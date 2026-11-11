// Mandatory persistent pacing for every outward action; scans never acquire a lease.
export const ACTION_GATE_KEY='xAssistantActionGateV1';
export const ACTION_INTERVAL=23000;
export const FOLLOW_INTERVAL=120000;
export const FOLLOWBACK_MIN=55000,FOLLOWBACK_MAX=70000;
export const INTERACTION_FOLLOW_INTENT_TTL=15000;
export const sampleFollowbackInterval=(rng=Math.random)=>FOLLOWBACK_MIN+Math.round(Math.max(0,Math.min(1,Number(rng())||0))*(FOLLOWBACK_MAX-FOLLOWBACK_MIN));
export const ACTION_LEASE=10000;
const kinds=new Set(['post','reply','like','follow']);
const stamp=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const later=(a,b)=>a===null?b:b===null?a:Math.max(a,b);
const fail=(code,message)=>Object.assign(Error(message),{code});
const binding=input=>{
 const account=String(input.account||'').toLowerCase();
 if(!/^\/[a-z0-9_]{1,15}$/.test(account)||!['posting','interaction','notifications','followback'].includes(input.module)||(input.module==='followback'&&input.kind!=='follow')||!Number.isInteger(input.owner)||!input.documentId||!input.runId||!kinds.has(input.kind))throw fail('ACTION_BINDING','写操作缺少有效运行凭证');
 return {account,module:input.module,owner:input.owner,documentId:input.documentId,runId:input.runId,kind:input.kind,...(input.module==='notifications'&&input.kind==='like'&&input.afterReply===true?{afterReply:true}:{})};
};
const same=(a,b)=>['account','module','owner','documentId','runId','kind','afterReply'].every(key=>a?.[key]===b[key]);

export function createActionGate({read,write,now=Date.now,uuid=()=>crypto.randomUUID(),random=Math.random}){
 let queue=Promise.resolve();
 const serial=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
 const clocks=value=>({lastActionAt:stamp(value?.lastActionAt),lastFollowAt:stamp(value?.lastFollowAt),lastFollowModule:value?.lastFollowModule==='followback'?'followback':'interaction',followbackNotBefore:stamp(value?.followbackNotBefore),interactionFollowIntentUntil:stamp(value?.interactionFollowIntentUntil),notifyLikeNotBefore:stamp(value?.notifyLikeNotBefore),notifyReplyNotBefore:stamp(value?.notifyReplyNotBefore)});
 const accountState=(state,account)=>state.accounts[account]??=clocks();
 const notifyGap=()=>3000+Math.round(Math.max(0,Math.min(1,Number(random())||0))*2000);
 function consume(state,holder,time){
  const record=accountState(state,holder.account);
  // These deadlines belong only to this account's notifications worker. Never
  // move the shared send/follow clock for a like or sample on acquire/poll.
  if(holder.module==='notifications'){
   if(holder.kind==='reply')record.notifyLikeNotBefore=later(record.notifyLikeNotBefore,time+notifyGap());
   if(holder.kind==='like'){
    // For this reply's own like, start the full send floor at the like ACK.
    // A standalone like instead guards the reverse direction by just 3–5 s;
    // if a recent reply preceded it, its separate pause cannot eat the send floor.
    const next=time+(holder.afterReply?ACTION_INTERVAL:notifyGap());
    record.notifyReplyNotBefore=later(record.notifyReplyNotBefore,
     record.notifyLikeNotBefore===null?next:Math.max(next,record.notifyLikeNotBefore+ACTION_INTERVAL));
   }
  }
  if(holder.kind==='like'){
   if(state.lastLikeAt===null||time>state.lastLikeAt){
    state.lastLikeAt=time;state.nextLikeAt=time+1000+Math.floor(Math.max(0,Math.min(1,Number(random())||0))*2000);
   }
   return;
  }
  state.lastActionAt=later(state.lastActionAt,time);
  record.lastActionAt=later(stamp(record.lastActionAt),time);
  if(holder.kind==='follow'&&(record.lastFollowAt==null||time>=record.lastFollowAt)){
   record.lastFollowAt=time;record.lastFollowModule=holder.module==='followback'?'followback':'interaction';
   if(holder.module==='followback')record.followbackNotBefore=time+durableGap(holder);
  }
 }
 async function load(){
  const raw=await read()||{},state={version:1,lastActionAt:stamp(raw.lastActionAt),lastLikeAt:stamp(raw.lastLikeAt),nextLikeAt:stamp(raw.nextLikeAt),accounts:{},holder:raw.holder||null,lastSettlement:raw.lastSettlement||null};
  for(const [account,value] of Object.entries(raw.accounts||{})){
   state.accounts[account]=clocks(value);
   state.lastActionAt=later(state.lastActionAt,state.accounts[account].lastActionAt);
  }
  if(raw.version!==1){
   // Upgrade once. Never erase old follow cooldowns or a recently submitted run.
   for(const [name,value] of Object.entries(raw.legacyFollowCooldown||{})){
    const account=name.toLowerCase(),nextAt=stamp(value?.nextAt);
    if(!/^\/[a-z0-9_]{1,15}$/.test(account)||nextAt===null)continue;
    consume(state,{account,kind:'follow'},nextAt-FOLLOW_INTERVAL);
   }
   for(const runtime of Object.values(raw.runtimes||{})){
    const account=String(runtime?.account||'').toLowerCase(),time=typeof runtime?.submittedAt==='number'?runtime.submittedAt:Date.parse(runtime?.submittedAt);
    if(/^\/[a-z0-9_]{1,15}$/.test(account)&&Number.isFinite(time))consume(state,{account,kind:'post'},time+15000);
   }
  }
  return state;
 }
 // Choose once at grant; neither polling, restart nor receipt readback resamples.
 const durableGap=holder=>Number.isFinite(holder.followbackGap)&&holder.followbackGap>=FOLLOWBACK_MIN&&holder.followbackGap<=FOLLOWBACK_MAX?holder.followbackGap:FOLLOWBACK_MAX;
 function expire(state,time){
  if(state.holder&&time>=state.holder.expiresAt){
   // A missing ACK is not proof of no click. The latest possible click is expiry.
   consume(state,state.holder,state.holder.expiresAt);
   const previous=state.holder;state.holder=null;return previous;
  }
  return null;
 }
 const acquire=input=>serial(async()=>{
  const request=binding(input),state=await load(),time=now();
  if(!Number.isFinite(time))throw fail('ACTION_CLOCK','系统时间无效');
  expire(state,time);
  const record=accountState(state,request.account);
  let retryAt=request.kind==='like'?(state.nextLikeAt??time):(state.lastActionAt===null?time:state.lastActionAt+ACTION_INTERVAL);
  if(request.module==='notifications'){
   const floor=request.kind==='like'?record.notifyLikeNotBefore:request.kind==='reply'?record.notifyReplyNotBefore:null;
   if(floor!==null)retryAt=Math.max(retryAt,floor);
  }
  if(request.kind==='follow'&&record.lastFollowAt!==null)retryAt=Math.max(retryAt,request.module==='followback'&&record.lastFollowModule==='followback'?Math.max(record.lastFollowAt+FOLLOWBACK_MIN,record.followbackNotBefore??record.lastFollowAt+FOLLOWBACK_MAX):record.lastFollowAt+FOLLOW_INTERVAL);
  // A waiting interaction follow renews a short intent. Follow-back yields
  // while it is refreshed; a stopped worker can delay it by at most one TTL.
  if(request.kind==='follow'&&request.module==='followback'&&record.interactionFollowIntentUntil!==null&&record.interactionFollowIntentUntil>time)
   retryAt=Math.max(retryAt,record.interactionFollowIntentUntil);
  if(state.holder){
   const sameLane=(request.kind==='like')===(state.holder.kind==='like');
   retryAt=Math.max(retryAt,state.holder.expiresAt+(sameLane?(request.kind==='like'?3000:ACTION_INTERVAL):0),request.kind==='follow'&&state.holder.account===request.account&&state.holder.kind==='follow'?state.holder.expiresAt+(state.holder.module==='followback'&&request.module==='followback'?durableGap(state.holder):FOLLOW_INTERVAL):0);
  }
  if(state.holder||time<retryAt){
   if(request.kind==='follow'&&request.module==='interaction')record.interactionFollowIntentUntil=time+INTERACTION_FOLLOW_INTENT_TTL;
   await write(state);return {granted:false,retryAt,...(state.holder?{waitForLease:true}:{}),...(request.kind==='follow'&&request.module==='interaction'?{waitForIntent:true}:{})};
  }
  if(request.kind==='follow'&&request.module==='interaction')record.interactionFollowIntentUntil=null;
  state.holder={...request,leaseId:uuid(),expiresAt:time+ACTION_LEASE,...(request.module==='followback'?{followbackGap:sampleFollowbackInterval(random)}:{})};
  await write(state);
  return {granted:true,leaseId:state.holder.leaseId,expiresAt:state.holder.expiresAt,retryAt:null};
 });
 const settle=input=>serial(async()=>{
  const request=binding(input);
  if(!input.leaseId||!['attempted','released'].includes(input.outcome))throw fail('ACTION_SETTLEMENT','操作回执无效');
  const state=await load(),time=now();
  if(!Number.isFinite(time))throw fail('ACTION_CLOCK','系统时间无效');
  if(state.lastSettlement?.leaseId===input.leaseId&&same(state.lastSettlement,request))return {...state.lastSettlement,idempotent:true};
  const holder=state.holder;
  if(!holder||holder.leaseId!==input.leaseId||!same(holder,request))throw fail('ACTION_LEASE_CHANGED','操作许可已失效或不属于当前任务');
  const expired=time>=holder.expiresAt;
  if(input.outcome==='attempted')consume(state,holder,time);
  else if(expired)consume(state,holder,holder.expiresAt);
  // A late release never rolls back expiry's conservative consumption.
  state.holder=null;
  state.lastSettlement={...request,leaseId:input.leaseId,outcome:input.outcome,settledAt:time,consumed:input.outcome==='attempted'||!!expired};
  await write(state);
  return {...state.lastSettlement};
 });
 return {acquire,settle};
}
