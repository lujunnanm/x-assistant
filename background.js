import {createFollowQueue,FOLLOW_QUEUE_KEY,FOLLOW_QUEUE_ALARM} from './interaction-follow-queue.mjs';
import {interactionFollowPage} from './interaction-follow-page.mjs';
import './time-policy.js';
import {prepareWorkerRepair} from './worker-repair.mjs';
import {createManagedService,BOUNDARY_ALARM,WATCHDOG_ALARM} from './managed-service.mjs';
import {createActionGate,ACTION_GATE_KEY,sampleFollowbackInterval,FOLLOWBACK_MAX} from './action-gate.mjs';
import {verifyCredential,API_KEY_STORAGE} from './deepseek-direct.mjs';
import {recoverGeneration} from './ai-recovery.mjs';
import {POST_SCHEDULE_KEY,restoreSchedule,confirmSchedule,scheduledStart} from './posting-schedule.mjs';
import {generateReply,generateNotificationReply,generateTimelineRewrite} from './ai-client.mjs';
import {normalizePostingCopies,postingCopyOperation,appendTimelineRewrite,validateTimelinePostingSource,timelinePostingAttachmentUrls,timelineRewriteRowId,timelineRewriteSourceId,eligiblePostingCopies} from './posting-copy.mjs';
import {fetchTimelineImages} from './timeline-images.mjs';
import {KEYS,abandonState,assertRunOwner,beginState,patchState,stopState,stopOwnedState,resolveState,reserveRow} from './state.mjs';
const timing=globalThis.XAssistantTimePolicy;
const getTiming=async()=>timing.normalize(await read(timing.KEY));
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
const read=async key=>(await chrome.storage.local.get(key))[key];
const write=(key,value)=>chrome.storage.local.set({[key]:value});
const POST_COPIES='xAssistantPostingCopiesV1',POST_LEDGER='xAssistantPostingLedgerV1',LEGACY_COPY_BACKUP='xAssistantLegacyCopyBackupV1';
const getPostCopies=async()=>normalizePostingCopies(await read(POST_COPIES));
async function getEligiblePostingRows(){return eligiblePostingCopies((await getPostCopies()).rows);}
async function postingCopiesStatus(msg,sender){
 if(!/^\/[A-Za-z0-9_]{1,15}$/.test(msg.account||''))throw Error('登录账号尚未就绪，请刷新诊断');
 const account=msg.account.toLowerCase();
 // Reuse the same profile-link evidence as the console, without trusting a
 // saved service account after an X account switch. This read never submits.
 const observed=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},func:()=>{
  const value=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  return /^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
 }});
 if(observed.length!==1||observed[0].result!==account||sender.documentId&&observed[0].documentId!==sender.documentId)throw Error('当前登录账号或页面已变化，请刷新本页后重新诊断');
 await workspace(msg,sender);
 const copies=await getPostCopies(),checkedAt=Date.now(),rows=copies.rows;
 const counts={enabled:rows.filter(row=>row.enabled).length,disabled:rows.filter(row=>!row.enabled).length};
 const eligible=eligiblePostingCopies(rows).length;
 const current=await managed.get();
 return {protocol:2,version:chrome.runtime.getManifest().version,extensionId:chrome.runtime.id,account,revision:copies.revision,checkedAt,total:rows.length,counts,eligible,
  serviceAccountMismatch:!!(current.enabled&&current.account&&current.account!==account)};
}
const managed=createManagedService({read,write,tabs:chrome.tabs,alarms:chrome.alarms,runtimeFor:module=>read(KEYS[module]),retireMissingRun,prepareWorkerRepair,canRecoverPosting:async run=>{const gate=await read(ACTION_GATE_KEY);return !gate?.holder&&(!run.submittedAt||run.receipt?.kind==='confirmed');},postingReady:async()=>(await getPostCopies()).rows.some(row=>row.enabled)});
const actionGate=createActionGate({read:async()=>{const state=await read(ACTION_GATE_KEY)||{};if(state.version===1)return state;return {...state,legacyFollowCooldown:await read('xAssistantFollowCooldownV1')||{},runtimes:Object.fromEntries(await Promise.all(['posting','interaction','notifications'].map(async module=>[module,await read(KEYS[module])])))};},write:state=>write(ACTION_GATE_KEY,state)});
let followQueueTimer=null,followQueueAt=Infinity;
function scheduleFollowQueue(at){
 if(followQueueAt<=at)return;
 clearTimeout(followQueueTimer);followQueueAt=at;
 chrome.alarms.create(FOLLOW_QUEUE_ALARM,{when:at});
 followQueueTimer=setTimeout(runFollowQueue,Math.max(1,at-Date.now()));
}
function runFollowQueue(){
 clearTimeout(followQueueTimer);followQueueTimer=null;followQueueAt=Infinity;
 // Durable wake survives a worker suspension during navigation or a click.
 chrome.alarms.create(FOLLOW_QUEUE_ALARM,{when:Date.now()+30000});
 followQueue.pump().catch(error=>serial(()=>log('独立关注队列：'+error.message)).catch(console.error)).finally(()=>{if(followQueueAt===Infinity)chrome.alarms.clear(FOLLOW_QUEUE_ALARM);});
}
async function queueFollowAllowed(account){
 const service=await managed.get(),run=await read(KEYS.interaction);
 return service.enabled&&service.selected.interaction&&service.account===account&&run?.active&&run.account===account&&service.workers.interaction?.tabId===run.owner&&(await read('xAssistantAutoFollowV1'))!==false;
}
const followQueue=createFollowQueue({
 read:()=>read(FOLLOW_QUEUE_KEY),write:value=>write(FOLLOW_QUEUE_KEY,value),tabs:chrome.tabs,gate:actionGate,
 allowed:queueFollowAllowed,schedule:scheduleFollowQueue,
 page:async(tabId,row,mode,permit)=>{
  const results=await chrome.scripting.executeScript({target:permit?.documentId?{tabId,documentIds:[permit.documentId]}:{tabId,frameIds:[0]},func:interactionFollowPage,args:[row,mode,permit||null]});
  if(results.length!==1)throw Error('独立关注页面返回异常');return results[0];
 },
 reserved:async(row,targetId)=>{const records=(await read('xAssistantFollowbackLedgerV1'))?.[row.account]||{};return !!records['@'+row.author]||!!targetId&&Object.values(records).some(r=>r.targetId===targetId);},
 notify:row=>serial(async()=>{
  const db=await read('xAssistantProcessedV1')||{posts:{}};
  for(const id of row.postIds){const record=db.posts[id];if(record?.reply==='verified'&&record.author?.toLowerCase()==='@'+row.author){record.follow=row.status;if(row.error)record.followError=row.error;}}
  await write('xAssistantProcessedV1',db);
  if(['verified','skipped'].includes(row.status)){
   const followed=await read('xAssistantFollowedV1')||{handles:{}};
   followed.handles[row.author]={...followed.handles[row.author],handle:'@'+row.author,owner:row.account.slice(1),source:row.status==='verified'?'interaction':'observed',lastSeenAt:new Date().toISOString()};
   await write('xAssistantFollowedV1',followed);
  }
  await log('独立关注 · @'+row.author+' · '+row.status+(row.error?' · '+row.error:''));
 })
});
const getApp=async()=>({rows:[],logs:[],revision:0,...await read('app')});
const WORKSPACES='xAssistantWorkspaceOwnersV1',AI_STATUS='xAssistantAIStatusV2',REPLY_CLAIMS='xAssistantReplyClaimsV1';
const FOLLOWBACK_LEDGER='xAssistantFollowbackLedgerV1';
const modules=['posting','interaction','notifications']; // AI clients only. Follow-back never uses AI.
const isPanel=sender=>sender.url?.split('#')[0]===chrome.runtime.getURL('panel.html');
const isPage=sender=>Number.isInteger(sender.tab?.id)&&(!Number.isInteger(sender.frameId)||sender.frameId===0)&&/^https:\/\/x\.com\//.test(sender.url||'');
const identity=(msg,sender)=>`${sender.documentId||'instance'}:${msg.instanceId||''}`;
async function workspace(msg,sender){
 const entry=(await read(WORKSPACES))?.[sender.tab.id];
 if(!entry||entry.identity!==identity(msg,sender)||entry.instanceId!==msg.instanceId||sender.documentLifecycle&&sender.documentLifecycle!=='active')throw Error('页面实例已失效，请刷新后重新启动');
 return entry.identity;
}
async function retireFollowbacks(owner){
 const db=await read(FOLLOWBACK_LEDGER);if(!db)return;
 let changed=false;
 for(const records of Object.values(db))for(const entry of Object.values(records)){
  if(entry.status==='in_flight'&&(owner==null||entry.owner===owner)){entry.status='unknown';entry.at=Date.now();changed=true;}
 }
 if(changed)await write(FOLLOWBACK_LEDGER,db);
}
async function stopTab(id){
 for(const key of Object.values(KEYS)){
  const s=await read(key);if(s?.owner===id&&s.active)await write(key,stopState(s));
 }
 const claims=await read(REPLY_CLAIMS)||{};let changed=false;
 for(const account of Object.values(claims))for(const claim of Object.values(account))if(claim.owner===id&&claim.status==='in_flight'){claim.status='unknown';claim.at=Date.now();changed=true;}
 if(changed)await write(REPLY_CLAIMS,claims);
 await retireFollowbacks(id);
}
// Called inside the serialized supervisor after tabs.get(run.owner) positively
// confirms closure. Retire only this run; keep pending clicks quarantined.
async function retireMissingRun(module,expected){
 const key=KEYS[module],run=await read(key);
 const matches=x=>x?.owner===expected.owner&&x?.runId===expected.runId&&x?.documentId===expected.documentId;
 if(!run?.active||!matches(run)||run.account!==expected.account)return;
 const stopped=stopState(run),updates={[key]:stopped};
 const ledgerKey=module==='followback'?FOLLOWBACK_LEDGER:['interaction','notifications'].includes(module)?REPLY_CLAIMS:null;
 if(ledgerKey){
  const db=await read(ledgerKey),entries=db?.[run.account.toLowerCase()]||{};
  for(const entry of Object.values(entries))if(matches(entry)&&entry.status==='in_flight'&&(module==='followback'||entry.module===module)){
   entry.status='unknown';entry.at=Date.now();updates[ledgerKey]=db;stopped.phase='unknown';
  }
 }
 const holder=(await read(ACTION_GATE_KEY))?.holder;
 if(holder?.module===module&&matches(holder))stopped.phase='unknown';
 await chrome.storage.local.set(updates);
}
async function hello(msg,sender){
 if(typeof msg.instanceId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(msg.instanceId))throw Error('页面实例标识无效');
 if(sender.documentLifecycle&&sender.documentLifecycle!=='active')throw Error('页面已经离开前台文档');
 const db=await read(WORKSPACES)||{},previous=db[sender.tab.id],next=identity(msg,sender);
 if(previous?.identity===next)return {tabId:sender.tab.id,assignment:await managed.assignment(sender.tab.id)};
 if(previous?.retired?.includes(next))throw Error('旧页面实例不能重新接管任务');
 await stopTab(sender.tab.id);
 db[sender.tab.id]={identity:next,instanceId:msg.instanceId,documentId:sender.documentId||null,retired:[...(previous?.retired||[]),...(previous?[previous.identity]:[])],at:Date.now()};
 await write(WORKSPACES,db);
 return {tabId:sender.tab.id,assignment:await managed.assignment(sender.tab.id)};
}
async function aiStatus(module,entry){
 const states=await read(AI_STATUS)||{};
 await write(AI_STATUS,{...states,[module]:{module,...entry,time:Date.now()}});
}
async function replyClaim(msg,sender,documentId){
 if(!['interaction','notifications'].includes(msg.module)||!/^\d+$/.test(msg.postId||''))throw Error('回复目标无效');
 const state=await read(KEYS[msg.module]),auth={owner:sender.tab.id,runId:msg.runId,documentId};
 // Settlement is allowed after a local Stop, but never after a replacement run/document.
 assertRunOwner(state,auth);
 const account=state.account?.toLowerCase();
 if(account!==msg.account?.toLowerCase())throw Error('回复账号不匹配');
 const db=await read(REPLY_CLAIMS)||{},records=db[account]||{},old=records[msg.postId];
 if(msg.kind==='REPLY_CLAIM'){
  await managed.authorize(sender.tab.id,msg.module,account);
  patchState(state,{},auth);
  if(old&&['confirmed','unknown','in_flight'].includes(old.status))return {claimed:false,reason:old.status};
  const processed=(await read('xAssistantProcessedV1'))?.posts?.[msg.postId];
  const prior=(!processed?.account||processed.account.toLowerCase()===account)?processed:null;
  const notification=(await read('xAssistantNotificationRepliesV1'))?.[account]?.records?.[msg.postId];
  if(prior?.reply==='verified'||['confirmed','previously_processed'].includes(notification?.status))return {claimed:false,reason:'confirmed'};
  if(['unknown','in_flight'].includes(prior?.reply)||['unknown','in_flight'].includes(notification?.status))return {claimed:false,reason:'unknown'};
  await managed.authorize(sender.tab.id,msg.module,account);
  const claim={claimId:crypto.randomUUID(),module:msg.module,runId:msg.runId,owner:sender.tab.id,documentId,status:'in_flight',at:Date.now()};
  db[account]={...records,[msg.postId]:claim};await write(REPLY_CLAIMS,db);
  return {claimed:true,claimId:claim.claimId};
 }
 if(!old||old.claimId!==msg.claimId||old.module!==msg.module||old.runId!==msg.runId||old.owner!==sender.tab.id||old.documentId!==documentId)throw Error('回复占位已失效');
 if(!['confirmed','unknown','released'].includes(msg.outcome))throw Error('回复结果无效');
 if(old.status==='confirmed'&&msg.outcome!=='confirmed')throw Error('已确认回复不得降级');
 if(old.status==='unknown'&&msg.outcome==='released')throw Error('未知发送结果不得自动释放');
 if(msg.outcome==='confirmed'&&msg.receipt?.kind!=='confirmed')throw Error('回复成功必须有平台回执');
 records[msg.postId]={...old,status:msg.outcome,at:Date.now(),...(msg.receipt?{receipt:msg.receipt}:{})};db[account]=records;
 await write(REPLY_CLAIMS,db);return records[msg.postId];
}
// A verified follower is attempted only by the managed account's own list. The
// durable target reservation and submitting state are one atomic storage write.
async function verifyFollowbackRoute(owner,account){
 const tab=await chrome.tabs.get(owner);
 if(!globalThis.XAssistantServicePolicy.isFollowbackPage(tab.url,account))throw Object.assign(Error('不在当前账号的认证关注者页面，未回关'),{code:'PAGE_CHANGED'});
}
async function followbackTransaction(msg,auth){
 if(msg.module!=='followback'||!/^@[A-Za-z0-9_]{1,15}$/.test(msg.target||'')||
    (typeof msg.targetId!=='string'||!/^\d{1,24}$/.test(msg.targetId)))throw Error('回关目标无效');
 const key=KEYS.followback,state=await read(key),account=state?.account?.toLowerCase(),target=msg.target.toLowerCase();
 assertRunOwner(state,auth);
 if(!account||account!==msg.account?.toLowerCase()||account.slice(1)===target.slice(1))throw Error('回关账号或目标不匹配');
 const db=await read(FOLLOWBACK_LEDGER)||{},records=db[account]||{},targetId=msg.targetId,now=Date.now();
 if(msg.kind==='FOLLOWBACK_RESERVE'){
  await managed.authorize(auth.owner,'followback',account);patchState(state,{},auth);
  const prior=records[target]||(targetId&&Object.values(records).find(x=>x.targetId===targetId));
  if(prior&&['confirmed','unknown','in_flight'].includes(prior.status))return {claimed:false,reason:prior.status};
  if(['submitting','unknown'].includes(state.phase))throw Error('有待核对的回关，不会领取新目标');
  await verifyFollowbackRoute(auth.owner,account);
  const holder=(await read(ACTION_GATE_KEY))?.holder;
  if(holder?.module!=='followback'||holder.kind!=='follow'||holder.account!==account||holder.owner!==auth.owner||holder.documentId!==auth.documentId||holder.runId!==auth.runId||!(holder.expiresAt>Date.now()))throw Error('回关许可无效或过期，未点击');
  // Preserve uncertain follows recorded by the older interaction driver too.
  const processed=(await read('xAssistantProcessedV1'))?.posts||{};
  if(Object.values(processed).some(r=>r?.follow==='unknown'&&r.author?.toLowerCase()===target&&(!r.account||r.account.toLowerCase()===account))){
   db[account]={...records,[target]:{account,target,targetId,status:'unknown',source:'interaction',at:now}};
   await write(FOLLOWBACK_LEDGER,db);return {claimed:false,reason:'unknown'};
  }
  const entry={...auth,account,target,targetId,leaseId:holder.leaseId,claimId:crypto.randomUUID(),status:'in_flight',at:now};
  db[account]={...records,[target]:entry};
  const next=patchState(state,{phase:'submitting',text:target,submittedAt:new Date(now).toISOString()},auth);
  await chrome.storage.local.set({[FOLLOWBACK_LEDGER]:db,[key]:next});
  return {claimed:true,claimId:entry.claimId};
 }
 const old=records[target],outcome=msg.outcome;
 if(!old||old.claimId!==msg.claimId||old.owner!==auth.owner||old.runId!==auth.runId||old.documentId!==auth.documentId||old.targetId!==targetId||!['confirmed','released','unknown','rate_limited'].includes(outcome))throw Error('回关记录不匹配，未更改');
 if(old.status==='confirmed'){
  if(outcome==='confirmed')return {status:'confirmed',nextAt:state.nextAt};throw Error('已确认的回关不能释放');
 }
 if(outcome==='confirmed'&&(msg.receipt?.kind!=='following'||msg.receipt.target?.toLowerCase()!==target||msg.receipt.targetId!==targetId))throw Error('回关成功必须有原账号已关注回执');
 if(outcome==='rate_limited'&&(old.status!=='in_flight'||msg.receipt?.kind!=='rate_limit'||msg.receipt.target?.toLowerCase()!==target||msg.receipt.targetId!==targetId))throw Error('限流回执不匹配，保留待核对状态');
 if(outcome==='released'){
  const ack=(await read(ACTION_GATE_KEY))?.lastSettlement;
  if(old.status!=='in_flight'||(!old.releaseAck&&(ack?.leaseId!==old.leaseId||ack.outcome!=='released')))throw Error('回关未点击状态未获确认，不会自动重试');
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
 await chrome.storage.local.set({[FOLLOWBACK_LEDGER]:db,[key]:next});return {status:outcome,nextAt:next.nextAt};
}
async function followbackReview(msg,auth){
 if(msg.module!=='followback'||!/^@[A-Za-z0-9_]{1,15}$/.test(msg.target||'')||!/^\d{1,24}$/.test(msg.targetId||'')||!['confirmed','not_following'].includes(msg.outcome))throw Error('回关核对结果无效');
 const state=await read(KEYS.followback),account=state?.account?.toLowerCase(),target=msg.target.toLowerCase(),service=await read('xAssistantManagedServiceV1');
 if(state?.active||state?.phase!=='unknown'||state.runId!==msg.runId||account!==msg.account?.toLowerCase()||service?.enabled!==true||service?.selected?.followback!==true||service?.account!==account||service?.workers?.followback?.tabId!==auth.owner)throw Error('回关核对任务已变化');
 await verifyFollowbackRoute(auth.owner,account);
 const db=await read(FOLLOWBACK_LEDGER)||{},records=db[account]||{},old=records[target],kind=msg.outcome==='confirmed'?'following':'not_following';
 if(!old||old.targetId!==msg.targetId||!['unknown','in_flight'].includes(old.status)||msg.receipt?.kind!==kind||msg.receipt.target?.toLowerCase()!==target||msg.receipt.targetId!==msg.targetId)throw Error('回关核对记录不匹配');
 records[target]={...old,status:msg.outcome==='confirmed'?'confirmed':'failed',at:Date.now(),receipt:msg.receipt};db[account]=records;
 const now=Date.now(),next={...state,active:false,phase:'stopped',nextAt:null,error:null,revision:(state.revision||0)+1,
  resolution:{automatic:true,outcome:msg.outcome,at:new Date(now).toISOString(),runId:state.runId,target,targetId:msg.targetId},
  ...(msg.outcome==='confirmed'?{completed:(Number(state.completed)||0)+1,receipt:{kind:'following',target,targetId:msg.targetId,at:now}}:{})};
 await chrome.storage.local.set({[FOLLOWBACK_LEDGER]:db,[KEYS.followback]:next});await log('followback · 自动核对 · '+target+' · '+msg.outcome);
 await managed.reconcile();return {resolved:true,outcome:msg.outcome};
}
async function log(message){const app=await getApp();app.logs=[{time:new Date().toISOString(),message},...(app.logs||[])].slice(0,100);await write('app',app);}
async function handle(msg,sender){
 const panel=isPanel(sender),page=isPage(sender);
 if(!panel&&!page)throw Error('无效消息来源');
 if(msg.kind==='PING')return null;
 if(msg.kind==='WORKSPACE_HELLO'&&page)return hello(msg,sender);
 if(msg.kind==='STOP_ALL'&&panel){
  const service=await managed.set({enabled:false});
  // Managed workers drain submitted receipts; legacy/unassigned tasks are stopped directly.
  const owned=new Set(Object.values(service.workers).map(worker=>worker.tabId));
  for(const key of Object.values(KEYS)){const state=await read(key);if(!owned.has(state?.owner))await write(key,stopState(state));}
  await log('应急停止全部模块；已提交回执继续收尾，未知发送记录保留');return {stopped:true};
 }
 const documentId=page&&(msg.kind!=='RUNTIME'||msg.action!=='get')?await workspace(msg,sender):null;
 const auth={owner:sender.tab?.id,runId:msg.runId,documentId};
 if(msg.kind==='SERVICE_GET')return managed.get();
 if(msg.kind==='POST_COPIES_STATUS'&&page)return postingCopiesStatus(msg,sender);
 if(msg.kind==='SERVICE_TRIAL_ONCE'&&panel)return managed.trialStart(msg.account,msg.requestId,msg.issuedAt,msg.only);
 if(msg.kind==='SERVICE_SET'){
  const current=await managed.get(),selected=msg.selected?.posting??current.selected.posting;
  if(selected&&(msg.enabled===true||msg.selected?.posting===true)){
   const {rows}=await getPostCopies();
   if(!eligiblePostingCopies(rows).length)throw Object.assign(Error(rows.length?'库内文案均已停用，请在文案库启用至少一条':'文案库为空，请先添加发帖文案'),{code:'POST_LIBRARY_EMPTY'});
  }
  const result=await managed.set(msg);await log('神圣计划总开关 · '+(result.enabled?'已开启':'已关闭'));return result;}
 if(msg.kind==='SERVICE_REPAIR')return managed.repair(msg.module);
 if(msg.kind==='SERVICE_FOCUS')return managed.focus(msg.module);
 if(msg.kind==='WORKER_POLL'&&page)return managed.poll(sender.tab.id);
 if(msg.kind==='WORKER_REPORT'&&page)return managed.report(sender.tab.id,msg);
 if(msg.kind==='FOLLOWBACK_WAIT'&&page&&msg.module==='followback'){
  const s=await read(KEYS.followback);assertRunOwner(s,auth);
  if(s.account?.toLowerCase()!==msg.account?.toLowerCase())throw Error('回关账号不匹配');
  if(!s.active||!['waiting','followback_scan'].includes(s.phase))throw Error('回关目标仍需收尾，不能重新计时');
  await managed.authorize(auth.owner,'followback',s.account);await verifyFollowbackRoute(auth.owner,s.account);
  if(Number.isFinite(s.nextAt)&&s.nextAt>Date.now())return {nextAt:s.nextAt};
  const nextAt=Date.now()+sampleFollowbackInterval();
  await write(KEYS.followback,patchState(s,{phase:'waiting',nextAt},auth));return {nextAt};
 }
 if(page&&['FOLLOWBACK_RESERVE','FOLLOWBACK_SETTLE'].includes(msg.kind))return followbackTransaction(msg,auth);
 if(page&&msg.kind==='FOLLOWBACK_REVIEW')return followbackReview(msg,auth);
 if(page&&msg.kind==='FOLLOWBACK_SWEEP_DONE'){
  const s=await read(KEYS.followback);assertRunOwner(s,auth);if(s.account?.toLowerCase()!==msg.account?.toLowerCase())throw Error('完整遍历账号不匹配');
  await verifyFollowbackRoute(auth.owner,s.account);await write('xAssistantFollowbackSweepV1',false);const result=await managed.set({selected:{followback:false}});await log('followback · 认证关注者列表完整遍历完成，模块已关闭');return result;
 }
 if((msg.kind==='REPLY_CLAIM'||msg.kind==='REPLY_SETTLE')&&page)return replyClaim(msg,sender,documentId);
 if(msg.kind==='FOLLOW_ENQUEUE'&&page){
  const run=await read(KEYS.interaction);assertRunOwner(run,auth);
  await managed.authorize(sender.tab.id,'interaction',run.account);
  if(run.account!==msg.account||!await queueFollowAllowed(run.account))return 'skipped_disabled';
  const record=(await read('xAssistantProcessedV1'))?.posts?.[msg.postId];
  if(record?.reply!=='verified'||record.author?.toLowerCase()!=='@'+String(msg.author).toLowerCase())throw Error('仅已确认回复的作者可加入关注队列');
  const windowId=sender.tab.windowId??(await chrome.tabs.get(sender.tab.id)).windowId;
  return followQueue.enqueue({account:run.account,author:msg.author,postId:msg.postId,windowId});
 }
 if((msg.kind==='ACTION_ACQUIRE'||msg.kind==='ACTION_SETTLE')&&page){
  const kinds={posting:['post'],interaction:['reply','follow'],notifications:['reply'],followback:['follow']};
  if(!kinds[msg.module]?.includes(msg.actionKind))throw Error('模块写操作类型无效');
  const state=await read(KEYS[msg.module]);assertRunOwner(state,auth);
  if(state.account?.toLowerCase()!==msg.account?.toLowerCase())throw Error('写操作账号不匹配');
  const binding={...auth,module:msg.module,account:state.account,kind:msg.actionKind,...(msg.afterReply===true?{afterReply:true}:{})};
  if(msg.kind==='ACTION_SETTLE'){
   const ack=await actionGate.settle({...binding,leaseId:msg.leaseId,outcome:msg.outcome});
   if(msg.module==='followback'&&ack.outcome==='released'){
    // A different worker may ACK another lease before this caller settles its target.
    const db=await read(FOLLOWBACK_LEDGER),entry=Object.values(db?.[state.account.toLowerCase()]||{}).find(v=>v.status==='in_flight'&&v.leaseId===ack.leaseId);
    if(entry&&!entry.releaseAck){entry.releaseAck=true;await write(FOLLOWBACK_LEDGER,db);}
   }
   return ack;
  }
  patchState(state,{},auth);await managed.authorize(sender.tab.id,msg.module,state.account);
  if(msg.module==='followback')await verifyFollowbackRoute(auth.owner,state.account);
  const lease=await actionGate.acquire(binding);
  try{await managed.authorize(sender.tab.id,msg.module,state.account);}
  catch(error){if(lease.granted)await actionGate.settle({...binding,leaseId:lease.leaseId,outcome:'released'}).catch(()=>{});throw error;}
  return lease;
 }

 if(msg.kind==='TIME_GET'&&panel)return getTiming();
 if(msg.kind==='TIME_SAVE'&&panel){const config=timing.normalize(msg.config);await write(timing.KEY,config);await log('时间控制已保存；已开始的冷却保持原截止时间');return config;}
 if(msg.kind==='TIME_ARM'&&page){
  if(msg.name!=='interaction')throw Error('未知冷却模块');
  const state=await read(KEYS.interaction);
  patchState(state,{},auth);
  if(state.account?.toLowerCase()!==msg.account?.toLowerCase())throw Error('冷却账号不匹配');
  const end=Date.now()+timing.milliseconds(await getTiming(),'interaction');
  const db=await read('xAssistantCooldownsV1')||{},account=state.account.toLowerCase();
  db[account]={...db[account],interaction:end};
  await chrome.storage.local.set({xAssistantCooldownsV1:db,[KEYS.interaction]:patchState(state,{phase:'waiting',nextAt:end},auth)});
  await managed.trialDone('interaction',sender.tab.id,'互动轮结束，进入冷却');
  return end;
 }
 if(msg.kind==='GET'&&panel)return getApp();
 if(msg.kind==='LIBRARY_OP'&&panel)throw Error('旧文案库已移除，请使用发帖文案库');
 if(msg.kind==='POST_COPIES_GET'&&panel)return getPostCopies();
 if(msg.kind==='POST_COPIES_OP'&&panel){
  const service=await managed.get(),runtime=await read(KEYS.posting);
  if(runtime?.phase==='unknown'||!runtime?.active&&runtime?.phase==='submitting')throw Error('请先处理未确认发送结果，再编辑发帖文案');
  const current=await getPostCopies(),next=postingCopyOperation(current,msg.op);
  if(service.enabled&&service.selected.posting||runtime?.active){
   // Serialized with opening and confirmation. Ordinary single-row edits do
   // not disturb a reserved copy or reset the posting deadline.
   const rowAt=rows=>rows.find(row=>row.id===runtime?.rowId);
   if(['opening','filling','submitting'].includes(runtime?.phase)&&JSON.stringify(rowAt(current.rows))!==JSON.stringify(rowAt(next.rows)))
    throw Error('这条文案正在发帖或等待回执，请稍后再改；其他文案可正常管理');
   if(!['upsert','delete','merge'].includes(msg.op.action)&&
      (next.rows.length<current.rows.length||!current.rows.every((row,i)=>JSON.stringify(row)===JSON.stringify(next.rows[i]))))
    throw Error('清空或批量调整已有文案前请先暂停发帖');
  }
  await write(POST_COPIES,next);
  if(service.enabled&&service.selected.posting&&!next.rows.some(row=>row.enabled)){
   try{await managed.set({selected:{posting:false}});}catch(error){await log('文案库已无启用稿件，关闭发帖开关失败：'+error.message);}
  }
  await log('发帖文案库更新：'+msg.op.action);return next;
 }
 if(msg.kind==='OPEN_PANEL'&&page){await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'#'+(['library','following','logs','time-settings'].includes(msg.section)?msg.section:'library')});return null;}
 if(msg.kind==='FOLLOW_MERGE'&&page){
  if(!Array.isArray(msg.rows)||msg.rows.length>500)throw Error('关注记录无效');
  const db=await read('xAssistantFollowedV1')||{handles:{}};
  for(const row of msg.rows){if(!/^@[A-Za-z0-9_]{1,15}$/.test(row.handle||''))throw Error('关注账号无效');db.handles[row.handle.slice(1).toLowerCase()]={...db.handles[row.handle.slice(1).toLowerCase()],...row};}
  await write('xAssistantFollowedV1',db);return db;
 }
 if(msg.kind==='PROCESSED'&&page){
  if(!/^\d+$/.test(msg.id))throw Error('帖子 ID 无效');
  const db=await read('xAssistantProcessedV1')||{posts:{}};
  const old=db.posts[msg.id];
  if(msg.record.follow==='queued'&&old?.author===msg.record.author&&['verified','skipped','unknown','failed','skipped_followback_ledger'].includes(old.follow))msg.record={...msg.record,follow:old.follow,...(old.followError?{followError:old.followError}:{})};
  db.posts[msg.id]=msg.record;
  // Never expire an uncertain submission; dropping that evidence can cause duplicate sends.
  const entries=Object.entries(db.posts).sort((a,b)=>String(b[1].at).localeCompare(String(a[1].at)));
  db.posts=Object.fromEntries(entries.filter(([,v],i)=>i<2000||['unknown','in_flight'].includes(v.reply)));
  await write('xAssistantProcessedV1',db);
  const rec=msg.record,state=await read(KEYS.interaction);
  if(state?.active&&state.owner===sender.tab.id&&state.documentId===documentId&&(rec.error||rec.reply==='ai_error'||rec.follow==='unknown')){
   const lastIssue={code:rec.reasonCode||'ITEM_ERROR',message:rec.error||rec.reason||'关注结果未确认',targetId:msg.id};
   if(state.lastIssue?.targetId!==msg.id||state.lastIssue?.message!==lastIssue.message){
    await write(KEYS.interaction,patchState(state,{lastIssue},{owner:state.owner,runId:state.runId,documentId}));await log('互动 · '+lastIssue.code+' · '+lastIssue.message);
   }
  }
  return db;
 }
 if(msg.kind!=='RUNTIME'||!page||!KEYS[msg.module])throw Error('未知或未授权命令');
 if(msg.module==='cleanup')throw Error('清理模块已移除');
 const key=KEYS[msg.module],s=await read(key)||{},owner=sender.tab.id;
 if(msg.action==='get')return s;
 let next;
 if(msg.action==='begin'||msg.action==='prepare'){
  await managed.authorize(owner,msg.module,msg.account);
  if(msg.module==='posting'&&!(await getEligiblePostingRows()).length)throw Error('当前文案库没有启用文案');
  const states=await Promise.all(Object.entries(KEYS).filter(([name])=>name!==msg.module).map(async([name,otherKey])=>[name,await read(otherKey)||{}]));
  const other=states.filter(([name])=>name!=='cleanup').map(([,state])=>state);
  next=beginState(s,other,{owner,documentId,account:msg.account,resume:msg.resume});
  if(msg.module==='posting')delete next.libraryRemaining;
  if(msg.action==='prepare'){await managed.authorize(owner,msg.module,msg.account);return {account:next.account,owner:next.owner};}
 }else if(msg.action==='stop')next=stopOwnedState(s,auth);
 else if(msg.action==='resolve')next=resolveState(s,msg);
 else if(msg.action==='abandon')next=abandonState(s,msg);
 else if(msg.action==='patch'){
  if(msg.module==='followback'&&msg.patch?.phase&&(msg.patch.phase==='submitting'||['submitting','unknown'].includes(s.phase)&&msg.patch.phase!==s.phase))throw Error('回关提交状态只能通过目标事务变更');
  if(msg.patch?.phase==='submitting'||msg.module==='posting'&&msg.patch?.phase==='opening')await managed.authorize(owner,msg.module,s.account);
  if(msg.module==='posting'&&msg.patch?.phase==='opening'){
   patchState(s,{},auth);
   const copies=await getPostCopies(),first=copies.rows.find(row=>row.enabled);
   if(!first||msg.patch.libraryRevision!==copies.revision||first.id!==msg.patch.rowId||first.text!==msg.patch.text)
    throw Object.assign(Error('文案库已更新，重新选择启用稿件'),{code:'POST_COPY_CHANGED'});
  }
  next=patchState(s,msg.patch,auth);
 }
 else if(msg.action==='pick'){
  await managed.authorize(owner,msg.module,s.account);
  if(msg.module==='cleanup'||msg.module==='followback')throw Error('此模块不使用文案库');
  patchState(s,{},auth);
  if(msg.module==='posting'){
   const copies=await getPostCopies(),row=copies.rows.find(row=>row.enabled);
   if(!row)throw Error('当前文案库没有启用文案');
   await managed.authorize(owner,msg.module,s.account);return {...row,type:'post',libraryRevision:copies.revision};
  }
  const chosen=reserveRow(s,(await getApp()).rows,'reply');
  await managed.authorize(owner,msg.module,s.account);await write(key,chosen.state);return chosen.row;
 }else throw Error('未知运行操作');
 if(msg.module==='posting'&&(next.account||s.account)){
  const schedules=await read(POST_SCHEDULE_KEY)||{};
  const time=await getTiming();
  let schedule=restoreSchedule(schedules,next.account||s.account,s,Date.now(),time);
  let copiesUpdate=null,disablePosting=false;
  if(msg.action==='patch'&&msg.patch?.phase==='confirmed'){
   if(msg.patch.receipt?.kind!=='confirmed')throw Error('发帖成功必须有平台回执');
   if((s.phase!=='submitting'&&s.phase!=='confirmed')||typeof s.rowId!=='string'||!s.rowId||typeof s.text!=='string'||!s.submittedAt)throw Error('发帖成功记录缺少文案绑定，未删除文案库条目');
   const replay=schedule.confirmedRunId===s.runId&&schedule.confirmedSubmittedAt===s.submittedAt;
   const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===s.rowId);
   if(index<0&&!replay)throw Error('待删除文案已不在文案库，未写入成功状态');
   if(index>=0&&copies.rows[index].text!==s.text)throw Error('文案内容已变化，未删除文案库条目');
   if(index>=0)copiesUpdate={revision:copies.revision+1,rows:copies.rows.filter((_,i)=>i!==index)};
   const remaining=copiesUpdate||copies;
   next.libraryRemaining=eligiblePostingCopies(remaining.rows).length;
   disablePosting=next.libraryRemaining===0;
   // Idempotent receipt replay cannot move the deadline or delete another row.
   schedule=replay?schedule:{...confirmSchedule(Date.now(),Math.random,time),confirmedRunId:s.runId,confirmedSubmittedAt:s.submittedAt};
   next.nextAt=schedule.nextPostAt;
  }else if(['resolve','abandon'].includes(msg.action)&&typeof s.rowId==='string'&&s.rowId&&typeof s.text==='string'){
   // A human-reviewed unknown result is retained but disabled, so ordered
   // selection can continue without ever retrying the uncertain post.
   const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===s.rowId);
   if(index>=0&&copies.rows[index].text!==s.text)throw Error('待核对文案内容已变化，未继续发帖');
   if(index>=0&&copies.rows[index].enabled)copiesUpdate={revision:copies.revision+1,rows:copies.rows.map((row,i)=>i===index?{...row,enabled:false}:row)};
   const remaining=copiesUpdate||copies;
   next.libraryRemaining=eligiblePostingCopies(remaining.rows).length;
   disablePosting=next.libraryRemaining===0;
  }else if(msg.action==='begin'){
   next.nextAt=scheduledStart(schedule,Date.now(),time);schedule.nextPostAt=next.nextAt;
  }else if(msg.action==='patch'&&Number.isFinite(next.nextAt))schedule.nextPostAt=next.nextAt;
  next.lastPostedAt=schedule.lastPostedAt;next.nextPostAt=schedule.nextPostAt;
  schedules[(next.account||s.account).toLowerCase()]=schedule;
  if(msg.action==='begin'||msg.action==='patch'&&msg.patch?.phase==='submitting')await managed.authorize(owner,msg.module,next.account||s.account);
  await chrome.storage.local.set({[key]:next,[POST_SCHEDULE_KEY]:schedules,...(copiesUpdate?{[POST_COPIES]:copiesUpdate}:{})});
  if(disablePosting){
   try{await managed.set({selected:{posting:false}});await log('发帖文案库已无启用文案，发帖开关已自动关闭');}
   catch(error){await log('发帖文案库已无启用文案；自动关闭发帖开关失败：'+error.message);}
  }
 }else{
  if(msg.module==='followback'&&msg.action==='begin'){
   await verifyFollowbackRoute(owner,next.account);await managed.authorize(owner,'followback',next.account);
   next.nextAt=Date.now()+sampleFollowbackInterval();
  }
  if(msg.module==='interaction'&&msg.action==='begin'){
   // A SPA can be on a different route than the one that originally injected this script.
   // Bind fresh runs to the current tab URL and the still-authorized preference; detail
   // visits after begin are guarded by the workspace, not mistaken for source changes.
   const tab=await chrome.tabs.get(owner),u=new URL(tab.url||'about:blank');
   const mode=u.origin!=='https://x.com'?null:u.pathname==='/home'?'home':u.pathname==='/search'&&u.searchParams.get('q')&&['','top','live'].includes(u.searchParams.get('f')||'')?'search':null;
   if(!mode)throw Object.assign(Error('互动工作页不在首页或话题搜索页，未开始互动'),{code:'PAGE_CHANGED'});
   const permit=await managed.authorize(owner,msg.module,next.account);
   if(mode!==msg.sourceMode||mode!==permit.sourceMode)throw Object.assign(Error('互动来源与工作页不一致，未启动旧目标'),{code:'SOURCE_CHANGED'});
   next.sourceMode=mode;
  }
  await write(key,next);
 }
 if(msg.module==='notifications'&&msg.action==='patch'&&msg.patch?.phase==='waiting'&&msg.patch?.roundComplete===true)await managed.trialDone('notifications',owner,'回帖轮结束：'+String(msg.patch.roundReason||'扫描完成'));
 if(msg.patch?.lastIssue&&next.lastIssue)await log(msg.module+' · '+next.lastIssue.code+' · '+next.lastIssue.message);
 if(['begin','stop','resolve','abandon'].includes(msg.action)||msg.patch?.error||msg.patch?.phase==='confirmed')await log(`${msg.module} · ${next.phase}${next.error?' · '+next.error:''}`);
 return next;
}
let credentialFlight=null;
async function checkCredential(){
 const key=(await chrome.storage.local.get(API_KEY_STORAGE))[API_KEY_STORAGE];
 if(credentialFlight?.key===key)return credentialFlight.task;
 const entry={key};entry.task=verifyCredential(key).finally(()=>{if(credentialFlight===entry)credentialFlight=null;});credentialFlight=entry;return entry.task;
}
const timelineRewriteFlights=new Map();
async function timelineRewriteStatus(msg,sender){
 if(!isPage(sender)||sender.documentLifecycle&&sender.documentLifecycle!=='active')throw Error('无效改写状态请求');
 if(!Array.isArray(msg.ids)||msg.ids.length>500||msg.ids.some(id=>!/^\d+$/.test(id||'')))throw Error('帖子 ID 列表无效');
 const copies=await getPostCopies(),saved=new Set(copies.rows.map(timelineRewriteSourceId).filter(Boolean));
 return {existing:[...new Set(msg.ids)].filter(id=>saved.has(id)),revision:copies.revision};
}
async function rewriteTimelinePost(msg,sender){
 if(!isPage(sender))throw Error('无效改写请求来源');
 let page;try{page=new URL(sender.url);}catch{throw Error('当前页面无效');}
 if(page.origin!=='https://x.com'||sender.documentLifecycle&&sender.documentLifecycle!=='active')throw Error('仅可从 X 页面改写帖子或评论');
 const post=validateTimelinePostingSource(msg.post),rowId=timelineRewriteRowId(post.id);
 const current=await serial(getPostCopies),existing=current.rows.find(row=>row.id===rowId||timelineRewriteSourceId(row)===post.id);
 if(existing)return {added:false,id:existing.id,revision:current.revision,total:current.rows.length};
 const fingerprint=JSON.stringify(post);let entry=timelineRewriteFlights.get(rowId);
 if(entry&&entry.fingerprint!==fingerprint)throw Error('帖子正文已变化，请重新点击 +');
 if(!entry){
  entry={fingerprint};
  const attachmentUrls=timelinePostingAttachmentUrls(post);
  entry.task=Promise.all([post.text.trim()?generateTimelineRewrite(post):{text:''},attachmentUrls.length?fetchTimelineImages(attachmentUrls):[]]);
  timelineRewriteFlights.set(rowId,entry);
 }
 try{
  const [rewritten,images]=await entry.task;
  return await serial(async()=>{
   const result=appendTimelineRewrite(await getPostCopies(),post,rewritten.text,undefined,images,rewritten.style);
   if(result.added)await write(POST_COPIES,result.library);
   return {added:result.added,id:result.row.id,revision:result.library.revision,total:result.library.rows.length};
  });
 }finally{if(timelineRewriteFlights.get(rowId)===entry)timelineRewriteFlights.delete(rowId);}
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 // Liveness must not wait behind credential checks or storage mutations.
 if(msg?.kind==='PING'){
  const allowed=isPanel(sender)||isPage(sender);
  respond(allowed?{ok:true,state:null}:{ok:false,error:'无效消息来源'});return false;
 }
 // A work-page wake has no storage mutations or action authority; never hold the mutation queue.
 if(msg?.kind==='WORKER_WAKE'){
  if(!isPage(sender)||!Number.isFinite(msg.ms)||msg.ms<=0||msg.ms>15000){respond({ok:false,error:'唤醒请求无效'});return false;}
  setTimeout(()=>respond({ok:true,state:null}),Math.ceil(msg.ms));return true;
 }
 // Credential network waits must never occupy the storage-mutation queue.
 if(msg?.kind==='AI_CHECK'){
  (async()=>{
   if(!isPanel(sender)&&!isPage(sender))throw Error('无效 AI 请求来源');
   const module=isPage(sender)?msg.module:'settings';
   if(isPage(sender)&&!modules.includes(module))throw Error('AI 检查模块无效');
   if(isPage(sender)){await workspace(msg,sender);await managed.authorize(sender.tab.id,module,(await managed.assignment(sender.tab.id))?.account);}
   try{
    await checkCredential();
    await serial(async()=>{if(isPage(sender)){await workspace(msg,sender);await managed.authorize(sender.tab.id,module,(await managed.assignment(sender.tab.id))?.account);}await aiStatus(module,{error:null,retrying:false});});
    return {ready:true};
   }catch(error){
    if(['SERVICE_DISABLED','MODULE_DISABLED','OUTSIDE_WORKING_HOURS','WORKER_REPLACED','SOURCE_CHANGED'].includes(error.code))throw error;
    await serial(async()=>{if(isPage(sender))await workspace(msg,sender);await aiStatus(module,{error:error.message,attempt:1,retrying:false});});
    throw error;
   }
  })().then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message,code:e.code,submitted:e.submitted,confirmed:e.confirmed}));return true;
 }
 if(msg?.kind==='AI_POST'){
  respond({ok:false,error:'发帖已改为文案库原文发送，不再调用 AI 发帖'});return false;
 }
 if(msg?.kind==='TIMELINE_REWRITE_STATUS'){
  serial(()=>timelineRewriteStatus(msg,sender)).then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message,code:e.code}));return true;
 }
 if(msg?.kind==='TIMELINE_REWRITE_ADD'){
  rewriteTimelinePost(msg,sender).then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message,code:e.code}));return true;
 }
 if(msg?.kind==='AI_REPLY'||msg?.kind==='AI_NOTIFICATION_REPLY'){
  (async()=>{
   if(!isPage(sender))throw Error('无效 AI 请求来源');
   const module=msg.kind==='AI_NOTIFICATION_REPLY'?'notifications':'interaction',key=KEYS[module];
   const auth={owner:sender.tab.id,runId:msg.runId,documentId:await workspace(msg,sender)};
   const s=await read(key);patchState(s,{},auth);await managed.authorize(sender.tab.id,module,s.account);
   const check=async()=>{await workspace(msg,sender);const latest=await read(key);patchState(latest,{},auth);await managed.authorize(sender.tab.id,module,latest.account);};
   const recover=(generate,binding)=>recoverGeneration(generate,{binding,
    check,
    report:entry=>serial(async()=>{await check();await aiStatus(module,{operation:msg.kind,runId:msg.runId,error:entry.reason,reasonCode:entry.reasonCode,attempt:entry.attempt,retrying:entry.retrying});await log(`${msg.kind} · AI 第 ${entry.attempt} 次失败 · ${entry.reason} · ${entry.retrying?'稍后重试':'本次生成失败，未发送'}`);})
   });
   const result=await recover(()=>(msg.kind==='AI_NOTIFICATION_REPLY'?generateNotificationReply:generateReply)(msg.post),{postId:msg.post?.id});
   await check();
   if(!result.skippedGenerationError)await serial(async()=>{await check();await aiStatus(module,{runId:msg.runId,error:null,retrying:false});});
   return result;
  })().then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message||'任务已停止；未发送',code:e.code,submitted:e.submitted,confirmed:e.confirmed}));return true;
 }
 serial(()=>handle(msg||{},sender)).then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message,code:e.code,submitted:e.submitted,confirmed:e.confirmed}));return true;
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function recover(install=false){
 // A reload invalidates every content-script document, even if its X tab still exists.
 // Preserve runtime submission evidence, but never reassign that dead document.
 await managed.recover({clearWorkers:true});await retireFollowbacks(null);
 const app=await getApp();
 if(!app.postingCopyMigratedV1){
  if(app.rows.length&&!(await read(LEGACY_COPY_BACKUP)))await write(LEGACY_COPY_BACKUP,{rows:app.rows,revision:app.revision||0,backedUpAt:new Date().toISOString()});
  app.rows=[];delete app.libraryBackup;app.postingCopyMigratedV1=true;app.revision=(app.revision||0)+1;
 }
 const rawCopies=await read(POST_COPIES),copies=normalizePostingCopies(rawCopies);
 if(rawCopies&&JSON.stringify(rawCopies)!==JSON.stringify(copies))copies.revision++;
 await write(POST_COPIES,copies);
 // The v7.4 once-only ledger no longer participates in v3-style rotation.
 // Remove it after terminal legacy rows have already migrated to disabled rows.
 if(await read(POST_LEDGER)!==undefined)await chrome.storage.local.remove?.(POST_LEDGER);
 await write(timing.KEY,await getTiming());
 app.schemaVersion=3;app.postingCopySimpleV1=true;app.postingCopyOrderedDeleteV1=true;app.running=false;app.nextAt=null;
 await write('app',app);
 for(const key of Object.values(KEYS))await write(key,stopState(await read(key)));
 await write(WORKSPACES,{});
 const schedule=await read('xAssistantSchedulerV3');if(schedule)await write('xAssistantSchedulerV3',{...schedule,active:false,stopReason:'manual',restartAt:null,stoppedAt:Date.now()});
 const scan=await read('xAssistantFollowingScanV1');if(scan)await write('xAssistantFollowingScanV1',{...scan,active:false,message:'浏览器或扩展已重启，请重新读取'});
 await chrome.alarms.clear('x-assistant-loop');
 await log('神圣计划已恢复；总开关保持关闭');
}
chrome.runtime.onInstalled.addListener(()=>serial(()=>recover(true)).catch(console.error));
chrome.runtime.onStartup.addListener(()=>serial(()=>recover()).catch(console.error));
chrome.tabs.onRemoved?.addListener((id,info)=>serial(async()=>{await managed.removed(id,info);await stopTab(id);const db=await read(WORKSPACES)||{};delete db[id];await write(WORKSPACES,db);}).catch(console.error));

chrome.tabs.onReplaced?.addListener((added,removed)=>serial(async()=>{await managed.replaced(added,removed);await stopTab(removed);const db=await read(WORKSPACES)||{};delete db[removed];await write(WORKSPACES,db);}).catch(console.error));

chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.url&&!/^https:\/\/x\.com\//.test(change.url))serial(async()=>{await stopTab(id);await managed.updated(id,change);}).catch(console.error);});
chrome.alarms.onAlarm?.addListener(alarm=>{if(alarm.name===FOLLOW_QUEUE_ALARM){runFollowQueue();return;}if([BOUNDARY_ALARM,WATCHDOG_ALARM].includes(alarm.name))serial(()=>managed.reconcile()).catch(console.error);});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area==='local'){
  const toggle=changes.xAssistantAutoFollowV1,service=changes.xAssistantManagedServiceV1,run=changes.xAssistantRuntimeV1;
  if(toggle&&toggle.newValue!==false)followQueue.resume().catch(console.error);
  const control=s=>JSON.stringify([s?.enabled,s?.selected?.interaction,s?.account]);
  if(toggle||service&&control(service.oldValue)!==control(service.newValue)||run&&run.oldValue?.active!==run.newValue?.active)scheduleFollowQueue(Date.now()+100);
 }
 if(area==='local'&&changes.xAssistantFriendSearchV1)serial(()=>managed.reconcile()).catch(console.error);
});
