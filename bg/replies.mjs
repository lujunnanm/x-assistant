// Reply claims (one durable slot per target post) and AI generation for replies.
// Generation never holds the storage queue and never submits anything to X.
import {KEYS,assertRunOwner,patchState} from '../state.mjs';
import {verifyCredential,API_KEY_STORAGE} from '../deepseek-direct.mjs';
import {recoverGeneration} from '../ai-recovery.mjs';
import {generateReply,generateNotificationReply} from '../ai-client.mjs';
import {normalizeReplyContext,confirmedReplyHistory} from '../reply-context.mjs';
import {buildVoice,reconcile,stage} from '../reply-memory.mjs';
import {K,AI_MODULES,read,write,serial,log,fail,isPage,isPanel} from './context.mjs';
import {managed} from './services.mjs';
import {workspace} from './workspace.mjs';

const SETTLED=['confirmed','unknown','in_flight','duplicate_skipped'];
const PASS_THROUGH=['SERVICE_DISABLED','MODULE_DISABLED','OUTSIDE_WORKING_HOURS','WORKER_REPLACED','SOURCE_CHANGED'];

async function aiStatus(module,entry){
 const states=await read(K.AI_STATUS)||{};
 await write(K.AI_STATUS,{...states,[module]:{module,...entry,time:Date.now()}});
}

async function claim(msg,sender,documentId,{state,auth,account,db,records,old}){
 await managed.authorize(sender.tab.id,msg.module,account);
 patchState(state,{},auth);
 if(old&&SETTLED.includes(old.status))return {claimed:false,reason:old.status};
 const processed=(await read(K.PROCESSED))?.posts?.[msg.postId];
 const prior=(!processed?.account||processed.account.toLowerCase()===account)?processed:null;
 const notification=(await read(K.NOTIFICATION_REPLIES))?.[account]?.records?.[msg.postId];
 if(prior?.reply==='verified'||['confirmed','previously_processed'].includes(notification?.status))return {claimed:false,reason:'confirmed'};
 if(notification?.status==='duplicate_skipped')return {claimed:false,reason:'duplicate_skipped'};
 if(['unknown','in_flight'].includes(prior?.reply)||['unknown','in_flight'].includes(notification?.status))return {claimed:false,reason:'unknown'};
 const permit=await managed.authorize(sender.tab.id,msg.module,account);
 const entry={claimId:crypto.randomUUID(),module:msg.module,runId:msg.runId,owner:sender.tab.id,documentId,workerToken:permit.token,status:'in_flight',at:Date.now()};
 db[account]={...records,[msg.postId]:entry};await write(K.REPLY_CLAIMS,db);
 return {claimed:true,claimId:entry.claimId};
}

async function settle(msg,sender,documentId,{account,db,records,old}){
 if(!old||old.claimId!==msg.claimId||old.module!==msg.module||old.runId!==msg.runId||old.owner!==sender.tab.id||old.documentId!==documentId)throw fail('回复占位已失效');
 if(!['confirmed','unknown','released','duplicate_skipped'].includes(msg.outcome))throw fail('回复结果无效');
 if(msg.outcome==='duplicate_skipped'&&(msg.module!=='notifications'||!['in_flight','duplicate_skipped'].includes(old.status)||
    msg.receipt?.kind!=='rejected'||msg.receipt.reason!=='duplicate'||msg.receipt.evidence!=='x_notice'))throw fail('缺少本次回帖的重复拒绝凭据');
 if(old.status==='duplicate_skipped'&&msg.outcome!=='duplicate_skipped')throw fail('已跳过的重复回帖不得重试');
 if(old.status==='confirmed'&&msg.outcome!=='confirmed')throw fail('已确认回复不得降级');
 if(old.status==='unknown'&&msg.outcome==='released')throw fail('未知发送结果不得自动释放');
 if(msg.outcome==='confirmed'&&msg.receipt?.kind!=='confirmed')throw fail('回复成功必须有平台回执');
 let deferred;
 if(msg.deferred&&msg.outcome==='unknown'&&msg.module==='notifications'&&old.status==='in_flight'){
  const run=await read(KEYS.notifications),q=msg.deferred,author=q.author;
  if(run?.rowId!==msg.postId||run.text!==q.text||run.runId!==msg.runId||!/^\w{1,15}$/.test(author)||!/^\d{1,20}$/.test(q.root)||!Number.isFinite(Date.parse(run.submittedAt)))throw fail('待核对项归属不符');
  deferred={author:author.toLowerCase(),root:q.root,text:run.text,since:Date.parse(run.submittedAt),nextAt:Date.now()+60000,checks:0};
 }
 records[msg.postId]={...old,...(deferred?{deferred}:{}),status:msg.outcome,at:Date.now(),...(msg.receipt?{receipt:msg.receipt}:{})};db[account]=records;
 await write(K.REPLY_CLAIMS,db);
 if(msg.module==='notifications'&&msg.outcome==='confirmed'&&old.status!=='confirmed')
  await managed.recordNotificationProgress({tabId:sender.tab.id,token:old.workerToken,account,progressAt:records[msg.postId].at,kind:'reply_confirmed'});
 return records[msg.postId];
}

export async function replyClaim(msg,sender,documentId){
 if(!['interaction','notifications'].includes(msg.module)||!/^\d+$/.test(msg.postId||''))throw fail('回复目标无效');
 const state=await read(KEYS[msg.module]),auth={owner:sender.tab.id,runId:msg.runId,documentId};
 // Settlement is allowed after a local Stop, but never after a replacement run/document.
 assertRunOwner(state,auth);
 const account=state.account?.toLowerCase();
 if(account!==msg.account?.toLowerCase())throw fail('回复账号不匹配');
 const db=await read(K.REPLY_CLAIMS)||{},records=db[account]||{};
 const tx={state,auth,account,db,records,old:records[msg.postId]};
 return msg.kind==='REPLY_CLAIM'?claim(msg,sender,documentId,tx):settle(msg,sender,documentId,tx);
}

let credentialFlight=null;
function checkCredential(key){
 if(credentialFlight?.key===key)return credentialFlight.task;
 const entry={key};
 entry.task=verifyCredential(key).finally(()=>{if(credentialFlight===entry)credentialFlight=null;});
 credentialFlight=entry;return entry.task;
}

export async function aiCheck(msg,sender){
 const page=isPage(sender);
 if(!isPanel(sender)&&!page)throw fail('无效 AI 请求来源');
 const module=page?msg.module:'settings';
 if(page&&!AI_MODULES.includes(module))throw fail('AI 检查模块无效');
 const authorize=async()=>{await workspace(msg,sender);await managed.authorize(sender.tab.id,module,(await managed.assignment(sender.tab.id))?.account);};
 if(page)await authorize();
 try{
  await checkCredential((await chrome.storage.local.get(API_KEY_STORAGE))[API_KEY_STORAGE]);
  await serial(async()=>{if(page)await authorize();await aiStatus(module,{error:null,retrying:false});});
  return {ready:true};
 }catch(error){
  if(PASS_THROUGH.includes(error.code))throw error;
  await serial(async()=>{if(page)await workspace(msg,sender);await aiStatus(module,{error:error.message,attempt:1,retrying:false});});
  throw error;
 }
}

export async function aiReply(msg,sender){
 if(!isPage(sender))throw fail('无效 AI 请求来源');
 const notification=msg.kind==='AI_NOTIFICATION_REPLY',module=notification?'notifications':'interaction',key=KEYS[module];
 const auth={owner:sender.tab.id,runId:msg.runId,documentId:await workspace(msg,sender)};
 const s=await read(key);patchState(s,{},auth);await managed.authorize(sender.tab.id,module,s.account);
 const check=async()=>{await workspace(msg,sender);const latest=await read(key);patchState(latest,{},auth);await managed.authorize(sender.tab.id,module,latest.account);};
 const report=entry=>serial(async()=>{
  await check();
  await aiStatus(module,{operation:msg.kind,runId:msg.runId,error:entry.reason,reasonCode:entry.reasonCode,attempt:entry.attempt,retrying:entry.retrying});
  await log(`${msg.kind} · AI 第 ${entry.attempt} 次失败 · ${entry.reason} · ${entry.retrying?'稍后重试':'本次生成失败，未发送'}`);
 });
 const context=normalizeReplyContext(msg.post?.context,msg.post||{});
 const result=await recoverGeneration(async()=>{
  const [processed,notifications,claims,memories]=await Promise.all([read(K.PROCESSED),read(K.NOTIFICATION_REPLIES),read(K.REPLY_CLAIMS),read(K.REPLY_MEMORY)]);
  const account=s.account.toLowerCase();
  const selfReplies=confirmedReplyHistory(context,s.account,processed?.posts,notifications?.[account]?.records,claims?.[account]);
  // voice is always worker-built: a page-supplied value never reaches the prompt.
  return (notification?generateNotificationReply:generateReply)({...msg.post,context,selfReplies,account:s.account,voice:buildVoice(memories?.[account],claims?.[account],context)});
 },{binding:{postId:msg.post?.id},check,report});
 await check();
 if(!result.skippedGenerationError)await serial(async()=>{await check();await aiStatus(module,{runId:msg.runId,error:null,retrying:false});});
 if(result?.action!=='send_reply')return result;
 // Remember what was generated; it only becomes memory once the claim ledger shows it was sent.
 await serial(()=>stageMemory(s.account.toLowerCase(),context,result)).catch(()=>{});
 const {memoryNote,...page}=result; // the page never sees the note
 return page;
}

async function stageMemory(account,context,result){
 const [memories,claims]=await Promise.all([read(K.REPLY_MEMORY),read(K.REPLY_CLAIMS)]);
 const next=stage(reconcile(memories?.[account],claims?.[account]),{postId:context.target.id,author:context.target.author,
  rootId:context.root.id,theirs:context.target.text,mine:result.text,note:result.memoryNote});
 await write(K.REPLY_MEMORY,{...memories,[account]:next});
}
