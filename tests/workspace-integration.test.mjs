import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const load=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const scripts=['service-policy.js','workspace-policy.js','workspace.js'].map(load);
const KEY='xAssistantManagedServiceV1';
const SEARCH_KEY='xAssistantFriendSearchV1';
const keys={posting:'xAssistantPostingV1',interaction:'xAssistantRuntimeV1',notifications:'xAssistantNotificationsRuntimeV1',followback:'xAssistantFollowbackRuntimeV1'};
const DAY=Date.parse('2026-11-04T04:00:00Z'),MIDNIGHT=Date.parse('2026-11-04T16:00:00Z'),MORNING=Date.parse('2026-11-04T22:00:00Z');
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
function makeBus({enabled=true,selected={interaction:true,notifications:true},workers={},friendSearch=true}={}){
 const data={[KEY]:{enabled,selected,account:'/me',revision:1,workers},[SEARCH_KEY]:friendSearch},listeners=[];
 return{data,listeners,setService(patch){const previous=data[KEY];data[KEY]={...previous,...patch,revision:previous.revision+1};for(const fn of listeners)fn({[KEY]:{oldValue:previous,newValue:data[KEY]}},'local');},setRuntime(module,value){data[keys[module]]={...value};},setSearch(value){const oldValue=data[SEARCH_KEY];data[SEARCH_KEY]=value;for(const fn of listeners)fn({[SEARCH_KEY]:{oldValue,newValue:value}},'local');}};
}
function fixture({path='/home',tabId=1,module=null,bus=makeBus(),account='/me',now=DAY,aiCheck=async()=>({ready:true}),helloError=null,poll,report,driverStart,driverStop}={}){
 if(module)bus.data[KEY].workers[module]={tabId,token:module+'-'+tabId,status:'starting',retryAt:null};
 let clock=now,currentAccount=account,closed=false;
 const calls=[],stops=[],starts=[],events=[],listeners={},timers=new Map(),messages=[],running={posting:false,interaction:false,notifications:false};
 let nextTimer=1;
 const location={};const navigateTo=value=>{const url=new URL(value,'https://x.com');Object.assign(location,{href:url.href,pathname:url.pathname,search:url.search});};navigateTo(path);
 const assignment=()=>{
  const service=bus.data[KEY],found=Object.entries(service.workers).find(([,w])=>w.tabId===tabId);if(!found)return null;
  const [name,w]=found,time=(clock+8*3600000)%86400000;
  const reason=!service.enabled?'SERVICE_DISABLED':name!=='posting'&&!service.selected[name]?'MODULE_DISABLED':name==='posting'&&time<6*3600000?'OUTSIDE_WORKING_HOURS':w.status==='blocked'?'WORKER_BLOCKED':w.retryAt>clock?'RETRY_WAIT':null;
  return{module:name,...(name==='interaction'?{sourceMode:bus.data[SEARCH_KEY]===false?'home':'search'}:{}),token:w.token,account:service.account,shouldRun:!reason,reason,revision:service.revision,status:w.status,retryAt:w.retryAt};
 };
 const window={dispatchEvent:event=>{events.push(event);for(const fn of listeners[event.type]||[])fn(event);},addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)};
 const api={call:async msg=>{
  calls.push({...msg});
  if(msg.kind==='WORKSPACE_HELLO'){if(helloError)throw helloError;return{tabId,assignment:assignment()};}
  if(msg.kind==='WORKER_POLL')return poll?poll(assignment):assignment();
  if(msg.kind==='AI_CHECK')return aiCheck(msg);
  if(msg.kind==='WORKER_REPORT'){
   if(report)return report(msg,bus,clock);
   const w=bus.data[KEY].workers[msg.module];
   if(w?.token===msg.token){
    const workers={...bus.data[KEY].workers,[msg.module]:{...w,status:msg.status==='error'?'blocked':msg.status,error:msg.error||null}};
    bus.setService({workers});
   }
   return bus.data[KEY];
  }
  return{};
 },runtime:async(name,action,extra={})=>{calls.push({kind:'RUNTIME',module:name,action,...extra});if(action==='stop'){const run=bus.data[keys[name]];assert.equal(extra.runId,run.runId);bus.setRuntime(name,{...run,active:false,phase:['submitting','unknown'].includes(run.phase)?'unknown':'stopped'});}return bus.data[keys[name]]||{};},review:async()=>{throw Error('Automatic review is forbidden');}};
 const driver=name=>({start:async(_resume,sourceMode)=>{
  if(name==='interaction')calls.push({kind:'interaction-start',sourceMode});
  starts.push(name);if(driverStart)await driverStart(name);
  running[name]=true;bus.setRuntime(name,{active:true,owner:tabId,runId:name+'-'+tabId,phase:'waiting'});
 },stop:async options=>{stops.push({name,options});if(driverStop)await driverStop(name);running[name]=false;const run=bus.data[keys[name]];if(run?.owner===tabId)bus.setRuntime(name,{...run,active:false,phase:['submitting','unknown'].includes(run.phase)?'unknown':'stopped'});},isRunning:()=>running[name]});
 const bounded=async(work,{signal,deadline=Infinity}={})=>{
  if(signal?.aborted)throw new DOMException('stopped','AbortError');
  if(clock>=deadline)throw Object.assign(Error('expired'),{code:'YIELD'});
  let abort;try{return await Promise.race([Promise.resolve().then(()=>{if(signal?.aborted)throw new DOMException('stopped','AbortError');return work();}),new Promise((_,reject)=>{abort=()=>reject(new DOMException('stopped','AbortError'));signal?.addEventListener('abort',abort,{once:true});})]);}finally{signal?.removeEventListener('abort',abort);}
 };
 const context=vm.createContext({URL,DOMException,AbortController,Date:{now:()=>clock},Error,Promise,CustomEvent:class{constructor(type,init={}){this.type=type;this.detail=init.detail;}},location,window,
  document:{querySelector:selector=>selector==='[data-testid="AppTabBar_Profile_Link"]'&&currentAccount?{getAttribute:()=>currentAccount}:null,querySelectorAll:()=>[]},
  setInterval:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id),
  chrome:{runtime:{onMessage:{addListener:fn=>messages.push(fn)}},storage:{local:{get:async names=>Object.fromEntries((Array.isArray(names)?names:[names]).map(name=>[name,bus.data[name]]))},onChanged:{addListener:fn=>bus.listeners.push(fn)}}},
  XAssistantTasks:{bounded,waitForPage:async probe=>probe()},XAssistantCore:{editorText:e=>e.textContent||''},
  XAssistantRuntime:api,XAssistantPostingDriver:driver('posting'),XAssistantInteractionDriver:driver('interaction'),XAssistantNotificationDriver:driver('notifications'),XAssistantFollowbackDriver:driver('followback'),
  XAssistantEntry:{captureInteractionTarget:()=>{},setInteractionMode:sourceMode=>calls.push({kind:'mode',sourceMode}),enter:async name=>{if(name!=='interaction')return;const mode=calls.filter(c=>c.kind==='mode').at(-1).sourceMode;const dest=mode==='home'?'/home':'/search?q=test';context.XAssistantWorkspace.expectNavigation(dest);navigateTo(dest);}}
 });
 scripts.forEach(source=>vm.runInContext(source,context));
 return{workspace:context.XAssistantWorkspace,calls,stops,starts,bus,context,timers,running,events,assignment,
  tick:async ms=>{for(const timer of [...timers.values()])if(ms===undefined||timer.ms===ms)timer.fn();await flush();},
  sync:async()=>{for(const fn of messages)fn({kind:'SERVICE_SYNC'},null,()=>{});await flush();},
  navigate:async value=>{navigateTo(value);window.dispatchEvent({type:'popstate'});await flush();},
  setAccount:value=>{currentAccount=value;},setNow:value=>{clock=value;},
  emit:(type,detail)=>window.dispatchEvent(new context.CustomEvent(type,{detail})),
  close:async()=>{closed=true;window.dispatchEvent({type:'pagehide'});await flush();},isClosed:()=>closed};
}
async function started(f){await f.workspace.ready;await flush();return f;}

test('ordinary X pages have no driver start entry, no work polling, and no task timers',async()=>{
 for(const path of ['/home','/search?q=hi','/me','/notifications','/other','/me/verified_followers']){
  const f=await started(fixture({path}));assert.equal(f.workspace.start,undefined);assert.equal(f.starts.length,0);assert.equal(f.timers.size,0);
  f.bus.setService({enabled:false});await flush();assert.equal(f.calls.filter(c=>c.kind==='WORKER_POLL').length,0);
  await f.navigate('/messages');assert.equal(f.starts.length,0);
 }
});
test('a managed work page starts only its assigned driver and reports ownership',async()=>{
 const f=await started(fixture({module:'posting'}));
 assert.deepEqual(f.starts,['posting']);assert.equal(f.workspace.active(),'posting');assert.equal(f.workspace.state().status,'running');
 assert.equal(f.calls.filter(c=>c.kind==='WORKER_REPORT'&&c.status==='running').length,1);
 assert.deepEqual([...f.timers.values()].map(t=>t.ms).sort((a,b)=>a-b),[500,5000]);await f.close();
});
test('three managed pages remain independent when one optional module is disabled',async()=>{
 const bus=makeBus(),post=fixture({module:'posting',tabId:1,bus}),interaction=fixture({module:'interaction',tabId:2,path:'/search?q=hi',bus}),reply=fixture({module:'notifications',tabId:3,path:'/me',bus});
 await Promise.all([started(post),started(interaction),started(reply)]);
 bus.setService({selected:{interaction:false,notifications:true}});await flush();
 assert.equal(post.workspace.active(),'posting');assert.equal(reply.workspace.active(),'notifications');assert.equal(interaction.workspace.active(),null);
 assert.equal(post.stops.length,0);assert.equal(reply.stops.length,0);await Promise.all([post.close(),interaction.close(),reply.close()]);
});
test('搜索开关来回切换只改变互动来源，同一工作页的发帖与回帖邻居不动',async()=>{
 const bus=makeBus(),post=fixture({module:'posting',tabId:1,bus}),i=fixture({module:'interaction',tabId:2,path:'/search?q=hi',bus}),reply=fixture({module:'notifications',tabId:3,path:'/me',bus});
 await Promise.all([started(post),started(i),started(reply)]);
 const modes=()=>i.calls.filter(c=>c.kind==='interaction-start').map(c=>c.sourceMode);
 assert.deepEqual(modes(),['search']);bus.setSearch(false);await flush();await i.sync();
 assert.equal(i.context.location.pathname,'/home');assert.deepEqual(modes(),['search','home']);assert.equal(i.stops.length,1);
 assert.equal(i.workspace.state().status,'running');assert.equal(post.stops.length,0);assert.equal(reply.stops.length,0);
 await i.tick(5000);assert.equal(i.starts.length,2);
 bus.setSearch(true);await flush();await i.sync();assert.equal(i.context.location.pathname,'/search');assert.deepEqual(modes(),['search','home','search']);
 assert.equal(i.calls.filter(c=>c.kind==='WORKER_REPORT'&&c.status==='error').length,0);
 assert.equal(post.starts.length,1);assert.equal(reply.starts.length,1);
 await Promise.all([post.close(),i.close(),reply.close()]);
});
test('时间线冷启动不依赖搜索开启，来源切换等待旧回执并只进入最后一次选择',async()=>{
 const drain=deferred(),bus=makeBus({friendSearch:false}),f=await started(fixture({module:'interaction',path:'/home',bus,driverStop:()=>drain.promise}));
 assert.equal(f.context.location.pathname,'/home');assert.equal(f.workspace.active(),'interaction');
 bus.setSearch(true);await flush();bus.setSearch(false);bus.setSearch(true);await flush();
 assert.equal(f.starts.length,1);assert.equal(f.workspace.state().status,'stopping');assert.equal(f.context.location.pathname,'/home');
 drain.resolve();await f.sync();assert.deepEqual(f.calls.filter(c=>c.kind==='interaction-start').map(c=>c.sourceMode),['home','search']);
 await f.close();
});
test('来源切换不自动恢复发送结果未知的回复',async()=>{
 const bus=makeBus(),f=await started(fixture({module:'interaction',path:'/search?q=x',bus}));
 bus.setRuntime('interaction',{...bus.data[keys.interaction],phase:'submitting'});
 bus.setSearch(false);await flush();await f.sync();
 assert.equal(f.starts.length,1);assert.equal(f.workspace.active(),null);assert.equal(bus.data[keys.interaction].phase,'unknown');
 assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code==='SEND_UNKNOWN'));
 await f.close();
});
test('切源不接管被替换的详情条目，旧工作页有草稿时不导航',async()=>{
 for(const variant of ['same','changed','draft']){
  const bus=makeBus(),f=await started(fixture({module:'interaction',path:'/search?q=test',bus}));
  f.context.navigation={currentEntry:{key:'detail-entry'}};
  f.workspace.expectNavigation('/writer/status/123');await f.navigate('/writer/status/123');
  // WORKER_REPORT occurs after stop saved the exact detail entry, before the next begin.
  const original=f.context.XAssistantRuntime.call;
  f.context.XAssistantRuntime.call=async m=>{
   if(m.kind==='WORKER_REPORT'&&m.status==='stopped'){
    if(variant==='changed')f.context.navigation.currentEntry={key:'different-entry'};
    if(variant==='draft')f.context.document.querySelectorAll=q=>q.includes('contenteditable')?[{textContent:'用户草稿'}]:[];
   }
   return original(m);
  };
  bus.setSearch(false);await flush();await f.sync();assert.equal(f.workspace.active(),variant==='same'?'interaction':null);
  if(variant==='same')assert.equal(f.context.location.pathname,'/home');
  else{assert.equal(f.context.location.pathname,'/writer/status/123');assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code===(variant==='draft'?'RESIDUAL_DRAFT':'PAGE_CHANGED')));}
  await f.close();
 }
});
test('posting cannot be disabled through an optional selection flag',async()=>{
 const bus=makeBus({selected:{posting:false,interaction:false,notifications:false}}),f=await started(fixture({module:'posting',bus}));
 assert.deepEqual(f.starts,['posting']);await f.close();
});
test('nighttime is a rest state and the same enabled worker starts at Beijing 06:00',async()=>{
 const f=await started(fixture({module:'posting',now:MIDNIGHT}));assert.equal(f.starts.length,0);assert.equal(f.workspace.state().status,'resting');
 f.setNow(MORNING);await f.sync();assert.deepEqual(f.starts,['posting']);assert.equal(f.workspace.state().status,'running');await f.close();
});
test('the midnight action gate is synchronous even before the next poll or alarm',async()=>{
 const f=await started(fixture({module:'posting',now:MIDNIGHT-1}));f.setNow(MIDNIGHT);
 assert.throws(()=>f.workspace.check(new AbortController().signal),e=>e.code==='REST_WINDOW');
 await f.tick(500);assert.equal(f.workspace.active(),null);assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='stopped'));
 assert.ok(!f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='error'));await f.close();
});
test('midnight pauses only posting; interaction and notification sessions cross midnight and 06:00 unchanged',async()=>{
 const bus=makeBus(),post=fixture({module:'posting',tabId:1,bus,now:MIDNIGHT-1}),interaction=fixture({module:'interaction',tabId:2,path:'/search?q=hi',bus,now:MIDNIGHT-1}),reply=fixture({module:'notifications',tabId:3,path:'/me',bus,now:MIDNIGHT-1});
 const workers=[post,interaction,reply];await Promise.all(workers.map(started));
 for(const f of workers)f.setNow(MIDNIGHT);
 assert.throws(()=>post.workspace.check(),e=>e.code==='REST_WINDOW');
 assert.doesNotThrow(()=>interaction.workspace.check());assert.doesNotThrow(()=>reply.workspace.check());
 await Promise.all(workers.map(f=>f.tick(500)));await Promise.all(workers.map(f=>f.sync()));
 assert.equal(post.workspace.active(),null);assert.equal(post.workspace.state().status,'resting');
 for(const f of [interaction,reply]){assert.equal(f.workspace.state().status,'running');assert.equal(f.starts.length,1);assert.equal(f.stops.length,0);}
 for(const f of workers)f.setNow(MORNING);
 await Promise.all(workers.map(f=>f.sync()));
 assert.deepEqual(post.starts,['posting','posting']);
 for(const f of [interaction,reply]){assert.equal(f.workspace.state().status,'running');assert.equal(f.starts.length,1);assert.equal(f.stops.length,0);assert.doesNotThrow(()=>f.workspace.check());}
 await Promise.all(workers.map(f=>f.close()));
});
test('nighttime first startup runs enabled interaction and notifications but leaves posting resting',async()=>{
 const bus=makeBus(),post=fixture({module:'posting',tabId:1,bus,now:MIDNIGHT+3600000}),interaction=fixture({module:'interaction',tabId:2,path:'/search?q=hi',bus,now:MIDNIGHT+3600000}),reply=fixture({module:'notifications',tabId:3,path:'/me',bus,now:MIDNIGHT+3600000});
 await Promise.all([started(post),started(interaction),started(reply)]);
 assert.deepEqual(post.starts,[]);assert.equal(post.workspace.state().status,'resting');assert.ok(!post.calls.some(c=>c.kind==='AI_CHECK'));
 assert.deepEqual(interaction.starts,['interaction']);assert.deepEqual(reply.starts,['notifications']);
 assert.doesNotThrow(()=>interaction.workspace.check());assert.doesNotThrow(()=>reply.workspace.check());
 bus.setService({selected:{interaction:false,notifications:true}});await flush();
 assert.equal(interaction.workspace.active(),null);assert.equal(interaction.workspace.state().status,'stopped');assert.equal(reply.stops.length,0);
 bus.setService({selected:{interaction:true,notifications:true}});await flush();
 assert.deepEqual(interaction.starts,['interaction','interaction']);assert.equal(reply.starts.length,1);
 bus.setService({enabled:false});await flush();
 assert.equal(interaction.workspace.active(),null);assert.equal(reply.workspace.active(),null);
 await Promise.all([post.close(),interaction.close(),reply.close()]);
});
test('ordinary nighttime pages cannot become workers even with both optional modules enabled',async()=>{
 for(const path of ['/home','/search?q=hi','/me','/notifications']){
  const f=await started(fixture({path,now:MIDNIGHT+3600000}));
  assert.equal(f.workspace.start,undefined);assert.equal(f.workspace.active(),null);assert.equal(f.starts.length,0);assert.equal(f.timers.size,0);
  f.bus.setService({selected:{interaction:true,notifications:true}});await flush();
  assert.ok(!f.calls.some(c=>c.kind==='WORKER_POLL'||c.kind==='AI_CHECK'));await f.close();
 }
});
test('module-owned detail navigation retains ownership, while manual browsing blocks only that worker',async()=>{
 const f=await started(fixture({module:'notifications',path:'/me'}));f.workspace.expectNavigation('/me/status/123');await f.navigate('/me/status/123');
 assert.equal(f.workspace.active(),'notifications');assert.equal(f.stops.length,0);
 await f.navigate('/other');assert.equal(f.workspace.active(),null);assert.equal(f.stops[0].options.preserveDrafts,true);
 assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code==='PAGE_CHANGED'));await f.sync();await f.tick(5000);assert.equal(f.starts.length,1);await f.close();
});
test('an account change blocks before another account can receive an action',async()=>{
 const f=await started(fixture({module:'posting'}));f.setAccount('/other');await f.tick(500);
 assert.equal(f.workspace.active(),null);assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code==='ACCOUNT_CHANGED'));await f.close();
});
test('unknown prior submissions block automatic startup without prompting or calling AI',async()=>{
 const bus=makeBus();bus.setRuntime('posting',{phase:'unknown',active:false,owner:1,runId:'old'});
 const f=await started(fixture({module:'posting',bus}));assert.equal(f.starts.length,0);assert.equal(f.calls.filter(c=>c.kind==='AI_CHECK').length,0);
 assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='blocked'&&c.submitted));await f.close();
});
test('existing user drafts prevent preparation and do not get cleaned',async()=>{
 const f=fixture({module:'posting'});const original=f.context.document.querySelector;
 f.context.document.querySelector=selector=>selector.includes('dialog')?{}:original(selector);
 await started(f);assert.equal(f.starts.length,0);assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code==='RESIDUAL_DRAFT'));await f.close();
});
test('cancelled preflight never starts after a late successful API response',async()=>{
 const pending=deferred(),f=fixture({module:'posting',aiCheck:()=>pending.promise});await started(f);assert.equal(f.workspace.state().status,'starting');
 f.bus.setService({enabled:false});await flush();pending.resolve({ready:true});await flush();
 assert.equal(f.workspace.active(),null);assert.equal(f.starts.length,0);assert.ok(!f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='error'));await f.close();
});
test('a late poll cannot revive a disabled service',async()=>{
 const pending=deferred();let count=0;
 const f=fixture({module:'posting',poll:get=>++count===1?pending.promise:get()});await started(f);
 const stale=f.assignment();f.bus.setService({enabled:false});pending.resolve(stale);await flush();assert.equal(f.starts.length,0);assert.equal(f.workspace.active(),null);await f.close();
});
test('a stopped driver error is reported once and cannot hot-loop restart',async()=>{
 const f=await started(fixture({module:'posting'}));f.running.posting=false;f.bus.setRuntime('posting',{phase:'stopped',active:false,error:'broken selector'});
 f.emit('x-assistant-module-state',{module:'posting',running:false,error:'broken selector'});await flush();await f.sync();await f.tick(5000);
 assert.equal(f.starts.length,1);assert.equal(f.workspace.active(),null);assert.equal(f.calls.filter(c=>c.kind==='WORKER_REPORT'&&c.status==='error').length,1);await f.close();
});
test('a transport failure retries only when the supervisor retry deadline has arrived',async()=>{
 let attempts=0;const retryAt=DAY+15000;
 const f=fixture({module:'posting',aiCheck:async()=>{if(++attempts===1)throw Object.assign(Error('Failed to fetch'),{code:'NETWORK'});return{ready:true};},report:(msg,bus)=>{
  const worker=bus.data[KEY].workers.posting;
  bus.setService({workers:{posting:{...worker,status:msg.status==='error'?'retrying':msg.status,retryAt:msg.status==='error'?retryAt:null}}});return bus.data[KEY];
 }});await started(f);assert.equal(f.starts.length,0);await f.sync();assert.equal(attempts,1);
 f.setNow(retryAt-1);await f.sync();assert.equal(attempts,1);f.setNow(retryAt);await f.sync();assert.equal(attempts,2);assert.equal(f.starts.length,1);await f.close();
});
test('old successful receipts are not attached to a new pre-submit network failure',async()=>{
 const bus=makeBus();bus.setRuntime('posting',{active:false,phase:'stopped',receipt:{kind:'confirmed'}});
 const f=await started(fixture({module:'posting',bus,aiCheck:async()=>{throw Object.assign(Error('Failed to fetch'),{code:'NETWORK'});}}));
 const failure=f.calls.find(c=>c.kind==='WORKER_REPORT'&&c.status==='error');assert.equal(failure.submitted,false);assert.equal(failure.confirmed,false);await f.close();
});
test('async outside-hours errors are ordinary rest stops, never sticky failures',async()=>{
 const f=await started(fixture({module:'posting',aiCheck:async()=>{throw Object.assign(Error('rest'),{code:'OUTSIDE_WORKING_HOURS'});}}));
 assert.equal(f.starts.length,0);assert.ok(!f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='error'));await f.close();
});
test('assignment removal stops the worker and removes all its timers',async()=>{
 const f=await started(fixture({module:'posting'}));f.bus.setService({workers:{}});await flush();
 assert.equal(f.workspace.active(),null);assert.equal(f.workspace.state().assignment,null);assert.equal(f.timers.size,0);await f.close();
});
test('handshake failure never creates a worker or timer',async()=>{
 const f=fixture({module:'posting',helloError:Error('stale document')});await assert.rejects(f.workspace.ready,/stale document/);await flush();assert.equal(f.starts.length,0);assert.equal(f.timers.size,0);assert.equal(f.workspace.state().status,'blocked');
});


test('stopping waits for a delayed driver start so it cannot become an orphan runner',async()=>{
 const pending=deferred(),f=fixture({module:'posting',driverStart:()=>pending.promise});await started(f);assert.equal(f.starts.length,1);
 f.bus.setService({enabled:false});await flush();assert.equal(f.workspace.state().status,'stopping');
 pending.resolve();await flush();assert.equal(f.workspace.active(),null);assert.equal(f.running.posting,false);
 assert.ok(f.stops.length>=2);await f.close();
});
test('a failed driver stop write gets one independent own-run stop before reporting stopped',async()=>{
 const f=await started(fixture({module:'posting'}));
 f.context.XAssistantPostingDriver.stop=async()=>{f.running.posting=false;throw Error('failed final write');};
 f.bus.setService({enabled:false});await flush();
 assert.equal(f.bus.data[keys.posting].active,false);assert.equal(f.workspace.state().status,'stopped');
 assert.equal(f.calls.filter(c=>c.kind==='RUNTIME'&&c.action==='stop').length,1);await f.close();
});
test('stop cleanup never writes stop to a replacement run',async()=>{
 const f=await started(fixture({module:'posting'}));
 f.context.XAssistantPostingDriver.stop=async()=>{f.running.posting=false;f.bus.setRuntime('posting',{active:true,owner:1,runId:'replacement',phase:'waiting'});throw Error('run replaced');};
 f.bus.setService({enabled:false});await flush();
 assert.equal(f.bus.data[keys.posting].runId,'replacement');assert.equal(f.bus.data[keys.posting].active,true);
 assert.equal(f.calls.filter(c=>c.kind==='RUNTIME'&&c.action==='stop').length,0);await f.close();
});
test('a recovered message channel publishes its paused worker instead of leaving a false running status',async()=>{
 let failNext=false;
 const f=fixture({module:'posting',poll:get=>{if(failNext){failNext=false;throw Error('background disconnected');}return get();}});
 await started(f);assert.equal(f.workspace.active(),'posting');failNext=true;await f.tick(5000);await flush();
 assert.equal(f.workspace.active(),null);assert.equal(f.bus.data[KEY].workers.posting.status,'blocked');
 assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='error'&&c.code==='WORKSPACE_UNAVAILABLE'));assert.equal(f.starts.length,1);await f.close();
});

function useRealHiddenAccountWait(f){
 const timers=new Map();let next=1;
 f.context.document.hidden=true;f.context.document.visibilityState='hidden';
 f.context.setTimeout=(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id;};
 f.context.clearTimeout=id=>timers.delete(id);
 f.context.XAssistantRuntime.sleep=(_ms,signal)=>new Promise((_resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('stopped','AbortError'));return;}
  signal?.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});
 });
 // The worker captures the task object at load; replace its methods in place.
 const tasks=f.context.XAssistantTasks;vm.runInContext(load('task-utils.js'),f.context);Object.assign(tasks,f.context.XAssistantTasks);f.context.XAssistantTasks=tasks;
 return timers;
}
test('a hidden worker with no account DOM leaves starting after a 120-second wall-clock ceiling',async()=>{
 const f=fixture({module:'posting',account:null}),timeouts=useRealHiddenAccountWait(f);await started(f);
 assert.equal(f.workspace.state().status,'starting');assert.equal(f.starts.length,0);
 const timer=[...timeouts.values()].find(t=>t.ms===120000);assert.ok(timer,'absolute account-readiness deadline must be armed');
 f.setNow(DAY+119999);await flush();assert.equal(f.workspace.state().status,'starting');
 f.setNow(DAY+120000);timer.fn();await flush();
 assert.equal(f.workspace.state().status,'blocked');assert.equal(f.workspace.active(),null);assert.equal(f.starts.length,0);
 assert.equal(f.calls.filter(c=>c.kind==='AI_CHECK').length,0);
 assert.ok(f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.status==='error'&&c.code==='ACCOUNT_NOT_READY'&&/两分钟/.test(c.error)));
 assert.equal(timeouts.size,0);await f.close();
});
test('disabling during hidden account readiness cancels immediately rather than waiting two minutes',async()=>{
 const f=fixture({module:'posting',account:null}),timeouts=useRealHiddenAccountWait(f);await started(f);
 f.bus.setService({enabled:false});await flush();
 assert.equal(f.workspace.active(),null);assert.equal(f.workspace.state().status,'stopped');assert.equal(f.starts.length,0);assert.equal(timeouts.size,0);
 assert.ok(!f.calls.some(c=>c.kind==='WORKER_REPORT'&&c.code==='ACCOUNT_NOT_READY'));await f.close();
});

test('only the assigned worker publishes distinct progress; repeated DOM countdown ticks never write another heartbeat',async()=>{
 const f=await started(fixture({module:'notifications',path:'/me'}));
 const query=f.context.document.querySelector;let status='下次回帖 100.0 秒';
 f.context.document.querySelector=selector=>selector.includes('[data-status=')?{textContent:status}:query(selector);
 const patches=()=>f.calls.filter(x=>x.action==='patch'&&x.patch?.activity);
 await f.tick(500);assert.equal(patches().length,1);assert.equal(patches()[0].patch.activity.step,'下次回帖');assert.equal(patches()[0].patch.activity.until,DAY+100000);assert.equal(patches()[0].runId,'notifications-1');
 for(let i=1;i<10;i++){f.setNow(DAY+i*1000);status='下次回帖 '+(100-i)+'.0 秒';await f.tick(500);}
 assert.equal(patches().length,1);
 f.workspace.progress('等待回复输入框');await flush();assert.equal(patches().length,2);assert.equal(patches().at(-1).patch.activity.step,'等待回复输入框');
 await f.tick(500);assert.equal(patches().length,2); // last displayed countdown must not erase the explicit stage
 f.workspace.progress('核对回复目标');f.workspace.progress('等待发送按钮');await flush();assert.equal(patches().length,2);
 f.setNow(DAY+12000);await f.tick(500);assert.equal(patches().length,3);assert.equal(patches().at(-1).patch.activity.step,'等待发送按钮');
 await f.close();f.workspace.progress('旧文档迟到更新');await flush();assert.equal(patches().length,3);
 const browse=await started(fixture());browse.workspace.progress('伪造更新');await flush();assert.ok(!browse.calls.some(x=>x.action==='patch'));await browse.close();
});
test('one-round local scope rejects posting, finished modules and expiry immediately',async()=>{
 const bus=makeBus();bus.data[KEY].trial={expiresAt:DAY+30000,pending:{posting:true,interaction:true,notifications:true}};
 const p=await started(fixture({module:'posting',tabId:1,bus}));assert.equal(p.starts.length,0);
 const i=await started(fixture({module:'interaction',tabId:2,path:'/search?q=hi',bus}));assert.equal(i.starts.length,1);
 i.setNow(DAY+30000);assert.throws(()=>i.workspace.check(),{code:'SERVICE_PAUSED'});await i.tick(500);assert.equal(i.workspace.active(),null);
 const n=await started(fixture({module:'notifications',tabId:3,path:'/me',bus}));assert.equal(n.starts.length,1);
 bus.setService({trial:{expiresAt:DAY+30000,pending:{interaction:true,notifications:false}}});await flush();assert.equal(n.workspace.active(),null);assert.equal(n.starts.length,1);
 await Promise.all([p.close(),i.close(),n.close()]);
});
test('driver terminal reports preserve their actual error code and explicit submission evidence',async()=>{
 const f=await started(fixture({module:'notifications',path:'/me'}));
 await f.emit('x-assistant-module-state',{module:'notifications',running:false,error:'平台响应未确认，保留当前编辑器',code:'SEND_UNKNOWN',submitted:true,confirmed:false});await flush();
 const report=f.calls.find(x=>x.kind==='WORKER_REPORT'&&x.code==='SEND_UNKNOWN');assert.ok(report);assert.equal(report.submitted,true);assert.equal(report.confirmed,false);await f.close();
});
test('retirement cancels guard/poll timers, and a delayed poll or SERVICE_SYNC cannot restart the retired document',async()=>{
 const pending=deferred();
 const f=await started(fixture({module:'interaction',path:'/search?q=friends',poll:()=>pending.promise}));const old=f.assignment();
 f.emit('x-assistant-invalidate',{code:'EXTENSION_CONTEXT_INVALIDATED',reason:'旧页面已退役'});
 assert.equal(f.timers.size,0);const polls=f.calls.filter(m=>m.kind==='WORKER_POLL').length;
 pending.resolve(old);await flush();await f.sync();await f.tick();
 assert.equal(f.workspace.active(),null);assert.equal(f.starts.length,0);assert.equal(f.calls.filter(m=>m.kind==='WORKER_POLL').length,polls);
});
test('a sync arriving during a rejected initial hello cannot arm timers or enqueue more refreshes',async()=>{
 const f=fixture({module:'posting',helloError:Error('stale document')});
 const msg=f.sync();await assert.rejects(f.workspace.ready,/stale document/);await msg;await f.sync();
 assert.equal(f.calls.filter(m=>m.kind==='WORKSPACE_HELLO').length,1);assert.ok(!f.calls.some(m=>m.kind==='WORKER_POLL'));assert.equal(f.timers.size,0);
});

test('followback starts only in its assigned owner list, throughout the posting rest window and without AI',async()=>{
 const opts={module:'followback',path:'/me/verified_followers',now:MIDNIGHT,aiCheck:()=>assert.fail('followback must not request an AI key')};
 const selected={posting:false,interaction:false,notifications:false,followback:true},bus=makeBus({selected});
 const f=await started(fixture({...opts,bus}));assert.deepEqual(f.starts,['followback']);assert.equal(f.workspace.active(),'followback');
 await f.navigate('/someone/verified_followers');assert.equal(f.workspace.active(),null);assert.ok(f.calls.some(m=>m.kind==='WORKER_REPORT'&&m.code==='PAGE_CHANGED'));await f.close();
 for(const [path,account,code] of [['/me/followers','/me','PAGE_CHANGED'],['/someone/verified_followers','/me','PAGE_CHANGED'],['/me/verified_followers','/other','ACCOUNT_CHANGED']]){
  const wrong=await started(fixture({...opts,path,account,bus:makeBus({selected})}));
  assert.deepEqual(wrong.starts,[]);assert.ok(wrong.calls.some(m=>m.kind==='WORKER_REPORT'&&m.code===code));await wrong.close();
 }
});
test('followback will not run while disabled, from diagnostics, with media drafts, or with an uncertain runtime',async()=>{
 const base={module:'followback',path:'/me/verified_followers'};
 for(const variant of ['disabled','diagnostic','draft','unknown']){
  const bus=makeBus({selected:{followback:variant!=='disabled'}});
  if(variant==='diagnostic')bus.data[KEY].trial={expiresAt:DAY+60000,pending:{followback:true}};
  if(variant==='unknown')bus.setRuntime('followback',{active:false,phase:'unknown'});
  const f=fixture({...base,bus});
  if(variant==='draft')f.context.document.querySelectorAll=k=>k.includes('input[type="file"]')?[{files:[{}]}]:[];
  await started(f);assert.deepEqual(f.starts,[]);assert.ok(!f.calls.some(m=>m.kind==='AI_CHECK'));
  if(variant==='draft')assert.ok(f.calls.some(m=>m.kind==='WORKER_REPORT'&&m.code==='RESIDUAL_DRAFT'));
  if(variant==='unknown')assert.ok(f.calls.some(m=>m.kind==='WORKER_REPORT'&&m.code==='SEND_UNKNOWN'&&m.submitted));
  await f.close();
 }
});
