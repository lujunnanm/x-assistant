import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedService,SERVICE_KEY,BOUNDARY_ALARM} from '../managed-service.mjs';
const at=iso=>Date.parse(iso);
function fixture(instant='2026-11-04T04:00:00Z',{posting=true,postingReady=async()=>true}={}){
 let time=at(instant),nextTab=10,nextId=0;const data={},tabs=new Map(),calls=[],runtimes={};
 if(posting!==null)data[SERVICE_KEY]={selected:{posting}};
 const service=createManagedService({now:()=>time,uuid:()=>`token-${++nextId}`,postingReady,read:async key=>structuredClone(data[key]),write:async(key,value)=>{data[key]=structuredClone(value);},runtimeFor:async module=>structuredClone(runtimes[module]||{}),
  tabs:{create:async options=>{calls.push(['create',options]);const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},update:async(id,options)=>{calls.push(['update',id,options]);assert.equal(Object.values(data[SERVICE_KEY].workers).some(w=>w.tabId===id),true,'ownership must be stored before navigation');if(!tabs.has(id))throw Error('missing');Object.assign(tabs.get(id),options);return tabs.get(id);},sendMessage:(id,message)=>{calls.push(['notify',id,message]);return new Promise(()=>{});}},
  alarms:{create:async(name,options)=>calls.push(['alarm',name,options]),clear:async name=>calls.push(['clear',name])}
 });
 return{service,data,tabs,calls,runtimes,time:value=>time=at(value)};
}
test('legacy state has posting off; optional modules can start without it',async()=>{
 const f=fixture(undefined,{posting:null});let s=await f.service.get();assert.deepEqual(s.selected,{posting:false,interaction:false,notifications:false,followback:false});
 s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});
 assert.equal(s.selected.posting,false);assert.deepEqual(Object.keys(s.workers),['interaction']);assert.equal(f.tabs.size,1);
 await assert.rejects(f.service.authorize(s.workers.interaction.tabId,'posting','/me'),e=>e.code==='NOT_MANAGED_WORKER');
});
test('empty posting library blocks only posting opt-in without changing other modules',async()=>{
 const f=fixture(undefined,{posting:false,postingReady:async()=>false});let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}});
 assert.deepEqual(Object.keys(s.workers),['notifications']);
 await assert.rejects(f.service.set({selected:{posting:true}}),e=>e.code==='POST_LIBRARY_EMPTY');
 s=await f.service.get();assert.equal(s.selected.posting,false);assert.deepEqual(Object.keys(s.workers),['notifications']);
});
test('selected posting creates nothing until master is enabled; switch can revoke it independently',async()=>{
 const f=fixture();let s=await f.service.get();assert.equal(s.enabled,false);assert.deepEqual(s.selected,{posting:true,interaction:false,notifications:false,followback:false});
 await f.service.set({selected:{interaction:true}});assert.equal(f.tabs.size,0);
 s=await f.service.set({enabled:true,account:'/Me'});assert.equal(s.account,'/me');assert.equal(f.tabs.size,2);assert.ok(s.workers.posting);assert.ok(s.workers.interaction);assert.equal(s.workers.notifications,undefined);
 assert.equal(f.calls.find(c=>c[0]==='create')[1].url,'about:blank');assert.ok(f.calls.filter(c=>c[0]==='update').every(c=>c[2].active===false));
 s=await f.service.set({selected:{posting:false}});assert.equal(s.selected.posting,false);assert.equal((await f.service.assignment(s.workers.posting.tabId)).reason,'MODULE_DISABLED');
});
test('selected patch merges, enabling all modules creates exactly three owned tabs',async()=>{
 const f=fixture();await f.service.set({selected:{interaction:true}});await f.service.set({selected:{notifications:true}});
 const s=await f.service.set({enabled:true,account:'/me'});assert.deepEqual(s.selected,{posting:true,interaction:true,notifications:true,followback:false});assert.equal(f.tabs.size,3);
 await Promise.all(Array.from({length:8},()=>f.service.reconcile()));assert.equal(f.tabs.size,3);
 await f.service.set({selected:{interaction:false}});assert.equal((await f.service.assignment(s.workers.interaction.tabId)).shouldRun,false);assert.equal((await f.service.assignment(s.workers.posting.tabId)).shouldRun,true);
});
test('night activation waits for Beijing 06 and midnight stops permission without resetting enabled',async()=>{
 const f=fixture('2026-11-03T21:59:59.999Z');await f.service.set({enabled:true,account:'/me'});assert.equal(f.tabs.size,0);
 f.time('2026-11-03T22:00:00Z');let s=await f.service.reconcile();assert.equal(f.tabs.size,1);const id=s.workers.posting.tabId;await f.service.poll(id);assert.equal((await f.service.assignment(id)).shouldRun,true);
 f.runtimes.posting={active:true,phase:'submitting'};assert.equal((await f.service.assignment(id)).shouldRun,true,'in-flight submission is not a stopped unknown');
 f.time('2026-11-04T16:00:00Z');s=await f.service.reconcile();assert.equal(s.enabled,true);assert.equal(s.status,'resting');assert.equal((await f.service.assignment(id)).reason,'OUTSIDE_WORKING_HOURS');assert.equal(f.runtimes.posting.active,true,'driver may drain existing receipt');
 assert.equal(f.calls.filter(c=>c[0]==='alarm'&&c[1]===BOUNDARY_ALARM).at(-1)[2].when,at('2026-11-04T22:00:00Z'));
 f.runtimes.posting={active:false,phase:'stopped'};f.time('2026-11-04T22:00:00Z');await f.service.reconcile();assert.equal(f.tabs.size,1);assert.equal((await f.service.assignment(id)).shouldRun,true);
});
test('closing a worker is not permission to respawn; repair creates a new owned page',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 f.tabs.delete(old.tabId);await f.service.removed(old.tabId);await f.service.reconcile();assert.equal(f.tabs.size,0);assert.equal((await f.service.get()).workers.posting.status,'missing');
 s=await f.service.repair('posting');assert.equal(f.tabs.size,1);assert.notEqual(s.workers.posting.token,old.token);assert.notEqual(s.workers.posting.tabId,old.tabId);
 await assert.rejects(f.service.report(old.tabId,{module:'posting',token:old.token,status:'running'}),/旧工作页/);
});
test('manual worker navigation is blocked and repair never navigates the repurposed page',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 await f.service.updated(old.tabId,{url:'https://example.com'});assert.equal((await f.service.assignment(old.tabId)).reason,'PAGE_CHANGED');
 const changes=f.calls.filter(c=>c[0]==='update'&&c[1]===old.tabId).length;s=await f.service.repair('posting');
 assert.equal(f.calls.filter(c=>c[0]==='update'&&c[1]===old.tabId).length,changes);assert.notEqual(s.workers.posting.tabId,old.tabId);
});
test('unknown submission prevents task creation, automatic retry and repair until reviewed',async()=>{
 const f=fixture();f.runtimes.posting={active:false,phase:'unknown'};let s=await f.service.set({enabled:true,account:'/me'});
 assert.equal(f.tabs.size,0);assert.equal(s.workers.posting.code,'SEND_UNKNOWN');await assert.rejects(f.service.repair('posting'),/核对/);
 f.runtimes.posting={active:false,phase:'stopped'};s=await f.service.repair('posting');assert.equal(f.tabs.size,1);
 const w=s.workers.posting;f.runtimes.posting={active:false,phase:'unknown'};await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'network failure',code:'NETWORK',submitted:false});
 assert.equal((await f.service.get()).workers.posting.status,'blocked');
});
test('only proven pre-submit network errors receive three bounded retries',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),w=s.workers.posting;
 for(let attempt=1;attempt<=4;attempt++){
  const state=await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'fetch failed',code:'NETWORK',submitted:false});
  assert.equal(state.workers.posting.status,attempt<=3?'retrying':'blocked');
  if(attempt<=3){assert.equal((await f.service.assignment(w.tabId)).reason,'RETRY_WAIT');const next=state.workers.posting.retryAt;f.time(new Date(next).toISOString());assert.equal((await f.service.assignment(w.tabId)).shouldRun,true);assert.equal((await f.service.assignment(w.tabId)).retryAt,next);await f.service.report(w.tabId,{module:'posting',token:w.token,status:'running'});}
 }
 const repaired=await f.service.repair('posting'),fresh=repaired.workers.posting;
 await f.service.report(fresh.tabId,{module:'posting',token:fresh.token,status:'error',error:'fetch failed',code:'NETWORK'});assert.equal((await f.service.get()).workers.posting.status,'blocked','missing pre-submit proof never retries');
});
test('late stopped report never clears a block or retry deadline',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),w=s.workers.posting;
 await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'fetch failed',code:'NETWORK',submitted:false});const retry=(await f.service.get()).workers.posting.retryAt;
 await f.service.report(w.tabId,{module:'posting',token:w.token,status:'stopped'});assert.equal((await f.service.get()).workers.posting.retryAt,retry);
});
test('global disable succeeds despite missing or changed account and never waits on worker acknowledgement',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'});const result=await Promise.race([f.service.set({enabled:false,account:null}),new Promise((_,reject)=>setTimeout(()=>reject(Error('deadlock')),100))]);
 assert.equal(result.enabled,false);assert.equal(result.account,'/me');assert.equal((await f.service.assignment(s.workers.posting.tabId)).reason,'SERVICE_DISABLED');
});
test('disabled repair clears ownership without opening or restarting any worker',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 await f.service.report(old.tabId,{module:'posting',token:old.token,status:'blocked',error:'draft',code:'RESIDUAL_DRAFT'});await f.service.set({enabled:false});const count=f.calls.filter(c=>c[0]==='create').length;
 await f.service.repair('posting');assert.equal(f.calls.filter(c=>c[0]==='create').length,count);assert.equal(await f.service.assignment(old.tabId),null);
});
test('startup resets enabled while preserving optional choices and never resumes sending',async()=>{
 const f=fixture();await f.service.set({enabled:true,account:'/me',selected:{notifications:true}});const s=await f.service.recover({clearWorkers:true});
 assert.equal(s.enabled,false);assert.equal(s.selected.notifications,true);assert.deepEqual(s.workers,{});await f.service.reconcile();assert.equal((await f.service.get()).enabled,false);
});
test('authorization rejects ordinary tabs, wrong module, wrong account and resting window',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),id=s.workers.posting.tabId;
 await assert.rejects(f.service.authorize(99,'posting','/me'),e=>e.code==='NOT_MANAGED_WORKER');await assert.rejects(f.service.authorize(id,'interaction','/me'));
 await assert.rejects(f.service.authorize(id,'posting','/other'),e=>e.code==='ACCOUNT_CHANGED');assert.equal((await f.service.authorize(id,'posting','/ME')).shouldRun,true);
 f.time('2026-11-04T16:00:00Z');await assert.rejects(f.service.authorize(id,'posting','/me'),e=>e.code==='OUTSIDE_WORKING_HOURS');
});
test('a previously healthy but frozen worker is surfaced without releasing ownership or respawning',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),w=s.workers.posting;
 await f.service.poll(w.tabId);f.runtimes.posting={active:true,phase:'waiting'};f.time('2026-11-04T04:03:01Z');
 const stale=await f.service.reconcile();assert.equal(stale.workers.posting.code,'WORKER_UNRESPONSIVE');assert.equal(stale.workers.posting.tabId,w.tabId);assert.equal(f.tabs.size,1);assert.equal(f.runtimes.posting.active,true);
});
test('normal authorization withdrawal never erases a human-action block',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),w=s.workers.posting;
 await f.service.report(w.tabId,{module:'posting',token:w.token,status:'blocked',code:'RESIDUAL_DRAFT',error:'user draft'});
 await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',code:'SERVICE_DISABLED',error:'disabled',submitted:false});
 assert.equal((await f.service.get()).workers.posting.code,'RESIDUAL_DRAFT');
});

test('night activation starts selected interaction and notifications but defers posting until 06',async()=>{
 const f=fixture('2026-11-04T16:00:00Z');let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 assert.deepEqual(Object.keys(s.workers).sort(),['interaction','notifications']);assert.equal(f.tabs.size,2);assert.equal(s.postingWorking,false);assert.equal(s.working,true);assert.equal(s.status,'working');assert.equal(s.window.working,false);
 const ids={interaction:s.workers.interaction.tabId,notifications:s.workers.notifications.tabId};
 for(const [module,id] of Object.entries(ids)){assert.equal((await f.service.authorize(id,module,'/me')).shouldRun,true);await f.service.poll(id);}
 f.time('2026-11-04T21:59:59.999Z');await Promise.all([f.service.reconcile(),f.service.reconcile()]);assert.equal(f.tabs.size,2);
 f.time('2026-11-04T22:00:00Z');s=await f.service.reconcile();assert.equal(f.tabs.size,3);assert.equal(s.postingWorking,true);assert.equal((await f.service.authorize(s.workers.posting.tabId,'posting','/me')).shouldRun,true);
 for(const [module,id] of Object.entries(ids))assert.equal(s.workers[module].tabId,id,'06 does not replace an all-day worker');
});
test('midnight revokes only posting while selected workers retain permission and master stop revokes all',async()=>{
 const f=fixture('2026-11-04T15:59:59Z');let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 for(const [module,w] of Object.entries(s.workers)){const {sourceMode}=await f.service.poll(w.tabId);f.runtimes[module]={active:true,phase:'waiting',sourceMode};}
 f.time('2026-11-04T16:00:00Z');s=await f.service.reconcile();assert.equal(s.status,'working');assert.equal(f.tabs.size,3);
 await assert.rejects(f.service.authorize(s.workers.posting.tabId,'posting','/me'),e=>e.code==='OUTSIDE_WORKING_HOURS');
 for(const module of ['interaction','notifications']){const w=s.workers[module];assert.equal((await f.service.authorize(w.tabId,module,'/me')).shouldRun,true);assert.equal((await f.service.report(w.tabId,{module,token:w.token,status:'running'})).workers[module].status,'running');}
 await f.service.set({enabled:false});for(const [module,w] of Object.entries(s.workers))await assert.rejects(f.service.authorize(w.tabId,module,'/me'),e=>e.code==='SERVICE_DISABLED');
});
test('night selections and repair create only eligible workers without reopening closed pages automatically',async()=>{
 const f=fixture('2026-11-04T19:00:00Z');await f.service.set({enabled:true,account:'/me'});assert.equal(f.tabs.size,0);assert.equal((await f.service.get()).status,'resting');
 let s=await f.service.set({selected:{interaction:true}});const old=s.workers.interaction;assert.equal(f.tabs.size,1);
 f.tabs.delete(old.tabId);await f.service.removed(old.tabId);await f.service.reconcile();assert.equal(f.tabs.size,0);
 s=await f.service.repair('interaction');assert.equal(f.tabs.size,1);assert.notEqual(s.workers.interaction.token,old.token);
 await f.service.repair('posting');assert.equal(f.tabs.size,1);assert.equal((await f.service.get()).workers.posting,undefined);
 await f.service.set({selected:{notifications:true}});assert.equal(f.tabs.size,2);
 await f.service.set({selected:{interaction:false}});assert.equal((await f.service.assignment(s.workers.interaction.tabId)).reason,'MODULE_DISABLED');
});
test('night startup still requires explicit master enable and keeps uncertain replies blocked',async()=>{
 const f=fixture('2026-11-04T18:00:00Z');await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 f.runtimes.notifications={active:false,phase:'unknown'};await f.service.recover({clearWorkers:true});let s=await f.service.reconcile();assert.equal(s.enabled,false);assert.deepEqual(s.workers,{});
 s=await f.service.set({enabled:true});assert.equal(s.workers.posting,undefined);assert.equal(s.workers.interaction.status,'starting');assert.equal(s.workers.notifications.code,'SEND_UNKNOWN');
 await assert.rejects(f.service.repair('notifications'),e=>e.code==='SEND_UNKNOWN');
});

test('only a diagnostic assignment carries the finite single-round scan flag',async()=>{
 const f=fixture(),s=await f.service.trialStart('/me','test-request-01',at('2026-11-04T04:00:00Z'));
 for(const worker of Object.values(s.workers))assert.equal((await f.service.assignment(worker.tabId)).singleRound,true);
 const ordinary=fixture(),normal=await ordinary.service.set({enabled:true,account:'/me',selected:{interaction:true}});
 assert.equal((await ordinary.service.assignment(normal.workers.interaction.tabId)).singleRound,undefined);
});

test('late diagnostic cannot start and replaying an acknowledged request cannot start a second cycle',async()=>{
 const f=fixture(),t=at('2026-11-04T04:00:00Z'),start=(n,ts)=>f.service.trialStart('/me',n,ts);
 await assert.rejects(start('test-request-late',t-16000),e=>e.code==='TRIAL_REQUEST_EXPIRED');assert.equal(f.tabs.size,0);
 const s=await start('test-request-same',t);assert.equal((await start('test-request-same',t)).trial.id,s.trial.id);
 await f.service.set({enabled:false});const again=await start('test-request-same',t);assert.equal(again.enabled,false);assert.equal(f.tabs.size,2);
});

test('a diagnostic for only the module still needing verification cannot restart a completed sibling or authorize posting',async()=>{
 const f=fixture(),t=at('2026-11-04T04:00:00Z');
 await assert.rejects(f.service.trialStart('/me','invalid-only-module',t,'posting'),e=>e.code==='TRIAL_MODULE_INVALID');
 const s=await f.service.trialStart('/me','only-notifications',t,'notifications');assert.deepEqual(Object.keys(s.workers),['notifications']);
 await f.service.trialDone('notifications',s.workers.notifications.tabId,'sample');const done=await f.service.get();assert.equal(done.enabled,false);assert.deepEqual(Object.keys(done.lastTrial.results),['notifications']);
});
