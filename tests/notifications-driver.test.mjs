import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../notifications-driver.js',import.meta.url),'utf8');
const KEY='xAssistantNotificationsRuntimeV1',SCHEDULE='xAssistantNotificationScheduleV1';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture({lock=true,scan,deadline,legacyState}={}){
 let now=1000,scans=0;
 const calls=[],events=[],sleepers=[],listeners={},changes=[];
 const states={notifications:legacyState||{active:false},interaction:{active:true,owner:2,runId:'i'},posting:{active:true,owner:3,runId:'p'}};
 const storage=deadline===undefined?{}:{[SCHEDULE]:{'/me':{nextAt:deadline}}};
 const section={dataset:{}},output={textContent:''};
 const context=vm.createContext({AbortController,DOMException,Error,Date:{now:()=>now},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
  document:{getElementById:()=>({querySelector:s=>s.includes('data-status')?output:section})},
  window:{dispatchEvent:e=>events.push(e),addEventListener:(name,fn)=>listeners[name]=fn},
  navigator:{locks:{request:async(name,options,fn)=>{assert.equal(name,'x-assistant-notifications-loop');assert.equal(options.ifAvailable,true);assert.equal(options.steal,undefined);return fn(lock?{}:null);}}},
  chrome:{storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async values=>Object.assign(storage,structuredClone(values))},onChanged:{addListener:fn=>changes.push(fn)}}},
  XAssistantWorkspace:{ready:Promise.resolve({tabId:1}),check:signal=>{if(signal.aborted)throw new DOMException('stopped','AbortError');}},
  XAssistantDOM:{account:()=>'/me'},XAssistantTime:{ready:Promise.resolve(),ms:name=>name==='startup'?100:600},
  XAssistantTasks:{TaskError:class extends Error{constructor(code,message){super(message);this.code=code;}},check:signal=>{if(signal.aborted)throw new DOMException('stopped','AbortError');}},
  XAssistantRuntime:{review:async()=>true,runtime:async(module,action,extra={})=>{
    calls.push({module,action,extra});
    if(action==='get')return {...states[module]};
    if(action==='begin'){states[module]={active:true,owner:1,runId:'n',phase:'waiting'};return {...states[module]};}
    assert.equal(module,'notifications');assert.equal(extra.runId,'n');
    if(action==='patch')Object.assign(states[module],extra.patch);
    if(action==='stop'){states[module].active=false;states[module].phase=['unknown','submitting'].includes(states[module].phase)?'unknown':'stopped';}
    return {...states[module]};
  },sleep:(ms,signal)=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('stopped','AbortError'));return;}
    const abort=()=>reject(new DOMException('stopped','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    sleepers.push(()=>{signal.removeEventListener('abort',abort);now+=ms;resolve();});
  })},
  XAssistantProfileReplies:{scan:async options=>{scans++;return scan?scan(options,{states,storage}):{complete:true,reason:'profile_complete'};}}
 });
 vm.runInContext(source,context);
 return{driver:context.XAssistantNotificationDriver,context,calls,events,states,storage,section,output,changes,listeners,scans:()=>scans,
  advance:async()=>{const pending=sleepers.splice(0);pending.forEach(fn=>fn());await flush();}};
}
test('loading a page never resumes a legacy active runtime',async()=>{
 const f=fixture({legacyState:{active:true,owner:1,runId:'old'}});await flush();
 assert.equal(f.driver.isRunning(),false);assert.equal(f.calls.length,0);assert.equal(f.scans(),0);
});
test('hidden 10-minute wait wakes 40 times, never scans early and remains immediately stoppable',async()=>{
 const f=fixture({deadline:601000});f.context.document.hidden=true;
 await f.driver.start();
 for(let i=0;i<39;i++){await f.advance();assert.equal(f.scans(),0);}
 await f.advance();assert.equal(f.scans(),1);
 await f.driver.stop();assert.equal(f.driver.isRunning(),false);
 assert.equal(f.storage[SCHEDULE]['/me'].nextAt,601600);
});
test('start resolves after ownership while the scan loop remains independently active',async()=>{
 const f=fixture();const start=await f.driver.start();
 assert.equal(start.runId,'n');assert.equal(start.account,'/me');assert.equal(f.driver.isRunning(),true);
 assert.equal(f.scans(),0);assert.equal(f.section.dataset.nextAt,'1100');
 await f.advance();assert.equal(f.scans(),1);assert.equal(f.storage[SCHEDULE]['/me'].nextAt,1700);
 assert.equal(f.states.posting.active,true);assert.equal(f.states.interaction.active,true);
 await f.driver.stop();assert.equal(f.driver.isRunning(),false);assert.equal(f.states.notifications.active,false);
 assert.ok(f.calls.every(c=>c.module==='notifications'));assert.equal(f.storage[SCHEDULE]['/me'].nextAt,1700);
});
test('saved notification deadline survives a stop/start and changes to other modules',async()=>{
 const f=fixture({deadline:3000});await f.driver.start();assert.equal(f.section.dataset.nextAt,'3000');
 f.states.posting.active=false;await f.advance();assert.equal(f.scans(),0);
 await f.driver.stop();assert.equal(f.storage[SCHEDULE]['/me'].nextAt,3000);
 await f.driver.start();assert.equal(f.section.dataset.nextAt,'3000');await f.driver.stop();
});
test('a second tab cannot steal the reply lock or stop the owner',async()=>{
 const f=fixture({lock:false,legacyState:{active:true,owner:9,runId:'remote'}});
 await assert.rejects(f.driver.start(),/另一个/);await flush();
 assert.equal(f.driver.isRunning(),false);assert.equal(f.calls.length,0);assert.equal(f.states.notifications.runId,'remote');
});
test('scan failure stops replies alone and announces its error',async()=>{
 const f=fixture({scan:async()=>{throw Error('scan failed');}});await f.driver.start();await f.advance();
 assert.equal(f.driver.isRunning(),false);assert.equal(f.states.notifications.active,false);
 assert.equal(f.states.interaction.active,true);assert.equal(f.states.posting.active,true);
 assert.equal(f.output.textContent,'scan failed');assert.equal(f.events.at(-1).detail.error,'scan failed');
});
test('stop waits for aborted transaction evidence before stopping the runtime',async()=>{
 const f=fixture({scan:(options,{states,storage})=>new Promise((_resolve,reject)=>{
  options.signal.addEventListener('abort',()=>{
   states.notifications.phase='unknown';storage.replyEvidence={status:'unknown'};
   reject(new DOMException('stopped','AbortError'));
  },{once:true});
 })});await f.driver.start();await f.advance();assert.equal(f.scans(),1);
 await f.driver.stop({preserveDrafts:true});
 assert.equal(f.storage.replyEvidence.status,'unknown');assert.equal(f.states.notifications.phase,'unknown');
 assert.equal(f.states.notifications.active,false);
});
test('an obsolete driver never stops a replacement run',async()=>{
 const f=fixture();await f.driver.start();f.states.notifications={active:true,owner:8,runId:'replacement'};
 for(const notify of f.changes)notify({[KEY]:{newValue:f.states.notifications}},'local');await flush();
 assert.equal(f.driver.isRunning(),false);assert.equal(f.states.notifications.active,true);
 assert.equal(f.calls.filter(c=>c.action==='stop').length,0);
});
test('driver source has no scheduler or interaction dependency and no draft cancellation',()=>{
 assert.doesNotMatch(source,/XAssistantScheduler|XAssistantInteraction|XAssistantPopup|page-actions|steal:/);
});


test('upgrade carries over the previous account deadline without carrying over activation',async()=>{
 const f=fixture();f.storage.xAssistantSchedulerV3={active:true,account:'/Me',nextReplyAt:7000};
 await flush();assert.equal(f.driver.isRunning(),false);
 await f.driver.start();assert.equal(f.section.dataset.nextAt,'7000');
 await f.driver.stop();assert.equal(f.storage[SCHEDULE]['/me'].nextAt,7000);
});


test('failure to persist an error message cannot prevent stopping this run',async()=>{
 const f=fixture({scan:async()=>{throw Error('scan failed');}});
 const original=f.context.XAssistantRuntime.runtime;
 f.context.XAssistantRuntime.runtime=async(module,action,extra)=>{
  if(action==='patch'&&extra?.patch?.error)throw Error('error log write failed');
  return original(module,action,extra);
 };
 await f.driver.start();await f.advance();
 assert.equal(f.driver.isRunning(),false);assert.equal(f.states.notifications.active,false);
 assert.equal(f.calls.filter(c=>c.action==='stop').length,1);
});


test('an automatic reply start never prompts to clear a prior unknown submission',async()=>{
 const f=fixture({legacyState:{active:false,owner:1,runId:'old',phase:'unknown'}});
 f.context.XAssistantRuntime.review=()=>{throw Error('must not prompt');};
 await assert.rejects(f.driver.start(),e=>e.code==='REVIEW_REQUIRED');await flush();
 assert.equal(f.calls.filter(c=>c.action==='begin').length,0);assert.equal(f.states.notifications.phase,'unknown');
});

test('driver stop event propagates exact X error code, submission evidence and does not invent confirmation',async()=>{
 const f=fixture({scan:async()=>{throw Object.assign(Error('X 原因：出错了，不会重发'),{code:'SEND_UNKNOWN',submitted:true});}});
 await f.driver.start();await f.advance();const stop=f.events.at(-1).detail;
 assert.equal(stop.code,'SEND_UNKNOWN');assert.equal(stop.submitted,true);assert.notEqual(stop.confirmed,true);assert.match(stop.error,/X 原因/);
});
test('a diagnostic round boundary is emitted only on return from a real scan, never on startup waiting',async()=>{
 const f=fixture();await f.driver.start();let waits=f.calls.filter(r=>r.extra?.patch?.phase==='waiting');assert.equal(waits.length,1);assert.equal(waits[0].extra.patch.roundComplete,undefined);
 await f.advance();waits=f.calls.filter(r=>r.extra?.patch?.phase==='waiting');assert.equal(waits.length,2);assert.equal(waits[1].extra.patch.roundComplete,true);assert.equal(waits[1].extra.patch.roundReason,'profile_complete');
 await f.driver.stop();
});
