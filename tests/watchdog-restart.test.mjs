import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedService,SERVICE_KEY,BOUNDARY_ALARM} from '../managed-service.mjs';
const at=iso=>Date.parse(iso);
function fixture(instant='2026-11-04T04:00:00Z',{posting=true,postingReady=async()=>true,prepareWorkerRepair=async()=>{},beforeGet=async()=>{},canRecoverPosting=async()=>false}={}){
 let time=at(instant),nextTab=10,nextId=0;const data={},tabs=new Map(),calls=[],runtimes={};
 if(posting!==null)data[SERVICE_KEY]={restartOnFailure:true,selected:{posting}};
 const service=createManagedService({now:()=>time,uuid:()=>`token-${++nextId}`,postingReady,prepareWorkerRepair,canRecoverPosting,retireMissingRun:async(module)=>{runtimes[module]={...runtimes[module],active:false,phase:['submitting','unknown'].includes(runtimes[module]?.phase)?'unknown':'stopped'};},read:async key=>structuredClone(data[key]),write:async(key,value)=>{data[key]=structuredClone(value);},runtimeFor:async module=>structuredClone(runtimes[module]||{}),
  tabs:{remove:async id=>{calls.push(['remove',id]);tabs.delete(id);},create:async options=>{calls.push(['create',options]);const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{await beforeGet(id);if(!tabs.has(id))throw Error('No tab with id: '+id+'.');return tabs.get(id);},update:async(id,options)=>{calls.push(['update',id,options]);assert.equal(Object.values(data[SERVICE_KEY].workers).some(w=>w.tabId===id),true,'ownership must be stored before navigation');if(!tabs.has(id))throw Error('missing');Object.assign(tabs.get(id),options);return tabs.get(id);},reload:async id=>{calls.push(['reload',id]);if(!tabs.has(id))throw Error('missing');Object.assign(tabs.get(id),{discarded:false,status:'loading'});return tabs.get(id);},sendMessage:(id,message)=>{calls.push(['notify',id,message]);return new Promise(()=>{});}},
  alarms:{create:async(name,options)=>calls.push(['alarm',name,options]),clear:async name=>calls.push(['clear',name])}
 });
 return{service,data,tabs,calls,runtimes,time:value=>time=at(value)};
}

for(const module of ['posting','interaction','notifications','followback'])test(module+' restarts failed page at 3 minutes, not before',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{[module]:true}}),w=s.workers[module];
 f.runtimes[module]={active:false,phase:'stopped',runId:'failed',owner:w.tabId,account:'/me',error:'failure'};
 s=await f.service.report(w.tabId,{module,token:w.token,status:'error',code:'NETWORK',error:'failure',submitted:false});
 assert.equal(s.workers[module].restartAt,Date.parse('2026-11-04T04:03:00Z'));
 f.time('2026-11-04T04:02:59.999Z');s=await f.service.reconcile();assert.equal(s.workers[module].tabId,w.tabId);assert.equal(f.calls.filter(c=>c[0]==='remove').length,0);
 f.time('2026-11-04T04:03:00Z');s=await f.service.reconcile();assert.notEqual(s.workers[module].tabId,w.tabId);assert.notEqual(s.workers[module].token,w.token);assert.equal(f.tabs.has(w.tabId),false);assert.equal(f.tabs.size,1);
 await Promise.all(Array.from({length:5},()=>f.service.reconcile()));assert.equal(f.tabs.size,1);
 await assert.rejects(f.service.report(w.tabId,{module,token:w.token,status:'running'}),/旧工作页/);
});
test('manual off cancels restart; normal cooldown never starts countdown',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}}),w=s.workers.notifications;
 f.runtimes.notifications={active:true,phase:'waiting',nextAt:Date.parse('2026-11-04T04:10:00Z')};await f.service.report(w.tabId,{module:'notifications',token:w.token,status:'running'});
 f.time('2026-11-04T04:04:00Z');await f.service.poll(w.tabId);s=await f.service.reconcile();assert.equal(s.workers.notifications.restartAt,undefined);
 f.runtimes.notifications={active:false,phase:'stopped',runId:'failure',error:'failure'};s=await f.service.reconcile();assert.ok(s.workers.notifications.restartAt);
 await f.service.set({selected:{notifications:false}});f.time('2026-11-04T04:20:00Z');s=await f.service.reconcile();assert.equal(f.tabs.has(w.tabId),true);assert.equal(s.workers.notifications.restartAt,undefined);
});
test('unknown send recreates page but never releases unknown runtime',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}}),w=s.workers.notifications;
 f.runtimes.notifications={active:false,phase:'unknown',runId:'u',owner:w.tabId,account:'/me'};
 await f.service.report(w.tabId,{module:'notifications',token:w.token,status:'blocked',code:'SEND_UNKNOWN',error:'unknown',submitted:true});
 f.time('2026-11-04T04:03:00Z');s=await f.service.reconcile();assert.notEqual(s.workers.notifications.tabId,w.tabId);assert.equal(f.runtimes.notifications.phase,'unknown');assert.equal((await f.service.assignment(s.workers.notifications.tabId)).shouldRun,false);
});
test('silent stopped run with live heartbeat still restarts',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}}),w=s.workers.notifications;
 f.runtimes.notifications={active:false,phase:'stopped',runId:'latched',error:'SEND_UNKNOWN'};await f.service.report(w.tabId,{module:'notifications',token:w.token,status:'stopped'});
 f.time('2026-11-04T04:03:00Z');await f.service.poll(w.tabId);s=await f.service.reconcile();assert.notEqual(s.workers.notifications.tabId,w.tabId);
});
test('deadline persists across supervisor polls and master off cancels it',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}}),w=s.workers.interaction;
 await f.service.report(w.tabId,{module:'interaction',token:w.token,status:'error',code:'NETWORK',error:'failure',submitted:false});
 const due=(await f.service.get()).workers.interaction.restartAt;
 f.time('2026-11-04T04:02:00Z');await f.service.poll(w.tabId);s=await f.service.reconcile();assert.equal(s.workers.interaction.restartAt,due);
 await f.service.set({enabled:false});f.time('2026-11-04T04:05:00Z');s=await f.service.reconcile();assert.equal(f.tabs.has(w.tabId),true);assert.equal(s.workers.interaction.restartAt,undefined);
});
test('missing worker is recreated once and disabled followback stays disabled',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}}),w=s.workers.notifications;
 f.tabs.delete(w.tabId);await f.service.removed(w.tabId);await f.service.reconcile();
 f.time('2026-11-04T04:03:00Z');s=await f.service.reconcile();assert.notEqual(s.workers.notifications.tabId,w.tabId);assert.equal(f.tabs.size,1);assert.equal(s.workers.followback,undefined);
});
test('platform rate limit survives page replacement and cannot authorize a send',async()=>{
 const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{posting:true}}),w=s.workers.posting;
 s=await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',code:'RATE_LIMIT',httpStatus:429,error:'rate limit',submitted:false});const until=s.postingRateLimits['/me'].until;
 f.time('2026-11-04T04:03:00Z');s=await f.service.reconcile();assert.equal(s.postingRateLimits['/me'].until,until);assert.equal(f.tabs.has(w.tabId),false);assert.equal(s.workers.posting.status,'retrying');assert.equal((await f.service.assignment(s.workers.posting.tabId)).shouldRun,false);
});
