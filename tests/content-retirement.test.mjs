import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(){
 const requests=[],events=[];const runtime={id:'ext',sendMessage:async m=>{requests.push(m);return {ok:true,state:1};}};
 const local={get:async key=>{requests.push(key);return {[key]:4};},set:async v=>requests.push(v)};
 const scope=vm.createContext({crypto,DOMException,chrome:{runtime,storage:{local}},window:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,{detail}){Object.assign(this,{type,detail});}}});
 vm.runInContext(source('runtime-client.js'),scope);return {api:scope.XAssistantRuntime,runtime,local,events,requests};
}
test('after reload every content I/O fails closed before native invocation and retires this document only once',async()=>{
 const f=fixture();assert.equal(await f.api.call({kind:'PING'}),1);assert.equal((await f.api.storage.get('k')).k,4);
 f.runtime.id=undefined;
 for(const fn of [()=>f.api.call({kind:'TIME_ARM'}),()=>f.api.storage.get('old'),()=>f.api.storage.set({leak:1})])await assert.rejects(fn,e=>e.code==='EXTENSION_CONTEXT_INVALIDATED');
 assert.throws(()=>f.api.check(),e=>e.code==='EXTENSION_CONTEXT_INVALIDATED');
 assert.deepEqual(f.requests.map(x=>typeof x==='object'?x.kind:x),['PING','k']);assert.equal(f.events.length,1);assert.equal(f.events[0].type,'x-assistant-invalidate');
});
test('native invalidation between preflight and a storage or messaging call dispatches terminal retirement; no retry or false confirmation',async()=>{
 for(const kind of ['get','message']){
  const f=fixture();let count=0;const stale=()=>{count++;throw Error('Extension context invalidated.')};
  f.local.get=stale;f.runtime.sendMessage=stale;
  await assert.rejects(kind==='get'?f.api.storage.get('k'):f.api.call({kind:'REPLY_CLAIM'}),e=>f.api.isInvalid(e)&&e.confirmed!==true);
  await assert.rejects(f.api.call({kind:'PING'}),e=>f.api.isInvalid(e));assert.equal(count,1);assert.equal(f.events.length,1);
 }
 const f=fixture();let resolve;f.runtime.sendMessage=()=>new Promise(r=>resolve=r);
 const late=f.api.call({kind:'ACTION_SETTLE'});f.runtime.id=undefined;resolve({ok:true,state:{confirmed:true}});
 await assert.rejects(late,e=>f.api.isInvalid(e)&&e.confirmed!==true);assert.equal(f.events.length,1);
});
test('temporary channel errors surface but do not retire; submitted/confirmed evidence on actual application errors is preserved',async()=>{
 const f=fixture();f.runtime.sendMessage=async()=>{throw Error('Could not establish connection.')};
 await assert.rejects(f.api.call({kind:'PING'}),/Could not establish/);assert.equal(f.events.length,0);
 f.runtime.sendMessage=async()=>({ok:false,error:'platform refused',code:'SEND_UNKNOWN',submitted:true});
 await assert.rejects(f.api.call({kind:'RUNTIME'}),e=>e.code==='SEND_UNKNOWN'&&e.submitted===true);assert.equal(f.api.retired(),false);
});
test('an idle posting mirror touches storage only on initial load; no storage polling or activity after invalidation',async()=>{
 const listeners={},timers=[],cleared=[],changes=[];let count=0;
 const node=()=>({dataset:{},classList:{},style:{setProperty(){}},setAttribute(){},append(){},textContent:''}),section=node(),root=node();root.querySelector=()=>section;
 const scope=vm.createContext({Date,document:{getElementById:()=>root,createElement:node,querySelector:()=>null},chrome:{storage:{onChanged:{addListener:fn=>changes.push(fn)},local:{get:async()=>{count++;return {xAssistantPostingV1:{active:false}};}}}},window:{addEventListener:(type,fn)=>listeners[type]=fn},clearInterval:id=>cleared.push(id),setInterval:fn=>{timers.push(fn);return timers.length;},XAssistantCore:{},XAssistantRuntime:{}});
 vm.runInContext(source('posting.js'),scope);await Promise.resolve();await Promise.resolve();
 for(let i=0;i<10;i++)timers.forEach(fn=>fn());assert.equal(count,1);
 listeners['x-assistant-invalidate']();assert.ok(cleared.includes(1));assert.equal(scope.XAssistantPostingDriver.isRunning(),false);
});
test('eager timing and discovery reads are observed even on idle pages, and starting later still receives the original error',async()=>{
 const err=Error('configuration storage unavailable');const scope=vm.createContext({Promise,Set,document:{getElementById:()=>null},chrome:{storage:{local:{get:()=>Promise.reject(err)},onChanged:{addListener(){}}}},XAssistantTimePolicy:{normalize:()=>({}),milliseconds:()=>10},XAssistantRuntime:{storage:{get:()=>Promise.reject(err)}}});
 for(const file of ['time-client.js','module-entry.js'])vm.runInContext(source(file),scope);
 // No task has attached a consumer yet: a naked eager rejection would be reported here.
 await new Promise(r=>setImmediate(r));
 await assert.rejects(scope.XAssistantTime.ready,e=>e===err);await assert.rejects(scope.XAssistantEntry.targetFor(),e=>e===err);
});
