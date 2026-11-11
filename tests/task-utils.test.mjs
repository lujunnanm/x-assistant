import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../task-utils.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), sleeps = [];
  const setTimer = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, {callback, at: now + delay});
    return id;
  };
  const clearTimer = id => timers.delete(id);
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    sleeps.push(ms);
    const abort = () => {
      clearTimer(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimer(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
  });
  const context = vm.createContext({
    Date: {now: () => now}, DOMException,
    setTimeout: setTimer, clearTimeout: clearTimer,
    XAssistantRuntime: {sleep}
  });
  vm.runInContext(source, context);
  const advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
    await flush();
  };
  return {tasks: context.XAssistantTasks, context, sleeps, timers, advance, jump: ms => {now += ms;}};
}

function trackedSignal() {
  const controller = new AbortController(), listeners = new Set();
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(type, callback, options) {
      if (type === 'abort') listeners.add(callback);
      controller.signal.addEventListener(type, callback, options);
    },
    removeEventListener(type, callback) {
      if (type === 'abort') listeners.delete(callback);
      controller.signal.removeEventListener(type, callback);
    }
  };
  return {signal, abort: () => controller.abort(), count: () => listeners.size};
}
const isYield = error => error.name === 'YieldError' && error.code === 'YIELD';
const isAbort = error => error.name === 'AbortError';

test('check distinguishes cancellation from an expired work window', () => {
  const f = fixture(), c = new AbortController();
  assert.doesNotThrow(() => f.tasks.check(undefined));
  assert.throws(() => f.tasks.check(undefined, 0), isYield);
  c.abort();
  assert.throws(() => f.tasks.check(c.signal, 0), isAbort);
});

test('sleep clips its timer to the absolute work deadline and cleans listeners', async () => {
  const f = fixture(), tracked = trackedSignal();
  const pending = f.tasks.sleep(1000, tracked.signal, 250);
  const rejected = assert.rejects(pending, isYield);
  assert.deepEqual(f.sleeps, [250]);
  await f.advance(250);
  await rejected;
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('waitFor returns the actual truthy probe result', async () => {
  const f = fixture(), result = {id: 'ready'};
  assert.equal(await f.tasks.waitFor(() => result), result);
  assert.equal(f.timers.size, 0);
});

test('waitFor uses elapsed wall time rather than the number of polling attempts', async () => {
  const f = fixture();
  let attempts = 0;
  const pending = f.tasks.waitFor(() => { attempts++; return false; }, {timeout: 1000, interval: 100});
  assert.equal(attempts, 1);
  // Simulate a background tab timer being delayed far past its requested 100 ms.
  await f.advance(5000);
  assert.equal(await pending, null);
  assert.equal(attempts, 2);
  assert.equal(f.timers.size, 0);
});

test('hidden and unfocused pages have a finite wall timeout, not renewed on each probe', async()=>{
 for(const hidden of [true,false]){
  const f=fixture();let calls=0;
  f.context.document={hidden,hasFocus:()=>{throw Error('a focus check is not a scheduling requirement');}};
  const pending=f.tasks.waitForPage(()=>{calls++;return false;},{timeout:1000});
  await f.advance(5000);assert.equal(await pending,null);assert.equal(calls,2);assert.equal(f.timers.size,0);
 }
});
test('a hidden DOM mutation wakes the probe before its throttled timer', async()=>{
 const f=fixture();let notify,ready=false,disconnected=false;
 f.context.document={documentElement:{},hidden:true,hasFocus:()=>false};
 f.context.MutationObserver=class{constructor(fn){notify=fn;}observe(){}disconnect(){disconnected=true;}};
 const pending=f.tasks.waitForPage(()=>ready&&'rendered',{timeout:1000});
 f.jump(500);ready=true;notify();assert.equal(await pending,'rendered');assert.equal(disconnected,true);assert.equal(f.timers.size,0);
});
test('observer cannot return a stale mutation, extend time, or leak on abort',async()=>{
 for(const abort of [true,false]){
  const f=fixture(),tracked=trackedSignal();let notify,ready=false,disconnected=false;
  f.context.document={documentElement:{},visibilityState:'hidden'};
  f.context.MutationObserver=class{constructor(fn){notify=fn;}observe(){}disconnect(){disconnected=true;}};
  const pending=f.tasks.waitForPage(()=>ready,{timeout:1000,signal:tracked.signal});
  if(abort){const rejection=assert.rejects(pending,isAbort);tracked.abort();await rejection;}
  else{f.jump(700);notify();f.jump(301);ready=true;notify();assert.equal(await pending,null);}
  assert.equal(disconnected,true);assert.equal(f.timers.size,0);assert.equal(tracked.count(),0);
 }
});
test('waitFor does not return a probe result that arrived after its timeout', async () => {
  const f = fixture();
  const result = await f.tasks.waitFor(() => { f.jump(1001); return 'late'; }, {timeout: 1000});
  assert.equal(result, null);
});

test('waitFor checks deadline and cancellation after a synchronous probe', async () => {
  const f = fixture();
  await assert.rejects(f.tasks.waitFor(() => {f.jump(100); return 'late';}, {deadline: 50}), isYield);
  const tracked = trackedSignal();
  await assert.rejects(f.tasks.waitFor(() => {tracked.abort(); return 'stale';}, {signal: tracked.signal}), isAbort);
  assert.equal(tracked.count(), 0);
});

test('waitFor deadline yields, while an ordinary timeout returns null', async () => {
  const f = fixture(), tracked = trackedSignal();
  const pending = f.tasks.waitFor(() => null, {signal: tracked.signal, timeout: 1000, deadline: 50});
  const rejected = assert.rejects(pending, isYield);
  await f.advance(50);
  await rejected;
  assert.equal(tracked.count(), 0);
  const ordinary = f.tasks.waitFor(() => null, {timeout: 25});
  await f.advance(25);
  assert.equal(await ordinary, null);
});

test('bounded success and failure both release abort listeners and timers', async () => {
  const f = fixture(), tracked = trackedSignal();
  assert.equal(await f.tasks.bounded(() => 'ok', {signal: tracked.signal, deadline: 100}), 'ok');
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
  const failure = Error('work failed');
  await assert.rejects(f.tasks.bounded(() => {throw failure;}, {signal: tracked.signal, deadline: 100}), error => error === failure);
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('bounded pending work yields at deadline and cleans its abort listener', async () => {
  const f = fixture(), tracked = trackedSignal();
  const pending = f.tasks.bounded(() => new Promise(() => {}), {signal: tracked.signal, deadline: 100});
  const rejected = assert.rejects(pending, isYield);
  await flush();
  assert.equal(tracked.count(), 1);
  await f.advance(100);
  await rejected;
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('bounded cancellation releases deadline timer and abort listener', async () => {
  const f = fixture(), tracked = trackedSignal();
  const pending = f.tasks.bounded(() => new Promise(() => {}), {signal: tracked.signal, deadline: 100});
  const rejected = assert.rejects(pending, isAbort);
  await flush();
  tracked.abort();
  await rejected;
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('bounded does not start deferred work after immediate cancellation', async () => {
  const f = fixture(), tracked = trackedSignal();
  let calls = 0;
  const pending = f.tasks.bounded(() => {calls++;}, {signal: tracked.signal, deadline: 100});
  const rejected = assert.rejects(pending, isAbort);
  tracked.abort();
  await rejected;
  assert.equal(calls, 0);
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('bounded rejects a success that completes after deadline before the timer callback can run', async () => {
  const f = fixture(), tracked = trackedSignal();
  await assert.rejects(f.tasks.bounded(() => {f.jump(101); return 'late';}, {signal: tracked.signal, deadline: 100}), isYield);
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('bounded late result after cancellation cannot change the settled outcome', async () => {
  const f = fixture(), tracked = trackedSignal();
  let resolve;
  const work = new Promise(done => {resolve = done;});
  const pending = f.tasks.bounded(() => work, {signal: tracked.signal});
  const rejected = assert.rejects(pending, isAbort);
  await flush();
  tracked.abort();
  await rejected;
  resolve('too late');
  await flush();
  assert.equal(tracked.count(), 0);
  assert.equal(f.timers.size, 0);
});

test('managed deadline wake expires a hidden DOM wait even when its content timer never runs',async()=>{
 const f=fixture(),tracked=trackedSignal();let wake,detached=false;
 f.context.AbortController=AbortController;f.context.document={documentElement:{},hidden:true};
 f.context.MutationObserver=class{observe(){}disconnect(){detached=true;}};
 f.context.XAssistantRuntime.sleep=(ms,signal)=>{assert.equal(ms,1300);return new Promise(resolve=>{wake={resolve,signal};});};
 const pending=f.tasks.waitForPage(()=>false,{timeout:1300,signal:tracked.signal});
 f.jump(1300);wake.resolve();assert.equal(await pending,null);assert.equal(wake.signal.aborted,true);
 assert.equal(f.timers.size,0);assert.equal(tracked.count(),0);assert.equal(detached,true);
});
