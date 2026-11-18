// Only this wrapper may turn a persistent write-action lease into a DOM click.
(() => {
 const api=globalThis.XAssistantRuntime;
 const failure=(code,message)=>Object.assign(Error(message),{code});
 const synchronous=fn=>typeof fn==='function'&&fn.constructor?.name!=='AsyncFunction';
 const thenable=value=>value&&typeof value.then==='function';
 const monotonic=()=>globalThis.performance?.now?.()??Date.now();
 async function request(message,{signal,deadline}={}){
  return globalThis.XAssistantTasks.bounded(()=>api.call(message),{signal,deadline});
 }
 async function click({module,runId,account,kind,afterReply=false,signal,beforeClick=async()=>{},onWait=async()=>{},validate=()=>{},click:perform}){
  if(!synchronous(validate)||!synchronous(perform))throw failure('ACTION_ASYNC_CLICK','操作检查和点击必须同步执行');
  const binding={module,runId,account,actionKind:kind,...(afterReply?{afterReply:true}:{})};
  let permit=null,attempted=false,settlementStarted=false;
  const settle=outcome=>request({kind:'ACTION_SETTLE',...binding,leaseId:permit.leaseId,outcome},{deadline:Date.now()+5000});
  try{
   for(;;){
    api.check(signal);
    let abandoned=false;
    const pending=api.call({kind:'ACTION_ACQUIRE',...binding});
    pending.then(value=>{if(abandoned&&value?.granted)api.call({kind:'ACTION_SETTLE',...binding,leaseId:value.leaseId,outcome:'released'}).catch(()=>{});},()=>{});
    const started=monotonic();
    try{permit=await globalThis.XAssistantTasks.bounded(()=>pending,{signal,deadline:Date.now()+10000});}
    catch(error){abandoned=true;throw error;}
    api.check(signal);
    if(!permit?.granted){
     if(!Number.isFinite(permit?.retryAt))throw failure('ACTION_PERMIT','后台未返回有效操作许可');
     await onWait();api.check(signal);
     // Competing leases may ACK/release immediately; only contention polls briefly.
     if(!permit.waitForLease&&permit.retryAt-Date.now()>1000)globalThis.XAssistantWorkspace?.progress?.('等待操作间隔',{until:permit.retryAt});
     const poll=permit.waitForLease?250:permit.waitForIntent?5000:Infinity;
     await api.sleep(Math.max(1,Math.min(permit.retryAt-Date.now(),poll)),signal);if(!permit.waitForLease&&!permit.waitForIntent)globalThis.XAssistantWorkspace?.progress?.('正在核对操作目标');continue;
    }
    const withinLease=()=>{
     if(!permit.leaseId||!Number.isFinite(permit.expiresAt)||Date.now()>=permit.expiresAt||monotonic()-started>=10000)throw failure('ACTION_LEASE_EXPIRED','操作许可超时，尚未点击');
    };
    withinLease();
    await beforeClick();
    api.check(signal);withinLease();
    if(thenable(validate()))throw failure('ACTION_ASYNC_CLICK','操作检查不能返回异步任务');
    api.check(signal);withinLease();
    // There is no await between this final check and the actual platform click.
    attempted=true;
    const result=perform();
    if(thenable(result))throw failure('ACTION_ASYNC_CLICK','实际点击不能返回异步任务');
    settlementStarted=true;await settle('attempted');
    return result;
   }
  }catch(error){
   const e=error instanceof Error?error:Error(String(error));
   if(permit?.granted){
    if(!attempted){try{await settle('released');}catch{}}
    else{e.submitted=true;if(!settlementStarted){try{await settle('attempted');}catch{}}}
   }
   throw e;
  }
 }
 globalThis.XAssistantActions={click};
})();
