// Independent replies lifecycle. Never starts a task merely because storage says active.
(() => {
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
  const api = globalThis.XAssistantRuntime;
  const T = globalThis.XAssistantTasks;
  const KEY = 'xAssistantNotificationsRuntimeV1';
  const SCHEDULE_KEY = 'xAssistantNotificationScheduleV1';
  const EMPTY_REST_MS = 10 * 60 * 1000;
  const MODULE = 'notifications';
  const root = document.getElementById('x-assistant-float');
  const section = root?.querySelector('[data-module="notifications"]');
  const output = root?.querySelector('[data-status="notifications"]');
  let current = null;

  const show = message => { if (output && output.textContent !== message) output.textContent = message; };
  const failureTiming=error=>{
    const chain=[];for(let e=error;e&&chain.length<6;e=e.cause)chain.push(e);
    const statuses=chain.map(e=>e.httpStatus??e.status).filter(n=>Number.isInteger(n)&&n>=100&&n<=599);
    const httpStatus=statuses.includes(429)?429:statuses[0],retryAt=Math.max(-Infinity,...chain.map(e=>e.retryAt).filter(Number.isFinite));
    return {...(httpStatus?{httpStatus}:{}),...(Number.isFinite(retryAt)?{retryAt}:{})};
  };
  const announce = (running, error = null) => window.dispatchEvent(new CustomEvent('x-assistant-module-state', {
    detail: {module: MODULE, running, error:error?.message||null,...(error?.code?{code:error.code}:{}),...(error?.submitted?{submitted:true}:{}),...(error?.confirmed?{confirmed:true}:{}),
      ...failureTiming(error)}
  }));
  function check(session) {
    T.check(session.signal);
    globalThis.XAssistantWorkspace?.check(session.signal);
    if (globalThis.XAssistantDOM.account() !== session.account)
      throw new T.TaskError('ACCOUNT_CHANGED', '账号变化，回帖已停止');
  }
  const patch = (session, value) => api.runtime(MODULE, 'patch', {runId: session.runId, patch: value});
  async function saveDeadline(session, nextAt, roundComplete=false, roundReason) {
    check(session);
    const data = (await local().get(SCHEDULE_KEY))[SCHEDULE_KEY] || {};
    check(session);
    await local().set({[SCHEDULE_KEY]: {...data, [session.account]: {nextAt,...(session.emptyRest?{emptyRest:true}:{})}}});
    await patch(session, {phase: 'waiting', nextAt,...(roundComplete?{roundComplete:true,roundReason:String(roundReason||'scan_finished').slice(0,120)}:{})});
    if (section) section.dataset.nextAt = String(nextAt);
  }
  async function countdown(session, nextAt) {
    while (Date.now() < nextAt) {
      check(session);
      const left=nextAt-Date.now();
      show(session.emptyRest?'暂无待回复评论 · 距下次扫描 '+Math.ceil(left/1000)+' 秒':'下次回帖 '+(left/1000).toFixed(1)+' 秒');
      await api.sleep(Math.min(document.hidden?15000:session.emptyRest?1000:250, left), session.signal);
    }
    check(session);
  }
  async function loop(session, resolveStarted) {
    await globalThis.XAssistantTime.ready;
    const workspace = await globalThis.XAssistantWorkspace?.ready;
    session.owner = workspace?.tabId;
    session.account = globalThis.XAssistantDOM.account()?.toLowerCase();
    if (!/^\/[A-Za-z0-9_]{1,15}$/.test(session.account || '')) throw Error('无法核对登录账号');
    check(session);
    const previous = await api.runtime(MODULE, 'get');
    if (['unknown', 'submitting', 'deleting'].includes(previous?.phase)) throw new T.TaskError('REVIEW_REQUIRED', '请先在控制台核对上次发送结果');
    check(session);
    const run = await api.runtime(MODULE, 'begin', {account: session.account});
    session.runId = run.runId;
    session.owner = run.owner;
    check(session);
    const schedules = (await local().get(SCHEDULE_KEY))[SCHEDULE_KEY] || {};
    // One-way read of the old deadline: migration preserves cooling, not old activation.
    const legacy = (await local().get('xAssistantSchedulerV3')).xAssistantSchedulerV3;
    const saved = schedules[session.account]?.nextAt ??
      (legacy?.account?.toLowerCase() === session.account ? legacy.nextReplyAt : null);
    const now=Date.now();
    session.emptyRest=schedules[session.account]?.emptyRest===true&&Number.isFinite(saved)&&saved>now&&saved<=now+EMPTY_REST_MS;
    let nextAt = session.emptyRest?saved:globalThis.XAssistantDOM.indexRevision?now:Number.isFinite(saved) ? Math.max(now, saved)
      : Date.now() + globalThis.XAssistantTime.ms('startup');
    await saveDeadline(session, nextAt);
    announce(true);
    resolveStarted({runId: session.runId, account: session.account});
    for (;;) {
      await countdown(session, nextAt);
      session.emptyRest=false;
      if (section) section.dataset.nextAt = '';
      await patch(session, {phase: 'notification_scan', nextAt: null});
      check(session);
      show('正在检查待回评论');
      // 灯神 2：提及页扫到底，再把 7 天内每条本人原帖完整进一遍。
      const result = await globalThis.XAssistantReplySweep.scan({
        account: session.account, runId: session.runId, signal: session.signal, show
      });
      check(session);
      if (result?.reason === 'page_changed') throw new T.TaskError('PAGE_CHANGED', '页面已切换，回帖已暂停');
      if (result?.reason === 'PAGE_NOT_READY') throw new T.TaskError('PAGE_NOT_READY', 'X 主栏尚未加载，保留队列等待页面恢复');
      if(result?.scheduling==='continue'){
        nextAt=Date.now();await saveDeadline(session,nextAt,result.queuePending!==true,result.reason);continue;
      }
      if(result?.scheduling==='watch'){
        // Only a finished sweep (mentions + every recent original) can establish an empty queue.
        // A partial traversal or a pending retry remains interruptible below.
        if(result.reason==='profile_idle'&&result.complete===true&&result.queuePending===false&&result.stats?.pending===0){
          session.emptyRest=true;nextAt=Date.now()+EMPTY_REST_MS;
          await saveDeadline(session,nextAt,true,result.reason);continue;
        }
        const rev=()=>globalThis.XAssistantDOM.indexRevision(session.account);
        const badge=()=>document.querySelector('a[data-testid="AppTabBar_Notifications_Link"]')?.getAttribute('aria-label')||'';
        const initial=rev(),oldBadge=badge(),end=Math.max(Date.now(),result.nextWakeAt||Date.now()+60000);
        await saveDeadline(session,end,result.queuePending!==true,result.reason);
        show('监测评论 ID 和数量 · 新数据到达立即检查');
        // Pending work can wake early; it is not the ten-minute empty rest.
        await T.waitForPage(()=>{check(session);return rev()!==initial||badge()!==oldBadge;},{signal:session.signal,timeout:Math.max(0,end-Date.now()),interval:500});
        nextAt=Date.now();continue;
      }
      nextAt = Number.isFinite(result?.nextWakeAt) ? Math.max(Date.now()+15000,result.nextWakeAt)
        : Date.now()+globalThis.XAssistantTime.ms('notifications');
      await saveDeadline(session, nextAt,result?.queuePending!==true,result?.reason);
    }
  }
  async function finalize(session, error) {
    // The scan/transaction has finished recording its receipt or unknown result.
    // Do not cancel arbitrary dialogs here: a user may have navigated to a new draft.
    if (session.runId) {
      try {
        const state = await api.runtime(MODULE, 'get');
        if (state.active && state.runId === session.runId && state.owner === session.owner) {
          if (error && error.name !== 'AbortError') {
            try { await patch(session, {error: error.message}); } catch {}
          }
          await api.runtime(MODULE, 'stop', {runId: session.runId});
        }
      } catch (failure) {
        if (!error) error = failure;
      }
    }
    if (current === session) {
      current = null;
      if (section) section.dataset.nextAt = '';
      const message = error && error.name !== 'AbortError' ? error.message : session.stopReason || '回帖模块已停止';
      show(message);
      announce(false, error && error.name !== 'AbortError' ? error : null);
    }
  }
  async function start() {
    if (current) throw Error('回帖已在当前标签页启动');
    if (!navigator.locks) throw Error('浏览器不支持跨标签页执行锁');
    const controller = new AbortController();
    const session = {controller, signal: controller.signal, runId: null};
    current = session;
    let resolveStarted, rejectStarted;
    const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    session.task = navigator.locks.request('x-assistant-notifications-loop', {ifAvailable: true}, async lock => {
      let error;
      try {
        if (!lock) throw Error('回帖正在另一个 X 标签页运行');
        await loop(session, resolveStarted);
      } catch (failure) {
        error = failure;
        rejectStarted(failure);
      } finally {
        await finalize(session, error);
      }
    }).catch(async error => { rejectStarted(error); await finalize(session, error); });
    return started;
  }
  async function stop({reason = '回帖模块已停止'} = {}) {
    const session = current;
    if (!session) return;
    session.stopReason = reason;
    session.controller.abort();
    await session.task;
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY] || !current?.runId) return;
    const state = changes[KEY].newValue;
    if (!state?.active || state.runId !== current.runId || state.owner !== current.owner) current.controller.abort();
  });
  window.addEventListener('pagehide', () => { current?.controller.abort(); });
  window.addEventListener('x-assistant-invalidate', () => { current?.controller.abort(); });
  globalThis.XAssistantNotificationDriver = {start, stop, isRunning: () => !!current};
})();
