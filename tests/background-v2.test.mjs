import test from 'node:test';import assert from 'node:assert/strict';
const events={};let stored={};const evt=n=>({addListener:f=>events[n]=f});
globalThis.chrome={storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async data=>{Object.assign(stored,structuredClone(data));}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:evt('message'),onInstalled:evt('install'),onStartup:evt('startup'),openOptionsPage:async()=>{}},tabs:{get:async id=>({id,url:'https://x.com/search?q=fixture'}),onRemoved:evt('removed')},action:{onClicked:evt('click')},alarms:{clear:async()=>{}}};
const realNow=Date.now;Date.now=()=>Date.parse('2026-11-04T04:00:00Z');
await import('../background.js');Date.now=realNow;
// Legacy behavior fixtures now explicitly provision supervisor-owned workers.
function provision(msg,who){
 if(!who.tab||!/^https:\/\/x\.com\//.test(who.url||''))return;
 const module=msg.kind==='AI_CHECK'?msg.module:msg.kind==='RUNTIME'&&['begin','prepare'].includes(msg.action)?msg.module:null;
 if(!['posting','interaction','notifications'].includes(module))return;
 const service=stored.xAssistantManagedServiceV1||{account:'/me',selected:{posting:true,interaction:true,notifications:true},workers:{},revision:1};
 service.enabled=true;service.account='/me';service.selected={posting:true,interaction:true,notifications:true};service.workers[module]={tabId:who.tab.id,token:'fixture-'+module,status:'stopped'};stored.xAssistantManagedServiceV1=service;
}
const sender={id:'test',url:'https://x.com/home',tab:{id:1}},panel={id:'test',url:'chrome-extension://test/panel.html'};
const rawSend=(msg,who)=>new Promise(resolve=>events.message(msg,who,resolve));
const send=async(msg,who=sender)=>{provision(msg,who);if(who.tab&&/^https:\/\/x\.com\//.test(who.url)){who={...who,documentId:who.documentId||'doc-'+who.tab.id};msg={instanceId:'instance-'+who.tab.id,...msg};if(msg.kind!=='PING'&&msg.kind!=='WORKSPACE_HELLO')await rawSend({kind:'WORKSPACE_HELLO',instanceId:msg.instanceId},who);}return rawSend(msg,who);};
const rt=(action,extra={})=>send({kind:'RUNTIME',module:'posting',action,...(action==='stop'?{runId:stored.xAssistantPostingV1?.runId}:{}),...extra});
const tick=()=>new Promise(r=>setTimeout(r,20));
test('integration: legacy backup, new posting copy edits, start, stop, stale completion, restart',async()=>{
 stored.app={rows:[{id:'custom',type:'post',text:'mine',enabled:true}],logs:[]};events.install();await tick();
 assert.deepEqual(stored.app.rows,[]);assert.equal(stored.app.postingCopyMigratedV1,true);
 assert.equal(stored.xAssistantLegacyCopyBackupV1.rows[0].text,'mine');
 const a=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:'a',row:{id:'a',text:'a',enabled:true},expected:null,expectedRevision:0}},panel);
 const b=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:'b',row:{id:'b',text:'b',enabled:true},expected:null,expectedRevision:1}},panel);
 assert.equal(a.ok,true,a.error);assert.equal(b.ok,true,b.error);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(r=>r.text),['a','b']);
 const started=await rt('begin',{account:'/me'});assert.equal(started.ok,true);const runId=started.state.runId;
 assert.equal((await send({kind:'RUNTIME',module:'interaction',action:'begin',account:'/me',sourceMode:'search'},{...sender,tab:{id:2}})).ok,true);
 assert.equal((await send({kind:'RUNTIME',module:'cleanup',action:'begin',account:'/me'})).ok,false);
 await rt('patch',{runId,patch:{phase:'submitting',text:'proof'}});await rt('stop');assert.equal(stored.xAssistantPostingV1.phase,'unknown');
 assert.equal((await rt('patch',{runId,patch:{phase:'confirmed'}})).ok,false);assert.equal((await rt('begin',{account:'/me'})).ok,false);
 events.startup();await tick();assert.equal(stored.xAssistantPostingV1.phase,'unknown');assert.deepEqual(stored.app.rows,[]);
});
test('untrusted page cannot mutate new posting copy bank, unknown command fails',async()=>{assert.equal((await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:0}})).ok,false);assert.equal((await send({kind:'RUNTIME',module:'evil',action:'begin'})).ok,false);});
test('stopped unknown runtime can be archived as skipped before the next item',async()=>{
 stored.xAssistantPostingV1={active:false,phase:'unknown',account:'/me',runId:'stale',rowId:'row-1',text:'maybe sent'};
 const result=await rt('abandon',{runId:'stale',account:'/me',reason:'next_item'});
 assert.equal(result.ok,true);assert.equal(result.state.phase,'stopped');assert.equal(result.state.resolution.disposition,'skipped');assert.equal(result.state.resolution.rowId,'row-1');
});
test('closing owner tab stops countdown',async()=>{stored.xAssistantPostingV1={active:true,owner:1,phase:'waiting'};events.removed(1);await tick();assert.equal(stored.xAssistantPostingV1.active,false);});
test('module prepare validates ownership and conflicts without creating a run',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantCleanupV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 const before=structuredClone(stored.xAssistantNotificationsRuntimeV1);
 const r=await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'});
 assert.equal(r.ok,true);assert.deepEqual(stored.xAssistantNotificationsRuntimeV1,before);
 stored.xAssistantPostingV1={active:true,owner:2,phase:'waiting'};
 assert.equal((await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'})).ok,true);
 stored.xAssistantPostingV1.owner=1;assert.equal((await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'})).ok,false);
});
test('posting confirmation and schedule persist atomically through stop, restart and new run',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantCleanupV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 stored.xAssistantPostSchedulesV1={};
 const s=await rt('begin',{account:'/me'}),runId=s.state.runId;
 await rt('patch',{runId,patch:{phase:'submitting',submittedAt:new Date().toISOString()}});
 const confirmed=await rt('patch',{runId,patch:{phase:'confirmed',receipt:{kind:'confirmed'},completed:1}});
 const next=confirmed.state.nextPostAt,last=confirmed.state.lastPostedAt;
 assert.ok(next-last>=1200000&&next-last<=1800000);
 await rt('stop');assert.equal(stored.xAssistantPostingV1.nextPostAt,next);
 events.startup();await tick();
 const again=await rt('begin',{account:'/me'});assert.equal(again.state.nextAt,next);assert.equal(again.state.lastPostedAt,last);
 await rt('stop');
});

test('heartbeat bypasses a busy mutation queue but still validates sender',async()=>{
 const get=chrome.storage.local.get;let release,started;
 const waiting=new Promise(r=>{started=r;});
 chrome.storage.local.get=async key=>{if(key==='app'){started();await new Promise(r=>{release=r;});}return get(key);};
 const pending=send({kind:'GET'},panel);await waiting;
 try{
  const pong=await Promise.race([send({kind:'PING'}),new Promise(r=>setTimeout(()=>r('timeout'),30))]);
  assert.notEqual(pong,'timeout');assert.equal(pong.ok,true);
  assert.equal((await send({kind:'PING'},{...sender,url:'https://other.example/'})).ok,false);
 }finally{chrome.storage.local.get=get;release();await pending;}
});

test('timing API accepts only panel saves and preserves storage on invalid input',async()=>{
 assert.equal((await send({kind:'TIME_SAVE',config:{posting:{min:9,max:9}}})).ok,false);
 const result=await send({kind:'TIME_SAVE',config:{posting:{min:42,max:42},interaction:{min:4,max:4}}},panel);assert.equal(result.ok,true);assert.equal(result.state.posting.min,42);
 const before=structuredClone(stored.xAssistantTimingV1);
 assert.equal((await send({kind:'TIME_SAVE',config:{posting:{min:10,max:2}}},panel)).ok,false);assert.deepEqual(stored.xAssistantTimingV1,before);
 assert.deepEqual((await send({kind:'TIME_GET'},panel)).state,before);
});
test('interaction timer binds owner, run and account, records persistent deadline',async()=>{
 stored.xAssistantRuntimeV1={active:true,owner:1,runId:'i',account:'/me',phase:'waiting'};
 const request={kind:'TIME_ARM',name:'interaction',runId:'i',account:'/me'};
 for(const message of [{...request,runId:'stale'},{...request,account:'/other'},{...request,name:'posting'}])assert.equal((await send(message)).ok,false);
 assert.equal((await send(request,{...sender,tab:{id:2}})).ok,false);
 const before=Date.now(),result=await send(request);assert.equal(result.ok,true);assert.ok(result.state>=before+4000);assert.equal(stored.xAssistantCooldownsV1['/me'].interaction,result.state);
 assert.equal(stored.xAssistantRuntimeV1.nextAt,result.state);
 await send({kind:'RUNTIME',module:'interaction',action:'stop',runId:'i'});assert.equal(stored.xAssistantCooldownsV1['/me'].interaction,result.state);
});
test('AI interaction startup does not require unused reply-library rows',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 stored.app.rows=[{id:'only-post',type:'post',text:'post',enabled:true}];
 assert.equal((await send({kind:'RUNTIME',module:'interaction',action:'prepare',account:'/me'})).ok,true);
});
