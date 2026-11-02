import {verifyCredential,API_KEY_STORAGE} from './deepseek-direct.mjs';
import {recoverGeneration} from './ai-recovery.mjs';
import {POST_SCHEDULE_KEY,restoreSchedule,confirmSchedule,scheduledStart} from './posting-schedule.mjs';
import {generateReply,generatePost,generateNotificationReply} from './ai-client.mjs';
import builtinLibrary from './builtin-library.mjs';
import lanvPosts from './lanv-posts-50.mjs';
import rewrittenPosts from './rewritten-existing-posts-155.mjs';
import {validateRows} from './core.mjs';
import {KEYS,beginState,patchState,stopState,resolveState,libraryOperation,reserveRow} from './state.mjs';
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
const read=async key=>(await chrome.storage.local.get(key))[key];
const write=(key,value)=>chrome.storage.local.set({[key]:value});
const getApp=async()=>({rows:[],logs:[],revision:0,...await read('app')});
async function log(message){const app=await getApp();app.logs=[{time:new Date().toISOString(),message},...(app.logs||[])].slice(0,100);await write('app',app);}
async function handle(msg,sender){
 const panel=sender.url?.split('#')[0]===chrome.runtime.getURL('panel.html');
 const page=Number.isInteger(sender.tab?.id)&&/^https:\/\/x\.com\//.test(sender.url||'');
 if(!panel&&!page)throw Error('无效消息来源');
 if(msg.kind==='PING')return null;
 if(msg.kind==='AI_CHECK'){
  try{await verifyCredential((await chrome.storage.local.get(API_KEY_STORAGE))[API_KEY_STORAGE]);await write('xAssistantAIStatusV1',{error:null,time:Date.now()});return {ready:true};}
  catch(e){await write('xAssistantAIStatusV1',{module:'preflight',error:e.message,attempt:1,retrying:false,time:Date.now()});throw e;}
 }

 if(msg.kind==='GET'&&panel)return getApp();
 if(msg.kind==='LIBRARY_OP'&&panel){const app=libraryOperation(await getApp(),msg.op);await write('app',app);await log('文案库更新：'+msg.op.action);return getApp();}
 if(msg.kind==='OPEN_PANEL'&&page){await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'#'+(['library','following','logs'].includes(msg.section)?msg.section:'library')});return null;}
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
  await write('xAssistantProcessedV1',db);return db;
 }
 if(msg.kind!=='RUNTIME'||!page||!KEYS[msg.module])throw Error('未知或未授权命令');
 const key=KEYS[msg.module],s=await read(key)||{},owner=sender.tab.id;
 if(msg.action==='get')return s;
 let next;
 if(msg.action==='begin'||msg.action==='prepare'){
  if(!['cleanup','notifications'].includes(msg.module)&&!(await getApp()).rows.some(r=>r.enabled&&r.type===(msg.module==='posting'?'post':'reply')))throw Error('文案库为空或全部停用');
  const states=await Promise.all(Object.entries(KEYS).filter(([name])=>name!==msg.module).map(async([name,otherKey])=>[name,await read(otherKey)||{}]));
  if(states.some(([name,state])=>state.active&&(msg.module==='cleanup'||name==='cleanup')))throw Error('清理模块不能与互动或发帖同时运行');
  const other=states.map(([,state])=>state).find(state=>state.active)||{};
  next=beginState(s,other,{owner,account:msg.account,resume:msg.resume});
  if(msg.action==='prepare')return {account:next.account,owner:next.owner};
 }else if(msg.action==='stop')next=stopState(s);
 else if(msg.action==='resolve')next=resolveState(s,msg);
 else if(msg.action==='patch')next=patchState(s,msg.patch,{owner,runId:msg.runId});
 else if(msg.action==='pick'){
  if(msg.module==='cleanup')throw Error('清理模块不使用文案库');
  patchState(s,{}, {owner,runId:msg.runId});
  const chosen=reserveRow(s,(await getApp()).rows,msg.module==='posting'?'post':'reply');
  await write(key,chosen.state);return chosen.row;
 }else throw Error('未知运行操作');
 if(msg.module==='posting'&&(next.account||s.account)){
  const schedules=await read(POST_SCHEDULE_KEY)||{};
  let schedule=restoreSchedule(schedules,next.account||s.account,s);
  if(msg.action==='patch'&&msg.patch?.phase==='confirmed'){
   if(msg.patch.receipt?.kind!=='confirmed')throw Error('发帖成功必须有平台回执');
   // Idempotent receipt replay cannot move the deadline or count as another post.
   schedule=schedule.confirmedRunId===s.runId&&schedule.confirmedSubmittedAt===s.submittedAt?schedule:{...confirmSchedule(),confirmedRunId:s.runId,confirmedSubmittedAt:s.submittedAt};
   next.nextAt=schedule.nextPostAt;
  }else if(msg.action==='begin'){
   next.nextAt=scheduledStart(schedule);schedule.nextPostAt=next.nextAt;
  }else if(msg.action==='patch'&&Number.isFinite(next.nextAt))schedule.nextPostAt=next.nextAt;
  next.lastPostedAt=schedule.lastPostedAt;next.nextPostAt=schedule.nextPostAt;
  schedules[(next.account||s.account).toLowerCase()]=schedule;
  await chrome.storage.local.set({[key]:next,[POST_SCHEDULE_KEY]:schedules});
 }else await write(key,next);
 if(['begin','stop','resolve'].includes(msg.action)||msg.patch?.error||msg.patch?.phase==='confirmed')await log(`${msg.module} · ${next.phase}${next.error?' · '+next.error:''}`);
 return next;
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(msg?.kind==='AI_REPLY'||msg?.kind==='AI_POST'||msg?.kind==='AI_NOTIFICATION_REPLY'){
  (async()=>{
   if(!Number.isInteger(sender.tab?.id)||!/^https:\/\/x\.com\//.test(sender.url||''))throw Error('无效 AI 请求来源');
   const key=msg.kind==='AI_NOTIFICATION_REPLY'?KEYS.notifications:msg.kind==='AI_REPLY'?KEYS.interaction:KEYS.posting;
   const s=await read(key);patchState(s,{}, {owner:sender.tab.id,runId:msg.runId});
   const recover=(generate,binding)=>recoverGeneration(generate,{binding,
    check:async()=>patchState(await read(key),{}, {owner:sender.tab.id,runId:msg.runId}),
    report:entry=>serial(async()=>{await write('xAssistantAIStatusV1',{module:msg.kind,error:entry.reason,attempt:entry.attempt,retrying:entry.retrying,time:Date.now()});await log(`${msg.kind} · AI 第 ${entry.attempt} 次失败 · ${entry.reason} · ${entry.retrying?'稍后重试':'本次生成失败，未发送'}`);})
   });
   let result;
   if(msg.kind==='AI_POST'){
    const row=(await getApp()).rows.find(r=>r.id===msg.rowId&&r.type==='post'&&r.enabled);
    if(!row||s.lastId!==row.id)throw Error('发帖参考不匹配');
    result=await recover(()=>generatePost(row),{rowId:row.id});
   }else result=await recover(()=>(msg.kind==='AI_NOTIFICATION_REPLY'?generateNotificationReply:generateReply)(msg.post),{postId:msg.post?.id});
   patchState(await read(key),{}, {owner:sender.tab.id,runId:msg.runId});
   if(!result.skippedGenerationError)await serial(()=>write('xAssistantAIStatusV1',{error:null,time:Date.now()}));
   return result;
  })().then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message||'任务已停止；未发送'}));return true;
 }
 serial(()=>handle(msg||{},sender)).then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message}));return true;
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function recover(install=false){
 const app=await getApp();
 if(install&&!app.builtinLibraryV1Loaded){const ids=new Set(app.rows.map(r=>r.id));app.rows.push(...validateRows(builtinLibrary).filter(r=>!ids.has(r.id)));app.builtinLibraryV1Loaded=true;}
 if(install&&!app.replyFollowBackV1Loaded){app.rows=app.rows.map(row=>row.type==='reply'&&!row.text.trimEnd().endsWith('请回关我')?{...row,text:row.text.trimEnd()+'\n请回关我'}:row);app.replyFollowBackV1Loaded=true;}
 if(install&&!app.existingPostsRewriteV1Loaded){const replacements=new Map(validateRows(rewrittenPosts).map(row=>[row.id,row])),ids=new Set(app.rows.map(row=>row.id));app.rows=app.rows.map(row=>replacements.has(row.id)?{...row,text:replacements.get(row.id).text}:row);app.rows.push(...rewrittenPosts.filter(row=>!ids.has(row.id)));app.existingPostsRewriteV1Loaded=true;}
 if(install&&!app.lanvPostsV1Loaded){const ids=new Set(app.rows.map(row=>row.id));app.rows.push(...validateRows(lanvPosts).filter(row=>!ids.has(row.id)));app.lanvPostsV1Loaded=true;}
 if(install&&!app.postTopicsV1Loaded){const tagged=validateRows([...rewrittenPosts,...lanvPosts]),replacements=new Map(tagged.map(row=>[row.id,row])),ids=new Set(app.rows.map(row=>row.id));app.rows=app.rows.map(row=>replacements.has(row.id)?{...row,text:replacements.get(row.id).text}:row);app.rows.push(...tagged.filter(row=>!ids.has(row.id)));app.postTopicsV1Loaded=true;}
 app.schemaVersion=2;app.running=false;app.nextAt=null;
 await write('app',app);
 for(const key of Object.values(KEYS))await write(key,stopState(await read(key)));
 const schedule=await read('xAssistantSchedulerV3');if(schedule)await write('xAssistantSchedulerV3',{...schedule,active:false});
 const scan=await read('xAssistantFollowingScanV1');if(scan)await write('xAssistantFollowingScanV1',{...scan,active:false,message:'浏览器或扩展已重启，请重新读取'});
 await chrome.alarms.clear('x-assistant-loop');
 await log('v3 状态已恢复；用户文案保留，循环保持停止，未知发送记录保留');
}
chrome.runtime.onInstalled.addListener(()=>serial(()=>recover(true)).catch(console.error));
chrome.runtime.onStartup.addListener(()=>serial(()=>recover()).catch(console.error));
chrome.tabs.onRemoved?.addListener(id=>serial(async()=>{for(const key of Object.values(KEYS)){const s=await read(key);if(s?.owner===id)await write(key,stopState(s));}}).catch(console.error));

chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.url&&!/^https:\/\/x\.com\//.test(change.url))serial(async()=>{for(const key of Object.values(KEYS)){const s=await read(key);if(s?.owner===id)await write(key,stopState(s));}}).catch(console.error);});
