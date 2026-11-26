// Panel and page commands that run inside the serialized mutation queue.
import {KEYS,assertRunOwner,patchState,stopState} from '../state.mjs';
import {postingCopyOperation,eligiblePostingCopies} from '../posting-copy.mjs';
import {K,ACCOUNT,read,write,writeAll,getApp,getTiming,timing,log,fail} from './context.mjs';
import {managed,actionGate,followQueue,queueFollowAllowed} from './services.mjs';
import {workspace} from './workspace.mjs';
import {getPostCopies,assertPostingReady,assertPostingCooldown} from './copies.mjs';
import {verifyFollowbackRoute,followbackWait,followbackSweepDone,followbackTransaction,followbackReview} from './followback.mjs';
import {replyClaim} from './replies.mjs';
import {runtime} from './runtime.mjs';

const WRITE_KINDS={posting:['post'],interaction:['reply','follow'],notifications:['reply'],followback:['follow']};
const PANEL_SECTIONS=['library','following','logs','time-settings'];
const TERMINAL_FOLLOW=['verified','skipped','unknown','failed','skipped_followback_ledger'];

export async function stopAll(){
 const service=await managed.set({enabled:false});
 // Managed workers drain submitted receipts; legacy/unassigned tasks are stopped directly.
 const owned=new Set(Object.values(service.workers).map(worker=>worker.tabId));
 for(const key of Object.values(KEYS)){const state=await read(key);if(!owned.has(state?.owner))await write(key,stopState(state));}
 await log('应急停止全部模块；已提交回执继续收尾，未知发送记录保留');
 return {stopped:true};
}

async function serviceSet(msg){
 const current=await managed.get(),selected=msg.selected?.posting??current.selected.posting;
 if(selected&&(msg.enabled===true||msg.selected?.posting===true))await assertPostingReady();
 const result=await managed.set(msg);
 await log('灯神总开关 · '+(result.enabled?'已开启':'已关闭'));
 return result;
}

// Reuse the console's profile-link evidence instead of trusting a saved service
// account after an X account switch. This read never submits.
async function postCopiesStatus(msg,sender){
 if(!ACCOUNT.test(msg.account||''))throw fail('登录账号尚未就绪，请刷新诊断');
 const account=msg.account.toLowerCase();
 const observed=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},func:()=>{
  const value=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  return /^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
 }});
 if(observed.length!==1||observed[0].result!==account||sender.documentId&&observed[0].documentId!==sender.documentId)
  throw fail('当前登录账号或页面已变化，请刷新本页后重新诊断');
 await workspace(msg,sender);
 const copies=await getPostCopies(),rows=copies.rows,current=await managed.get();
 return {protocol:2,version:chrome.runtime.getManifest().version,extensionId:chrome.runtime.id,account,revision:copies.revision,checkedAt:Date.now(),
  total:rows.length,counts:{enabled:rows.filter(row=>row.enabled).length,disabled:rows.filter(row=>!row.enabled).length},
  eligible:eligiblePostingCopies(rows).length,serviceAccountMismatch:!!(current.enabled&&current.account&&current.account!==account)};
}

async function followEnqueue(msg,sender,auth){
 const run=await read(KEYS.interaction);assertRunOwner(run,auth);
 await managed.authorize(sender.tab.id,'interaction',run.account);
 if(run.account!==msg.account||!await queueFollowAllowed(run.account))return 'skipped_disabled';
 const record=(await read(K.PROCESSED))?.posts?.[msg.postId];
 if(record?.reply!=='verified'||record.author?.toLowerCase()!=='@'+String(msg.author).toLowerCase())throw fail('仅已确认回复的作者可加入关注队列');
 const windowId=sender.tab.windowId??(await chrome.tabs.get(sender.tab.id)).windowId;
 return followQueue.enqueue({account:run.account,author:msg.author,postId:msg.postId,windowId});
}

async function action(msg,sender,auth){
 if(!WRITE_KINDS[msg.module]?.includes(msg.actionKind))throw fail('模块写操作类型无效');
 const state=await read(KEYS[msg.module]);assertRunOwner(state,auth);
 if(state.account?.toLowerCase()!==msg.account?.toLowerCase())throw fail('写操作账号不匹配');
 const binding={...auth,module:msg.module,account:state.account,kind:msg.actionKind,...(msg.afterReply===true?{afterReply:true}:{})};
 if(msg.kind==='ACTION_SETTLE'){
  const ack=await actionGate.settle({...binding,leaseId:msg.leaseId,outcome:msg.outcome});
  if(msg.module==='followback'&&ack.outcome==='released'){
   // A different worker may ACK another lease before this caller settles its target.
   const db=await read(K.FOLLOWBACK_LEDGER),entry=Object.values(db?.[state.account.toLowerCase()]||{}).find(v=>v.status==='in_flight'&&v.leaseId===ack.leaseId);
   if(entry&&!entry.releaseAck){entry.releaseAck=true;await write(K.FOLLOWBACK_LEDGER,db);}
  }
  return ack;
 }
 patchState(state,{},auth);await managed.authorize(sender.tab.id,msg.module,state.account);
 if(msg.module==='posting')await assertPostingCooldown(state.account);
 if(msg.module==='followback')await verifyFollowbackRoute(auth.owner,state.account);
 const lease=await actionGate.acquire(binding);
 try{await managed.authorize(sender.tab.id,msg.module,state.account);}
 catch(error){if(lease.granted)await actionGate.settle({...binding,leaseId:lease.leaseId,outcome:'released'}).catch(()=>{});throw error;}
 return lease;
}

async function timeSave(msg){
 const config=timing.normalize(msg.config);
 await write(timing.KEY,config);await log('时间控制已保存；已开始的冷却保持原截止时间');
 return config;
}

async function timeArm(msg,sender,auth){
 if(msg.name!=='interaction')throw fail('未知冷却模块');
 const state=await read(KEYS.interaction);
 patchState(state,{},auth);
 if(state.account?.toLowerCase()!==msg.account?.toLowerCase())throw fail('冷却账号不匹配');
 const end=Date.now()+timing.milliseconds(await getTiming(),'interaction');
 const db=await read(K.COOLDOWNS)||{},account=state.account.toLowerCase();
 db[account]={...db[account],interaction:end};
 await writeAll({[K.COOLDOWNS]:db,[KEYS.interaction]:patchState(state,{phase:'waiting',nextAt:end},auth)});
 await managed.trialDone('interaction',sender.tab.id,'互动轮结束，进入冷却');
 return end;
}

async function postCopiesOp(msg){
 const service=await managed.get(),runtimeState=await read(KEYS.posting);
 if(runtimeState?.phase==='unknown'||!runtimeState?.active&&runtimeState?.phase==='submitting')throw fail('请先处理未确认发送结果，再编辑发帖文案');
 const current=await getPostCopies(),next=postingCopyOperation(current,msg.op);
 if(service.enabled&&service.selected.posting||runtimeState?.active){
  // Ordinary single-row edits do not disturb a reserved copy or reset the posting deadline.
  const rowAt=rows=>rows.find(row=>row.id===runtimeState?.rowId);
  if(['opening','filling','submitting'].includes(runtimeState?.phase)&&JSON.stringify(rowAt(current.rows))!==JSON.stringify(rowAt(next.rows)))
   throw fail('这条文案正在发帖或等待回执，请稍后再改；其他文案可正常管理');
  if(!['upsert','delete','merge'].includes(msg.op.action)&&
     (next.rows.length<current.rows.length||!current.rows.every((row,i)=>JSON.stringify(row)===JSON.stringify(next.rows[i]))))
   throw fail('清空或批量调整已有文案前请先暂停发帖');
 }
 await write(K.POST_COPIES,next);
 if(service.enabled&&service.selected.posting&&!next.rows.some(row=>row.enabled)){
  try{await managed.set({selected:{posting:false}});}catch(error){await log('文案库已无启用稿件，关闭发帖开关失败：'+error.message);}
 }
 await log('发帖文案库更新：'+msg.op.action);
 return next;
}

async function followMerge(msg){
 if(!Array.isArray(msg.rows)||msg.rows.length>500)throw fail('关注记录无效');
 const db=await read(K.FOLLOWED)||{handles:{}};
 for(const row of msg.rows){
  if(!/^@[A-Za-z0-9_]{1,15}$/.test(row.handle||''))throw fail('关注账号无效');
  const handle=row.handle.slice(1).toLowerCase();db.handles[handle]={...db.handles[handle],...row};
 }
 await write(K.FOLLOWED,db);return db;
}

async function processed(msg,sender,documentId){
 if(!/^\d+$/.test(msg.id))throw fail('帖子 ID 无效');
 const db=await read(K.PROCESSED)||{posts:{}},old=db.posts[msg.id];
 if(msg.record.follow==='queued'&&old?.author===msg.record.author&&TERMINAL_FOLLOW.includes(old.follow))
  msg.record={...msg.record,follow:old.follow,...(old.followError?{followError:old.followError}:{})};
 db.posts[msg.id]=msg.record;
 // Never expire an uncertain submission; dropping that evidence can cause duplicate sends.
 const entries=Object.entries(db.posts).sort((a,b)=>String(b[1].at).localeCompare(String(a[1].at)));
 db.posts=Object.fromEntries(entries.filter(([,v],i)=>i<2000||['unknown','in_flight'].includes(v.reply)));
 await write(K.PROCESSED,db);
 const rec=msg.record,state=await read(KEYS.interaction);
 if(state?.active&&state.owner===sender.tab.id&&state.documentId===documentId&&(rec.error||rec.reply==='ai_error'||rec.follow==='unknown')){
  const lastIssue={code:rec.reasonCode||'ITEM_ERROR',message:rec.error||rec.reason||'关注结果未确认',targetId:msg.id};
  if(state.lastIssue?.targetId!==msg.id||state.lastIssue?.message!==lastIssue.message){
   await write(KEYS.interaction,patchState(state,{lastIssue},{owner:state.owner,runId:state.runId,documentId}));
   await log('互动 · '+lastIssue.code+' · '+lastIssue.message);
  }
 }
 return db;
}

async function openPanel(msg){
 const section=PANEL_SECTIONS.includes(msg.section)?msg.section:'library';
 await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'#'+section});
 return null;
}

const legacyLibrary=()=>{throw fail('旧文案库已移除，请使用发帖文案库');};

// from: which sender may issue the command. Mismatched senders fall through to
// the generic rejection, exactly like an unknown command.
export const COMMANDS={
 SERVICE_GET:{from:'any',run:()=>managed.get()},
 SERVICE_SET:{from:'any',run:serviceSet},
 SERVICE_REPAIR:{from:'any',run:msg=>managed.repair(msg.module)},
 SERVICE_FOCUS:{from:'any',run:msg=>managed.focus(msg.module)},
 SERVICE_TRIAL_ONCE:{from:'panel',run:msg=>managed.trialStart(msg.account,msg.requestId,msg.issuedAt,msg.only)},
 POST_COPIES_STATUS:{from:'page',run:(msg,c)=>postCopiesStatus(msg,c.sender)},
 WORKER_POLL:{from:'page',run:(msg,c)=>managed.poll(c.sender.tab.id)},
 WORKER_REPORT:{from:'page',run:(msg,c)=>managed.report(c.sender.tab.id,msg)},
 FOLLOWBACK_WAIT:{from:'page',run:(msg,c)=>followbackWait(msg,c.auth)},
 FOLLOWBACK_RESERVE:{from:'page',run:(msg,c)=>followbackTransaction(msg,c.auth)},
 FOLLOWBACK_SETTLE:{from:'page',run:(msg,c)=>followbackTransaction(msg,c.auth)},
 FOLLOWBACK_REVIEW:{from:'page',run:(msg,c)=>followbackReview(msg,c.auth)},
 FOLLOWBACK_SWEEP_DONE:{from:'page',run:(msg,c)=>followbackSweepDone(msg,c.auth)},
 REPLY_CLAIM:{from:'page',run:(msg,c)=>replyClaim(msg,c.sender,c.documentId)},
 REPLY_SETTLE:{from:'page',run:(msg,c)=>replyClaim(msg,c.sender,c.documentId)},
 FOLLOW_ENQUEUE:{from:'page',run:(msg,c)=>followEnqueue(msg,c.sender,c.auth)},
 ACTION_ACQUIRE:{from:'page',run:(msg,c)=>action(msg,c.sender,c.auth)},
 ACTION_SETTLE:{from:'page',run:(msg,c)=>action(msg,c.sender,c.auth)},
 TIME_GET:{from:'panel',run:()=>getTiming()},
 TIME_SAVE:{from:'panel',run:timeSave},
 TIME_ARM:{from:'page',run:(msg,c)=>timeArm(msg,c.sender,c.auth)},
 GET:{from:'panel',run:()=>getApp()},
 LIBRARY_OP:{from:'panel',run:legacyLibrary},
 POST_COPIES_GET:{from:'panel',run:()=>getPostCopies()},
 POST_COPIES_OP:{from:'panel',run:postCopiesOp},
 OPEN_PANEL:{from:'page',run:openPanel},
 FOLLOW_MERGE:{from:'page',run:followMerge},
 PROCESSED:{from:'page',run:(msg,c)=>processed(msg,c.sender,c.documentId)},
 RUNTIME:{from:'page',run:(msg,c)=>{if(!KEYS[msg.module])throw fail('未知或未授权命令');return runtime(msg,c.sender,c.documentId);}}
};
