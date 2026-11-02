// Exercise the real scanner and controller together; no DOM send is performed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const names = ['scheduler-core.js', 'task-utils.js', 'notification-policy.js', 'notifications.js', 'scheduler.js'];
const sources = await Promise.all(names.map(name => readFile(new URL('../' + name, import.meta.url), 'utf8')));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture({autoFollow = false, rows = [], generate, beforeSend} = {}) {
  let now = 200000000, timerId = 0, working = false;
  const timers = new Map(), calls = [], sends = [], locks = new Map();
  const state = {posting: {active: false}, interaction: {active: false}, notifications: {active: false}};
  const storage = {xAssistantAutoFollowV1: autoFollow};
  const location = {pathname: '/home'};
  const timer = (callback, delay) => {const id = ++timerId; timers.set(id, {callback, at: now + delay}); return id;};
  const clearTimer = id => timers.delete(id);
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const cancel = () => {clearTimer(id); signal?.removeEventListener('abort', cancel); reject(new DOMException('stop', 'AbortError'));};
    const id = timer(() => {signal?.removeEventListener('abort', cancel); resolve();}, ms);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, {once: true});
  });
  const requestLock = (name, options, fn) => new Promise((resolve, reject) => {
    const queue = locks.get(name) || []; locks.set(name, queue);
    if (options.ifAvailable && queue.length) {resolve(fn(null)); return;}
    let started = false;
    const cancel = () => {
      if (started) return;
      const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
      options.signal?.removeEventListener('abort', cancel);
      reject(new DOMException('lock cancelled', 'AbortError'));
    };
    const job = () => {
      started = true; options.signal?.removeEventListener('abort', cancel);
      Promise.resolve().then(() => fn({name})).then(resolve, reject).finally(() => {queue.shift(); queue[0]?.();});
    };
    if (options.signal?.aborted) {cancel(); return;}
    options.signal?.addEventListener('abort', cancel, {once: true});
    queue.push(job); if (queue.length === 1) job();
  });
  const node = () => ({dataset: {}, textContent: '', setAttribute() {}, after() {}, replaceWith() {}});
  const button = node(), summary = node(), sections = {};
  for (const name of ['posting', 'interaction', 'notifications']) sections[name] = {querySelector: () => node()};
  const root = {querySelector: selector => sections[/data-module="(.*?)"/.exec(selector)?.[1]] || node(), insertBefore() {}};
  const links = ['/home', '/notifications', '/notifications/mentions'].map(path => ({getAttribute: () => path, click() {location.pathname = path;}}));
  const document = {getElementById: () => root, createElement: () => ({...node(), querySelector: selector => selector === 'button' ? button : summary}), querySelectorAll: () => links, querySelector: () => null};
  const runtime = async (module, action, extra = {}) => {
    const value = state[module];
    if (action === 'get' || action === 'prepare') return {...value};
    if (action === 'begin') Object.assign(value, {active: true, phase: 'waiting', runId: module, error: null});
    if (action === 'patch') Object.assign(value, extra.patch);
    if (action === 'stop') {value.active = false; calls.push('stop:' + module);}
    return {...value};
  };
  const context = vm.createContext({
    document, location, innerHeight: 900, URL, DOMException, AbortController,
    Date: {now: () => now}, setTimeout: timer, clearTimeout: clearTimer,
    window: {addEventListener() {}, scrollTo() {}, scrollBy() {}},
    navigator: {locks: {request: requestLock}},
    chrome: {storage: {local: {get: async key => ({[key]: storage[key]}), set: async values => Object.assign(storage, values)}}},
    XAssistantCore: {randomSeconds: () => 3},
    XAssistantRuntime: {runtime, sleep, review: async () => true,
      check: signal => {if (signal.aborted) throw new DOMException('stop', 'AbortError');},
      call: async message => message.kind === 'AI_CHECK' ? {} : generate ? generate(message) : {action: 'send_reply', postId: message.post.id, text: 'reply'}},
    XAssistantDOM: {account: () => '/me', dialogs: () => [], rows: () => rows},
    XAssistantEntry: {account: () => '/me', captureInteractionTarget: () => '/search?q=test', setInteractionTarget() {}, enter: async module => {calls.push('enter:' + module); location.pathname = module === 'notifications' ? '/home' : '/search';}},
    XAssistantInteraction: {pause: async () => {calls.push('gate:pause'); assert.equal(working, false); return {wasRunning: false};}, resume: async () => calls.push('gate:resume')},
    XAssistantInteractionDriver: {isRunning: () => working,
      start: async () => {working = true; state.interaction.active = true; calls.push('interaction:start');},
      pause: async () => {working = false; calls.push('interaction:pause');},
      stop: async () => {working = false; state.interaction.active = false;}},
    XAssistantPostingDriver: {start: async () => Object.assign(state.posting, {active: true, phase: 'waiting', nextAt: now + 3000000}), stop: async () => {state.posting.active = false;}},
    XAssistantReplyEngine: {send: async options => {await beforeSend?.(options); await options.onBeforeSubmit(); sends.push(options.row.id); await options.onConfirmed({kind: 'confirmed'});}}
  });
  for (const source of sources) vm.runInContext(source, context);
  await flush();
  await context.XAssistantScheduler.start(); await flush();
  return {context, storage, state, calls, sends, summary,
    working: () => working, now: () => now,
    advance: async ms => {
      now += ms;
      for (const [id, item] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (item.at <= now && timers.delete(id)) item.callback();
      await flush();
    },
    stop: async () => {await context.XAssistantScheduler.stop(); await flush();}
  };
}

test('real empty notification scan ends once and returns control to interaction', async () => {
  const f = await fixture();
  try {
    assert.equal(f.working(), true);
    await f.advance(600000);
    assert.equal(f.working(), false);
    await f.advance(500); await f.advance(1200); await f.advance(1200); await f.advance(500);
    assert.equal(f.working(), true);
    const record = f.storage.xAssistantNotificationRepliesV1['/me'];
    assert.equal(record.lastScan.reason, 'exhausted');
    assert.equal(record.cycles, 1);
    assert.equal(f.state.notifications.phase, 'waiting');
    assert.equal(f.state.posting.active, true);
    assert.ok(f.storage.xAssistantSchedulerV3.nextReplyAt > f.now());
    assert.ok(f.calls.includes('enter:interaction'));
  } finally {await f.stop();}
});

test('real cooldown notification scan sends once without recursively pausing interaction', async () => {
  const f = await fixture({autoFollow: true, rows: [{id: '1', at: 199999999, author: 'friend', addressed: true, text: 'hello'}]});
  try {
    const task = f.context.XAssistantScheduler.replyDuringCooldown({signal: new AbortController().signal, end: f.now() + 50000});
    await flush(); await f.advance(500); await f.advance(3000);
    await f.advance(1200); await f.advance(1200); await f.advance(1200);
    await task;
    assert.deepEqual(f.sends, ['1']);
    assert.equal(f.storage.xAssistantNotificationRepliesV1['/me'].records['1'].status, 'confirmed');
    assert.equal(f.state.notifications.phase, 'waiting');
    assert.equal(f.working(), true);
    assert.equal(f.calls.includes('gate:pause'), false);
    assert.equal(f.calls.at(-1), 'enter:interaction');
  } finally {await f.stop();}
});

test('scanner AI deadline yields without stopping collaboration and ignores late AI success', async () => {
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  const f = await fixture({autoFollow: true, rows: [{id: '2', at: 199999999, author: 'friend', addressed: true, text: 'hello'}], generate: () => pending});
  try {
    const task = f.context.XAssistantScheduler.replyDuringCooldown({signal: new AbortController().signal, end: f.now() + 50000});
    await flush(); await f.advance(500); await f.advance(39500); await task;
    assert.equal(f.storage.xAssistantNotificationRepliesV1['/me'].lastScan.reason, 'yield');
    assert.equal(f.context.XAssistantScheduler.active(), true);
    assert.equal(f.working(), true);
    assert.equal(f.state.notifications.phase, 'waiting');
    release({action: 'send_reply', postId: '2', text: 'too late'}); await flush();
    assert.deepEqual(f.sends, []);
  } finally {release({action: 'skip', postId: '2'}); await f.stop();}
});


test('target update skips only that reply and resumes interaction after the next confirmed reply', async () => {
  const f = await fixture({autoFollow: true,
    rows: [
      {id: 'updated', at: 199999999, author: 'friend', addressed: true, text: 'old node'},
      {id: 'next', at: 199999998, author: 'other', addressed: true, text: 'next reply'}
    ],
    beforeSend: options => {
      if (options.row.id === 'updated') throw Object.assign(Error('target updated'), {code: 'TARGET_UPDATED', submitted: false});
    }
  });
  try {
    const task = f.context.XAssistantScheduler.replyDuringCooldown({signal: new AbortController().signal, end: f.now() + 50000});
    await flush(); await f.advance(500); await f.advance(3000); await f.advance(3000);
    await f.advance(1200); await f.advance(1200); await f.advance(1200); await task;
    assert.deepEqual(f.sends, ['next']);
    const records = f.storage.xAssistantNotificationRepliesV1['/me'].records;
    assert.equal(records.updated.status, 'failed');
    assert.equal(records.updated.reasonCode, 'TARGET_UPDATED');
    assert.equal(records.next.status, 'confirmed');
    assert.equal(f.context.XAssistantScheduler.active(), true);
    assert.equal(f.working(), true);
    assert.equal(f.calls.at(-1), 'enter:interaction');
  } finally {await f.stop();}
});

test('posting takes the page lock after reply deadline, then interaction resumes', async () => {
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  const f = await fixture({autoFollow: true,
    rows: [{id: 'guard', at: 199999999, author: 'friend', addressed: true, text: 'hello'}], generate: () => pending});
  try {
    // Posting guard wins at +20 sec, earlier than the +40 sec reply budget.
    f.state.posting.nextAt = f.now() + 50000;
    const reply = f.context.XAssistantScheduler.replyDuringCooldown({signal: new AbortController().signal, end: f.now() + 50000});
    await flush(); await f.advance(500);
    let postStarted = false;
    const post = f.context.navigator.locks.request('x-assistant-page-actions', {}, async () => {
      await f.context.XAssistantScheduler.beforePost();
      postStarted = true;
      assert.equal(f.working(), false);
      f.state.posting.nextAt = f.now() + 3000000;
      f.state.posting.phase = 'waiting';
      await f.context.XAssistantScheduler.afterPost();
    });
    await flush(); assert.equal(postStarted, false);
    await f.advance(19500); await Promise.all([reply, post]);
    assert.equal(postStarted, true);
    assert.equal(f.storage.xAssistantNotificationRepliesV1['/me'].lastScan.reason, 'yield');
    await f.advance(500);
    assert.equal(f.working(), true);
    assert.equal(f.context.XAssistantScheduler.active(), true);
    assert.deepEqual(f.sends, []);
  } finally {release({action: 'skip', postId: 'guard'}); await f.stop();}
});

test('manual stop during an AI wait aborts the scanner and late generation never sends', async () => {
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  const f = await fixture({autoFollow: true,
    rows: [{id: 'stop', at: 199999999, author: 'friend', addressed: true, text: 'hello'}], generate: () => pending});
  const task = f.context.XAssistantScheduler.replyDuringCooldown({signal: new AbortController().signal, end: f.now() + 50000});
  await flush(); await f.advance(500);
  await f.stop(); await task;
  assert.equal(f.context.XAssistantScheduler.active(), false);
  assert.equal(f.working(), false);
  assert.equal(f.state.posting.active, false);
  assert.equal(f.storage.xAssistantSchedulerV3.active, false);
  assert.equal(f.storage.xAssistantSchedulerV3.stopReason, 'manual');
  assert.equal(f.storage.xAssistantNotificationRepliesV1['/me'].lastScan.reason, 'stopped');
  release({action: 'send_reply', postId: 'stop', text: 'too late'}); await flush();
  assert.deepEqual(f.sends, []);
});
