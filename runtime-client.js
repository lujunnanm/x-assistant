(()=>{
 const instanceId=crypto.randomUUID();
 // Isolated worlds can outlive a reload. A missing runtime.id is terminal *here*,
 // unlike a temporarily sleeping worker. Never issue another extension operation.
 let retired=false;
 const contextError=()=>Object.assign(Error('扩展已更新，请刷新当前 X 页面'),{code:'EXTENSION_CONTEXT_INVALIDATED'});
 const isInvalid=e=>e?.code==='EXTENSION_CONTEXT_INVALIDATED'||/extension context invalidated/i.test(e?.message||'');
 const retire=()=>{if(!retired){retired=true;globalThis.window?.dispatchEvent(new CustomEvent('x-assistant-invalidate',{detail:{reason:contextError().message,code:'EXTENSION_CONTEXT_INVALIDATED'}}));}return contextError();};
 const assertContext=()=>{let id;try{id=globalThis.chrome?.runtime?.id;}catch(e){if(!isInvalid(e))throw e;}if(retired||!id)throw retire();};
 const io=async operation=>{assertContext();try{const value=await operation();assertContext();return value;}catch(e){if(isInvalid(e))throw retire();throw e;}};
 const storage={get:key=>io(()=>chrome.storage.local.get(key)),set:values=>io(()=>chrome.storage.local.set(values))};
 const call=async message=>{const result=await io(()=>chrome.runtime.sendMessage({...message,instanceId}));if(!result?.ok)throw Object.assign(Error(result?.error||'扩展后台未响应，请刷新页面'),{code:result?.code,submitted:result?.submitted,confirmed:result?.confirmed});return result.state;};
 const abort=()=>new DOMException('任务已停止','AbortError');
 const check=signal=>{if(signal?.aborted)throw abort();assertContext();if(signal)globalThis.XAssistantWorkspace?.check(signal);};
 // Hidden tab timers may be coalesced. A short worker-side timer delivers a
 // wake-up only: it neither grants a write permit nor starts a task.
 const sleepPart=(ms,signal,guard)=>new Promise((resolve,reject)=>{
  guard(signal);let settled=false;
  const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(e)reject(e);else resolve();};
  const cancel=()=>finish(abort()),timer=setTimeout(()=>finish(),ms);
  signal?.addEventListener('abort',cancel,{once:true});
  if(globalThis.document?.hidden&&globalThis.XAssistantWorkspace?.active?.()&&ms>0){
   call({kind:'WORKER_WAKE',ms:Math.ceil(ms)}).then(()=>finish(),()=>{}); // local timer is the fallback
  }
 });
 const sleepWith=async(ms,signal,guard)=>{
  const end=Date.now()+Math.max(0,ms);
  do{await sleepPart(Math.max(0,Math.min(15000,end-Date.now())),signal,guard);guard(signal);}while(Date.now()<end);
 };
 const sleep=(ms,signal)=>sleepWith(ms,signal,check);
 // Receipt readback after a click does not authorize another click, even on Stop.
 const wakeReadOnly=(ms,signal)=>sleepWith(ms,signal,s=>{if(s?.aborted)throw abort();});
 const runtime=(module,action,extra={})=>call({kind:'RUNTIME',module,action,...extra});
 const review=async(module,account)=>{
  const s=await runtime(module,'get');if(!['unknown','submitting','deleting'].includes(s.phase))return true;
  if(s.active)throw Error('请先结束旧任务，再核对平台记录');
  const action=module==='followback'?'回关':module==='cleanup'?'删除':'发送',postingNote=module==='posting'?'\n\n确认后这条不确定文案会自动停用，其他启用文案继续按顺序发送；不会自动重试本条。':'\n\n只有已核对完成才点“确定”。将保留旧记录，开始新的轮换；不会自动重试旧任务。',accepted=confirm(`上次${action}结果未知。请先在 X 核对并处理这条记录：\n\n`+(s.text||'（请查看平台记录）')+postingNote);
  if(!accepted)return false;
  await runtime(module,'resolve',{runId:s.runId,account,reviewed:true});return true;
 };
 globalThis.XAssistantRuntime={call,runtime,storage,assertContext,isInvalid,retired:()=>retired,sleep,wakeReadOnly,check,abort,review,instanceId};
})();
