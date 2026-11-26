// Automatic review of an uncertain send (posting or replies) by platform readback.
// Found on the account's own timeline → confirmed. Absent at two readbacks
// (2 and 10 minutes after the click) → not sent, so the copy / comment re-queues.
// X refuses an identical recent post, which backs up the rare late publication.
import {KEYS,uncertain} from '../state.mjs';
import {eligiblePostingCopies} from '../posting-copy.mjs';
import {POST_SCHEDULE_KEY,restoreSchedule,confirmSchedule} from '../posting-schedule.mjs';
import {K,read,writeAll,serial,log,getTiming} from './context.mjs';
import {managed} from './services.mjs';
import {getPostCopies} from './copies.mjs';
import {readbackOwn} from './readback.mjs';

export const AUTO_REVIEW_ALARM='x-assistant-auto-review';
const FIRST_CHECK=2*60000,FINAL_CHECK=10*60000,INCONCLUSIVE_RETRY=2*60000,MAX_INCONCLUSIVE=5;
const MODULES={posting:{kind:'post',name:'发帖'},notifications:{kind:'reply',name:'回帖'}};

// Which run (if any) is waiting for review, and when its next readback is due.
export function reviewPlan(run,service,module,now=Date.now()){
 const submittedAt=Date.parse(run?.submittedAt||'');
 if(module==='notifications'&&run?.rowId)return null; // A parent-bound write cannot be resolved by text-only history.
 if(!service?.enabled||!service.selected?.[module]||!run||run.active||!uncertain(run)||!Number.isFinite(submittedAt))return null;
 if(!run.account||run.account.toLowerCase()!==service.account?.toLowerCase()||typeof run.text!=='string')return null;
 if(module==='posting'&&typeof run.rowId!=='string')return null;
 const review=run.autoReview?.runId===run.runId&&run.autoReview.submittedAt===run.submittedAt?run.autoReview:{runId:run.runId,submittedAt:run.submittedAt,misses:0,inconclusive:0};
 if(review.inconclusive>=MAX_INCONCLUSIVE)return null; // Leave it for a person.
 const dueAt=Math.max(Number(review.nextAt)||0,submittedAt+(review.misses?FINAL_CHECK:FIRST_CHECK));
 return {review,submittedAt,dueAt,due:dueAt<=now};
}

// Decide from one readback: confirmed / not_sent / retry later.
export function nextReview(plan,result,now=Date.now()){
 if(result.status==='found')return {outcome:'confirmed'};
 if(result.status==='absent'){
  const misses=plan.review.misses+1;
  if(misses>=2&&now>=plan.submittedAt+FINAL_CHECK)return {outcome:'not_sent'};
  return {review:{...plan.review,misses,nextAt:plan.submittedAt+FINAL_CHECK}};
 }
 return {review:{...plan.review,inconclusive:plan.review.inconclusive+1,nextAt:now+INCONCLUSIVE_RETRY,lastReason:result.reason}};
}

const resolution=(run,outcome,extra={})=>({automatic:true,outcome,at:new Date().toISOString(),runId:run.runId,
 rowId:run.rowId,text:run.text,submittedAt:run.submittedAt,previousPhase:run.phase,...extra});
const settledRun=(run,outcome,extra={})=>({...run,active:false,phase:'stopped',error:null,autoReview:null,
 revision:(run.revision||0)+1,resolution:resolution(run,outcome,extra)});
const same=(a,b)=>a?.runId===b.runId&&a?.submittedAt===b.submittedAt&&uncertain(a)&&!a.active;

async function settlePosting(run,decision,found){
 const latest=await read(KEYS.posting);if(!same(latest,run))return false;
 const updates={};
 if(decision.outcome==='confirmed'){
  const copies=await getPostCopies(),index=copies.rows.findIndex(row=>row.id===run.rowId&&row.text===run.text);
  const library=index>=0?{revision:copies.revision+1,rows:copies.rows.filter((_,i)=>i!==index)}:copies;
  if(index>=0)updates[K.POST_COPIES]=library;
  const schedules=await read(POST_SCHEDULE_KEY)||{},account=run.account.toLowerCase(),time=await getTiming();
  const previous=restoreSchedule(schedules,account,latest,Date.now(),time);
  const schedule={...previous,...confirmSchedule(Date.parse(run.submittedAt),Math.random,time),confirmedRunId:run.runId,confirmedSubmittedAt:run.submittedAt};
  schedules[account]=schedule;updates[POST_SCHEDULE_KEY]=schedules;
  updates[KEYS.posting]={...settledRun(latest,'confirmed',{postId:found.id}),completed:(Number(latest.completed)||0)+1,
   receipt:{kind:'confirmed',evidence:'profile_readback',postId:found.id,url:found.url},
   lastPostedAt:schedule.lastPostedAt,nextPostAt:schedule.nextPostAt,libraryRemaining:eligiblePostingCopies(library.rows).length};
 }else updates[KEYS.posting]=settledRun(latest,'not_sent'); // The copy stays enabled and is first in line again.
 await writeAll(updates);
 if(updates[KEYS.posting].libraryRemaining===0){
  try{await managed.set({selected:{posting:false}});}catch(error){await log('发帖文案库已无可发文案；自动关闭发帖开关失败：'+error.message);}
 }
 return true;
}

async function settleReplies(run,decision,found){
 const latest=await read(KEYS.notifications);if(!same(latest,run))return false;
 const account=run.account.toLowerCase(),[replies,claims]=await Promise.all([read(K.NOTIFICATION_REPLIES),read(K.REPLY_CLAIMS)]);
 const records=replies?.[account]?.records||{},ledger=claims?.[account]||{},updates={};
 const confirmed=decision.outcome==='confirmed',receipt=confirmed?{kind:'confirmed',evidence:'profile_readback',postId:found.id}:null;
 const exact=run.rowId||run.lastIssue?.targetId;
 // Do not touch another pending reply merely because its text/run happens to match.
 const matched=Object.keys(records).filter(id=>(!exact||id===exact)&&records[id]?.status==='unknown'&&records[id].text===run.text&&
   ledger[id]?.module==='notifications'&&ledger[id]?.runId===run.runId&&ledger[id]?.status==='unknown'&&!ledger[id].deferred);
 if(matched.length!==1)return false;
 let target=null;
 for(const [id,record] of Object.entries(records)){
  if(id!==matched[0])continue;
  target=id;
  records[id]=confirmed?{...record,status:'confirmed',at:Date.now(),receipt}:
   {...record,status:'failed',at:Date.now(),reasonCode:'AUTO_REVIEW_NOT_FOUND',reason:'自动核对未在本人回复中找到，已重新排队'};
 }
 if(target){updates[K.NOTIFICATION_REPLIES]={...replies,[account]:{...replies[account],records}};}
 for(const [id,claim] of Object.entries(ledger)){
  if(id!==target)continue;
  ledger[id]={...claim,status:confirmed?'confirmed':'released',at:Date.now(),...(receipt?{receipt}:{})};
  updates[K.REPLY_CLAIMS]={...claims,[account]:ledger};
 }
 updates[KEYS.notifications]={...settledRun(latest,decision.outcome,{targetId:target,...(found?{postId:found.id}:{})}),...(receipt?{receipt}:{})};
 await writeAll(updates);
 return true;
}

let running=false;
export async function autoReview({readback=readbackOwn,now=Date.now}={}){
 if(running)return [];
 running=true;const done=[];
 try{
  for(const module of Object.keys(MODULES)){
   const [service,run]=await Promise.all([managed.get(),read(KEYS[module])]);
   const plan=reviewPlan(run,service,module,now());
   if(!plan?.due)continue;
   let windowId; // Open the readback tab beside the module's own work page.
   try{if(Number.isInteger(service.workers?.[module]?.tabId))windowId=(await chrome.tabs.get(service.workers[module].tabId))?.windowId;}catch{}
   let result;
   try{result=await readback({account:run.account,kind:MODULES[module].kind,text:run.text,since:plan.submittedAt,windowId});}
   catch(error){result={status:'inconclusive',reason:error.message};}
   const decision=nextReview(plan,result,now());
   const applied=await serial(async()=>{
    if(decision.outcome){
     const ok=await (module==='posting'?settlePosting:settleReplies)(run,decision,result);
     if(ok)await log(`${MODULES[module].name} · 自动核对 · ${decision.outcome==='confirmed'?'平台上已找到，记为成功':'两次回读均未找到，判为未发并重新排队'}`);
     return ok;
    }
    const latest=await read(KEYS[module]);if(!same(latest,run))return false;
    await writeAll({[KEYS[module]]:{...latest,autoReview:decision.review}});
    if(result.status!=='absent')await log(`${MODULES[module].name} · 自动核对暂未完成 · ${result.reason||'稍后重试'}`);
    return false;
   });
   if(applied){done.push({module,outcome:decision.outcome});await serial(()=>managed.reconcile());}
  }
 }finally{running=false;}
 return done;
}
