import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const core=await readFile(new URL('../scheduler-core.js',import.meta.url),'utf8'),source=await readFile(new URL('../scheduler.js',import.meta.url),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,25));
async function fixture({workMs=0,scanComplete=false,scanRest=false,postError=false,entryError=false,pageLockBlocked=false,scanHandler=null}={}){
 const events=new Map();const window={addEventListener(name,handler,options){events.set(name,{handler,once:options?.once});}};
 const emit=(name,detail)=>{const event=events.get(name);if(!event)return;if(event.once)events.delete(name);event.handler({detail});};
 let now=0,working=false,scans=0,postRunning=false;let storageWrites=0,pageLockRequests=0;const storage={xAssistantAutoFollowV1:false},calls=[],runtimes={posting:{active:false},interaction:{active:false},notifications:{active:false}};
 const node=()=>({dataset:{},textContent:'',setAttribute(){},after(){},replaceWith(){}});
 const button=node(),summary=node(),header=node(),sections={};for(const n of ['posting','interaction','notifications'])sections[n]={querySelector:()=>node()};
 const root={querySelector:s=>s==='header'?header:sections[/data-module="(.*?)"/.exec(s)?.[1]]||node(),insertBefore(){}};
 const document={getElementById:()=>root,createElement:()=>({...node(),querySelector:s=>s==='button'?button:summary})};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},2);function abort(){clearTimeout(timer);reject(new DOMException('stop','AbortError'));}if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
 const runtime=async(n,action,extra={})=>{const s=runtimes[n];if(action==='get'||action==='prepare')return {...s};if(action==='begin'){Object.assign(s,{active:true,runId:n,phase:'waiting',error:null});return {...s};}if(action==='patch'){Object.assign(s,extra.patch);return {...s};}if(action==='stop'){s.active=false;calls.push('stop:'+n);return {...s};}};
 const ctx=vm.createContext({document,Date:{now:()=>now},AbortController,DOMException,Promise,setTimeout,clearTimeout,window,navigator:{locks:{request:async(name,options,fn)=>{if(name==='x-assistant-page-actions'){pageLockRequests++;if(pageLockBlocked)return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('lock cancelled','AbortError'));if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});}return fn({name});}}},chrome:{storage:{local:{get:async k=>({[k]:storage[k]}),set:async o=>{storageWrites++;Object.assign(storage,o);}}}},XAssistantRuntime:{call:async()=>({ready:true}),runtime,review:async()=>true,sleep,check:s=>{if(s.aborted)throw new DOMException('stop','AbortError');}},XAssistantEntry:{captureInteractionTarget:()=>'/home',setInteractionTarget:()=>{},account:()=>'/me',enter:async()=>{if(entryError)throw Error('navigation failed');}},XAssistantInteractionDriver:{isRunning:()=>working,start:async()=>{working=true;runtimes.interaction.active=true;calls.push('interaction:start');},pause:async()=>{working=false;calls.push('interaction:pause');},stop:async()=>{working=false;runtimes.interaction.active=false;}},XAssistantPostingDriver:{start:async()=>{postRunning=true;Object.assign(runtimes.posting,{active:true,phase:'waiting',nextAt:9999999,error:postError?'generation failed':null});},stop:async()=>{postRunning=false;runtimes.posting.active=false;}},XAssistantNotifications:{scan:async options=>{scans++;calls.push('scan');if(options.cooldownSlot){assert.equal(options.yieldAt,now+40000);}else{assert.equal(working,false);assert.equal(options.yieldAt,runtimes.posting.nextAt-30000);}return scanHandler?await scanHandler(options):{complete:scanComplete,rest:scanRest};}}});
 vm.runInContext(core,ctx);const orig=ctx.XAssistantSchedulerCore.fresh;ctx.XAssistantSchedulerCore.fresh=t=>({...orig(t),workMs});vm.runInContext(source,ctx);await wait();
 return {ctx,storage,calls,runtimes,button,summary,emit,advance:async t=>{now=t;await wait();},start:async()=>{await ctx.XAssistantScheduler.start();await wait();},stop:()=>ctx.XAssistantScheduler.stop(),working:()=>working,scans:()=>scans,postRunning:()=>postRunning,writes:()=>storageWrites,pageLockRequests:()=>pageLockRequests};
}
test('continuous interaction yields to ten-minute reply checks then resumes',async()=>{
 const f=await fixture({scanComplete:true});try{
  await f.start();assert.equal(f.working(),true);
  await f.advance(599999);assert.equal(f.scans(),0);
  await f.advance(600000);assert.equal(f.scans(),1);
  await f.advance(600500);assert.equal(f.working(),true);assert.equal(f.postRunning(),true);
  await f.advance(1200000);assert.equal(f.scans(),2);
 }finally{await f.stop();}
});
test('actual controller: posting error shuts down all modules instead of silently restarting',async()=>{
 const f=await fixture({postError:true});await f.start();await wait();assert.equal(f.postRunning(),false);assert.equal(f.working(),false);assert.equal(f.storage.xAssistantSchedulerV3.active,false);assert.match(f.summary.textContent,/generation failed/);
});
test('actual controller: failed navigation never starts a module',async()=>{
 const f=await fixture({entryError:true});await f.start();await wait();assert.equal(f.postRunning(),false);assert.equal(f.working(),false);assert.match(f.summary.textContent,/navigation failed/);
});

test('notification scan-limit rest keeps posting alive without repeated scanning',async()=>{
 const f=await fixture({workMs:3599000,scanRest:true});
 try{await f.start();await f.advance(600000);assert.equal(f.scans(),1);assert.equal(f.postRunning(),true);assert.equal(f.storage.xAssistantSchedulerV3.active,true);await f.advance(900000);assert.equal(f.scans(),1);assert.equal(f.postRunning(),true);}finally{await f.stop();}
});

test('follow cooldown slot processes replies within 40 seconds without pausing itself',async()=>{
 const f=await fixture({scanComplete:true});try{
  await f.start();await f.ctx.XAssistantScheduler.replyDuringCooldown({signal:new AbortController().signal,end:50000});
  assert.equal(f.scans(),1);assert.equal(f.working(),true);assert.equal(f.postRunning(),true);assert.equal(f.storage.xAssistantSchedulerV3.nextReplyAt,600000);
  await f.ctx.XAssistantScheduler.beforePost();
  await f.ctx.XAssistantScheduler.replyDuringCooldown({signal:new AbortController().signal,end:50000});
  assert.equal(f.scans(),1);
 }finally{await f.stop();}
});

test('concurrent cooldown hooks reserve exactly one reply slot',async()=>{
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 const f=await fixture({scanHandler:()=>blocked});try{
  await f.start();const signal=new AbortController().signal;
  const first=f.ctx.XAssistantScheduler.replyDuringCooldown({signal,end:50000});
  const second=f.ctx.XAssistantScheduler.replyDuringCooldown({signal,end:50000});
  await wait();assert.equal(f.scans(),1);assert.equal(f.pageLockRequests(),1);
  release({complete:true});await Promise.all([first,second]);
 }finally{release({complete:true});await f.stop();}
});
test('posting releases queued cooldown scan before waiting on interaction',async()=>{
 const f=await fixture({pageLockBlocked:true});try{
  await f.start();const slot=f.ctx.XAssistantScheduler.replyDuringCooldown({signal:new AbortController().signal,end:50000});
  await wait();assert.equal(f.pageLockRequests(),1);
  // Real interaction awaits this hook, and posting already owns the page lock.
  const pause=f.ctx.XAssistantInteractionDriver.pause;
  f.ctx.XAssistantInteractionDriver.pause=async()=>{await slot;await pause();};
  await Promise.race([f.ctx.XAssistantScheduler.beforePost(),new Promise((_,reject)=>setTimeout(()=>reject(Error('deadlock')),200))]);
  await slot;assert.equal(f.scans(),0);assert.equal(f.working(),false);
 }finally{await f.stop();}
});
test('manual stop aborts interaction before awaiting a blocked handoff',async()=>{
 const f=await fixture();await f.start();
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 const stopDriver=f.ctx.XAssistantInteractionDriver.stop;
 f.ctx.XAssistantInteractionDriver.pause=()=>blocked;
 f.ctx.XAssistantInteractionDriver.stop=async()=>{release();await stopDriver();};
 const handoff=f.ctx.XAssistantScheduler.beforePost().catch(()=>{});
 await wait();await Promise.race([f.stop(),new Promise((_,reject)=>setTimeout(()=>reject(Error('stop deadlock')),200))]);
 await handoff;assert.equal(f.storage.xAssistantSchedulerV3.active,false);assert.equal(f.storage.xAssistantSchedulerV3.stopReason,'manual');
});
test('unchanged polling state does not write storage every tick',async()=>{
 const f=await fixture();try{await f.start();const before=f.writes();await wait();await wait();assert.ok(f.writes()-before<=1);await f.advance(6000);assert.ok(f.writes()>before);}finally{await f.stop();}
});
test('invalid cooldown deadline never opens a notification slot',async()=>{
 const f=await fixture();try{await f.start();for(const end of [undefined,NaN,Infinity])await f.ctx.XAssistantScheduler.replyDuringCooldown({signal:new AbortController().signal,end});assert.equal(f.scans(),0);assert.equal(f.pageLockRequests(),0);}finally{await f.stop();}
});


test('invalidation retains its actual diagnosis and disables restart until refresh', async () => {
 for (const reason of ['扩展已更新，请刷新当前 X 页面', '后台连续 3 次连接失败，已安全停止。请刷新页面后重试']) {
  const f = await fixture();
  await f.start();
  f.emit('x-assistant-invalidate', {reason});
  assert.equal(f.button.disabled, true);
  assert.equal(f.ctx.XAssistantScheduler.active(), false);
  await wait();
  assert.equal(f.working(), false);
  assert.equal(f.postRunning(), false);
  assert.equal(f.storage.xAssistantSchedulerV3.active, false);
  assert.equal(f.storage.xAssistantSchedulerV3.error, reason);
  assert.equal(f.storage.xAssistantSchedulerV3.stopReason, reason);
  assert.equal(f.summary.textContent, reason);
  // Session cleanup and programmatic start must both honor the page-level latch.
  await f.start();
  assert.equal(f.button.disabled, true);
  assert.equal(f.ctx.XAssistantScheduler.active(), false);
  assert.equal(f.postRunning(), false);
  assert.equal(f.summary.textContent, reason);
 }
});

test('invalidation while idle prevents startup and supplies a useful fallback reason', async () => {
 const f = await fixture();
 f.emit('x-assistant-invalidate');
 await wait();
 await f.start();
 assert.equal(f.button.disabled, true);
 assert.equal(f.ctx.XAssistantScheduler.active(), false);
 assert.equal(f.postRunning(), false);
 assert.match(f.summary.textContent, /刷新当前 X 页面/);
 assert.equal(f.storage.xAssistantSchedulerV3, undefined);
});

test('an ordinary manual stop remains restartable', async () => {
 const f = await fixture();
 try {
  await f.start(); await f.stop();
  assert.equal(f.button.disabled, false);
  await f.start();
  assert.equal(f.ctx.XAssistantScheduler.active(), true);
  assert.equal(f.button.disabled, false);
 } finally {await f.stop();}
});

test('manual stop after a cancelled refresh persists the stopped scheduler state', async () => {
 const f = await fixture();
 await f.start();
 await f.ctx.XAssistantScheduler.beforeRefresh();
 // A cancelled beforeunload prompt leaves the same content script alive;
 // no pagehide event follows beforeRefresh().
 await f.stop();
 assert.equal(f.postRunning(), false);
 assert.equal(f.working(), false);
 assert.equal(f.storage.xAssistantSchedulerV3.active, false);
 assert.equal(f.storage.xAssistantSchedulerV3.stopReason, 'manual');
});

test('failure after a cancelled refresh persists the error instead of a resumable session', async () => {
 const f = await fixture();
 await f.start();
 await f.ctx.XAssistantScheduler.beforeRefresh();
 f.runtimes.posting.error = 'generation failed after cancelled refresh';
 await wait();
 assert.equal(f.postRunning(), false);
 assert.equal(f.working(), false);
 assert.equal(f.storage.xAssistantSchedulerV3.active, false);
 assert.equal(f.storage.xAssistantSchedulerV3.stopReason, 'error');
 assert.equal(f.storage.xAssistantSchedulerV3.error, 'generation failed after cancelled refresh');
});

test('an actual pagehide still preserves the running state for refresh recovery', async () => {
 const f = await fixture();
 await f.start();
 await f.ctx.XAssistantScheduler.beforeRefresh();
 f.emit('pagehide');
 await wait();
 assert.equal(f.ctx.XAssistantScheduler.active(), false);
 assert.equal(f.storage.xAssistantSchedulerV3.active, true);
 assert.equal(f.storage.xAssistantSchedulerV3.stopReason, null);
 assert.equal(f.calls.includes('stop:notifications'), false);
});
