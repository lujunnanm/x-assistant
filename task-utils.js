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
  globalThis.XAssistantTasks = {TaskError, check, sleep, waitFor, bounded};
})();
