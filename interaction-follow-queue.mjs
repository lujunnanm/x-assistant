export const FOLLOW_QUEUE_KEY='xAssistantInteractionFollowQueueV1';
export const FOLLOW_QUEUE_ALARM='x-assistant-follow-queue';
const terminal=new Set(['verified','skipped','unknown','failed','skipped_followback_ledger']);

// A separate tab owns DOM work. Enqueue only persists; neither pacing nor navigation
// is awaited by the interaction loop or the background's general message queue.
export function createFollowQueue({read,write,tabs,page,gate,allowed,reserved,notify,schedule,now=Date.now,uuid=()=>crypto.randomUUID()}){
 let writes=Promise.resolve(),running=null;
 const load=async()=>({rows:{},tab:null,blocked:null,...await read()});
 const change=fn=>{const result=writes.then(async()=>{const state=await load(),value=await fn(state);await write(state);return value;});writes=result.catch(()=>{});return result;};
 const update=(key,patch)=>change(s=>Object.assign(s.rows[key],patch));
 const finish=async(row,status,error)=>{
  const result=await update(row.key,{status,error:error||null,finishedAt:now()});
  await notify(result);
 };
 const enqueue=async input=>{
  const account=String(input.account).toLowerCase(),author=String(input.author).toLowerCase();
  if(!/^\/[a-z0-9_]{1,15}$/.test(account)||! /^[a-z0-9_]{1,15}$/.test(author)||!/^\d+$/.test(input.postId)||account==='/'+author||!Number.isInteger(input.windowId))throw Error('关注队列目标无效');
  const status=await change(s=>{
   const key=account+'@'+author,old=s.rows[key];
   if(old){if(!old.postIds.includes(input.postId))old.postIds.push(input.postId);return terminal.has(old.status)?old.status:'queued';}
   s.rows[key]={key,id:uuid(),account,author,postId:input.postId,postIds:[input.postId],windowId:input.windowId,url:`https://x.com/${author}/status/${input.postId}`,status:'queued',createdAt:now(),nextAt:0};
   return 'queued';
  });
  schedule(now()+100);return status;
 };
 async function step(){
  const state=await load();
  // A worker restart after durable intent must not repeat an uncertain click.
  for(const row of Object.values(state.rows))if(row.status==='in_flight')await finish(row,'unknown','后台重启，关注结果待核对，不自动重试');
  if(state.blocked)return;
  const permission=new Map();let row;
  for(const candidate of Object.values(state.rows).filter(r=>['queued','loading'].includes(r.status))){
   if(!permission.has(candidate.account))permission.set(candidate.account,await allowed(candidate.account));
   if(permission.get(candidate.account)){row=candidate;break;}
  }
  if(!row)return;
  if(row.nextAt>now()){schedule(row.nextAt);return;}
  let permit=null,binding=null,attempted=false;
  try{
   let tab=state.tab;
   if(!tab){
    const created=await tabs.create({url:row.url,windowId:row.windowId,active:false});
    tab={id:created.id,url:row.url};await change(s=>{s.tab=tab;});
   }else{
    let live;try{live=await tabs.get(tab.id);}catch(error){throw Object.assign(error,{blockQueue:true});}
    if(live.url!==tab.url){throw Object.assign(Error('关注队列页面已离开原目标，请返回原页后重新开启自动关注'),{blockQueue:true});}
    if(tab.url!==row.url){
     if(!(await page(tab.id,row,'canNavigate')).result?.safe)throw Object.assign(Error('关注队列原页有草稿或账号变化，请先处理'),{blockQueue:true});
     await tabs.update(tab.id,{url:row.url,active:false});tab={id:tab.id,url:row.url};await change(s=>{s.tab=tab;});
    }
   }
   if(!await allowed(row.account))return;
   const prepared=await page(tab.id,row,'prepare'),target=prepared.result;
   if(target?.state==='paused')return;
   if(target?.state==='loading'){
    const startedAt=row.startedAt||now();
    if(now()-startedAt>60000)throw Error('关注目标加载超时');
    await update(row.key,{status:'loading',startedAt,nextAt:now()+5000});schedule(now()+5000);return;
   }
   if(target?.state==='followed'){await finish(row,'skipped');return;}
   if(target?.state!=='unfollowed'||!prepared.documentId||target.targetId!=null&&!/^\d+$/.test(target.targetId))throw Error(target?.error||'无法核对关注目标');
   if(await reserved(row,target.targetId)){await finish(row,'skipped_followback_ledger');return;}
   binding={module:'interaction',kind:'follow',account:row.account,owner:tab.id,documentId:prepared.documentId,runId:row.id};
   permit=await gate.acquire(binding);
   if(!permit.granted){
    // Refresh the existing shared-gate intent without parking the interaction loop.
    const nextAt=Math.max(now()+250,Math.min(permit.retryAt,now()+5000));
    await update(row.key,{status:'queued',startedAt:null,nextAt});schedule(nextAt);return;
   }
   if(!await allowed(row.account))return;
   if(await reserved(row,target.targetId)){await finish(row,'skipped_followback_ledger');return;}
   await update(row.key,{status:'in_flight',leaseId:permit.leaseId});
   attempted=true; // Lost script/ACK after this point is unknown, never retried.
   const response=await page(tab.id,row,'click',{...permit,targetId:target.targetId,documentId:prepared.documentId});
   const result=response.result;
   if(response.documentId!==prepared.documentId)throw Error('关注页面文档已变化');
   if(result?.clicked===false)attempted=false;
   await gate.settle({...binding,leaseId:permit.leaseId,outcome:attempted?'attempted':'released'});permit=null;
   if(result?.state==='paused')await update(row.key,{status:'queued',nextAt:0});
   else await finish(row,result?.state==='followed'?(attempted?'verified':'skipped'):attempted?'unknown':'failed',result?.error);
  }catch(error){
   if(error.blockQueue){await change(s=>{s.blocked=error.message;});await notify({...row,status:'failed',error:error.message});}
   else await finish(row,attempted?'unknown':'failed',error.message);
  }finally{
   if(permit?.granted)await gate.settle({...binding,leaseId:permit.leaseId,outcome:attempted?'attempted':'released'}).catch(()=>{});
   const latest=await load();
   const next=Object.values(latest.rows).find(r=>r.account===row.account&&['queued','loading'].includes(r.status));
   if(!latest.blocked&&next&&await allowed(row.account))schedule(Math.max(now()+1000,next.nextAt));
  }
 }
 const pump=()=>running||(running=step().finally(()=>{running=null;}));
 const resume=async()=>{
  await change(async s=>{
   if(s.tab)try{await tabs.get(s.tab.id);}catch(e){if(/No tab with id/i.test(e.message))s.tab=null;else throw e;}
   s.blocked=null;
  });schedule(now()+100);
 };
 return {enqueue,pump,resume};
}
