import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const scripts=['task-utils.js','action-client.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
function fixture(options={}){
 const state={now:1000,mono:1000,events:[],messages:[],clicks:0,sleeps:[]},controller=new AbortController();
 class Clock extends Date{static now(){return state.now;}}
 const api={check:signal=>{if(signal?.aborted)throw new DOMException('stopped','AbortError');options.guard?.(state);},
  sleep:async(ms,signal)=>{api.check(signal);state.sleeps.push(ms);state.now+=ms;state.mono+=ms;options.onSleep?.(state,controller);api.check(signal);},
  call:async message=>{state.messages.push(message);state.events.push(message.kind==='ACTION_ACQUIRE'?'acquire':message.outcome);
   if(options.call)return options.call(message,state,controller);
   return message.kind==='ACTION_ACQUIRE'?{granted:true,leaseId:'lease',expiresAt:state.now+10000}:{};
  }};
 const context=vm.createContext({Date:Clock,performance:{now:()=>state.mono},Error,DOMException,setTimeout,clearTimeout,XAssistantRuntime:api});
 for(const script of scripts)vm.runInContext(script,context);
 const send=(overrides={})=>context.XAssistantActions.click({module:'interaction',runId:'run',account:'/owner',kind:'reply',signal:controller.signal,
  beforeClick:async()=>{state.events.push('before');options.before?.(state,controller);},validate:()=>{state.events.push('validate');options.validate?.(state,controller);},
  click:()=>{state.events.push('click');state.clicks++;options.click?.(state,controller);},...overrides});
 return {state,controller,send};
}
test('lease wraps the final synchronous validation and click, then ACKs actual action',async()=>{
 const f=fixture();await f.send();assert.deepEqual(f.state.events,['acquire','before','validate','click','attempted']);
 assert.equal(f.state.messages[0].actionKind,'reply');assert.equal(f.state.messages[1].leaseId,'lease');assert.equal(f.state.clicks,1);
});
test('pacing wait never writes submitting state or creates an observer before a permit',async()=>{
 let requests=0;
 const f=fixture({call:(message,state)=>message.kind==='ACTION_ACQUIRE'?(++requests===1?{granted:false,retryAt:24000}:{granted:true,leaseId:'lease',expiresAt:state.now+10000}):{}});
 await f.send();assert.deepEqual(f.state.events,['acquire','acquire','before','validate','click','attempted']);assert.deepEqual(f.state.sleeps,[23000]);
});
test('stop while waiting for global pacing makes no pre-click mutation and no action',async()=>{
 const f=fixture({call:()=>({granted:false,retryAt:24000}),onSleep:(_state,controller)=>controller.abort()});
 await assert.rejects(f.send(),{name:'AbortError'});assert.deepEqual(f.state.events,['acquire']);assert.equal(f.state.clicks,0);
});
test('late or invalid grant is released and cannot click',async()=>{
 for(const permit of [{granted:true,leaseId:'lease',expiresAt:1000},{granted:true,leaseId:'lease',expiresAt:NaN}]){
  const f=fixture({call:message=>message.kind==='ACTION_ACQUIRE'?permit:{}});
  await assert.rejects(f.send(),{code:'ACTION_LEASE_EXPIRED'});assert.equal(f.state.clicks,0);assert.equal(f.state.messages.at(-1).outcome,'released');
 }
});
test('stop, lease expiry and validation failure before click only release a permit',async()=>{
 for(const options of [{before:(_s,c)=>c.abort()},{before:s=>s.now+=10000},{validate:()=>{throw Error('page changed');}},{validate:s=>s.now+=10000}]){
  const f=fixture(options);await assert.rejects(f.send());assert.equal(f.state.clicks,0);assert.equal(f.state.messages.at(-1).outcome,'released');
 }
});
test('monotonic lease age also blocks a delayed click if the wall clock was rolled backwards',async()=>{
 const f=fixture({before:s=>{s.mono+=10000;s.now-=5000;}});await assert.rejects(f.send(),{code:'ACTION_LEASE_EXPIRED'});assert.equal(f.state.clicks,0);
});
test('async validation or click functions are rejected before acquiring permission',async()=>{
 for(const overrides of [{validate:async()=>{}},{click:async()=>{}}]){
  const f=fixture();await assert.rejects(f.send(overrides),{code:'ACTION_ASYNC_CLICK'});assert.equal(f.state.messages.length,0);
 }
});
test('a thenable validation is not allowed to cross the final synchronous boundary',async()=>{
 const f=fixture();await assert.rejects(f.send({validate:()=>Promise.resolve()}),{code:'ACTION_ASYNC_CLICK'});assert.equal(f.state.clicks,0);assert.equal(f.state.messages.at(-1).outcome,'released');
});
test('click throw or thenable click conservatively consumes instead of releasing',async()=>{
 for(const click of [()=>{throw Error('DOM click uncertain');},()=>Promise.resolve()]){
  const f=fixture();await assert.rejects(f.send({click}),error=>error.submitted===true);assert.equal(f.state.messages.at(-1).outcome,'attempted');
 }
});
test('lost ACK marks submitted, never releases and never repeats the platform click',async()=>{
 const f=fixture({call:(message,state)=>{if(message.kind==='ACTION_ACQUIRE')return {granted:true,leaseId:'lease',expiresAt:state.now+10000};throw Error('ACK lost');}});
 await assert.rejects(f.send(),error=>error.submitted===true);assert.equal(f.state.clicks,1);assert.equal(f.state.messages.filter(m=>m.kind==='ACTION_SETTLE').length,1);
});
test('abort immediately after click does not abort the attempted settlement',async()=>{
 const f=fixture({click:(_s,c)=>c.abort()});await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.messages.at(-1).outcome,'attempted');
});
test('an abandoned acquire response is released on arrival and can never trigger a late click',async()=>{
 let resolve,entered;const started=new Promise(r=>entered=r);
 const f=fixture({call:message=>message.kind==='ACTION_ACQUIRE'?(entered(),new Promise(r=>resolve=r)):{} });
 const sending=f.send();await started;f.controller.abort();await assert.rejects(sending,{name:'AbortError'});
 resolve({granted:true,leaseId:'late',expiresAt:11000});await new Promise(r=>setImmediate(r));
 assert.equal(f.state.clicks,0);assert.equal(f.state.messages.at(-1).leaseId,'late');assert.equal(f.state.messages.at(-1).outcome,'released');
});
test('all outward action categories use the same lease protocol including independent likes',async()=>{
 for(const kind of ['post','reply','follow','like']){
  const f=fixture();await f.send({kind});assert.equal(f.state.messages[0].actionKind,kind);assert.equal(f.state.clicks,1);
 }
});
test('a released competing lease wakes a like after 250ms, not the conservative thirteen seconds',async()=>{
 let requested=0;
 const f=fixture({call:(message,state)=>message.kind==='ACTION_ACQUIRE'?(++requested===1?{granted:false,retryAt:14000,waitForLease:true}:{granted:true,leaseId:'released-then-like',expiresAt:state.now+10000}):{}});
 await f.send({kind:'like'});assert.deepEqual(f.state.sleeps,[250]);assert.equal(f.state.now,1250);assert.equal(f.state.clicks,1);
});
test('a waiting interaction follow renews priority every five seconds without busy polling',async()=>{
 let requested=0;
 const f=fixture({call:(message,state)=>message.kind==='ACTION_ACQUIRE'?(++requested===1?{granted:false,retryAt:121000,waitForIntent:true}:{granted:true,leaseId:'interaction-follow',expiresAt:state.now+10000}):{}});
 await f.send({kind:'follow'});assert.deepEqual(f.state.sleeps,[5000]);assert.equal(f.state.now,6000);assert.equal(f.state.clicks,1);
});

test('onWait may skip an ineligible follow without sleeping, acquiring twice or clicking',async()=>{
 const f=fixture({call:()=>({granted:false,retryAt:121000,waitForIntent:true})});
 await assert.rejects(f.send({kind:'follow',onWait:async()=>{throw Object.assign(Error('cooling'),{code:'FOLLOW_COOLDOWN'});}}),{code:'FOLLOW_COOLDOWN'});
 assert.equal(f.state.clicks,0);assert.deepEqual(f.state.sleeps,[]);assert.equal(f.state.messages.length,1);
});
