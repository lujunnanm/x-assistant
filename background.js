import './time-policy.js';
import {createManagedService,BOUNDARY_ALARM,WATCHDOG_ALARM} from './managed-service.mjs';
import {createActionGate,ACTION_GATE_KEY,sampleFollowbackInterval,FOLLOWBACK_MAX} from './action-gate.mjs';
import {verifyCredential,API_KEY_STORAGE} from './deepseek-direct.mjs';
import {recoverGeneration} from './ai-recovery.mjs';
import {POST_SCHEDULE_KEY,restoreSchedule,confirmSchedule,scheduledStart} from './posting-schedule.mjs';
import {generateReply,generateNotificationReply} from './ai-client.mjs';
import {normalizePostingCopies,postingCopyOperation} from './posting-copy.mjs';
import {KEYS,abandonState,assertRunOwner,beginState,patchState,stopState,stopOwnedState,resolveState,reserveRow} from './state.mjs';
const timing=globalThis.XAssistantTimePolicy;
const getTiming=async()=>timing.normalize(await read(timing.KEY));
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
const read=async key=>(await chrome.storage.local.get(key))[key];
const write=(key,value)=>chrome.storage.local.set({[key]:value});
const POST_COPIES='xAssistantPostingCopiesV1',LEGACY_COPY_BACKUP='xAssistantLegacyCopyBackupV1';
const getPostCopies=async()=>normalizePostingCopies(await read(POST_COPIES));
const managed=createManagedService({read,write,tabs:chrome.tabs,alarms:chrome.alarms,runtimeFor:module=>read(KEYS[module]),retireMissingRun,postingReady:async()=>(await getPostCopies()).rows.some(row=>row.enabled)});
const actionGate=createActionGate({read:async()=>{const state=await read(ACTION_GATE_KEY)||{};if(state.version===1)return state;return {...state,legacyFollowCooldown:await read('xAssistantFollowCooldownV1')||{},runtimes:Object.fromEntries(await Promise.all(['posting','interaction','notifications'].map(async module=>[module,await read(KEYS[module])])))};},write:state=>write(ACTION_GATE_KEY,state)});
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
  if(prior)return {claimed:false,reason:prior.status};
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
 if(!old||old.claimId!==msg.claimId||old.owner!==auth.owner||old.runId!==auth.runId||old.documentId!==auth.documentId||old.targetId!==targetId||!['confirmed','released','unknown'].includes(outcome))throw Error('回关记录不匹配，未更改');
 if(old.status==='confirmed'){
  if(outcome==='confirmed')return {status:'confirmed',nextAt:state.nextAt};throw Error('已确认的回关不能释放');
 }
 if(outcome==='confirmed'&&(msg.receipt?.kind!=='following'||msg.receipt.target?.toLowerCase()!==target||msg.receipt.targetId!==targetId))throw Error('回关成功必须有原账号已关注回执');
 if(outcome==='released'){
  const ack=(await read(ACTION_GATE_KEY))?.lastSettlement;
  if(old.status!=='in_flight'||(!old.releaseAck&&(ack?.leaseId!==old.leaseId||ack.outcome!=='released')))throw Error('回关未点击状态未获确认，不会自动重试');
  delete records[target];
 }else records[target]={...old,status:outcome,at:now};
 let nextAt=null;
 if(state.active&&outcome==='confirmed'){
  const gate=await read(ACTION_GATE_KEY),persisted=gate?.accounts?.[account]?.followbackNotBefore,held=gate?.holder;
  // If the click ACK was lost but the platform readback is exact, use the
  // possible lease-expiry time; never schedule a second independent delay.
  nextAt=held?.leaseId===old.leaseId?held.expiresAt+(held.followbackGap||FOLLOWBACK_MAX):Number.isFinite(persisted)?persisted:now+FOLLOWBACK_MAX;
 }else if(state.active&&outcome==='released')nextAt=now+sampleFollowbackInterval();
 const next={...state,revision:(state.revision||0)+1,phase:outcome==='unknown'?'unknown':state.active?'waiting':'stopped',
   nextAt,error:outcome==='unknown'?'回关 '+target+' 结果未知，不会自动重试':null,
   ...(outcome==='confirmed'?{completed:(Number(state.completed)||0)+1,receipt:{kind:'following',target,targetId,at:now}}:{})};
 await chrome.storage.local.set({[FOLLOWBACK_LEDGER]:db,[key]:next});return {status:outcome,nextAt:next.nextAt};
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
 if(msg.kind==='SERVICE_TRIAL_ONCE'&&panel)return managed.trialStart(msg.account,msg.requestId,msg.issuedAt,msg.only);
 if(msg.kind==='SERVICE_SET'){const result=await managed.set(msg);await log('神圣计划总开关 · '+(result.enabled?'已开启':'已关闭'));return result;}
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
 if((msg.kind==='REPLY_CLAIM'||msg.kind==='REPLY_SETTLE')&&page)return replyClaim(msg,sender,documentId);
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
  if(service.enabled&&service.selected.posting||runtime?.active||['submitting','unknown'].includes(runtime?.phase))throw Error('请先暂停发帖并处理未确认发送结果，再编辑发帖文案');
  const next=postingCopyOperation(await read(POST_COPIES),msg.op);
  await write(POST_COPIES,next);await log('发帖文案库更新：'+msg.op.action);return next;
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
  const db=await read('xAssistantProcessedV1')||{posts:{}};db.posts[msg.id]=msg.record;
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
  if(msg.module==='posting'&&!(await getPostCopies()).rows.some(r=>r.enabled))throw Error('发帖文案库为空或全部停用');
  const states=await Promise.all(Object.entries(KEYS).filter(([name])=>name!==msg.module).map(async([name,otherKey])=>[name,await read(otherKey)||{}]));
  const other=states.filter(([name])=>name!=='cleanup').map(([,state])=>state);
  next=beginState(s,other,{owner,documentId,account:msg.account,resume:msg.resume});
  if(msg.action==='prepare'){await managed.authorize(owner,msg.module,msg.account);return {account:next.account,owner:next.owner};}
 }else if(msg.action==='stop')next=stopOwnedState(s,auth);
 else if(msg.action==='resolve')next=resolveState(s,msg);
 else if(msg.action==='abandon')next=abandonState(s,msg);
 else if(msg.action==='patch'){if(msg.module==='followback'&&msg.patch?.phase&&(msg.patch.phase==='submitting'||['submitting','unknown'].includes(s.phase)&&msg.patch.phase!==s.phase))throw Error('回关提交状态只能通过目标事务变更');if(msg.patch?.phase==='submitting')await managed.authorize(owner,msg.module,s.account);next=patchState(s,msg.patch,auth);}
 else if(msg.action==='pick'){
  await managed.authorize(owner,msg.module,s.account);
  if(msg.module==='cleanup'||msg.module==='followback')throw Error('此模块不使用文案库');
  patchState(s,{},auth);
  const rows=msg.module==='posting'?(await getPostCopies()).rows.map(row=>({...row,type:'post'})):(await getApp()).rows;
  const chosen=reserveRow(s,rows,msg.module==='posting'?'post':'reply');
  await managed.authorize(owner,msg.module,s.account);await write(key,chosen.state);return chosen.row;
 }else throw Error('未知运行操作');
 if(msg.module==='posting'&&(next.account||s.account)){
  const schedules=await read(POST_SCHEDULE_KEY)||{};
  const time=await getTiming();
  let schedule=restoreSchedule(schedules,next.account||s.account,s,Date.now(),time);
  if(msg.action==='patch'&&msg.patch?.phase==='confirmed'){
   if(msg.patch.receipt?.kind!=='confirmed')throw Error('发帖成功必须有平台回执');
   // Idempotent receipt replay cannot move the deadline or count as another post.
   schedule=schedule.confirmedRunId===s.runId&&schedule.confirmedSubmittedAt===s.submittedAt?schedule:{...confirmSchedule(Date.now(),Math.random,time),confirmedRunId:s.runId,confirmedSubmittedAt:s.submittedAt};
   next.nextAt=schedule.nextPostAt;
  }else if(msg.action==='begin'){
   next.nextAt=scheduledStart(schedule,Date.now(),time);schedule.nextPostAt=next.nextAt;
  }else if(msg.action==='patch'&&Number.isFinite(next.nextAt))schedule.nextPostAt=next.nextAt;
  next.lastPostedAt=schedule.lastPostedAt;next.nextPostAt=schedule.nextPostAt;
  schedules[(next.account||s.account).toLowerCase()]=schedule;
  if(msg.action==='begin'||msg.action==='patch'&&msg.patch?.phase==='submitting')await managed.authorize(owner,msg.module,next.account||s.account);
  await chrome.storage.local.set({[key]:next,[POST_SCHEDULE_KEY]:schedules});
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
 // Preserve the page/draft and business ledger, but never reassign that dead document.
 await managed.recover({clearWorkers:true});await retireFollowbacks(null);
 const app=await getApp();
 if(!app.postingCopyMigratedV1){
  if(app.rows.length&&!(await read(LEGACY_COPY_BACKUP)))await write(LEGACY_COPY_BACKUP,{rows:app.rows,revision:app.revision||0,backedUpAt:new Date().toISOString()});
  app.rows=[];delete app.libraryBackup;app.postingCopyMigratedV1=true;app.revision=(app.revision||0)+1;
 }
 await write(timing.KEY,await getTiming());
 app.schemaVersion=2;app.running=false;app.nextAt=null;
 await write('app',app);
 for(const key of Object.values(KEYS))await write(key,stopState(await read(key)));
 await write(WORKSPACES,{});
 const schedule=await read('xAssistantSchedulerV3');if(schedule)await write('xAssistantSchedulerV3',{...schedule,active:false,stopReason:'manual',restartAt:null,stoppedAt:Date.now()});
 const scan=await read('xAssistantFollowingScanV1');if(scan)await write('xAssistantFollowingScanV1',{...scan,active:false,message:'浏览器或扩展已重启，请重新读取'});
 await chrome.alarms.clear('x-assistant-loop');
 await log('v7 状态已恢复；总开关保持关闭，选择与业务数据保留，未知发送记录保留');
}
chrome.runtime.onInstalled.addListener(()=>serial(()=>recover(true)).catch(console.error));
chrome.runtime.onStartup.addListener(()=>serial(()=>recover()).catch(console.error));
chrome.tabs.onRemoved?.addListener(id=>serial(async()=>{await stopTab(id);await managed.removed(id);const db=await read(WORKSPACES)||{};delete db[id];await write(WORKSPACES,db);}).catch(console.error));

chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.url&&!/^https:\/\/x\.com\//.test(change.url))serial(async()=>{await stopTab(id);await managed.updated(id,change);}).catch(console.error);});
chrome.alarms.onAlarm?.addListener(alarm=>{if([BOUNDARY_ALARM,WATCHDOG_ALARM].includes(alarm.name))serial(()=>managed.reconcile()).catch(console.error);});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area==='local'&&changes.xAssistantFriendSearchV1)serial(()=>managed.reconcile()).catch(console.error);
});
