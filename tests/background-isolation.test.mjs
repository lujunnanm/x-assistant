import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
const events={};let stored={};
const evt=name=>({addListener:fn=>events[name]=fn});
globalThis.chrome={
 storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async data=>Object.assign(stored,structuredClone(data))},onChanged:evt('storage')},
 runtime:{id:'isolation',getURL:path=>'chrome-extension://isolation/'+path,onMessage:evt('message'),onInstalled:evt('install'),onStartup:evt('startup'),openOptionsPage:async()=>{}},
 tabs:{get:async id=>({id,url:'https://x.com/search?q=fixture'}),onRemoved:evt('removed'),onUpdated:evt('updated')},action:{onClicked:evt('click')},alarms:{clear:async()=>{}}
};
const realNow=Date.now;Date.now=()=>Date.parse('2026-11-04T04:00:00Z');
await import('../background.js');Date.now=realNow;
// Legacy behavior fixtures now explicitly provision supervisor-owned workers.
function provision(msg,who){
 if(!who.tab||!/^https:\/\/x\.com\//.test(who.url||''))return;
 const module=msg.kind==='AI_CHECK'?msg.module:msg.kind==='RUNTIME'&&['begin','prepare'].includes(msg.action)?msg.module:null;
 if(!['posting','interaction','notifications'].includes(module))return;
 const service=stored.xAssistantManagedServiceV1||{account:'/me',selected:{posting:true,interaction:true,notifications:true},workers:{},revision:1};
 service.enabled=true;service.workers[module]??={tabId:who.tab.id,token:'fixture-'+module,status:'stopped'};stored.xAssistantManagedServiceV1=service;
}
const page=(id,documentId='document-'+id,instanceId='instance-'+id)=>({id:'isolation',url:'https://x.com/home',tab:{id},frameId:0,documentId,instanceId,documentLifecycle:'active'});
const panel={id:'isolation',url:'chrome-extension://isolation/panel.html'};
const send=(msg,who)=>new Promise(resolve=>{provision(msg,who);const {instanceId,...sender}=who;events.message({...msg,...(instanceId?{instanceId}:{})},sender,resolve);});
const hello=who=>send({kind:'WORKSPACE_HELLO'},who);
const runtime=(who,module,action,extra={})=>send({kind:'RUNTIME',module,action,...extra},who);
const begin=(who,module)=>runtime(who,module,'begin',{account:'/me',...(module==='interaction'?{sourceMode:'search'}:{})});
const claim=(who,module,runId,postId)=>send({kind:'REPLY_CLAIM',module,runId,account:'/me',postId},who);
const settle=(who,module,runId,postId,claimId,outcome,receipt)=>send({kind:'REPLY_SETTLE',module,runId,account:'/me',postId,claimId,outcome,receipt},who);
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
beforeEach(()=>{stored={app:{rows:[{id:'post',type:'post',text:'legacy fixture',enabled:true}],logs:[]},xAssistantPostingCopiesV1:{revision:1,rows:[{id:'post',text:'fixture',enabled:true}]}};});

test('three modules run in independent tabs and cannot share or steal a tab',async()=>{
 const tabs=[page(1),page(2),page(3)];await Promise.all(tabs.map(hello));
 const starts=await Promise.all(tabs.map((tab,index)=>begin(tab,['posting','interaction','notifications'][index])));
 assert.ok(starts.every(result=>result.ok));
 assert.equal((await begin(page(4),'posting')).ok,false,'workspace handshake required');
 await hello(page(4));assert.equal((await begin(page(4),'posting')).ok,false,'same module cannot be stolen');
 await runtime(tabs[2],'notifications','stop',{runId:starts[2].state.runId});
 assert.equal((await begin(tabs[0],'notifications')).ok,false,'different modules cannot share one tab');
 assert.equal(stored.xAssistantPostingV1.active,true);assert.equal(stored.xAssistantRuntimeV1.active,true);
});

test('stop is bound to owner, run and document; only panel can stop all',async()=>{
 const a=page(1),b=page(2);await hello(a);await hello(b);
 const p=await begin(a,'posting'),i=await begin(b,'interaction');
 for(const [who,runId] of [[b,p.state.runId],[a,'stale'],[a,undefined]])assert.equal((await runtime(who,'posting','stop',{runId})).ok,false);
 assert.equal((await send({kind:'STOP_ALL'},a)).ok,false);assert.equal(stored.xAssistantPostingV1.active,true);
 await runtime(a,'posting','stop',{runId:p.state.runId});assert.equal(stored.xAssistantRuntimeV1.runId,i.state.runId);assert.equal(stored.xAssistantRuntimeV1.active,true);
 assert.equal((await send({kind:'STOP_ALL'},panel)).ok,true);assert.equal(stored.xAssistantManagedServiceV1.enabled,false);assert.equal(stored.xAssistantRuntimeV1.active,true,'managed worker may finish its receipt before stopping');
});

test('new document stops only its old owner; old messages cannot stop a new run',async()=>{
 const old=page(1),next=page(1,'document-new','instance-new'),other=page(2);await hello(old);await hello(other);
 const p=await begin(old,'posting'),i=await begin(other,'interaction');
 await hello(next);assert.equal(stored.xAssistantPostingV1.active,false);assert.equal(stored.xAssistantRuntimeV1.active,true);
 const fresh=await begin(next,'posting');assert.equal(fresh.ok,true);assert.notEqual(fresh.state.runId,p.state.runId);
 assert.equal((await runtime(old,'posting','stop',{runId:fresh.state.runId})).ok,false);
 assert.equal((await runtime(old,'posting','patch',{runId:fresh.state.runId,patch:{phase:'unknown'}})).ok,false);
 assert.equal((await hello(old)).ok,false,'retired document cannot re-register');
 await hello(next);assert.equal(stored.xAssistantPostingV1.active,true,'same document handshake is idempotent');
 assert.equal(stored.xAssistantRuntimeV1.runId,i.state.runId);
});

test('new instance fallback and refresh retain uncertain evidence without restarting',async()=>{
 const old=page(1,undefined,'instance-one');delete old.documentId;
 const next={...old,instanceId:'instance-two'};await hello(old);const p=await begin(old,'posting');
 await runtime(old,'posting','patch',{runId:p.state.runId,patch:{phase:'submitting',text:'uncertain content'}});
 await hello(next);assert.equal(stored.xAssistantPostingV1.active,false);assert.equal(stored.xAssistantPostingV1.phase,'unknown');assert.equal(stored.xAssistantPostingV1.text,'uncertain content');
 assert.equal((await begin(next,'posting')).ok,false);assert.equal((await hello({...next,documentLifecycle:'cached'})).ok,false);
});

test('tab closure and navigation away stop only their owned module',async()=>{
 const a=page(1),b=page(2);await hello(a);await hello(b);await begin(a,'posting');await begin(b,'interaction');
 events.updated(1,{url:'https://example.com'});await flush();assert.equal(stored.xAssistantPostingV1.active,false);assert.equal(stored.xAssistantRuntimeV1.active,true);
 events.removed(2);await flush();assert.equal(stored.xAssistantRuntimeV1.active,false);
});

test('credential network wait does not block another module and statuses stay independent',async()=>{
 const a=page(1),b=page(2);await hello(a);await hello(b);
 const failed=await send({kind:'AI_CHECK',module:'posting'},a);assert.equal(failed.ok,false);const original=structuredClone(stored.xAssistantAIStatusV2.posting);
 stored.xAssistantDeepSeekKeyV1='fixture-key';let release,entered;
 const waiting=new Promise(resolve=>entered=resolve),originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{entered();await new Promise(resolve=>release=resolve);return {ok:true};};
 const c=page(3);await hello(c);const pending=send({kind:'AI_CHECK',module:'notifications'},c);await waiting;
 try{
  const other=await Promise.race([begin(b,'interaction'),new Promise(resolve=>setTimeout(()=>resolve('blocked'),100))]);
  assert.notEqual(other,'blocked');assert.equal(other.ok,true);
  assert.equal((await runtime(b,'interaction','stop',{runId:other.state.runId})).ok,true);
 }finally{release();await pending;globalThis.fetch=originalFetch;}
 assert.deepEqual(stored.xAssistantAIStatusV2.posting,original);assert.equal(stored.xAssistantAIStatusV2.notifications.error,null);assert.equal(stored.xAssistantAIStatusV1,undefined);
});

test('atomic shared reply claim permits only one sender across independent modules',async()=>{
 const a=page(1),b=page(2);await hello(a);await hello(b);const i=await begin(a,'interaction'),n=await begin(b,'notifications');
 const results=await Promise.all([claim(a,'interaction',i.state.runId,'123'),claim(b,'notifications',n.state.runId,'123')]);
 assert.equal(results.filter(result=>result.state?.claimed).length,1);assert.equal(results[1].state.reason,'in_flight');
 const id=results[0].state.claimId;
 assert.equal((await settle(b,'notifications',n.state.runId,'123',id,'released')).ok,false);
 assert.equal((await settle(a,'interaction',i.state.runId,'123',id,'confirmed',{kind:'confirmed',url:'https://x.com/me/status/999'})).ok,true);
 assert.equal((await settle(a,'interaction',i.state.runId,'123',id,'released')).ok,false);
 assert.equal((await claim(b,'notifications',n.state.runId,'123')).state.reason,'confirmed');
});

test('claim imports confirmed and uncertain evidence from both legacy ledgers',async()=>{
 const a=page(1);await hello(a);const i=await begin(a,'interaction');
 stored.xAssistantProcessedV1={posts:{'10':{reply:'verified'},'11':{reply:'unknown'},'12':{reply:'in_flight'}}};
 stored.xAssistantNotificationRepliesV1={'/me':{records:{'20':{status:'confirmed'},'21':{status:'unknown'},'22':{status:'in_flight'}}}};
 for(const id of ['10','11','12','20','21','22'])assert.equal((await claim(a,'interaction',i.state.runId,id)).state.claimed,false,id);
 stored.xAssistantNotificationRepliesV1['/other']={records:{'30':{status:'confirmed'}}};assert.equal((await claim(a,'interaction',i.state.runId,'30')).state.claimed,true);
});

test('proven pre-submit release works after stop; unknown is retained and refresh cannot release it',async()=>{
 const a=page(1);await hello(a);const i=await begin(a,'interaction');
 const first=await claim(a,'interaction',i.state.runId,'100');await runtime(a,'interaction','stop',{runId:i.state.runId});
 assert.equal((await settle(a,'interaction',i.state.runId,'100',first.state.claimId,'released')).ok,true);
 const second=await begin(a,'interaction'),claim2=await claim(a,'interaction',second.state.runId,'100');assert.equal(claim2.state.claimed,true);
 await settle(a,'interaction',second.state.runId,'100',claim2.state.claimId,'unknown');
 assert.equal((await settle(a,'interaction',second.state.runId,'100',claim2.state.claimId,'released')).ok,false);
 const pending=await claim(a,'interaction',second.state.runId,'101');await hello(page(1,'new-document','new-instance'));
 assert.equal(stored.xAssistantReplyClaimsV1['/me']['101'].status,'unknown');
 assert.equal((await settle(a,'interaction',second.state.runId,'101',pending.state.claimId,'released')).ok,false);
});

test('搜索开关 storage 事件促使后台重新协调互动工作页',async()=>{
 const tabs=new Map(),created=[],prior={create:chrome.tabs.create,get:chrome.tabs.get,update:chrome.tabs.update};
 chrome.tabs.create=async options=>{const tab={id:80+created.length,url:options.url};tabs.set(tab.id,tab);created.push(tab.id);return tab;};
 chrome.tabs.get=async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);};
 chrome.tabs.update=async(id,options)=>{Object.assign(tabs.get(id),options);return tabs.get(id);};
 try{
  stored.xAssistantManagedServiceV1={enabled:true,account:'/me',selected:{posting:false,interaction:true,notifications:false},workers:{},revision:1};
  stored.xAssistantFriendSearchV1=false;
  events.storage({xAssistantFriendSearchV1:{oldValue:true,newValue:false}},'local');await flush();
  assert.equal(created.length,1);assert.equal(tabs.get(created[0]).url,'https://x.com/home');
  stored.xAssistantFriendSearchV1=true;
  events.storage({xAssistantFriendSearchV1:{oldValue:false,newValue:true}},'local');await flush();
  assert.equal(created.length,1,'切换来源复用互动页，由工作区安全切换路由');
  const w=page(created[0]);const assignment=await hello(w);assert.equal(assignment.state.assignment.sourceMode,'search');
 }finally{Object.assign(chrome.tabs,prior);}
});
