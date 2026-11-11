import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedService,SERVICE_KEY,BOUNDARY_ALARM} from '../managed-service.mjs';
const at=iso=>Date.parse(iso);
function fixture(instant='2026-11-04T04:00:00Z',{posting=true,postingReady=async()=>true,prepareWorkerRepair=async()=>{},beforeGet=async()=>{}}={}){
 let time=at(instant),nextTab=10,nextId=0;const data={},tabs=new Map(),calls=[],runtimes={};
 if(posting!==null)data[SERVICE_KEY]={selected:{posting}};
 const service=createManagedService({now:()=>time,uuid:()=>`token-${++nextId}`,postingReady,prepareWorkerRepair,read:async key=>structuredClone(data[key]),write:async(key,value)=>{data[key]=structuredClone(value);},runtimeFor:async module=>structuredClone(runtimes[module]||{}),
  tabs:{create:async options=>{calls.push(['create',options]);const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{await beforeGet(id);if(!tabs.has(id))throw Error('No tab with id: '+id+'.');return tabs.get(id);},update:async(id,options)=>{calls.push(['update',id,options]);assert.equal(Object.values(data[SERVICE_KEY].workers).some(w=>w.tabId===id),true,'ownership must be stored before navigation');if(!tabs.has(id))throw Error('missing');Object.assign(tabs.get(id),options);return tabs.get(id);},sendMessage:(id,message)=>{calls.push(['notify',id,message]);return new Promise(()=>{});}},
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
test('overnight activation starts posting immediately and midnight never revokes permission',async()=>{
 const f=fixture('2026-11-03T21:59:59.999Z');let s=await f.service.set({enabled:true,account:'/me'});assert.equal(f.tabs.size,1);const id=s.workers.posting.tabId;
 f.time('2026-11-03T22:00:00Z');s=await f.service.reconcile();assert.equal(f.tabs.size,1);await f.service.poll(id);assert.equal((await f.service.assignment(id)).shouldRun,true);
 f.runtimes.posting={active:true,phase:'submitting'};assert.equal((await f.service.assignment(id)).shouldRun,true,'in-flight submission is not a stopped unknown');
 f.time('2026-11-04T16:00:00Z');await f.service.poll(id);s=await f.service.reconcile();assert.equal(s.enabled,true);assert.equal(s.status,'working');assert.equal((await f.service.assignment(id)).shouldRun,true);assert.equal(f.runtimes.posting.active,true);
 assert.equal(f.calls.filter(c=>c[0]==='alarm'&&c[1]===BOUNDARY_ALARM).at(-1)[2].when,at('2026-11-05T16:00:00Z'));
 f.runtimes.posting={active:false,phase:'stopped'};f.time('2026-11-04T22:00:00Z');await f.service.reconcile();assert.equal(f.tabs.size,1);assert.equal((await f.service.assignment(id)).shouldRun,true);
});
test('closing a worker is not permission to respawn; repair creates a new owned page',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 f.tabs.delete(old.tabId);await f.service.removed(old.tabId);await f.service.reconcile();assert.equal(f.tabs.size,0);assert.equal((await f.service.get()).workers.posting.status,'missing');
 s=await f.service.repair('posting');assert.equal(f.tabs.size,1);assert.notEqual(s.workers.posting.token,old.token);assert.notEqual(s.workers.posting.tabId,old.tabId);
 await assert.rejects(f.service.report(old.tabId,{module:'posting',token:old.token,status:'running'}),/旧工作页/);
});
test('explicit repair restores the same existing worker tab instead of opening another',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 await f.service.updated(old.tabId,{url:'https://example.com'});assert.equal((await f.service.assignment(old.tabId)).reason,'PAGE_CHANGED');
 const changes=f.calls.filter(c=>c[0]==='update'&&c[1]===old.tabId).length;s=await f.service.repair('posting');
 assert.equal(f.calls.filter(c=>c[0]==='update'&&c[1]===old.tabId).length,changes+1);assert.equal(s.workers.posting.tabId,old.tabId);assert.equal(f.tabs.size,1);
});
test('unknown submission prevents task creation, automatic retry and repair until reviewed',async()=>{
 const f=fixture();f.runtimes.posting={active:false,phase:'unknown'};let s=await f.service.set({enabled:true,account:'/me'});
 assert.equal(f.tabs.size,0);assert.equal(s.workers.posting.code,'SEND_UNKNOWN');await assert.rejects(f.service.repair('posting'),/核对/);
 f.runtimes.posting={active:false,phase:'stopped'};s=await f.service.repair('posting');assert.equal(f.tabs.size,1);
 const w=s.workers.posting;f.runtimes.posting={active:false,phase:'unknown'};await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'network failure',code:'NETWORK',submitted:false});
 assert.equal((await f.service.get()).workers.posting.status,'blocked');
});
test('未知回关会创建原模块核对页，自动复核后原页直接恢复',async()=>{
 const f=fixture(undefined,{posting:false});f.runtimes.followback={active:false,phase:'unknown'};
 let s=await f.service.set({enabled:true,account:'/me',selected:{followback:true}});const worker=s.workers.followback;
 assert.equal(f.tabs.size,1);assert.equal(worker.code,'SEND_UNKNOWN');assert.equal((await f.service.assignment(worker.tabId)).reason,'SEND_UNKNOWN');
 f.runtimes.followback={active:false,phase:'stopped'};s=await f.service.reconcile();assert.equal(s.workers.followback.tabId,worker.tabId);assert.equal(s.workers.followback.status,'stopped');assert.equal((await f.service.assignment(worker.tabId)).shouldRun,true);
});
test('ordinary failures restart in the original tab within one minute, repeatedly',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'}),w=s.workers.posting;
 const id=w.tabId;
 for(let attempt=1;attempt<=4;attempt++){
  s=await f.service.report(id,{module:'posting',token:w.token,status:'error',error:'页面加载超时',code:'NAVIGATION',submitted:false});
  assert.equal(s.workers.posting.status,'retrying');
  const next=s.workers.posting.retryAt;
  f.time(new Date(next-1).toISOString());await f.service.reconcile();assert.equal((await f.service.assignment(id)).reason,'RETRY_WAIT');
  f.time(new Date(next).toISOString());assert.equal((await f.service.assignment(id)).shouldRun,false);
  s=await f.service.reconcile();w=s.workers.posting;
  assert.equal(w.tabId,id);assert.equal(w.status,'starting');assert.equal(f.tabs.size,1);
 }
 await f.service.report(id,{module:'posting',token:w.token,status:'error',error:'fetch failed',code:'NETWORK'});
 assert.equal((await f.service.get()).workers.posting.status,'blocked');
});
test('rate limits persist for thirty minutes and a manual disable prevents restart',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const w=s.workers.posting;
 s=await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'Rate limit exceeded',code:'RATE_LIMIT',submitted:false});
 const next=s.workers.posting.retryAt;assert.equal(next-at('2026-11-04T04:00:00Z'),1800000);
 f.time(new Date(next-1).toISOString());await f.service.reconcile();assert.equal((await f.service.assignment(w.tabId)).reason,'RETRY_WAIT');
 await f.service.set({enabled:false});f.time(new Date(next+30000).toISOString());await f.service.reconcile();assert.equal((await f.service.assignment(w.tabId)).reason,'SERVICE_DISABLED');
});
test('confirmed return errors can recover but a draft at restart still blocks',async()=>{
 const f=fixture(undefined,{prepareWorkerRepair:async()=>{throw Object.assign(Error('草稿'),{code:'RESIDUAL_DRAFT'});}});
 let s=await f.service.set({enabled:true,account:'/me',selected:{notifications:true}});const w=s.workers.notifications;
 s=await f.service.report(w.tabId,{module:'notifications',token:w.token,status:'error',error:'原来源页地址或实际内容未恢复',code:'NAVIGATION',submitted:true,confirmed:true});
 assert.equal(s.workers.notifications.status,'retrying');f.time(new Date(s.workers.notifications.retryAt).toISOString());
 s=await f.service.reconcile();assert.equal(s.workers.notifications.code,'RESIDUAL_DRAFT');assert.equal(s.workers.notifications.status,'blocked');assert.equal(f.tabs.size,2);
});
test('confirmed interaction return failures retain automatic same-tab recovery',async()=>{
 const f=fixture(undefined,{posting:false});
 let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});const old=s.workers.interaction;
 f.runtimes.interaction={active:false,phase:'stopped',runId:'confirmed-run',receipt:{kind:'confirmed'}};
 s=await f.service.report(old.tabId,{module:'interaction',token:old.token,status:'error',code:'RETURN_UNVERIFIED',error:'无法核对返回路径',submitted:true,confirmed:true});
 assert.equal(s.workers.interaction.status,'retrying');
 assert.equal(s.workers.interaction.retryAt-at('2026-11-04T04:00:00Z'),30000);
 f.time(new Date(s.workers.interaction.retryAt).toISOString());s=await f.service.reconcile();
 assert.equal(s.workers.interaction.status,'starting');assert.equal(s.workers.interaction.tabId,old.tabId);
 assert.notEqual(s.workers.interaction.token,old.token);assert.equal(f.tabs.size,1);
 assert.deepEqual(f.runtimes.interaction.receipt,{kind:'confirmed'});
});
async function blockedInteraction({legacy=false,runtime={},code='RESIDUAL_DRAFT'}={}){
 let blocked=true,probes=0;
 const f=fixture(undefined,{posting:false,prepareWorkerRepair:async()=>{probes++;if(blocked)throw Object.assign(Error('原工作页需要处理'),{code});}});
 let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}}),w=s.workers.interaction;
 f.runtimes.interaction={active:false,phase:'stopped',account:'/me',owner:w.tabId,runId:'settled',...runtime};
 if(legacy)Object.assign(f.data[SERVICE_KEY].workers.interaction,{status:'blocked',code,error:'原工作页有未发送草稿',retryAt:null});
 else{
  s=await f.service.report(w.tabId,{module:'interaction',token:w.token,status:'error',code:'NAVIGATION',submitted:false,error:'页面暂未就绪'});
  f.time(new Date(s.workers.interaction.retryAt).toISOString());await f.service.reconcile();
 }
 return {...f,worker:w,clear:()=>{blocked=false;},probes:()=>probes};
}
test('interaction draft recovery rechecks at thirty seconds and resumes only the clean original tab',async()=>{
 const f=await blockedInteraction();const old=f.worker;
 assert.equal(f.probes(),1);await f.service.reconcile();assert.equal(f.probes(),1,'no recursive busy probe');
 f.time('2026-11-04T04:00:59.999Z');await f.service.reconcile();assert.equal(f.probes(),1);
 f.time('2026-11-04T04:01:00Z');let s=await f.service.reconcile();assert.equal(f.probes(),2);
 assert.equal(s.workers.interaction.status,'blocked');assert.equal(s.workers.interaction.token,old.token);
 assert.equal(f.calls.filter(c=>c[0]==='update').length,1,'real draft is never navigated away');
 f.clear();f.time('2026-11-04T04:01:30Z');s=await f.service.reconcile();
 assert.equal(f.probes(),3);assert.equal(s.workers.interaction.status,'starting');assert.equal(s.workers.interaction.tabId,old.tabId);
 assert.notEqual(s.workers.interaction.token,old.token);assert.equal(f.tabs.size,1);
 assert.equal(s.workers.interaction.draftRecheckAt,null);assert.equal(s.workers.interaction.draftRecovery,null);
 assert.equal((await f.service.assignment(old.tabId)).shouldRun,true);
});
test('legacy interaction draft blocks recover after a fresh same-owner settled-runtime proof',async()=>{
 for(const code of ['RESIDUAL_DRAFT','RESIDUAL_POPUP']){
  const f=await blockedInteraction({legacy:true,code});f.clear();const s=await f.service.reconcile();
  assert.equal(s.workers.interaction.status,'starting');assert.equal(s.workers.interaction.tabId,f.worker.tabId);assert.equal(f.tabs.size,1);
 }
});
test('draft recovery never bypasses an unknown send, active run, changed owner or unconfirmed submission',async()=>{
 for(const runtime of [{phase:'unknown'},{phase:'submitting'},{phase:'deleting'},{active:true},{owner:999},{account:'/other'},{submittedAt:'pending',receipt:null},{phase:'error'},{runId:null}]){
  const f=await blockedInteraction({legacy:true,runtime});f.clear();await f.service.reconcile();
  assert.equal(f.probes(),0,JSON.stringify(runtime));assert.equal(f.calls.filter(c=>c[0]==='update').length,1);assert.equal(f.tabs.size,1);
 }
});
test('master/module disable and one-round trials never auto-recover a draft block',async()=>{
 for(const change of [{enabled:false},{selected:{interaction:false}},{trial:{pending:{interaction:true},expiresAt:at('2026-11-04T05:00:00Z'),results:{},previousSelected:{interaction:false}}}]){
  const f=await blockedInteraction({legacy:true});f.clear();Object.assign(f.data[SERVICE_KEY],change);await f.service.reconcile();assert.equal(f.probes(),0);
 }
});
test('legacy draft recovery leaves unrelated manual, account and platform blocks alone',async()=>{
 for(const code of ['MANUAL_PAUSE','ACCOUNT_CHANGED','AUTH','FOLLOW_LIMIT','RESIDUAL_POPUP_OTHER','WORKER_UNRESPONSIVE']){
  const f=await blockedInteraction({legacy:true,code});f.clear();await f.service.reconcile();assert.equal(f.probes(),0);
 }
});
test('safe pre-start draft reports can recover without inventing a previous runtime',async()=>{
 for(const submitted of [false,true,undefined]){
  let probes=0;const f=fixture(undefined,{posting:false,prepareWorkerRepair:async()=>{probes++;}});
  let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});const w=s.workers.interaction;
  s=await f.service.report(w.tabId,{module:'interaction',token:w.token,status:'blocked',code:'RESIDUAL_DRAFT',error:'草稿',submitted});
  f.time('2026-11-04T04:00:30Z');s=await f.service.reconcile();
  assert.equal(probes,submitted===false?1:0);assert.equal(s.workers.interaction.status,submitted===false?'starting':'blocked');
 }
});
test('draft proof is invalidated by a different run and a newly unconfirmed receipt',async()=>{
 for(const change of [{runId:'different'},{submittedAt:'new-send',receipt:null}]){
  const f=await blockedInteraction();f.clear();Object.assign(f.runtimes.interaction,change);f.time('2026-11-04T04:01:30Z');
  const s=await f.service.reconcile();assert.equal(f.probes(),1);assert.equal(s.workers.interaction.status,'blocked');
 }
});
test('disappeared draft worker does not get replaced automatically',async()=>{
 const f=await blockedInteraction({legacy:true});f.clear();f.tabs.delete(f.worker.tabId);const s=await f.service.reconcile();
 assert.equal(f.probes(),0);assert.equal(f.tabs.size,0);assert.equal(s.workers.interaction.status,'missing');
});
test('a tab closed between lookup and automatic repair never spawns a replacement',async()=>{
 let reads=0;const f=fixture(undefined,{posting:false,beforeGet:async id=>{if(++reads===2)f.tabs.delete(id);}});
 let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});const w=s.workers.interaction;
 f.runtimes.interaction={active:false,phase:'stopped',account:'/me',owner:w.tabId,runId:'settled'};
 Object.assign(f.data[SERVICE_KEY].workers.interaction,{status:'blocked',code:'RESIDUAL_DRAFT'});
 s=await f.service.reconcile();assert.equal(f.tabs.size,0);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(s.workers.interaction.code,'WORKER_CLOSED');
});
test('a runtime changing during draft preflight cannot authorize navigation or a fresh token',async()=>{
 for(const change of [{phase:'unknown'},{active:true},{runId:'replacement'},{submittedAt:'pending',receipt:null}]){
  const f=fixture(undefined,{posting:false,prepareWorkerRepair:async()=>Object.assign(f.runtimes.interaction,change)});
  let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});const w=s.workers.interaction;
  f.runtimes.interaction={active:false,phase:'stopped',account:'/me',owner:w.tabId,runId:'settled'};
  Object.assign(f.data[SERVICE_KEY].workers.interaction,{status:'blocked',code:'RESIDUAL_DRAFT'});
  s=await f.service.reconcile();assert.equal(f.calls.filter(c=>c[0]==='update').length,1);assert.equal(s.workers.interaction.token,w.token);assert.equal(s.workers.interaction.status,'blocked');
 }
});
test('confirmed legacy receipt can recover without changing runtime, cooldown or search preference',async()=>{
 const f=await blockedInteraction({legacy:true,runtime:{submittedAt:'done',receipt:{kind:'confirmed'},nextAt:at('2026-11-04T04:10:00Z')}});
 f.tabs.get(f.worker.tabId).url='https://x.com/search?q=kept&f=live';
 const before=structuredClone(f.runtimes.interaction);f.clear();const s=await f.service.reconcile();assert.equal(s.workers.interaction.status,'starting');
 assert.deepEqual(f.runtimes.interaction,before);assert.equal(f.tabs.get(f.worker.tabId).url,'https://x.com/search?q=kept&f=live');assert.equal(f.tabs.size,1);
});
test('genuinely unverified unsent returns and unknown sends never become blanket retries',async()=>{
 for(const phase of ['stopped','unknown']){
  const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});const w=s.workers.interaction;
  f.runtimes.interaction={active:false,phase};
  s=await f.service.report(w.tabId,{module:'interaction',token:w.token,status:'error',code:'RETURN_UNVERIFIED',error:'返回路径缺少证据',submitted:false,confirmed:false});
  assert.equal(s.workers.interaction.status,'blocked');assert.equal(s.workers.interaction.retryAt,null);
  f.time('2026-11-04T04:05:00Z');s=await f.service.reconcile();
  assert.equal(s.workers.interaction.status,'blocked');assert.equal(s.workers.interaction.token,w.token);
 }
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
test('disabled repair preserves the original tab without opening or restarting any worker',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'});const old=s.workers.posting;
 await f.service.report(old.tabId,{module:'posting',token:old.token,status:'blocked',error:'draft',code:'RESIDUAL_DRAFT'});await f.service.set({enabled:false});const count=f.calls.filter(c=>c[0]==='create').length;
 await f.service.repair('posting');assert.equal(f.calls.filter(c=>c[0]==='create').length,count);assert.equal((await f.service.assignment(old.tabId)).reason,'SERVICE_DISABLED');
});
test('startup resets enabled while preserving optional choices and never resumes sending',async()=>{
 const f=fixture();await f.service.set({enabled:true,account:'/me',selected:{notifications:true}});const s=await f.service.recover({clearWorkers:true});
 assert.equal(s.enabled,false);assert.equal(s.selected.notifications,true);assert.deepEqual(s.workers,{});await f.service.reconcile();assert.equal((await f.service.get()).enabled,false);
});
test('authorization rejects ordinary tabs, wrong module and wrong account but remains valid overnight',async()=>{
 const f=fixture();const s=await f.service.set({enabled:true,account:'/me'}),id=s.workers.posting.tabId;
 await assert.rejects(f.service.authorize(99,'posting','/me'),e=>e.code==='NOT_MANAGED_WORKER');await assert.rejects(f.service.authorize(id,'interaction','/me'));
 await assert.rejects(f.service.authorize(id,'posting','/other'),e=>e.code==='ACCOUNT_CHANGED');assert.equal((await f.service.authorize(id,'posting','/ME')).shouldRun,true);
 f.time('2026-11-04T16:00:00Z');assert.equal((await f.service.authorize(id,'posting','/me')).shouldRun,true);
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

test('overnight activation starts every selected module immediately',async()=>{
 const f=fixture('2026-11-04T16:00:00Z');let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 assert.deepEqual(Object.keys(s.workers).sort(),['interaction','notifications','posting']);assert.equal(f.tabs.size,3);assert.equal(s.postingWorking,true);assert.equal(s.working,true);assert.equal(s.status,'working');assert.equal(s.window.working,true);
 const ids={posting:s.workers.posting.tabId,interaction:s.workers.interaction.tabId,notifications:s.workers.notifications.tabId};
 for(const [module,id] of Object.entries(ids)){assert.equal((await f.service.authorize(id,module,'/me')).shouldRun,true);await f.service.poll(id);}
 f.time('2026-11-04T21:59:59.999Z');await Promise.all([f.service.reconcile(),f.service.reconcile()]);assert.equal(f.tabs.size,3);
 f.time('2026-11-04T22:00:00Z');s=await f.service.reconcile();assert.equal(f.tabs.size,3);assert.equal(s.postingWorking,true);assert.equal((await f.service.authorize(s.workers.posting.tabId,'posting','/me')).shouldRun,true);
 for(const [module,id] of Object.entries(ids))assert.equal(s.workers[module].tabId,id,'time boundaries never replace an all-day worker');
});
test('midnight retains every selected module permission and master stop revokes all',async()=>{
 const f=fixture('2026-11-04T15:59:59Z');let s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 for(const [module,w] of Object.entries(s.workers)){const {sourceMode}=await f.service.poll(w.tabId);f.runtimes[module]={active:true,phase:'waiting',sourceMode};}
 f.time('2026-11-04T16:00:00Z');s=await f.service.reconcile();assert.equal(s.status,'working');assert.equal(f.tabs.size,3);
 for(const module of ['posting','interaction','notifications']){const w=s.workers[module];assert.equal((await f.service.authorize(w.tabId,module,'/me')).shouldRun,true);assert.equal((await f.service.report(w.tabId,{module,token:w.token,status:'running'})).workers[module].status,'running');}
 await f.service.set({enabled:false});for(const [module,w] of Object.entries(s.workers))await assert.rejects(f.service.authorize(w.tabId,module,'/me'),e=>e.code==='SERVICE_DISABLED');
});
test('overnight selections and repair keep eligible workers without reopening closed pages automatically',async()=>{
 const f=fixture('2026-11-04T19:00:00Z');await f.service.set({enabled:true,account:'/me'});assert.equal(f.tabs.size,1);assert.equal((await f.service.get()).status,'working');
 let s=await f.service.set({selected:{interaction:true}});const old=s.workers.interaction;assert.equal(f.tabs.size,2);
 f.tabs.delete(old.tabId);await f.service.removed(old.tabId);await f.service.reconcile();assert.equal(f.tabs.size,1);
 s=await f.service.repair('interaction');assert.equal(f.tabs.size,2);assert.notEqual(s.workers.interaction.token,old.token);
 const post=s.workers.posting;assert.equal(f.tabs.size,2);assert.equal((await f.service.get()).workers.posting.tabId,post.tabId);
 await f.service.set({selected:{notifications:true}});assert.equal(f.tabs.size,3);
 await f.service.set({selected:{interaction:false}});assert.equal((await f.service.assignment(s.workers.interaction.tabId)).reason,'MODULE_DISABLED');
});
test('overnight startup still requires explicit master enable and keeps uncertain replies blocked',async()=>{
 const f=fixture('2026-11-04T18:00:00Z');await f.service.set({enabled:true,account:'/me',selected:{interaction:true,notifications:true}});
 f.runtimes.notifications={active:false,phase:'unknown'};await f.service.recover({clearWorkers:true});let s=await f.service.reconcile();assert.equal(s.enabled,false);assert.deepEqual(s.workers,{});
 s=await f.service.set({enabled:true});assert.equal(s.workers.posting.status,'starting');assert.equal(s.workers.interaction.status,'starting');assert.equal(s.workers.notifications.code,'SEND_UNKNOWN');
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

test('all four modules repair in place with a new token and unchanged schedules',async()=>{
 const f=fixture();let s=await f.service.set({enabled:true,account:'/me',selected:{posting:true,interaction:true,notifications:true,followback:true}});
 f.data.xAssistantNotificationScheduleV1={'/me':{nextAt:987654321}};
 for(const module of ['posting','interaction','notifications','followback']){
  const old=s.workers[module];
  await f.service.report(old.tabId,{module,token:old.token,status:'blocked',code:'EDITOR_NOT_READY',error:'not ready'});
  s=await f.service.repair(module);
  assert.equal(s.workers[module].tabId,old.tabId);assert.notEqual(s.workers[module].token,old.token);
  assert.equal(s.workers[module].status,'starting');
  await assert.rejects(f.service.report(old.tabId,{module,token:old.token,status:'running'}),/旧工作页/);
 }
 assert.equal(f.calls.filter(c=>c[0]==='create').length,4);
 assert.equal(f.data.xAssistantNotificationScheduleV1['/me'].nextAt,987654321);
});
test('a draft on the original page blocks navigation without spawning an escape tab',async()=>{
 const f=fixture(undefined,{prepareWorkerRepair:async()=>{throw Error('草稿');}});
 const s=await f.service.set({enabled:true,account:'/me'}),old=s.workers.posting;
 const updates=f.calls.filter(c=>c[0]==='update').length;
 await assert.rejects(f.service.repair('posting'),/草稿/);
 assert.equal(f.tabs.size,1);assert.equal(f.calls.filter(c=>c[0]==='update').length,updates);
 assert.equal((await f.service.get()).workers.posting.token,old.token);
});
test('in-place interaction repair retains the current custom search keyword',async()=>{
 const f=fixture(undefined,{posting:false});const s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});
 const id=s.workers.interaction.tabId,url='https://x.com/search?q=custom&f=live';f.tabs.get(id).url=url;
 await f.service.repair('interaction');assert.equal(f.tabs.size,1);assert.equal(f.tabs.get(id).url,url);
});

test('each module keeps a rate deadline across repeated reports then repairs only its original tab',async()=>{
 for(const module of ['posting','interaction','notifications','followback']){
  const f=fixture(undefined,{posting:false});let s=await f.service.set({enabled:true,account:'/me',selected:{[module]:true}});const w=s.workers[module];
  const msg={module,token:w.token,status:'error',code:'RATE_LIMIT',error:'Too many requests',submitted:false};
  s=await f.service.report(w.tabId,msg);const due=s.workers[module].retryAt;
  f.time(new Date(due-1000).toISOString());s=await f.service.report(w.tabId,msg);assert.equal(s.workers[module].retryAt,due);
  await f.service.reconcile();assert.equal((await f.service.assignment(w.tabId)).shouldRun,false);
  f.time(new Date(due).toISOString());s=await f.service.reconcile();
  assert.equal(s.workers[module].status,'starting');assert.equal(s.workers[module].tabId,w.tabId);assert.notEqual(s.workers[module].token,w.token);assert.equal(f.tabs.size,1);
 }
});
test('a closed retry tab is not recreated and an unknown result discovered during waiting is not retried',async()=>{
 for(const missing of [true,false]){
  const f=fixture();let s=await f.service.set({enabled:true,account:'/me'});const w=s.workers.posting;
  s=await f.service.report(w.tabId,{module:'posting',token:w.token,status:'error',error:'timeout',code:'NETWORK',submitted:false});
  f.time(new Date(s.workers.posting.retryAt).toISOString());
  if(missing)f.tabs.delete(w.tabId);else f.runtimes.posting={active:false,phase:'unknown'};
  s=await f.service.reconcile();assert.equal(s.workers.posting.status,missing?'missing':'blocked');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
 }
});
