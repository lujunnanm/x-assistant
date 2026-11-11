// Independent replies lifecycle. Never starts a task merely because storage says active.
(() => {
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
  const api = globalThis.XAssistantRuntime;
  const T = globalThis.XAssistantTasks;
  const KEY = 'xAssistantNotificationsRuntimeV1';
  const SCHEDULE_KEY = 'xAssistantNotificationScheduleV1';
  const MODULE = 'notifications';
  const root = document.getElementById('x-assistant-float');
  const section = root?.querySelector('[data-module="notifications"]');
  const output = root?.querySelector('[data-status="notifications"]');
  let current = null;

  const show = message => { if (output && output.textContent !== message) output.textContent = message; };
  const announce = (running, error = null) => window.dispatchEvent(new CustomEvent('x-assistant-module-state', {
    detail: {module: MODULE, running, error:error?.message||null,...(error?.code?{code:error.code}:{}),...(error?.submitted?{submitted:true}:{}),...(error?.confirmed?{confirmed:true}:{})}
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
    await local().set({[SCHEDULE_KEY]: {...data, [session.account]: {nextAt}}});
    await patch(session, {phase: 'waiting', nextAt,...(roundComplete?{roundComplete:true,roundReason:String(roundReason||'scan_finished').slice(0,120)}:{})});
    if (section) section.dataset.nextAt = String(nextAt);
  }
  async function countdown(session, nextAt) {
    while (Date.now() < nextAt) {
      check(session);
      show('下次回帖 ' + ((nextAt - Date.now()) / 1000).toFixed(1) + ' 秒');
      await api.sleep(Math.min(document.hidden?15000:250, nextAt - Date.now()), session.signal);
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
    let nextAt = Number.isFinite(saved) ? Math.max(Date.now(), saved)
      : Date.now() + globalThis.XAssistantTime.ms('startup');
    await saveDeadline(session, nextAt);
    announce(true);
    resolveStarted({runId: session.runId, account: session.account});
    for (;;) {
      await countdown(session, nextAt);
      if (section) section.dataset.nextAt = '';
      await patch(session, {phase: 'notification_scan', nextAt: null});
      check(session);
      show('正在检查我的帖子评论与提及');
      const result = await globalThis.XAssistantProfileReplies.scan({
        account: session.account, runId: session.runId, signal: session.signal,
        yieldAt: Infinity, until: Date.now(), returnToHome: false, show
      });
      check(session);
      if (result?.reason === 'page_changed') throw new T.TaskError('PAGE_CHANGED', '页面已切换，回帖已暂停');
      nextAt = Date.now() + globalThis.XAssistantTime.ms('notifications');
      await saveDeadline(session, nextAt,true,result?.reason);
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
