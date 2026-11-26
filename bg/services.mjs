// Long-lived collaborators: the work-tab supervisor, the outward action gate and the follow queue.
import {createManagedService} from '../managed-service.mjs';
import {createActionGate,ACTION_GATE_KEY} from '../action-gate.mjs';
import {createFollowQueue,FOLLOW_QUEUE_KEY,FOLLOW_QUEUE_ALARM} from '../interaction-follow-queue.mjs';
import {interactionFollowPage} from '../interaction-follow-page.mjs';
import {prepareWorkerRepair} from '../worker-repair.mjs';
import {KEYS} from '../state.mjs';
import {K,read,write,serial,log} from './context.mjs';
import {getEligiblePostingRows} from './copies.mjs';
import {retireMissingRun} from './ledgers.mjs';

export const managed=createManagedService({
 read,write,tabs:chrome.tabs,alarms:chrome.alarms,runtimeFor:module=>read(KEYS[module]),retireMissingRun,prepareWorkerRepair,
 beforeWorkerRestart:async(tab,account,{module})=>{
  let snapshot={at:Date.now(),module,account,tabId:tab.id,url:tab.url};
  try{
   const result=await Promise.race([chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({
    drafts:[...document.querySelectorAll('[contenteditable="true"]')].map(e=>e.innerText||e.textContent||'').filter(Boolean),
    hasAttachments:!!document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')
   })}),new Promise((_,reject)=>setTimeout(()=>reject(Error('工作页快照超时')),5000))]);snapshot={...snapshot,...result[0]?.result};
  }catch(e){snapshot.readError=e.message;}
  const key='xAssistantRestartSnapshotsV1',saved=await read(key)||[];
  await write(key,[...saved,snapshot].slice(-20));
 },
 canRecoverPosting:async run=>{const gate=await read(ACTION_GATE_KEY);return !gate?.holder&&(!run.submittedAt||run.receipt?.kind==='confirmed');},
 postingReady:async()=>!!(await getEligiblePostingRows()).length
});

export const actionGate=createActionGate({
 read:async()=>{
  const state=await read(ACTION_GATE_KEY)||{};
  if(state.version===1)return state;
  // One-time migration input from pre-v1 gates.
  const runtimes=await Promise.all(['posting','interaction','notifications'].map(async module=>[module,await read(KEYS[module])]));
  return {...state,legacyFollowCooldown:await read(K.LEGACY_FOLLOW_COOLDOWN)||{},runtimes:Object.fromEntries(runtimes)};
 },
 write:state=>write(ACTION_GATE_KEY,state)
});

export async function queueFollowAllowed(account){
 const service=await managed.get(),run=await read(KEYS.interaction);
 return service.enabled&&service.selected.interaction&&service.account===account&&run?.active&&run.account===account&&
  service.workers.interaction?.tabId===run.owner&&(await read(K.AUTO_FOLLOW))!==false;
}

let followQueueTimer=null,followQueueAt=Infinity;
export function scheduleFollowQueue(at){
 if(followQueueAt<=at)return;
 clearTimeout(followQueueTimer);followQueueAt=at;
 chrome.alarms.create(FOLLOW_QUEUE_ALARM,{when:at});
 followQueueTimer=setTimeout(runFollowQueue,Math.max(1,at-Date.now()));
}
export function runFollowQueue(){
 clearTimeout(followQueueTimer);followQueueTimer=null;followQueueAt=Infinity;
 // Durable wake survives a worker suspension during navigation or a click.
 chrome.alarms.create(FOLLOW_QUEUE_ALARM,{when:Date.now()+30000});
 followQueue.pump()
  .catch(error=>serial(()=>log('独立关注队列：'+error.message)).catch(console.error))
  .finally(()=>{if(followQueueAt===Infinity)chrome.alarms.clear(FOLLOW_QUEUE_ALARM);});
}

async function notifyFollow(row){
 const db=await read(K.PROCESSED)||{posts:{}};
 for(const id of row.postIds){
  const record=db.posts[id];
  if(record?.reply==='verified'&&record.author?.toLowerCase()==='@'+row.author){record.follow=row.status;if(row.error)record.followError=row.error;}
 }
 await write(K.PROCESSED,db);
 if(['verified','skipped'].includes(row.status)){
  const followed=await read(K.FOLLOWED)||{handles:{}};
  followed.handles[row.author]={...followed.handles[row.author],handle:'@'+row.author,owner:row.account.slice(1),
   source:row.status==='verified'?'interaction':'observed',lastSeenAt:new Date().toISOString()};
  await write(K.FOLLOWED,followed);
 }
 await log('独立关注 · @'+row.author+' · '+row.status+(row.error?' · '+row.error:''));
}

export const followQueue=createFollowQueue({
 read:()=>read(FOLLOW_QUEUE_KEY),write:value=>write(FOLLOW_QUEUE_KEY,value),tabs:chrome.tabs,gate:actionGate,
 allowed:queueFollowAllowed,schedule:scheduleFollowQueue,
 page:async(tabId,row,mode,permit)=>{
  const target=permit?.documentId?{tabId,documentIds:[permit.documentId]}:{tabId,frameIds:[0]};
  const results=await chrome.scripting.executeScript({target,func:interactionFollowPage,args:[row,mode,permit||null]});
  if(results.length!==1)throw Error('独立关注页面返回异常');
  return results[0];
 },
 reserved:async(row,targetId)=>{
  const records=(await read(K.FOLLOWBACK_LEDGER))?.[row.account]||{};
  return !!records['@'+row.author]||!!targetId&&Object.values(records).some(r=>r.targetId===targetId);
 },
 notify:row=>serial(()=>notifyFollow(row))
});
