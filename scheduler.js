(() => {
  const root = document.getElementById('x-assistant-float');
  const api = globalThis.XAssistantRuntime;
  const C = globalThis.XAssistantSchedulerCore;
  const I = globalThis.XAssistantInteractionDriver;
  const P = globalThis.XAssistantPostingDriver;
  const KEY = 'xAssistantSchedulerV3';
  const FOLLOW_KEY = 'xAssistantAutoFollowV1';
  const modules = ['posting', 'interaction', 'notifications'];
  const REFRESH_RESUME_MS = 15000;

  const master = document.createElement('div');
  master.className = 'master-control';
  master.innerHTML = '<button data-a="master" role="switch" aria-checked="false">启动协同</button><span data-master-status role="status" hidden>已停止</span>';
  root.querySelector('header').after(master);
  const button = master.querySelector('button');
  const summary = master.querySelector('span');
  const lamps = {};
  for (const name of modules) {
    const section = root.querySelector(`[data-module="${name}"]`);
    const lamp = section.querySelector('.state-lamp');
    lamps[name] = lamp;
  }
  root.insertBefore(root.querySelector('[data-module="posting"]'), root.querySelector('[data-module="interaction"]'));

  let current = null;
  let lastMessage = '已停止';
  // A dead extension context cannot recover without a new page/content script.
  // Keep this latch outside the session so finalization cannot re-enable Start.
  let unavailableReason = null;
  const minuteText = ms => `${Math.ceil(Math.max(0, ms) / 60000)} 分钟`;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const show = (name, text, kind) => {
    lamps[name].title = text;
    setText(lamps[name], kind === 'off' ? '已停止' : kind === 'on' ? '运行中' : '等待中');
    if (lamps[name].dataset.state !== kind) lamps[name].dataset.state = kind;
  };

  function render(s = current) {
    const active = !!s && !s.signal.aborted;
    const repliesSection=root.querySelector('[data-module="notifications"]');
    if(repliesSection?.dataset){
      const deadline=s?.reply&&Number.isFinite(s.reply.deadline)?s.reply.deadline:s?.state?.nextReplyAt;
      const next=active&&Number.isFinite(deadline)?String(deadline):'';
      if(repliesSection.dataset.nextAt!==next)repliesSection.dataset.nextAt=next;
    }
    if (unavailableReason) button.disabled = true;
    setText(button, active ? '停止协同' : '启动协同');
    button.setAttribute('aria-label',active?'停止协同':'启动协同');
    button.setAttribute('aria-checked', String(active));
    if (!active) {
      for (const name of modules) show(name, '已停止', 'off');
      setText(summary, unavailableReason || s?.state?.error || lastMessage);
      return;
    }
    if (!s.state) { setText(summary, '正在检查账号与 API'); return; }
    const replying = !!s.reply?.started;
    show('posting', s.postingBusy ? '正在发帖' : '冷却中', s.postingBusy ? 'on' : 'wait');
    show('interaction', replying ? '等待回帖完成' : I.isRunning() ? '运行中' : '等待交接',
      !replying && I.isRunning() ? 'on' : 'wait');
    const replyText = replying ? '回帖中' : Date.now() >= s.state.nextReplyAt ? '等待发帖或当前互动完成'
      : '下次回帖 ' + minuteText(s.state.nextReplyAt - Date.now());
    show('notifications', replyText, replying ? 'on' : 'wait');
    setText(summary, s.postingBusy ? '发帖优先 · 其他任务等待'
      : replying ? '正在处理通知回复'

      : `互动持续运行 · 下次回帖 ${minuteText(s.state.nextReplyAt - Date.now())}`);
  }

  function check(s) { api.check(s.signal); }
  // Only a refresh explicitly armed by this running content script may resume.
  // Ordinary page/browser/extension reloads remain safe stop boundaries.
  async function normalizeBootState(saved) {
    const refreshResume = !!saved?.active && Number.isFinite(saved?.refreshResumeUntil) &&
      saved.refreshResumeUntil >= Date.now() && saved.stopReason == null && !saved.error;
    if (refreshResume) {
      const resumed = {...saved, refreshResumeUntil: null};
      await chrome.storage.local.set({[KEY]: resumed});
      return {state: resumed, resume: true};
    }
    if (!saved?.active && saved?.stopReason !== 'error' && !Number.isFinite(saved?.restartAt)) return saved;
    await Promise.allSettled(modules.map(name => api.runtime(name, 'stop')));
    const stopped = {...saved, active: false, error: null, stopReason: 'manual', restartAt: null, refreshResumeUntil: null, stoppedAt: Date.now()};
    await chrome.storage.local.set({[KEY]: stopped});
    return {state: stopped, resume: false};
  }
  function serial(s, fn) {
    const task = s.queue.then(() => { check(s); return fn(); });
    s.queue = task.catch(() => {});
    return task;
  }

  async function save(s, force = false) {
    if (!s.owns || !s.state) return;
    const now = Date.now();
    const important = JSON.stringify([s.state.active, s.state.mode, s.state.autoFollow,
      s.state.nextReplyAt, s.state.interactionTarget, s.state.error, s.state.stopReason]);
    if (!force && important === s.savedSignature && now - s.savedAt < 5000) return;
    s.savedSignature = important;
    s.savedAt = now;
    const snapshot = {...s.state};
    s.saveQueue = s.saveQueue.catch(() => {}).then(() => chrome.storage.local.set({[KEY]: snapshot}));
    await s.saveQueue;
  }

  function fail(s, error) {
    if (s.signal.aborted) return;
    s.preserveDrafts = s.preserveDrafts || !!error.preserveDrafts || !!error.submitted;
    if (s.state) s.state.error = error.message || '协同执行失败';
    lastMessage = error.message || '协同执行失败';
    s.reason = 'error';
    s.controller.abort();
    s.reply?.controller.abort();
  }

  function stopDrivers(s) {
    if (!s.owns) return Promise.resolve();
    if (!s.shutdown) {
      // Issue all aborts immediately. Waiting for the main loop first can deadlock
      // when that loop is waiting for an interaction handoff.
      s.reply?.controller.abort();
      s.shutdown = Promise.allSettled([
        I.stop({preserveDrafts: !!s.preserveDrafts}), P.stop(), api.runtime('notifications', 'stop')
      ]).then(async () => { if (s.reply) await s.reply.task.catch(() => {}); });
    }
    return s.shutdown;
  }

  async function pauseInteraction(s) {
    if (!I.isRunning()) return;
    if (!s.pausing) s.pausing = Promise.resolve(I.pause()).finally(() => { s.pausing = null; });
    await s.pausing;
    check(s);
  }

  async function runReplies(s, slot) {
    try {
      await navigator.locks.request('x-assistant-page-actions', {signal: slot.signal}, async () => {
        check(s); api.check(slot.signal);
        const post = await api.runtime('posting', 'get');
        if (!post.active || post.error) throw Error(post.error || '发帖模块已停止');

        slot.deadline = Math.min(slot.deadline, C.replyDeadline(s.state, post));
        if (s.postingBusy || Date.now() >= slot.deadline) return;
        slot.started = true; slot.batchUntil = Date.now();
        render(s);
        const old = await api.runtime('notifications', 'get');
        const run = await api.runtime('notifications', 'begin', {account: s.state.account, resume: !!old.active});
        for (;;) {
          check(s); api.check(slot.signal);
          await globalThis.XAssistantEntry.enter('notifications', slot.signal);
          const result = await globalThis.XAssistantProfileReplies.scan({
            account: s.state.account, runId: run.runId, signal: slot.signal,
            // Once a reply batch starts it owns the page until a confirmation
            // sweep finds no eligible unreplied comments from this snapshot.
            yieldAt: Infinity, until: slot.batchUntil,
            show: text => setText(root.querySelector('[data-status="notifications"]'), text)
          });
          check(s); api.check(slot.signal);
          await api.runtime('notifications', 'patch', {runId: run.runId, patch: {phase: 'waiting', nextAt: null}});
          if (result?.reason==='profile_complete' || result?.rest || result?.reason === 'liked_boundary' || (result?.complete && !(result.stats?.eligible > 0))) break;
          lastMessage = '回帖复查中，确认所有未回复评论'; render(s);
          await api.sleep(1000, slot.signal);
        }
        s.state = C.finishReplies(s.state, Date.now());
        await save(s, true);
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        // A reply composer owned by this task can finish rendering after the
        // first bounded cleanup attempt. Keep the session alive, block every
        // other page action, and retry only the safe dismiss routine.
        if (error.code === 'CLEANUP_FAILED' && !error.preserveDrafts && !error.submitted) {
          s.cleanupBlocked = true;
          lastMessage = '回复窗口清理中，其他任务已暂停';
          render(s);
        } else {
          fail(s, error); throw error;
        }
      }
    } finally {
      slot.unlink();
      if (s.reply === slot) s.reply = null;
      render(s);
    }
  }

  function claimReplySlot(s, {deadline, signal = s.signal}) {
    if (s.reply || s.postingBusy || s.signal.aborted || signal.aborted || !Number.isFinite(deadline) || Date.now() >= deadline) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    s.signal.addEventListener('abort', abort, {once: true});
    signal.addEventListener('abort', abort, {once: true});
    const slot = {controller, signal: controller.signal, deadline, started: false,
      unlink: () => { s.signal.removeEventListener('abort', abort); signal.removeEventListener('abort', abort); }};
    // Reserve synchronously, before any storage/network await. Two callers can
    // otherwise both pass the replyTask check and start overlapping scans.
    s.reply = slot;
    slot.task = Promise.resolve().then(() => runReplies(s, slot));
    slot.task.catch(() => {}); // Errors are stored by runReplies and stop the session.
    return slot;
  }

  async function tick(s) {
    check(s);
    if (globalThis.XAssistantEntry.account() !== s.state.account) throw Error('账号变化，已停止协同');
    if (s.cleanupBlocked) {
      lastMessage = '正在安全恢复回复窗口'; render(s);
      const clean = await globalThis.XAssistantPopup.cancel();
      check(s);
      if (!clean) { await save(s); return; }
      if (!globalThis.XAssistantCore.interactionPage(location.href)) await globalThis.XAssistantEntry.enter('interaction', s.signal);
      const notifications = await api.runtime('notifications', 'get');
      if (notifications?.active && notifications.runId) await api.runtime('notifications', 'patch', {runId: notifications.runId, patch: {phase: 'waiting', nextAt: null}});
      s.cleanupBlocked = false; lastMessage = '回复窗口已恢复';
    }
    const [post, interaction, setting] = await Promise.all([
      api.runtime('posting', 'get'), api.runtime('interaction', 'get'), chrome.storage.local.get(FOLLOW_KEY)
    ]);
    check(s);
    if (!post.active || post.error) throw Error(post.error || '发帖模块已停止');
    if (interaction.error && s.state.workStarted) throw Error(interaction.error);
    s.state = C.tick(C.setFollowMode(s.state, setting[FOLLOW_KEY] !== false, Date.now()), Date.now());
    const action = C.choose(s.state, Date.now(), {busy: s.postingBusy || post.phase !== 'waiting', nextAt: post.nextAt});
    if (!s.reply && action !== 'interaction') await pauseInteraction(s);
    if (!s.reply && action === 'interaction' && !I.isRunning()) {
      await globalThis.XAssistantEntry.enter('interaction', s.signal);
      check(s);
      if (!s.postingBusy) {
        const run = await api.runtime('interaction', 'get');
        check(s); await I.start(!!run.active); s.state.workStarted = true;
      }
    }
    if (!s.reply && action === 'notifications') claimReplySlot(s, {deadline: Math.min(Date.now()+C.REPLY_WINDOW,C.replyDeadline(s.state, post))});
    await save(s);
    render(s);
  }

  async function initialize(s, resume) {
    await globalThis.XAssistantTime?.ready;
    let account;
    for (let i = 0; i < 150; i++) {
      check(s); account = globalThis.XAssistantEntry.account();
      if (/^\/[A-Za-z0-9_]{1,15}$/.test(account || '')) break;
      await api.sleep(100, s.signal);
    }
    if (!/^\/[A-Za-z0-9_]{1,15}$/.test(account || '')) throw Error('账号加载超时，请刷新后重试');
    setText(summary, '正在检查 DeepSeek 连接');
    await api.call({kind: 'AI_CHECK'}); check(s);
    if (!resume) for (const name of modules) {
      if (!await api.review(name, account)) throw Error('未完成旧发送记录核对');
      check(s);
    }
    for (const name of modules) { await api.runtime(name, 'prepare', {account}); check(s); }
    const previous = (await chrome.storage.local.get(KEY))[KEY];
    const post = await api.runtime('posting', 'get');
    if (resume && (!previous?.active || previous.account !== account || !post.active)) throw Error('旧协同已停止，请重新启动');
    s.owns = true;
    s.state = {...C.fresh(Date.now()), ...(resume ? previous : {}), account, active: true, error: null, stopReason: null};
    if (!resume && previous?.account === account && Number.isFinite(previous.nextReplyAt)) s.state.nextReplyAt = previous.nextReplyAt;
    s.state.interactionTarget = resume ? previous.interactionTarget || '/home' : globalThis.XAssistantEntry.captureInteractionTarget();
    globalThis.XAssistantEntry.setInteractionTarget(s.state.interactionTarget);
    await globalThis.XAssistantEntry.enter('posting', s.signal); check(s); await save(s, true);
    await P.start(resume);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      check(s);
      if ((await api.runtime('posting', 'get')).active) { ready = true; break; }
      await api.sleep(50, s.signal);
    }
    if (!ready) throw Error('发帖模块启动超时');
    button.disabled = !!unavailableReason;
  }

  async function start(resume = false) {
    if (current || unavailableReason) return;
    const controller = new AbortController();
    const s = {controller, signal: controller.signal, state: null, owns: false, refreshing: false, cleanupBlocked: false,
      postingBusy: false, reply: null, pausing: null, queue: Promise.resolve(), saveQueue: Promise.resolve(),
      savedAt: -Infinity, savedSignature: '', reason: null, shutdown: null};
    current = s; button.disabled = true; lastMessage = '正在启动'; render(s);
    s.task = navigator.locks.request('x-assistant-master-v3', {ifAvailable: true}, async lock => {
      if (!lock) throw Error('协同正在另一个 X 标签页运行');
      await initialize(s, resume);
      while (!s.signal.aborted) {
        await serial(s, () => tick(s));
        await api.sleep(500, s.signal);
      }
    }).catch(error => { if (error.name !== 'AbortError') fail(s, error); }).finally(async () => {
      s.controller.abort(); s.reply?.controller.abort();
      if (s.owns && !s.refreshing) {
        await stopDrivers(s);
        const stoppedAt=Date.now(),stopReason=s.reason||'completed';
        s.state = {...s.state, active: false, stopReason, stoppedAt,
          restartAt: null};
        try { await save(s, true); } catch { lastMessage = '已停止，但状态保存失败，请刷新核对'; }
      }
      if (current === s) {
        current = null; button.disabled = !!unavailableReason;
        if (s.state?.error) lastMessage = s.state.error;
        else if (!s.refreshing) lastMessage = '已停止';
        render();
      }
    });
  }

  async function stop(reason = 'manual') {
    const s = current;
    if (!s) {
      if (reason === 'manual') {
        const saved = (await chrome.storage.local.get(KEY))[KEY];
        if (saved) await chrome.storage.local.set({[KEY]: {...saved, active: false, stopReason: 'manual', restartAt: null, stoppedAt: Date.now()}});
      }
      return;
    }
    s.reason = unavailableReason || reason; lastMessage = '正在停止';
    s.controller.abort(); s.reply?.controller.abort(); render(s);
    await stopDrivers(s);
    await s.task;
  }

  globalThis.XAssistantScheduler = {
    start, stop, active: () => !!current && !current.signal.aborted,
    beforePost: async () => {
      const s = current; if (!s) return;
      s.postingBusy = true;
      // Posting already holds the page lock. Release any queued cooldown scan
      // before waiting for interaction, or both drivers would wait for each other.
      if (s.reply && !s.reply.started) s.reply.controller.abort();
      await serial(s, async () => { await pauseInteraction(s); await save(s, true); });
    },
    afterPost: async () => { if (current) { current.postingBusy = false; render(current); } },
    beforeRefresh: async () => {
      const s = current; if (!s) return;
      // This short-lived marker distinguishes our own refresh from a user,
      // browser or extension reload. It is consumed by the next content script.
      check(s); s.state.refreshResumeUntil=Date.now()+REFRESH_RESUME_MS; await save(s, true);
    }
  };
  button.onclick = () => (current ? stop() : start()).catch(error => { lastMessage = error.message; render(); });
  window.addEventListener('pagehide', () => {
    if (!current) return;
    current.refreshing = true; current.reason = 'pagehide';
    current.controller.abort(); current.reply?.controller.abort();
  }, {once: true});
  window.addEventListener('x-assistant-invalidate', event => {
    const detail = event.detail?.reason;
    unavailableReason = typeof detail === 'string' && detail.trim()
      ? detail.trim() : '扩展连接已失效，请刷新当前 X 页面';
    lastMessage = unavailableReason;
    if (current?.state) {
      current.state.error = unavailableReason;
      current.state.stopReason = unavailableReason;
    }
    button.disabled = true;
    // stop() aborts locally first; a failed background/storage connection must
    // not erase the original diagnosis or produce an unhandled rejection.
    void stop(unavailableReason).catch(() => {}).finally(() => render());
    render();
  }, {once: true});
  chrome.storage.local.get(KEY).then(async data => {
    const normalized = await normalizeBootState(data[KEY]);
    const saved = normalized?.state ?? normalized;
    lastMessage = saved?.error || '已停止'; render();
    if (normalized?.resume) await start(true);
  }).catch(error => { lastMessage = error.message; render(); });
})();
