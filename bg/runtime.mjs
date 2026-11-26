// RUNTIME: begin/prepare/stop/resolve/abandon/patch/pick for each module's run state.
// Posting outcomes (confirmed / not_sent / duplicate / reviewed) also move the library
// and the account schedule in the same atomic write as the run state.
import {KEYS,abandonState,beginState,patchState,stopOwnedState,resolveState,reserveRow} from '../state.mjs';
import {eligiblePostingCopies} from '../posting-copy.mjs';
import {POST_SCHEDULE_KEY,restoreSchedule,confirmSchedule,scheduledStart} from '../posting-schedule.mjs';
import {sampleFollowbackInterval} from '../action-gate.mjs';
import {K,read,write,writeAll,getApp,getTiming,log,fail} from './context.mjs';
import {managed} from './services.mjs';
import {verifyFollowbackRoute} from './followback.mjs';
import {getPostCopies,postingUnavailable,assertPostingReady,assertPostingCooldown,postingCopyStamp,
 nativePostSuccess,nativePostRateLimit,nativePostTemporaryReject,postRateDeadline,postRetryDeadline,
 POST_RATE_DELAY,POST_TEMPORARY_RETRY} from './copies.mjs';

const disableRow=(copies,index)=>({revision:copies.revision+1,rows:copies.rows.map((row,i)=>i===index?{...row,enabled:false}:row)});
const boundSubmission=s=>typeof s.rowId==='string'&&!!s.rowId&&typeof s.text==='string'&&!!s.submittedAt;
const sameSubmission=(next,s)=>next.rowId===s.rowId&&next.text===s.text&&next.submittedAt===s.submittedAt;

async function begin(msg,s,owner,documentId){
 await managed.authorize(owner,msg.module,msg.account);
 if(msg.module==='posting')await assertPostingReady();
 const other=(await Promise.all(Object.entries(KEYS)
  .filter(([name])=>name!==msg.module&&name!=='cleanup')
  .map(([,key])=>read(key)))).map(state=>state||{});
 const next=beginState(s,other,{owner,documentId,account:msg.account,resume:msg.resume});
 if(msg.module==='posting')delete next.libraryRemaining;
 return next;
}

async function patch(msg,s,owner,auth){
 let copyStamp;
 const phase=msg.patch?.phase;
 if(msg.module==='followback'&&phase&&(phase==='submitting'||['submitting','unknown'].includes(s.phase)&&phase!==s.phase))
  throw fail('回关提交状态只能通过目标事务变更');
 if(phase==='submitting'||msg.module==='posting'&&phase==='opening')await managed.authorize(owner,msg.module,s.account);
 if(msg.module==='posting'&&['opening','submitting'].includes(phase))await assertPostingCooldown(s.account);
 if(msg.module==='posting'&&phase==='opening'){
  patchState(s,{},auth);
  const copies=await getPostCopies(),first=eligiblePostingCopies(copies.rows)[0];
  if(!first||msg.patch.libraryRevision!==copies.revision||first.id!==msg.patch.rowId||first.text!==msg.patch.text)
   throw fail('文案库已更新，重新选择启用稿件',{code:'POST_COPY_CHANGED'});
  copyStamp=await postingCopyStamp(first);
 }
 const next=patchState(s,msg.patch,auth);
 if(copyStamp)next.copyStamp=copyStamp;
 return next;
}

async function pick(msg,s,owner,auth,key){
 await managed.authorize(owner,msg.module,s.account);
 if(msg.module==='cleanup'||msg.module==='followback')throw fail('此模块不使用文案库');
 patchState(s,{},auth);
 if(msg.module==='posting'){
  await assertPostingCooldown(s.account);
  const copies=await getPostCopies(),row=eligiblePostingCopies(copies.rows)[0];
  if(!row)throw postingUnavailable(copies.rows);
  await managed.authorize(owner,msg.module,s.account);
  return {...row,type:'post',libraryRevision:copies.revision};
 }
 const chosen=reserveRow(s,(await getApp()).rows,'reply');
 await managed.authorize(owner,msg.module,s.account);await write(key,chosen.state);
 return chosen.row;
}

// Returns {done:s} for an idempotent replay, or the library update to commit with the run.
async function postingOutcome(msg,s,next,schedule,time){
 const phase=msg.patch?.phase,receipt=msg.patch?.receipt;
 if(msg.action==='patch'&&phase==='confirmed'){
  const native=receipt?.evidence==='x_create_result';
  if(receipt?.kind!=='confirmed')throw fail('发帖成功必须有平台回执');
  if((s.phase!=='submitting'&&s.phase!=='confirmed')||!boundSubmission(s)||
     native&&(msg.patch.attemptSubmittedAt!==s.submittedAt||!s.copyStamp||!nativePostSuccess(receipt,s.account)||!sameSubmission(next,s)))
   throw fail('发帖成功记录缺少文案绑定，未删除文案库条目');
  if(schedule.confirmedRunId===s.runId&&schedule.confirmedSubmittedAt===s.submittedAt)return {done:s};
  const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===s.rowId);
  const sameCopy=index>=0&&(native?await postingCopyStamp(copies.rows[index])===s.copyStamp:copies.rows[index].text===s.text);
  if(!native&&!sameCopy)throw fail(index<0?'待删除文案已不在文案库，未写入成功状态':'文案内容已变化，未删除文案库条目');
  const copiesUpdate=sameCopy?{revision:copies.revision+1,rows:copies.rows.filter((_,i)=>i!==index)}:null;
  if(native)next.completed=(Number(s.completed)||0)+1;
  next.libraryRemaining=eligiblePostingCopies((copiesUpdate||copies).rows).length;
  const confirmed={...confirmSchedule(Date.now(),Math.random,time),confirmedRunId:s.runId,confirmedSubmittedAt:s.submittedAt};
  next.nextAt=confirmed.nextPostAt;
  return {schedule:confirmed,copiesUpdate,disablePosting:next.libraryRemaining===0};
 }
 if(msg.action==='patch'&&phase==='not_sent'){
  const rate=nativePostRateLimit(receipt),temporary=nativePostTemporaryReject(receipt);
  if(!['submitting','not_sent'].includes(s.phase)||!boundSubmission(s)||msg.patch.attemptSubmittedAt!==s.submittedAt||!s.copyStamp||
     (!rate&&!temporary)||!sameSubmission(next,s)||receipt.retryAt!==undefined&&(!Number.isSafeInteger(receipt.retryAt)||receipt.retryAt<=0))
   throw fail('缺少当前请求已明确未发的回执，保留待核对状态');
  if(s.phase==='not_sent')return {done:s}; // A lost ACK must not extend this submission's cooldown.
  if(rate)schedule.rateLimitedUntil=Math.max(Date.now()+POST_RATE_DELAY,postRateDeadline(schedule),receipt.retryAt||0);
  else schedule.temporaryRetryUntil=Math.max(Date.now()+POST_TEMPORARY_RETRY,receipt.retryAt||0);
  next.nextAt=schedule.nextPostAt=Math.max(schedule.nextPostAt||0,postRetryDeadline(schedule));
  return {schedule};
 }
 if(msg.action==='patch'&&phase==='rejected'&&receipt?.reason==='duplicate'){
  if(s.phase!=='submitting'||!s.rowId||!s.text||!s.submittedAt||receipt.kind!=='rejected'||receipt.evidence!=='x_notice')throw fail('重复拒绝缺少当前提交回执，未修改文案');
  const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===s.rowId);
  if(index<0||copies.rows[index].text!==s.text)throw fail('重复拒绝的文案绑定已变化，未修改文案');
  const copiesUpdate=disableRow(copies,index);
  next.libraryRemaining=eligiblePostingCopies(copiesUpdate.rows).length;
  // A rejection is not a successful post. Preserve the row and the last success time.
  next.nextAt=Math.max(Date.now()+60000,schedule.nextPostAt||0);schedule.nextPostAt=next.nextAt;
  return {schedule,copiesUpdate,disablePosting:next.libraryRemaining===0};
 }
 if(['resolve','abandon'].includes(msg.action)&&typeof s.rowId==='string'&&s.rowId&&typeof s.text==='string'){
  // A human-reviewed unknown result is retained but disabled, so ordered
  // selection can continue without ever retrying the uncertain post.
  if(s.receipt)next.resolution.receipt=s.receipt;
  const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===s.rowId);
  if(index>=0&&copies.rows[index].text!==s.text)throw fail('待核对文案内容已变化，未继续发帖');
  const copiesUpdate=index>=0&&copies.rows[index].enabled?disableRow(copies,index):null;
  next.libraryRemaining=eligiblePostingCopies((copiesUpdate||copies).rows).length;
  return {schedule,copiesUpdate,disablePosting:next.libraryRemaining===0};
 }
 if(msg.action==='begin'){next.nextAt=Math.max(scheduledStart(schedule,Date.now(),time),postRetryDeadline(schedule));schedule.nextPostAt=next.nextAt;}
 else if(msg.action==='patch'&&Number.isFinite(next.nextAt))schedule.nextPostAt=next.nextAt=Math.max(next.nextAt,postRetryDeadline(schedule));
 return {schedule};
}

async function commitPosting(msg,s,next,owner,key){
 const account=next.account||s.account,schedules=await read(POST_SCHEDULE_KEY)||{},time=await getTiming();
 const outcome=await postingOutcome(msg,s,next,restoreSchedule(schedules,account,s,Date.now(),time),time);
 if(outcome.done)return outcome.done;
 const {schedule,copiesUpdate,disablePosting}=outcome;
 next.lastPostedAt=schedule.lastPostedAt;next.nextPostAt=schedule.nextPostAt;
 schedules[account.toLowerCase()]=schedule;
 if(msg.action==='begin'||msg.action==='patch'&&msg.patch?.phase==='submitting')await managed.authorize(owner,msg.module,account);
 await writeAll({[key]:next,[POST_SCHEDULE_KEY]:schedules,...(copiesUpdate?{[K.POST_COPIES]:copiesUpdate}:{})});
 if(disablePosting){
  try{await managed.set({selected:{posting:false}});await log('发帖文案库已无可发文案，发帖开关已自动关闭；未就绪条目仍保留');}
  catch(error){await log('发帖文案库已无可发文案；自动关闭发帖开关失败：'+error.message);}
 }
 return next;
}

// A SPA can be on a different route than the one that originally injected this script.
// Bind fresh runs to the current tab URL and the still-authorized preference.
async function interactionSource(owner,msg,account){
 const tab=await chrome.tabs.get(owner),u=new URL(tab.url||'about:blank');
 const search=u.pathname==='/search'&&u.searchParams.get('q')&&['','top','live'].includes(u.searchParams.get('f')||'');
 const mode=u.origin!=='https://x.com'?null:u.pathname==='/home'?'home':search?'search':null;
 if(!mode)throw fail('互动工作页不在首页或话题搜索页，未开始互动',{code:'PAGE_CHANGED'});
 const permit=await managed.authorize(owner,msg.module,account);
 if(mode!==msg.sourceMode||mode!==permit.sourceMode)throw fail('互动来源与工作页不一致，未启动旧目标',{code:'SOURCE_CHANGED'});
 return mode;
}

async function notificationProgress(msg,owner,next){
 const progress=msg.patch.notificationScanProgress;
 if(progress&&(Number.isInteger(progress.completedThreads)&&progress.completedThreads>0||progress.cursorAdvanced===true)&&Number.isFinite(progress.completedAt)){
  const assignment=await managed.assignment(owner);
  if(assignment?.module==='notifications')
   await managed.recordNotificationProgress({tabId:owner,token:assignment.token,account:next.account,progressAt:progress.completedAt,kind:'scan_complete'});
 }
 if(msg.patch?.phase==='waiting'&&msg.patch.roundComplete===true)
  await managed.trialDone('notifications',owner,'回帖轮结束：'+String(msg.patch.roundReason||'扫描完成'));
}

export async function runtime(msg,sender,documentId){
 if(msg.module==='cleanup')throw fail('清理模块已移除');
 const key=KEYS[msg.module],s=await read(key)||{},owner=sender.tab.id,auth={owner,runId:msg.runId,documentId};
 if(msg.action==='get')return s;
 let next;
 switch(msg.action){
  case 'begin':case 'prepare':
   next=await begin(msg,s,owner,documentId);
   if(msg.action==='prepare'){await managed.authorize(owner,msg.module,msg.account);return {account:next.account,owner:next.owner};}
   break;
  case 'stop':next=stopOwnedState(s,auth);break;
  case 'resolve':next=resolveState(s,msg);break;
  case 'abandon':next=abandonState(s,msg);break;
  case 'patch':next=await patch(msg,s,owner,auth);break;
  case 'pick':return pick(msg,s,owner,auth,key);
  default:throw fail('未知运行操作');
 }
 if(msg.module==='posting'&&(next.account||s.account)){
  const result=await commitPosting(msg,s,next,owner,key);
  if(result===s)return s;
 }else{
  if(msg.module==='followback'&&msg.action==='begin'){
   await verifyFollowbackRoute(owner,next.account);await managed.authorize(owner,'followback',next.account);
   next.nextAt=Date.now()+sampleFollowbackInterval();
  }
  if(msg.module==='interaction'&&msg.action==='begin')next.sourceMode=await interactionSource(owner,msg,next.account);
  await write(key,next);
 }
 if(msg.module==='notifications'&&msg.action==='patch')await notificationProgress(msg,owner,next);
 if(msg.patch?.lastIssue&&next.lastIssue)await log(msg.module+' · '+next.lastIssue.code+' · '+next.lastIssue.message);
 if(['begin','stop','resolve','abandon'].includes(msg.action)||msg.patch?.error||msg.patch?.phase==='confirmed')
  await log(`${msg.module} · ${next.phase}${next.error?' · '+next.error:''}`);
 return next;
}
