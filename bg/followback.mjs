// Verified-follower follow-back. The durable target reservation and the submitting
// state are always one atomic write; an uncertain click is never retried.
import {KEYS,assertRunOwner,patchState} from '../state.mjs';
import {ACTION_GATE_KEY,sampleFollowbackInterval,FOLLOWBACK_MAX} from '../action-gate.mjs';
import {K,read,write,writeAll,log,fail} from './context.mjs';
import {managed} from './services.mjs';

const HANDLE=/^@[A-Za-z0-9_]{1,15}$/,TARGET_ID=/^\d{1,24}$/;

export async function verifyFollowbackRoute(owner,account){
 const tab=await chrome.tabs.get(owner);
 if(!globalThis.XAssistantServicePolicy.isFollowbackPage(tab.url,account))throw fail('不在当前账号的认证关注者页面，未回关',{code:'PAGE_CHANGED'});
}

async function ownedRun(msg,auth,mismatch){
 const s=await read(KEYS.followback);assertRunOwner(s,auth);
 if(s.account?.toLowerCase()!==msg.account?.toLowerCase())throw fail(mismatch);
 return s;
}

export async function followbackWait(msg,auth){
 if(msg.module!=='followback')throw fail('未知或未授权命令');
 const s=await ownedRun(msg,auth,'回关账号不匹配');
 if(!s.active||!['waiting','followback_scan'].includes(s.phase))throw fail('回关目标仍需收尾，不能重新计时');
 await managed.authorize(auth.owner,'followback',s.account);await verifyFollowbackRoute(auth.owner,s.account);
 if(Number.isFinite(s.nextAt)&&s.nextAt>Date.now())return {nextAt:s.nextAt};
 const nextAt=Date.now()+sampleFollowbackInterval();
 await write(KEYS.followback,patchState(s,{phase:'waiting',nextAt},auth));return {nextAt};
}

export async function followbackSweepDone(msg,auth){
 const s=await ownedRun(msg,auth,'完整遍历账号不匹配');
 await verifyFollowbackRoute(auth.owner,s.account);await write(K.FOLLOWBACK_SWEEP,false);
 const result=await managed.set({selected:{followback:false}});
 await log('followback · 认证关注者列表完整遍历完成，模块已关闭');return result;
}

async function reserve(msg,auth,{state,account,target,targetId,db,records,now}){
 await managed.authorize(auth.owner,'followback',account);patchState(state,{},auth);
 const prior=records[target]||(targetId&&Object.values(records).find(x=>x.targetId===targetId));
 if(prior&&['confirmed','unknown','in_flight'].includes(prior.status))return {claimed:false,reason:prior.status};
 if(['submitting','unknown'].includes(state.phase))throw fail('有待核对的回关，不会领取新目标');
 await verifyFollowbackRoute(auth.owner,account);
 const holder=(await read(ACTION_GATE_KEY))?.holder;
 if(holder?.module!=='followback'||holder.kind!=='follow'||holder.account!==account||holder.owner!==auth.owner||
    holder.documentId!==auth.documentId||holder.runId!==auth.runId||!(holder.expiresAt>Date.now()))throw fail('回关许可无效或过期，未点击');
 // Preserve uncertain follows recorded by the older interaction driver too.
 const processed=(await read(K.PROCESSED))?.posts||{};
 if(Object.values(processed).some(r=>r?.follow==='unknown'&&r.author?.toLowerCase()===target&&(!r.account||r.account.toLowerCase()===account))){
  db[account]={...records,[target]:{account,target,targetId,status:'unknown',source:'interaction',at:now}};
  await write(K.FOLLOWBACK_LEDGER,db);return {claimed:false,reason:'unknown'};
 }
 const entry={...auth,account,target,targetId,leaseId:holder.leaseId,claimId:crypto.randomUUID(),status:'in_flight',at:now};
 db[account]={...records,[target]:entry};
 const next=patchState(state,{phase:'submitting',text:target,submittedAt:new Date(now).toISOString()},auth);
 await writeAll({[K.FOLLOWBACK_LEDGER]:db,[KEYS.followback]:next});
 return {claimed:true,claimId:entry.claimId};
}

async function settle(msg,auth,{state,account,target,targetId,db,records,now}){
 const old=records[target],outcome=msg.outcome;
 if(!old||old.claimId!==msg.claimId||old.owner!==auth.owner||old.runId!==auth.runId||old.documentId!==auth.documentId||old.targetId!==targetId||
    !['confirmed','released','unknown','rate_limited'].includes(outcome))throw fail('回关记录不匹配，未更改');
 if(old.status==='confirmed'){
  if(outcome==='confirmed')return {status:'confirmed',nextAt:state.nextAt};
  throw fail('已确认的回关不能释放');
 }
 const receiptFor=kind=>msg.receipt?.kind===kind&&msg.receipt.target?.toLowerCase()===target&&msg.receipt.targetId===targetId;
 if(outcome==='confirmed'&&!receiptFor('following'))throw fail('回关成功必须有原账号已关注回执');
 if(outcome==='rate_limited'&&(old.status!=='in_flight'||!receiptFor('rate_limit')))throw fail('限流回执不匹配，保留待核对状态');
 if(outcome==='released'){
  const ack=(await read(ACTION_GATE_KEY))?.lastSettlement;
  if(old.status!=='in_flight'||(!old.releaseAck&&(ack?.leaseId!==old.leaseId||ack.outcome!=='released')))throw fail('回关未点击状态未获确认，不会自动重试');
  delete records[target];
 }else records[target]={...old,status:outcome==='rate_limited'?'unknown':outcome,at:now,...(outcome==='rate_limited'?{reasonCode:'FOLLOW_RATE_LIMIT'}:{})};
 let nextAt=null;
 if(state.active&&outcome==='confirmed'){
  const gate=await read(ACTION_GATE_KEY),persisted=gate?.accounts?.[account]?.followbackNotBefore,held=gate?.holder;
  // If the click ACK was lost but the platform readback is exact, use the
  // possible lease-expiry time; never schedule a second independent delay.
  nextAt=held?.leaseId===old.leaseId?held.expiresAt+(held.followbackGap||FOLLOWBACK_MAX):Number.isFinite(persisted)?persisted:now+FOLLOWBACK_MAX;
 }else if(state.active&&outcome==='released')nextAt=now+sampleFollowbackInterval();
 if(outcome==='rate_limited')nextAt=now+1800000;
 const next={...state,revision:(state.revision||0)+1,phase:outcome==='unknown'?'unknown':state.active?'waiting':'stopped',
  nextAt,error:outcome==='unknown'?'回关 '+target+' 结果未知，不会自动重试':null,
  ...(outcome==='confirmed'?{completed:(Number(state.completed)||0)+1,receipt:{kind:'following',target,targetId,at:now}}:{})};
 await writeAll({[K.FOLLOWBACK_LEDGER]:db,[KEYS.followback]:next});
 return {status:outcome,nextAt:next.nextAt};
}

export async function followbackTransaction(msg,auth){
 if(msg.module!=='followback'||!HANDLE.test(msg.target||'')||typeof msg.targetId!=='string'||!TARGET_ID.test(msg.targetId))throw fail('回关目标无效');
 const state=await read(KEYS.followback),account=state?.account?.toLowerCase(),target=msg.target.toLowerCase();
 assertRunOwner(state,auth);
 if(!account||account!==msg.account?.toLowerCase()||account.slice(1)===target.slice(1))throw fail('回关账号或目标不匹配');
 const db=await read(K.FOLLOWBACK_LEDGER)||{};
 const tx={state,account,target,targetId:msg.targetId,db,records:db[account]||{},now:Date.now()};
 return msg.kind==='FOLLOWBACK_RESERVE'?reserve(msg,auth,tx):settle(msg,auth,tx);
}

export async function followbackReview(msg,auth){
 if(msg.module!=='followback'||!HANDLE.test(msg.target||'')||!TARGET_ID.test(msg.targetId||'')||!['confirmed','not_following'].includes(msg.outcome))throw fail('回关核对结果无效');
 const state=await read(KEYS.followback),account=state?.account?.toLowerCase(),target=msg.target.toLowerCase(),service=await read(K.MANAGED_SERVICE);
 if(state?.active||state?.phase!=='unknown'||state.runId!==msg.runId||account!==msg.account?.toLowerCase()||service?.enabled!==true||
    service?.selected?.followback!==true||service?.account!==account||service?.workers?.followback?.tabId!==auth.owner)throw fail('回关核对任务已变化');
 await verifyFollowbackRoute(auth.owner,account);
 const db=await read(K.FOLLOWBACK_LEDGER)||{},records=db[account]||{},old=records[target],kind=msg.outcome==='confirmed'?'following':'not_following';
 if(!old||old.targetId!==msg.targetId||!['unknown','in_flight'].includes(old.status)||msg.receipt?.kind!==kind||
    msg.receipt.target?.toLowerCase()!==target||msg.receipt.targetId!==msg.targetId)throw fail('回关核对记录不匹配');
 records[target]={...old,status:msg.outcome==='confirmed'?'confirmed':'failed',at:Date.now(),receipt:msg.receipt};db[account]=records;
 const now=Date.now(),next={...state,active:false,phase:'stopped',nextAt:null,error:null,revision:(state.revision||0)+1,
  resolution:{automatic:true,outcome:msg.outcome,at:new Date(now).toISOString(),runId:state.runId,target,targetId:msg.targetId},
  ...(msg.outcome==='confirmed'?{completed:(Number(state.completed)||0)+1,receipt:{kind:'following',target,targetId:msg.targetId,at:now}}:{})};
 await writeAll({[K.FOLLOWBACK_LEDGER]:db,[KEYS.followback]:next});await log('followback · 自动核对 · '+target+' · '+msg.outcome);
 await managed.reconcile();return {resolved:true,outcome:msg.outcome};
}
