// Shared, wall-clock bounded waits. No polling count is treated as a duration.
(() => {
  class TaskError extends Error {
    constructor(code, message) { super(message); this.name = code === 'YIELD' ? 'YieldError' : 'TaskError'; this.code = code; }
  }
  function check(signal, deadline = Infinity) {
    if (signal?.aborted) throw new DOMException('任务已停止', 'AbortError');
    if (Date.now() >= deadline) throw new TaskError('YIELD', '工作窗口已结束，稍后继续');
  }
  async function sleep(ms, signal, deadline = Infinity) {
    check(signal, deadline);
    await globalThis.XAssistantRuntime.sleep(Math.max(0, Math.min(ms, deadline - Date.now())), signal);
    check(signal, deadline);
  }
  // A hidden tab's timers may be throttled. Wake at actual DOM changes as
  // well as on a timer, but never extend the original absolute timeout.
  function waitForPage(probe, {signal, deadline=Infinity, timeout=10000, interval=100}={}) {
    const root=globalThis.document?.documentElement, Observer=globalThis.MutationObserver;
    if(!root||typeof Observer!=='function')return waitFor(probe,{signal,deadline,timeout,interval});
    const end=Date.now()+timeout;
    return new Promise((resolve,reject)=>{
      let timer,observer,wake,done=false;
      const finish=(fn,value)=>{
        if(done)return;done=true;
        clearTimeout(timer);observer?.disconnect();signal?.removeEventListener('abort',abort);wake?.abort();fn(value);
      };
      const abort=()=>finish(reject,new DOMException('任务已停止','AbortError'));
      const test=()=>{
        if(done)return;
        try{
          check(signal,deadline);globalThis.XAssistantRuntime.check?.(signal);
          if(Date.now()>end){finish(resolve,null);return;}
          const value=probe();
          check(signal,deadline);
          if(Date.now()>end || (!value && Date.now()>=end)){finish(resolve,null);return;}
          if(value)finish(resolve,value);
        }catch(e){finish(reject,e);}
      };
      const tick=()=>{test();if(!done)timer=setTimeout(tick,Math.max(1,Math.min(interval,end-Date.now(),deadline-Date.now())));};
      signal?.addEventListener('abort',abort,{once:true});
      try{
        observer=new Observer(test);
        observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-disabled','disabled','contenteditable','data-testid','role','href']});
        tick();
        // Managed hidden tabs can also use Runtime.sleep's background timer.
        // One cancellable deadline wake (not one API call per DOM poll). A
        // receipt-only wait without a task signal must not require permission.
        const clock=signal?globalThis.XAssistantRuntime.sleep:globalThis.XAssistantRuntime.wakeReadOnly;
        if(!done && clock && typeof AbortController==='function'){
          wake=new AbortController();
          clock(Math.max(0,Math.min(end,deadline)-Date.now()),wake.signal)
            .then(()=>{if(!done)test();},e=>{if(!done)finish(reject,e);});
        }
      }catch(e){finish(reject,e);}
    });
  }
  async function waitFor(probe, { signal, deadline = Infinity, timeout = 10000, interval = 100 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      check(signal, deadline);
      const result = probe();
      // A synchronous DOM probe can itself consume the remaining work window.
      check(signal, deadline);
      if (Date.now() > end) return null;
      if (result) return result;
      if (Date.now() >= end) return null;
      await sleep(Math.min(interval, end - Date.now()), signal, deadline);
    }
  }
  async function bounded(work, {signal, deadline = Infinity} = {}) {
    check(signal, deadline);
    let timer, cancel;
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        // Cancellation can occur after bounded() returns but before this microtask.
        check(signal, deadline);
        return work();
      }), new Promise((_, reject) => {
        cancel = () => reject(new DOMException('任务已停止', 'AbortError'));
        signal?.addEventListener('abort', cancel, {once:true});
        if (Number.isFinite(deadline)) timer = setTimeout(() => reject(new TaskError('YIELD','工作窗口已结束，稍后继续')), Math.max(0,deadline-Date.now()));
      })]);
      // Promise reactions run before timers: a blocked event loop must not turn
      // an expired result into success simply because the timer has not fired.
      check(signal, deadline);
      return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  globalThis.XAssistantTasks = {TaskError, check, sleep, waitForPage, waitFor, bounded};
})();
