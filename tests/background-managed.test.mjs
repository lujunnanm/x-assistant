import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
const events={},event=name=>({addListener:fn=>events[name]=fn});
let stored={},clock=Date.parse('2026-11-04T04:00:00Z'),nextTab=10,readHook=null;
const tabs=new Map(),alarms=new Map(),calls=[];
globalThis.chrome={
 storage:{local:{get:async key=>{readHook?.(key);return {[key]:structuredClone(stored[key])};},set:async values=>Object.assign(stored,structuredClone(values))}},
 runtime:{id:'managed',getURL:path=>'chrome-extension://managed/'+path,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup'),openOptionsPage:async()=>{}},
 action:{onClicked:event('clicked')},
 tabs:{create:async options=>{calls.push(['create',options]);const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('No tab with id: '+id+'.');return tabs.get(id);},update:async(id,options)=>{calls.push(['update',id,options]);assert.ok(Object.values(stored.xAssistantManagedServiceV1.workers).some(w=>w.tabId===id));Object.assign(tabs.get(id),options);return tabs.get(id);},sendMessage:async(id,msg)=>calls.push(['notify',id,msg]),onRemoved:event('removed'),onReplaced:event('replaced'),onUpdated:event('updated')},
 alarms:{get:async name=>alarms.get(name),create:async(name,options)=>{calls.push(['alarm',name,options]);alarms.set(name,{...options,scheduledTime:options.when??clock+options.periodInMinutes*60000});},clear:async name=>alarms.delete(name),onAlarm:event('alarm')}
};
const realNow=Date.now;Date.now=()=>clock;await import('../background.js');Date.now=realNow;
const page=(id=1)=>({id:'managed',url:'https://x.com/home',tab:{id},frameId:0,documentId:'doc-'+id,documentLifecycle:'active'});
const panel={id:'managed',url:'chrome-extension://managed/panel.html'};
const send=(msg,sender=page())=>new Promise(resolve=>events.message({...msg,...(sender.tab?{instanceId:'instance-'+sender.tab.id}:{})},sender,resolve));
const hello=sender=>send({kind:'WORKSPACE_HELLO'},sender);
const rt=(module,action,extra,sender)=>send({kind:'RUNTIME',module,action,...(module==='interaction'&&action==='begin'?{sourceMode:'search'}:{}),...extra},sender);
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
async function enable(selected={}){await hello(page());const response=await send({kind:'SERVICE_SET',enabled:true,selected:{posting:true,...selected},account:'/me'});assert.equal(response.ok,true,response.error);for(const worker of Object.values(response.state.workers))await hello(page(worker.tabId));return response.state;}
beforeEach(()=>{stored={app:{rows:[{id:'post',type:'post',enabled:true,text:'legacy fixture'}],logs:[]},xAssistantPostingCopiesV1:{revision:1,rows:[{id:'post',enabled:true,text:'fixture'}]}};clock=Date.parse('2026-11-04T04:00:00Z');nextTab=10;readHook=null;tabs.clear();alarms.clear();calls.length=0;});

test('ordinary control page can toggle service but cannot run any module itself',async()=>{
 const service=await enable({interaction:true,notifications:true});assert.equal(tabs.size,3);
 for(const module of ['posting','interaction','notifications']){
  const denied=await rt(module,'begin',{account:'/me'},page());assert.equal(denied.ok,false);assert.equal(denied.code,'NOT_MANAGED_WORKER');
  const worker=page(service.workers[module].tabId),started=await rt(module,'begin',{account:'/me'},worker);assert.equal(started.ok,true,started.error);
 }
});
test('SERVICE_REPAIR reuses all four original tabs through the real background handler',async()=>{
 const s=await enable({interaction:true,notifications:true,followback:true}),saved=chrome.scripting;
 chrome.scripting={executeScript:async({target})=>[{result:{url:tabs.get(target.tabId).url,account:'/me',draft:false}}]};
 try{
  for(const module of ['posting','interaction','notifications','followback']){
   const old=s.workers[module];
   const response=await send({kind:'SERVICE_REPAIR',module});
   assert.equal(response.ok,true,response.error);assert.equal(response.state.workers[module].tabId,old.tabId);
   assert.notEqual(response.state.workers[module].token,old.token);
  }
  assert.equal(tabs.size,4);assert.equal(calls.filter(c=>c[0]==='create').length,4);
 }finally{chrome.scripting=saved;}
});
test('posting is opt-in and switching it off leaves selected interaction independent',async()=>{
 await hello(page());assert.equal((await send({kind:'SERVICE_SET',selected:{interaction:true}})).ok,true);assert.equal(tabs.size,0);
 assert.equal((await send({kind:'SERVICE_SET',selected:{posting:false}})).ok,true);
 const s=await send({kind:'SERVICE_SET',enabled:true,account:'/me'});assert.deepEqual(Object.keys(s.state.workers).sort(),['interaction']);
 assert.equal(s.state.selected.posting,false);
});
test('disabled copies do not block master start, but posting failure is actionable and does not alter the running service',async()=>{
 stored.xAssistantPostingCopiesV1.rows[0].enabled=false;
 await hello(page());await send({kind:'SERVICE_SET',selected:{posting:false,interaction:true,notifications:true},account:'/me'});
 const started=await send({kind:'SERVICE_SET',enabled:true,account:'/me'});assert.equal(started.ok,true);assert.equal(started.state.enabled,true);
 const before=structuredClone(stored.xAssistantManagedServiceV1),copies=structuredClone(stored.xAssistantPostingCopiesV1);
 const denied=await send({kind:'SERVICE_SET',selected:{posting:true},account:'/me'});
 assert.equal(denied.ok,false);assert.equal(denied.code,'POST_LIBRARY_EMPTY');assert.match(denied.error,/均已停用.*文案库.*启用/);
 assert.deepEqual(stored.xAssistantManagedServiceV1,before);assert.deepEqual(stored.xAssistantPostingCopiesV1,copies);
 assert.deepEqual(Object.keys(started.state.workers).sort(),['interaction','notifications']);
});
test('a truly empty library tells the user to add copy rather than claiming disabled rows',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[];await hello(page());
 const denied=await send({kind:'SERVICE_SET',selected:{posting:true},account:'/me'});
 assert.equal(denied.code,'POST_LIBRARY_EMPTY');assert.match(denied.error,/文案库为空.*添加/);assert.doesNotMatch(denied.error,/均已停用/);
});
test('a newly saved disabled producer row becomes enabled and posting can be selected with master safely off',async()=>{
 stored.xAssistantPostingCopiesV1={revision:0,rows:[]};
 const row={id:'new',text:'用户新文案',enabled:false};
 const saved=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:row.id,row,expected:null,expectedRevision:0}},panel);
 assert.equal(saved.ok,true);assert.equal(saved.state.rows[0].enabled,true);
 const selected=await send({kind:'SERVICE_SET',selected:{posting:true},account:'/me'},panel);
 assert.equal(selected.ok,true);assert.equal(selected.state.selected.posting,true);assert.equal(selected.state.enabled,false);assert.equal(tabs.size,0);
});
test('midnight permits a new posting submission and its confirmed receipt',async()=>{
 stored.xAssistantPostingCopiesV1.rows.push({id:'next',enabled:true,text:'next fixture'});
 const service=await enable(),worker=page(service.workers.posting.tabId);const start=await rt('posting','begin',{account:'/me'},worker),runId=start.state.runId;
 clock=Date.parse('2026-11-04T15:59:59Z');assert.equal((await rt('posting','patch',{runId,patch:{phase:'submitting',rowId:'post',text:'fixture',submittedAt:'2026-11-04T15:59:59Z'}},worker)).ok,true);
 clock=Date.parse('2026-11-04T16:00:00Z');const continued=await rt('posting','patch',{runId,patch:{phase:'submitting'}},worker);assert.equal(continued.ok,true,continued.error);
 const receipt=await rt('posting','patch',{runId,patch:{phase:'confirmed',receipt:{kind:'confirmed'}}},worker);assert.equal(receipt.ok,true,receipt.error);
 assert.equal((await rt('posting','stop',{runId},worker)).ok,true);
 const poll=await send({kind:'WORKER_POLL'},worker);assert.equal(poll.state.shouldRun,true);assert.equal(poll.state.reason,null);
 clock=Date.parse('2026-11-04T22:00:00Z');events.alarm({name:'x-assistant-service-boundary'});await flush();assert.equal((await send({kind:'WORKER_POLL'},worker)).state.shouldRun,true);assert.equal(tabs.size,1);
});
test('crossing midnight during asynchronous posting schedule read preserves reservation commit',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);const start=await rt('posting','begin',{account:'/me'},worker),runId=start.state.runId;
 clock=Date.parse('2026-11-04T15:59:59.999Z');readHook=key=>{if(key==='xAssistantPostSchedulesV1')clock=Date.parse('2026-11-04T16:00:00Z');};
 const response=await rt('posting','patch',{runId,patch:{phase:'submitting'}},worker);readHook=null;
 assert.equal(response.ok,true,response.error);assert.equal(stored.xAssistantPostingV1.phase,'submitting');
});
test('reply target claims and settlement continue across midnight',async()=>{
 const service=await enable({interaction:true}),worker=page(service.workers.interaction.tabId);const run=await rt('interaction','begin',{account:'/me'},worker),runId=run.state.runId;
 const binding={module:'interaction',runId,account:'/me',postId:'123'};const claim=await send({kind:'REPLY_CLAIM',...binding},worker);assert.equal(claim.state.claimed,true);
 clock=Date.parse('2026-11-04T16:00:00Z');assert.equal((await send({kind:'REPLY_CLAIM',...binding,postId:'124'},worker)).state.claimed,true);
 const settled=await send({kind:'REPLY_SETTLE',...binding,claimId:claim.state.claimId,outcome:'confirmed',receipt:{kind:'confirmed'}},worker);assert.equal(settled.ok,true);
});
test('legacy outside-window reports stop cleanly without poisoning later worker permission',async()=>{
 const service=await enable(),w=service.workers.posting;clock=Date.parse('2026-11-04T16:00:00Z');
 const report=await send({kind:'WORKER_REPORT',module:'posting',token:w.token,status:'error',code:'OUTSIDE_WORKING_HOURS',error:'resting',submitted:false},page(w.tabId));
 assert.equal(report.ok,true);assert.equal(report.state.workers.posting.status,'stopped');clock=Date.parse('2026-11-04T22:00:00Z');assert.equal((await send({kind:'WORKER_POLL'},page(w.tabId))).state.shouldRun,true);
});
test('repeated state reports and watchdog reconciliation never postpone the periodic watchdog',async()=>{
 const service=await enable(),w=service.workers.posting;const before=alarms.get('x-assistant-service-watchdog').scheduledTime;
 for(let i=0;i<4;i++){clock+=1000;await send({kind:'WORKER_REPORT',module:'posting',token:w.token,status:'stopped'},page(w.tabId));events.alarm({name:'x-assistant-service-watchdog'});await flush();}
 assert.equal(alarms.get('x-assistant-service-watchdog').scheduledTime,before);assert.equal(calls.filter(c=>c[0]==='alarm'&&c[1]==='x-assistant-service-watchdog').length,1);
});
test('closing a worker marks missing and alarms do not recreate it without explicit repair',async()=>{
 const service=await enable(),w=service.workers.posting;tabs.delete(w.tabId);events.removed(w.tabId);await flush();events.alarm({name:'x-assistant-service-watchdog'});await flush();
 assert.equal(tabs.size,0);assert.equal(stored.xAssistantManagedServiceV1.workers.posting.status,'missing');
 const repaired=await send({kind:'SERVICE_REPAIR',module:'posting'});assert.equal(repaired.ok,true);assert.equal(tabs.size,1);assert.notEqual(repaired.state.workers.posting.token,w.token);
});
test('startup keeps saved choices but disables service and all existing runs',async()=>{
 const service=await enable({interaction:true}),worker=page(service.workers.posting.tabId);await rt('posting','begin',{account:'/me'},worker);
 events.startup();await flush();assert.equal(stored.xAssistantManagedServiceV1.enabled,false);assert.equal(stored.xAssistantManagedServiceV1.selected.interaction,true);assert.equal(stored.xAssistantPostingV1.active,false);assert.deepEqual(stored.xAssistantManagedServiceV1.workers,{});
});
test('emergency stop disables new sends immediately but lets the owning worker drain its receipt',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);const start=await rt('posting','begin',{account:'/me'},worker),runId=start.state.runId;
 await rt('posting','patch',{runId,patch:{phase:'submitting',rowId:'post',text:'fixture',submittedAt:'2026-11-04T04:00:00Z'}},worker);assert.equal((await send({kind:'STOP_ALL'},panel)).ok,true);
 assert.equal(stored.xAssistantManagedServiceV1.enabled,false);assert.equal(stored.xAssistantPostingV1.active,true);
 assert.equal((await rt('posting','patch',{runId,patch:{phase:'submitting'}},worker)).code,'SERVICE_DISABLED');
 assert.equal((await rt('posting','patch',{runId,patch:{phase:'confirmed',receipt:{kind:'confirmed'}}},worker)).ok,true);await rt('posting','stop',{runId},worker);assert.equal(stored.xAssistantPostingV1.active,false);
});
test('shared non-like action gate enforces 23 seconds from ACK and follows also need 120 seconds',async()=>{
 const service=await enable({interaction:true,notifications:true});const p=page(service.workers.posting.tabId),i=page(service.workers.interaction.tabId),n=page(service.workers.notifications.tabId);
 const post=await rt('posting','begin',{account:'/me'},p),interaction=await rt('interaction','begin',{account:'/me'},i),notification=await rt('notifications','begin',{account:'/me'},n);
 const payload=(module,runId,actionKind)=>({module,runId,account:'/me',actionKind});
 const pb=payload('posting',post.state.runId,'post'),ib=payload('interaction',interaction.state.runId,'follow'),nb=payload('notifications',notification.state.runId,'reply');
 const t=clock,first=await send({kind:'ACTION_ACQUIRE',...pb},p);assert.equal(first.state.granted,true);
 assert.equal((await send({kind:'ACTION_ACQUIRE',...nb},n)).state.granted,false,'in-flight lease is exclusive');
 clock=t+2000;assert.equal((await send({kind:'ACTION_SETTLE',...pb,leaseId:first.state.leaseId,outcome:'attempted'},p)).ok,true);
 clock=t+24999;assert.equal((await send({kind:'ACTION_ACQUIRE',...ib},i)).state.granted,false);
 clock=t+25000;const follow=await send({kind:'ACTION_ACQUIRE',...ib},i);assert.equal(follow.state.granted,true);
 clock=t+26000;await send({kind:'ACTION_SETTLE',...ib,leaseId:follow.state.leaseId,outcome:'attempted'},i);
 clock=t+49000;const reply=await send({kind:'ACTION_ACQUIRE',...nb},n);assert.equal(reply.state.granted,true);
 clock=t+50000;await send({kind:'ACTION_SETTLE',...nb,leaseId:reply.state.leaseId,outcome:'attempted'},n);
 clock=t+73000;const early=await send({kind:'ACTION_ACQUIRE',...ib},i);assert.equal(early.state.granted,false);assert.equal(early.state.retryAt,t+146000);
 clock=t+146000;assert.equal((await send({kind:'ACTION_ACQUIRE',...ib},i)).state.granted,true);
});
test('action acquisition binds worker, module, account and run while remaining available at midnight',async()=>{
 const service=await enable({interaction:true}),worker=page(service.workers.posting.tabId);const run=await rt('posting','begin',{account:'/me'},worker);
 const binding={module:'posting',runId:run.state.runId,account:'/me',actionKind:'post'};
 for(const [change,sender] of [[{},page()],[{runId:'wrong'},worker],[{account:'/other'},worker],[{actionKind:'follow'},worker]])assert.equal((await send({kind:'ACTION_ACQUIRE',...binding,...change},sender)).ok,false);
 clock=Date.parse('2026-11-04T16:00:00Z');const lease=await send({kind:'ACTION_ACQUIRE',...binding},worker);assert.equal(lease.state.granted,true);
 assert.equal(stored.xAssistantActionGateV1?.holder?.leaseId,lease.state.leaseId,'valid midnight action receives one bound lease');
});
test('post-click action ACK may settle at midnight after stop but an old run cannot settle a replacement',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);const run=await rt('posting','begin',{account:'/me'},worker),binding={module:'posting',runId:run.state.runId,account:'/me',actionKind:'post'};
 clock=Date.parse('2026-11-04T15:59:59Z');const acquired=await send({kind:'ACTION_ACQUIRE',...binding},worker);assert.equal(acquired.state.granted,true);
 clock=Date.parse('2026-11-04T16:00:00Z');await rt('posting','stop',{runId:run.state.runId},worker);
 assert.equal((await send({kind:'ACTION_SETTLE',...binding,leaseId:acquired.state.leaseId,outcome:'attempted'},worker)).ok,true);
 const saved=structuredClone(stored.xAssistantActionGateV1);events.startup();await flush();assert.deepEqual(stored.xAssistantActionGateV1,saved,'restart never clears pacing history');
 const service2=await enable();assert.equal(Object.keys(service2.workers).length,1);
 const current=service2.workers.posting;await hello(page(current.tabId));
 const fresh=await rt('posting','begin',{account:'/me'},page(current.tabId));assert.equal(fresh.ok,true);
 assert.equal((await send({kind:'ACTION_SETTLE',...binding,leaseId:acquired.state.leaseId,outcome:'attempted'},worker)).ok,false);
});

test('night master enable creates all selected workers that can begin and claim targets immediately',async()=>{
 clock=Date.parse('2026-11-04T16:00:00Z');const service=await enable({interaction:true,notifications:true});
 assert.deepEqual(Object.keys(service.workers).sort(),['interaction','notifications','posting']);assert.equal(tabs.size,3);assert.equal(service.status,'working');assert.equal(service.postingWorking,true);
 for(const [index,module] of ['interaction','notifications'].entries()){
  const worker=page(service.workers[module].tabId),start=await rt(module,'begin',{account:'/me'},worker);assert.equal(start.ok,true,start.error);
  assert.equal((await send({kind:'WORKER_POLL'},worker)).state.shouldRun,true);
  assert.equal((await rt(module,'patch',{runId:start.state.runId,patch:{phase:'submitting'}},worker)).ok,true);
  assert.equal((await send({kind:'REPLY_CLAIM',module,runId:start.state.runId,account:'/me',postId:String(900+index)},worker)).state.claimed,true);
  for(const actionKind of module==='interaction'?['reply','follow']:['reply']){
   const binding={module,runId:start.state.runId,account:'/me',actionKind},lease=await send({kind:'ACTION_ACQUIRE',...binding},worker);assert.equal(lease.state.granted,true,`${module}/${actionKind} is authorized at night`);
   assert.equal((await send({kind:'ACTION_SETTLE',...binding,leaseId:lease.state.leaseId,outcome:'released'},worker)).ok,true);
  }
 }
 clock=Date.parse('2026-11-04T22:00:00Z');events.alarm({name:'x-assistant-service-boundary'});await flush();assert.equal(tabs.size,3);
});
test('neither reply module can acquire or settle a like, while replies and interaction follows remain authorized',async()=>{
 const service=await enable({interaction:true,notifications:true});
 const i=page(service.workers.interaction.tabId),n=page(service.workers.notifications.tabId);
 const irun=await rt('interaction','begin',{account:'/me'},i),nrun=await rt('notifications','begin',{account:'/me'},n);
 const interaction={module:'interaction',runId:irun.state.runId,account:'/me'};
 const denied=await send({kind:'ACTION_ACQUIRE',...interaction,actionKind:'like'},i);
 assert.equal(denied.ok,false);assert.match(denied.error,/写操作类型无效/);
 assert.equal(stored.xAssistantActionGateV1,undefined,'rejected interaction like must not reserve a lease');
 assert.equal((await send({kind:'ACTION_SETTLE',...interaction,actionKind:'like',leaseId:'fake',outcome:'released'},i)).ok,false);
 for(const actionKind of ['reply','follow']){
  const lease=await send({kind:'ACTION_ACQUIRE',...interaction,actionKind},i);
  assert.equal(lease.state.granted,true,actionKind+' remains available to interaction');
  assert.equal((await send({kind:'ACTION_SETTLE',...interaction,actionKind,leaseId:lease.state.leaseId,outcome:'released'},i)).ok,true);
 }
 const notification={module:'notifications',runId:nrun.state.runId,account:'/me'};
 assert.equal((await send({kind:'ACTION_ACQUIRE',...notification,actionKind:'like'},n)).ok,false);
 assert.equal((await send({kind:'ACTION_SETTLE',...notification,actionKind:'like',leaseId:'fake',outcome:'released'},n)).ok,false);
 const reply=await send({kind:'ACTION_ACQUIRE',...notification,actionKind:'reply'},n);
 assert.equal(reply.state.granted,true,'notification replies remain available');
 assert.equal((await send({kind:'ACTION_SETTLE',...notification,actionKind:'reply',leaseId:reply.state.leaseId,outcome:'released'},n)).ok,true);
});
test('midnight keeps posting and other actions available while retaining leases and pacing',async()=>{
 clock=Date.parse('2026-11-04T15:59:59Z');const service=await enable({interaction:true,notifications:true}),bindings={};
 for(const module of ['posting','interaction','notifications']){const worker=page(service.workers[module].tabId),run=await rt(module,'begin',{account:'/me'},worker);bindings[module]={worker,payload:{module,runId:run.state.runId,account:'/me',actionKind:module==='posting'?'post':module==='interaction'?'follow':'reply'}};}
 const {worker,payload}=bindings.interaction,prior=await send({kind:'ACTION_ACQUIRE',...payload},worker);assert.equal(prior.state.granted,true);
 clock=Date.parse('2026-11-04T16:00:00Z');events.alarm({name:'x-assistant-service-boundary'});await flush();
 assert.equal((await send({kind:'ACTION_SETTLE',...payload,leaseId:prior.state.leaseId,outcome:'attempted'},worker)).ok,true);
 const post=bindings.posting;await rt('posting','stop',{runId:post.payload.runId},post.worker);assert.equal((await rt('posting','begin',{account:'/me'},post.worker)).ok,true);
 const n=bindings.notifications;assert.equal((await send({kind:'ACTION_ACQUIRE',...n.payload},n.worker)).state.granted,false,'non-like 23 seconds still applies at night');
 clock+=23000;const next=await send({kind:'ACTION_ACQUIRE',...n.payload},n.worker);assert.equal(next.state.granted,true);await send({kind:'ACTION_SETTLE',...n.payload,leaseId:next.state.leaseId,outcome:'attempted'},n.worker);
 clock+=23000;assert.equal((await send({kind:'ACTION_ACQUIRE',...payload},worker)).state.granted,false,'follow 120 seconds still applies at night');
 assert.equal((await send({kind:'ACTION_ACQUIRE',...n.payload,actionKind:'like'},n.worker)).ok,false,'notification likes are forbidden even at night');
 await send({kind:'SERVICE_SET',enabled:false});assert.equal((await send({kind:'ACTION_ACQUIRE',...n.payload},n.worker)).code,'SERVICE_DISABLED');
});
test('night AI checks remain available to every selected module without external network',async()=>{
 const service=await enable({interaction:true,notifications:true}),runs={};for(const module of ['posting','interaction','notifications']){const worker=page(service.workers[module].tabId);runs[module]={worker,runId:(await rt(module,'begin',{account:'/me'},worker)).state.runId};}
 clock=Date.parse('2026-11-04T16:00:00Z');stored.xAssistantDeepSeekKeyV1='fixture-key';const originalFetch=globalThis.fetch,requested=[];
 globalThis.fetch=async url=>{requested.push(url);if(url.endsWith('/models'))return {ok:true};if(url.startsWith('chrome-extension://managed/bridge/'))return {ok:true,text:async()=>'fixture prompt'};if(url==='https://api.deepseek.com/chat/completions')return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'skip'})}}]})};throw Error('unexpected fixture URL');};
 try{
  assert.equal((await send({kind:'AI_CHECK',module:'posting'},runs.posting.worker)).ok,true);
  assert.equal((await send({kind:'AI_POST',runId:runs.posting.runId,rowId:'post'},runs.posting.worker)).ok,false,'obsolete AI posting endpoint is disabled');assert.equal(requested.length,1);
  for(const module of ['interaction','notifications']){
   const {worker,runId}=runs[module];assert.equal((await send({kind:'AI_CHECK',module},worker)).ok,true);
   const result=await send({kind:module==='interaction'?'AI_REPLY':'AI_NOTIFICATION_REPLY',runId,post:{id:'456',text:'fixture'}},worker);assert.equal(result.ok,true,result.error);assert.equal(result.state.action,'skip');
  }
  assert.equal(requested.length,7);
 }finally{globalThis.fetch=originalFetch;}
});
test('crossing midnight during posting begin reads preserves the final runtime commit',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);clock=Date.parse('2026-11-04T15:59:59.999Z');
 readHook=key=>{if(key==='xAssistantPostSchedulesV1')clock=Date.parse('2026-11-04T16:00:00Z');};const response=await rt('posting','begin',{account:'/me'},worker);readHook=null;
 assert.equal(response.ok,true,response.error);assert.equal(stored.xAssistantPostingV1?.active,true);
});

test('diagnostic run is panel-only, runs each optional module once and never authorizes posting',async()=>{
 await hello(page());assert.equal((await send({kind:'SERVICE_TRIAL_ONCE',account:'/me',requestId:'test-request-01',issuedAt:clock},page())).ok,false);
 const started=await send({kind:'SERVICE_TRIAL_ONCE',account:'/me',requestId:'test-request-01',issuedAt:clock},panel);assert.ok(started.ok);const s=started.state;
 assert.deepEqual(Object.keys(s.workers).sort(),['interaction','notifications']);assert.equal(s.enabled,true);assert.ok(s.trial);
 const i=page(s.workers.interaction.tabId),n=page(s.workers.notifications.tabId);await hello(i);await hello(n);
 assert.equal((await rt('posting','begin',{account:'/me'},i)).ok,false);
 const ri=(await rt('interaction','begin',{account:'/me'},i)).state,rn=(await rt('notifications','begin',{account:'/me'},n)).state;
 stored.xAssistantReplyClaimsV1={'/me':{'2118124070718128465':{claimId:'preserve',status:'unknown',at:1}}};
 stored.xAssistantNotificationRepliesV1={'/me':{records:{'2118124070718128465':{status:'unknown',reasonCode:'SEND_UNKNOWN'}}}};
 for(const [module,r,p] of [['interaction',ri,i],['notifications',rn,n]]){
  const res=await send({kind:'REPLY_CLAIM',module,account:'/me',postId:'2118124070718128465',runId:r.runId},p);
  assert.equal(res.state.claimed,false);assert.equal(res.state.reason,'unknown');
 }
 await rt('notifications','patch',{runId:rn.runId,patch:{phase:'waiting',nextAt:clock+30000}},n);
 assert.equal(stored.xAssistantManagedServiceV1.trial.pending.notifications,true);
 await send({kind:'TIME_ARM',name:'interaction',account:'/me',runId:ri.runId},i);
 assert.equal((await send({kind:'WORKER_POLL'},i)).state.shouldRun,false);
 assert.equal((await send({kind:'WORKER_POLL'},n)).state.shouldRun,true);
 await rt('notifications','patch',{runId:rn.runId,patch:{phase:'waiting',nextAt:clock+600000,roundComplete:true,roundReason:'profile_complete'}},n);
 assert.equal(stored.xAssistantManagedServiceV1.enabled,false);assert.equal(stored.xAssistantManagedServiceV1.trial,undefined);assert.equal(tabs.size,2);
 assert.deepEqual(stored.xAssistantReplyClaimsV1['/me']['2118124070718128465'],{claimId:'preserve',status:'unknown',at:1});
});
test('trial expiry fails closed at authorization before alarm, closes and never starts ordinary posting',async()=>{
 const r=await send({kind:'SERVICE_TRIAL_ONCE',account:'/me',requestId:'test-request-01',issuedAt:clock},panel),i=page(r.state.workers.interaction.tabId);await hello(i);
 const a=await rt('interaction','begin',{account:'/me'},i);clock=r.state.trial.expiresAt;
 assert.equal((await send({kind:'ACTION_ACQUIRE',module:'interaction',runId:a.state.runId,account:'/me',actionKind:'reply'},i)).ok,false);
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(stored.xAssistantManagedServiceV1.enabled,false);assert.equal(tabs.size,2);
});

test('extension update detaches stale worker documents, preserves unknown rows and waits for explicit master enable',async()=>{
 const s=await enable({interaction:true,notifications:true}),old=s.workers.notifications.tabId;
 const protectedRow={claimId:'before',at:1,status:'unknown'};
 stored.xAssistantReplyClaimsV1={'/me':{'2118124070718128465':protectedRow}};
 const pending={phase:'submitting',active:true,owner:s.workers.posting.tabId,runId:'old-post',text:'keep'};
 stored.xAssistantPostingV1=pending;
 const tabsBefore=tabs.size;events.installed({reason:'update'});await flush();
 assert.equal(stored.xAssistantManagedServiceV1.enabled,false);
 assert.deepEqual(stored.xAssistantManagedServiceV1.selected,{posting:true,interaction:true,notifications:true,followback:false});
 assert.deepEqual(stored.xAssistantManagedServiceV1.workers,{});
 assert.equal(tabs.size,tabsBefore,'do not navigate, close, or create work tabs during update');
 assert.equal(stored.xAssistantPostingV1.phase,'unknown');
 assert.deepEqual(stored.xAssistantReplyClaimsV1['/me']['2118124070718128465'],protectedRow);
 const next=(await send({kind:'SERVICE_SET',enabled:true,account:'/me'},panel)).state;
 assert.notEqual(next.workers.notifications.tabId,old);assert.equal(next.workers.posting.code,'SEND_UNKNOWN');
 assert.equal((await hello(page(old))).state.assignment,null,'old tab cannot reclaim role');
});

test('interaction source changes revoke new claims, permits and submissions but let existing receipts settle',async()=>{
 stored.xAssistantFriendSearchV1=false;
 const service=await enable({interaction:true}),id=service.workers.interaction.tabId,worker=page(id);
 assert.equal(tabs.get(id).url,'https://x.com/home');
 assert.equal((await rt('interaction','begin',{account:'/me',sourceMode:'search'},worker)).code,'SOURCE_CHANGED');
 const run=await rt('interaction','begin',{account:'/me',sourceMode:'home'},worker);assert.ok(run.ok,run.error);
 const binding={module:'interaction',account:'/me',runId:run.state.runId};assert.equal(run.state.sourceMode,'home');
 const claim=await send({kind:'REPLY_CLAIM',...binding,postId:'22'},worker);
 const lease=await send({kind:'ACTION_ACQUIRE',...binding,actionKind:'reply'},worker);
 assert.equal(claim.state.claimed,true);assert.equal(lease.state.granted,true);
 tabs.get(id).url='https://x.com/author/status/22';
 assert.ok((await rt('interaction','patch',{runId:binding.runId,patch:{phase:'submitting'}},worker)).ok,'matching run can act in verified detail');
 stored.xAssistantFriendSearchV1=true;
 for(const msg of [{kind:'REPLY_CLAIM',postId:'23'},{kind:'ACTION_ACQUIRE',actionKind:'follow'},{kind:'RUNTIME',action:'patch',patch:{phase:'submitting'}}])
  assert.equal((await send({...binding,...msg},worker)).code,'SOURCE_CHANGED');
 assert.equal((await send({kind:'REPLY_SETTLE',...binding,postId:'22',claimId:claim.state.claimId,outcome:'confirmed',receipt:{kind:'confirmed'}},worker)).ok,true);
 assert.equal((await send({kind:'ACTION_SETTLE',...binding,actionKind:'reply',leaseId:lease.state.leaseId,outcome:'attempted'},worker)).ok,true);
 assert.ok((await rt('interaction','patch',{runId:binding.runId,patch:{phase:'confirmed',receipt:{kind:'confirmed'}}},worker)).ok);
 assert.ok((await rt('interaction','stop',{runId:binding.runId},worker)).ok);
 assert.equal((await rt('interaction','begin',{account:'/me',sourceMode:'search'},worker)).ok,false,'a stale detail URL cannot start a fresh source');
 tabs.get(id).url='https://x.com/search?q=topic';
 const next=await rt('interaction','begin',{account:'/me',sourceMode:'search'},worker);assert.ok(next.ok,next.error);assert.notEqual(next.state.runId,binding.runId);
 const duplicate=await send({kind:'REPLY_CLAIM',...binding,runId:next.state.runId,postId:'22'},worker);assert.equal(duplicate.state.reason,'confirmed');
});

async function fbStart(){
 clock=Date.now();
 const s=await enable({posting:false,followback:true});
 assert.deepEqual(Object.keys(s.workers),['followback']);
 const who=page(s.workers.followback.tabId);
 assert.equal(tabs.get(who.tab.id).url,'https://x.com/me/verified_followers');
 const r=await rt('followback','begin',{account:'/me'},who);assert.equal(r.ok,true,r.error);
 const binding={module:'followback',account:'/me',runId:r.state.runId},target={target:'@other',targetId:'12345'};
 const msg=(kind,extra={})=>send({kind,...binding,...extra},who);
 return {who,target,r,msg,bind:binding,permit:()=>msg('ACTION_ACQUIRE',{actionKind:'follow'}),reserve:(extra={})=>msg('FOLLOWBACK_RESERVE',{...target,...extra}),
  ack:(leaseId,outcome)=>msg('ACTION_SETTLE',{actionKind:'follow',leaseId,outcome}),settle:(claimId,outcome,extra={})=>msg('FOLLOWBACK_SETTLE',{...target,claimId,outcome,...extra})};
}
test('follow-back only leases follow on its own verified list; reservation and ledger are account+target scoped',async()=>{
 const f=await fbStart();assert.equal((await f.msg('ACTION_ACQUIRE',{actionKind:'reply'})).ok,false);
 assert.equal((await f.reserve()).ok,false,'reserve needs a granted lease');
 const good=tabs.get(f.who.tab.id).url;
 for(const url of ['https://x.com/me/followers','https://x.com/other/verified_followers',good+'?q=1']){
  tabs.get(f.who.tab.id).url=url;assert.equal((await f.permit()).code,'PAGE_CHANGED');
 }
 tabs.get(f.who.tab.id).url=good;const p=await f.permit();assert.ok(p.state.granted);
 assert.equal((await f.reserve({target:'@me'})).ok,false);
 stored.xAssistantProcessedV1={posts:{'1':{author:'@legacy',follow:'unknown',account:'/me'}}};
 assert.deepEqual((await f.reserve({target:'@legacy',targetId:'4'})).state,{claimed:false,reason:'unknown'});delete stored.xAssistantProcessedV1;
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@legacy'].status,'unknown','older uncertain author no longer starves subsequent scans');
 assert.equal((await f.reserve({targetId:null})).ok,false);
 const c=await f.reserve();assert.ok(c.state.claimed);const id=c.state.claimId;
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'in_flight');assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'submitting');
 assert.equal((await f.reserve({target:'@other_two'})).state.claimed,false,'renamed handle, same numeric ID');
 assert.equal((await f.reserve({target:'@two',targetId:'2'})).ok,false,'cannot reserve a second target at once');
 assert.equal((await f.msg('RUNTIME',{action:'patch',patch:{phase:'waiting'}})).ok,false);
 await f.ack(p.state.leaseId,'attempted');
 await send({kind:'SERVICE_SET',enabled:false},panel);
 assert.equal((await f.settle(id,'released')).ok,false,'attempted cannot release');
 assert.equal((await f.settle(id,'confirmed',{receipt:{kind:'following',target:'@different',targetId:'12345'}})).ok,false);
 assert.equal((await f.settle(id,'confirmed',{receipt:{kind:'following',target:'@other',targetId:'12346'}})).ok,false);
 assert.equal((await f.settle(id,'confirmed',{receipt:{kind:'following',target:'@other',targetId:'12345'}})).ok,true);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.completed,1);assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'confirmed');
 assert.equal((await f.settle(id,'released')).ok,false);
 assert.equal((await f.settle(id,'confirmed',{receipt:{kind:'following',target:'@other',targetId:'12345'}})).ok,true);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.completed,1);
});
test('verified pre-click release allows a future attempt, uncertain follow survives browser restart and review',async()=>{
 const f=await fbStart(),p=await f.permit(),c=await f.reserve();
 await f.ack(p.state.leaseId,'released');assert.equal((await f.settle(c.state.claimId,'released')).ok,true);
 assert.ok(!stored.xAssistantFollowbackLedgerV1['/me']['@other']);
 const p2=await f.permit(),c2=await f.reserve();assert.ok(p2.state.granted&&c2.state.claimed);
 await f.ack(p2.state.leaseId,'attempted');events.startup();await flush();
 assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'unknown');
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'unknown');
 assert.equal(stored.xAssistantManagedServiceV1.enabled,false);
 await hello(page(1));assert.ok((await rt('followback','resolve',{runId:f.bind.runId,account:'/me',reviewed:true},page(1))).ok);
 const fresh=await fbStart();assert.deepEqual((await fresh.reserve()).state,{claimed:false,reason:'unknown'});
});
test('unconfirmed follow-back result is never released or automatically retried',async()=>{
 const f=await fbStart(),p=await f.permit(),c=await f.reserve();await f.ack(p.state.leaseId,'attempted');
 assert.equal((await f.settle(c.state.claimId,'unknown')).ok,true);
 assert.equal((await f.settle(c.state.claimId,'released')).ok,false);
 assert.equal((await f.permit()).code,'SEND_UNKNOWN');
});
test('回关工作页自动核对同账号同 ID 的未知结果并恢复原模块',async()=>{
 const f=await fbStart(),p=await f.permit(),c=await f.reserve();await f.ack(p.state.leaseId,'attempted');await f.settle(c.state.claimId,'unknown');
 await rt('followback','stop',{runId:f.bind.runId},f.who);
 const result=await f.msg('FOLLOWBACK_REVIEW',{...f.target,outcome:'confirmed',receipt:{kind:'following',...f.target}});assert.ok(result.ok,result.error);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'stopped');assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'confirmed');
 assert.notEqual(stored.xAssistantManagedServiceV1.workers.followback.status,'blocked');assert.equal((await send({kind:'WORKER_POLL'},f.who)).state.shouldRun,true);
});
test('完整遍历完成后自动关闭遍历开关和回关模块',async()=>{
 const f=await fbStart();stored.xAssistantFollowbackSweepV1=true;
 const result=await f.msg('FOLLOWBACK_SWEEP_DONE');assert.ok(result.ok,result.error);
 assert.equal(stored.xAssistantFollowbackSweepV1,false);assert.equal(stored.xAssistantManagedServiceV1.selected.followback,false);
});

test('follow-back waiting lives in the backend; empty scans and confirmed ACK use one persisted deadline',async()=>{
 const f=await fbStart(),initial=f.r.state.nextAt;assert.ok(initial-Date.now()>=54900&&initial-Date.now()<=70000);
 const first=await f.msg('FOLLOWBACK_WAIT');assert.equal(first.state.nextAt,initial);
 assert.equal((await f.msg('RUNTIME',{action:'patch',patch:{phase:'followback_scan',nextAt:null}})).ok,true);
 const next=(await f.msg('FOLLOWBACK_WAIT')).state.nextAt;
 assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'waiting');assert.ok(next-Date.now()>=54900&&next-Date.now()<=70000);assert.equal((await f.msg('FOLLOWBACK_WAIT')).state.nextAt,next);
 const p=await f.permit(),c=await f.reserve();assert.equal((await f.msg('FOLLOWBACK_WAIT')).ok,false);
 await f.ack(p.state.leaseId,'attempted');
 const gate=stored.xAssistantActionGateV1.accounts['/me'].followbackNotBefore;
 const receipt={kind:'following',target:'@other',targetId:'12345'};
 assert.equal((await f.settle(c.state.claimId,'confirmed',{receipt})).state.nextAt,gate);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.nextAt,gate);
});

test('watchdog retires a proven closed follow-back waiting run even when onRemoved was missed; no automatic reopen',async()=>{
 const f=await fbStart(),id=f.who.tab.id,oldToken=stored.xAssistantManagedServiceV1.workers.followback.token;
 tabs.delete(id);events.alarm({name:'x-assistant-service-watchdog'});await flush();
 const worker=stored.xAssistantManagedServiceV1.workers.followback;
 assert.equal(worker.status,'missing');assert.equal(worker.closedTabId,id);assert.equal(worker.tabId,null);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.active,false);assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'stopped');
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0);
 const result=await send({kind:'SERVICE_REPAIR',module:'followback'});
 assert.equal(result.ok,true);assert.notEqual(result.state.workers.followback.token,oldToken);assert.equal(tabs.size,1);
});
test('explicit repair recovers 7.3.1 null-tab tombstone only after proving the old runtime owner no longer exists',async()=>{
 const f=await fbStart(),id=f.who.tab.id;
 Object.assign(stored.xAssistantManagedServiceV1.workers.followback,{status:'missing',code:'WORKER_CLOSED',tabId:null});
 const stillLive=await send({kind:'SERVICE_REPAIR',module:'followback'});
 assert.equal(stillLive.ok,false);assert.equal(stored.xAssistantFollowbackRuntimeV1.active,true);
 tabs.delete(id);
 const repaired=await send({kind:'SERVICE_REPAIR',module:'followback'});
 assert.equal(repaired.ok,true);assert.equal(stored.xAssistantFollowbackRuntimeV1.active,false);
 assert.equal(tabs.size,1);assert.notEqual(repaired.state.workers.followback.tabId,id);
});
test('transient or wrong-tab lookup errors are not proof of closure and do not drop ownership',async()=>{
 const f=await fbStart(),id=f.who.tab.id,original=chrome.tabs.get;
 try{
  for(const message of ['tabs API temporarily unavailable','No tab with id: '+(id+1)+'.']){
   chrome.tabs.get=async()=>{throw Error(message);};events.alarm({name:'x-assistant-service-watchdog'});await flush();
   assert.equal(stored.xAssistantFollowbackRuntimeV1.active,true);
   assert.equal(stored.xAssistantManagedServiceV1.workers.followback.tabId,id);
  }
 }finally{chrome.tabs.get=original;}
});
test('STOP_ALL also audits a vanished owning tab: reserved targets become unknown, never replayed or reported clean',async()=>{
 const f=await fbStart(),permit=await f.permit(),claim=await f.reserve();
 assert.ok(permit.state.granted&&claim.state.claimed);
 tabs.delete(f.who.tab.id);
 assert.equal((await send({kind:'STOP_ALL'},panel)).ok,true);
 assert.equal(stored.xAssistantFollowbackRuntimeV1.active,false);assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'unknown');
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'unknown');
 assert.equal(stored.xAssistantActionGateV1.holder.leaseId,permit.state.leaseId);
 assert.equal((await send({kind:'SERVICE_REPAIR',module:'followback'})).code,'SEND_UNKNOWN');assert.equal(tabs.size,0);
});
test('a stale missing marker cannot stop a replacement run with a different owner',async()=>{
 const f=await fbStart(),id=f.who.tab.id;
 Object.assign(stored.xAssistantManagedServiceV1.workers.followback,{status:'missing',code:'WORKER_CLOSED',tabId:null,closedTabId:id});
 const r=stored.xAssistantFollowbackRuntimeV1;Object.assign(r,{owner:id+100,runId:'replacement',documentId:'different-document'});
 tabs.delete(id);events.alarm({name:'x-assistant-service-watchdog'});await flush();
 assert.equal(stored.xAssistantFollowbackRuntimeV1.active,true);
 assert.equal((await send({kind:'SERVICE_REPAIR',module:'followback'})).ok,false);assert.equal(tabs.size,0);
});

test('running posting permits append-only import without changing service, current rows, runtime or schedule',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);await rt('posting','begin',{account:'/me'},worker);
 const before=structuredClone({service:stored.xAssistantManagedServiceV1,runtime:stored.xAssistantPostingV1,schedule:stored.xAssistantPostSchedulesV1});
 const saved=await send({kind:'POST_COPIES_OP',op:{action:'merge',expectedRevision:1,rows:[{id:'appended',text:'新增稿件',enabled:true}]}},panel);
 assert.equal(saved.ok,true,saved.error);assert.deepEqual(saved.state.rows.map(r=>r.id),['post','appended']);
 assert.deepEqual({service:stored.xAssistantManagedServiceV1,runtime:stored.xAssistantPostingV1,schedule:stored.xAssistantPostSchedulesV1},before);
});
test('active posting still rejects bulk clear, reorder, and insertion before current copy',async()=>{
 stored.xAssistantPostingCopiesV1.rows.push({id:'second',text:'第二条',enabled:true});
 await enable();const before=structuredClone(stored.xAssistantPostingCopiesV1),[first,second]=before.rows;
 for(const op of [{action:'clear'},{action:'replace',rows:[second,first]},{action:'replace',rows:[{id:'new',text:'插队',enabled:true},first,second]}]){
  const result=await send({kind:'POST_COPIES_OP',op:{...op,expectedRevision:before.revision}},panel);assert.equal(result.ok,false);assert.match(result.error,/暂停发帖/);assert.deepEqual(stored.xAssistantPostingCopiesV1,before);
 }
});
test('active append retains CAS and unknown-result locks rather than silently overwriting or resolving',async()=>{
 const service=await enable(),worker=page(service.workers.posting.tabId);const run=await rt('posting','begin',{account:'/me'},worker);
 const op={action:'upsert',id:'new',row:{id:'new',text:'新增',enabled:true},expected:null,expectedRevision:0};
 assert.match((await send({kind:'POST_COPIES_OP',op},panel)).error,/已变化/);
 stored.xAssistantPostingV1={...stored.xAssistantPostingV1,active:false,phase:'unknown'};
 const result=await send({kind:'POST_COPIES_OP',op:{...op,expectedRevision:1}},panel);assert.equal(result.ok,false);assert.match(result.error,/未确认/);assert.equal(stored.xAssistantPostingCopiesV1.rows.length,1);assert.equal(stored.xAssistantPostingV1.runId,run.state.runId);
});

// Closed/replaced posting workers: recover only a proven idle run, never a pending send.
async function idlePosting(){
 const service=await enable(),id=service.workers.posting.tabId;
 const started=await rt('posting','begin',{account:'/me'},page(id));assert.equal(started.ok,true,started.error);
 return {id,worker:service.workers.posting,run:stored.xAssistantPostingV1};
}
test('browser tab replacement transfers idle posting ownership, keeps schedule and ignores a late removal',async()=>{
 const f=await idlePosting(),schedule=structuredClone(stored.xAssistantPostSchedulesV1);
 tabs.delete(f.id);tabs.set(999,{id:999,url:'https://x.com/home'});
 events.replaced(999,f.id);await flush();
 const w=stored.xAssistantManagedServiceV1.workers.posting;
 assert.equal(w.tabId,999);assert.equal(w.status,'starting');assert.notEqual(w.token,f.worker.token);
 assert.equal(stored.xAssistantPostingV1.active,false);assert.deepEqual(stored.xAssistantPostSchedulesV1,schedule);
 events.removed(f.id,{isWindowClosing:false});await flush();assert.equal(stored.xAssistantManagedServiceV1.workers.posting.tabId,999);
 assert.equal(stored.xAssistantManagedServiceV1.workerEvents.at(-1).event,'tab_replaced');
 await hello(page(999));assert.equal((await rt('posting','begin',{account:'/me'},page(999))).ok,true);
});
test('idle posting closure waits before recreation and preserves the persisted deadline',async()=>{
 const f=await idlePosting(),schedule=structuredClone(stored.xAssistantPostSchedulesV1);
 tabs.delete(f.id);events.removed(f.id,{isWindowClosing:true});await flush();
 const w=stored.xAssistantManagedServiceV1.workers.posting;assert.ok(w.recoveryProof);assert.equal(w.status,'missing');
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0);
 w.recoverAt=0;events.alarm({name:'x-assistant-service-watchdog'});await flush();
 assert.equal(tabs.size,1);assert.notEqual(stored.xAssistantManagedServiceV1.workers.posting.tabId,f.id);
 assert.deepEqual(stored.xAssistantPostSchedulesV1,schedule);
 assert.equal(stored.xAssistantManagedServiceV1.workerEvents[0].isWindowClosing,true);
});
test('missed removal watchdog recovers only proven idle posting',async()=>{
 const f=await idlePosting();tabs.delete(f.id);events.alarm({name:'x-assistant-service-watchdog'});await flush();
 const w=stored.xAssistantManagedServiceV1.workers.posting;assert.ok(w.recoveryProof);assert.equal(stored.xAssistantPostingV1.active,false);
 w.recoverAt=0;events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,1);
 assert.equal(stored.xAssistantManagedServiceV1.workerEvents[0].event,'lookup_missing');
});
test('submitting, unknown, preparing and action leases never permit automatic posting recovery',async()=>{
 for(const phase of ['submitting','unknown','preparing','waiting']){
  const f=await idlePosting();stored.xAssistantPostingV1.phase=phase;
  if(phase==='waiting')stored.xAssistantActionGateV1={holder:{module:'posting',owner:f.id}};
  tabs.delete(f.id);events.removed(f.id,{});await flush();
  const w=stored.xAssistantManagedServiceV1.workers.posting;assert.equal(w.recoveryProof,null,phase);
  w.recoverAt=0;events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0,phase);
  // Reset the test fixture before the next independent safety case.
  stored.xAssistantPostingV1={};stored.xAssistantManagedServiceV1={};stored.xAssistantActionGateV1={};
 }
});
test('uncertain replacement stays blocked and cannot restart automatically',async()=>{
 const f=await idlePosting();stored.xAssistantPostingV1.phase='submitting';
 tabs.delete(f.id);tabs.set(998,{id:998,url:'https://x.com/home'});events.replaced(998,f.id);await flush();
 assert.equal(stored.xAssistantManagedServiceV1.workers.posting.code,'SEND_UNKNOWN');assert.equal(stored.xAssistantPostingV1.phase,'unknown');
 await hello(page(998));assert.equal((await rt('posting','begin',{account:'/me'},page(998))).ok,false);
});
test('replacement to a different route is never navigated or auto-started',async()=>{
 const f=await idlePosting();tabs.delete(f.id);tabs.set(997,{id:997,url:'https://example.com/'});
 events.replaced(997,f.id);await flush();assert.equal(stored.xAssistantManagedServiceV1.workers.posting.status,'blocked');
 assert.equal(tabs.get(997).url,'https://example.com/');
});
test('posting recreation is bounded and master/module disablement cancels it',async()=>{
 const f=await idlePosting();tabs.delete(f.id);events.removed(f.id,{});await flush();
 const w=stored.xAssistantManagedServiceV1.workers.posting;w.recoverAt=0;w.autoRecoveryTimes=[Date.now(),Date.now(),Date.now()];
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0);
 w.autoRecoveryTimes=[];stored.xAssistantManagedServiceV1.selected.posting=false;
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0);
 stored.xAssistantManagedServiceV1.selected.posting=true;stored.xAssistantManagedServiceV1.enabled=false;
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(tabs.size,0);
});

test('late replacement event can recover a positively audited idle missing worker',async()=>{
 const f=await idlePosting();tabs.delete(f.id);tabs.set(996,{id:996,url:'https://x.com/home'});
 events.alarm({name:'x-assistant-service-watchdog'});await flush();assert.equal(stored.xAssistantManagedServiceV1.workers.posting.status,'missing');
 events.replaced(996,f.id);await flush();assert.equal(stored.xAssistantManagedServiceV1.workers.posting.status,'starting');assert.equal(tabs.size,1);
});
test('rate/auth failures retained in an idle runtime do not permit recreation',async()=>{
 const f=await idlePosting();stored.xAssistantPostingV1.error='HTTP 429';tabs.delete(f.id);events.removed(f.id,{});await flush();
 assert.equal(stored.xAssistantManagedServiceV1.workers.posting.recoveryProof,null);
});

test('follow rate rejection preserves an unknown target while scheduling the module thirty minutes later',async()=>{
 const f=await fbStart(),p=await f.permit(),c=await f.reserve();await f.ack(p.state.leaseId,'attempted');
 const receipt={kind:'rate_limit',...f.target};
 assert.equal((await f.settle(c.state.claimId,'rate_limited',{receipt:{...receipt,targetId:'wrong'}})).ok,false);
 const start=Date.now(),result=await f.settle(c.state.claimId,'rate_limited',{receipt});assert.ok(result.ok,result.error);
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].status,'unknown');
 assert.equal(stored.xAssistantFollowbackLedgerV1['/me']['@other'].reasonCode,'FOLLOW_RATE_LIMIT');
 assert.equal(stored.xAssistantFollowbackRuntimeV1.phase,'waiting');assert.ok(result.state.nextAt>=start+1800000);
 await rt('followback','stop',{runId:f.bind.runId},f.who);
 const worker=stored.xAssistantManagedServiceV1.workers.followback;
 const report=await send({kind:'WORKER_REPORT',module:'followback',token:worker.token,status:'error',code:'FOLLOW_RATE_LIMIT',error:'X 关注频率受限',submitted:true,retryAt:result.state.nextAt},f.who);
 assert.ok(report.ok,report.error);assert.equal(report.state.workers.followback.status,'retrying');
 assert.ok(report.state.workers.followback.retryAt>=start+1800000);
 assert.equal((await f.settle(c.state.claimId,'released')).ok,false);
 assert.equal((await f.settle(c.state.claimId,'rate_limited',{receipt})).ok,false,'不能把历史未知记录转换为限流以解除保护');
});
