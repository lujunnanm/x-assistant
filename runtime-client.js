(()=>{
 const call=async message=>{const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'扩展后台未响应，请刷新页面');return result.state;};
 const abort=()=>new DOMException('任务已停止','AbortError');
 const check=signal=>{if(signal?.aborted)throw abort();};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const done=()=>{signal?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(done,ms);const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abort());};signal?.addEventListener('abort',cancel,{once:true});});
 const runtime=(module,action,extra={})=>call({kind:'RUNTIME',module,action,...extra});
 const review=async(module,account)=>{
  const s=await runtime(module,'get');if(!['unknown','submitting','deleting'].includes(s.phase))return true;
  if(s.active)throw Error('请先结束旧任务，再核对平台记录');
  const action=module==='cleanup'?'删除':'发送',accepted=confirm(`上次${action}结果未知。请先在 X 核对并处理这条记录：\n\n`+(s.text||'（请查看平台记录）')+'\n\n只有已核对完成才点“确定”。将保留旧记录，开始新的轮换；不会自动重试旧任务。');
  if(!accepted)return false;
  await runtime(module,'resolve',{runId:s.runId,account,reviewed:true});return true;
 };
 globalThis.XAssistantRuntime={call,runtime,sleep,check,abort,review};
})();
