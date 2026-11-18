import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const events={},event=name=>({addListener:fn=>events[name]=fn});
let stored={},clock=Date.parse('2026-11-06T04:00:00Z'),liveAccount='/owner',liveDocument='doc-1',duringProbe=null;
const writes=[],probes=[];
globalThis.chrome={
 storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async values=>{writes.push(structuredClone(values));Object.assign(stored,structuredClone(values));}}},
 runtime:{id:'diagnosticextensionfixture',getManifest:()=>({version:'7.5.2'}),getURL:path=>'chrome-extension://diagnosticextensionfixture/'+path,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup'),openOptionsPage:async()=>{}},
 scripting:{executeScript:async options=>{probes.push(options);duringProbe?.();const result=vm.runInNewContext('('+options.func.toString()+')()',{document:{querySelector:selector=>selector==='[data-testid="AppTabBar_Profile_Link"]'?{getAttribute:()=>liveAccount}:null}});return [{frameId:0,documentId:liveDocument,result}];}},
 action:{onClicked:event('clicked')},tabs:{sendMessage:async()=>{},onRemoved:event('removed'),onUpdated:event('updated')},alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:event('alarm')}
};
const realNow=Date.now;Date.now=()=>clock;await import('../background.js');
const panel={id:'diagnosticextensionfixture',url:'chrome-extension://diagnosticextensionfixture/panel.html'};
const page={id:'diagnosticextensionfixture',url:'https://x.com/home',tab:{id:1},frameId:0,documentId:'doc-1',documentLifecycle:'active'};
const send=(msg,sender=page)=>new Promise(resolve=>events.message({...msg,...(sender.tab?{instanceId:'instance-'+sender.tab.id}:{})},sender,resolve));
const status=(account='/owner',sender=page)=>send({kind:'POST_COPIES_STATUS',account},sender);
const row=(id,extra={})=>({id,text:'private full text '+id,enabled:true,newsId:'news_'+id,...extra});
beforeEach(()=>{
 liveAccount='/owner';liveDocument='doc-1';duringProbe=null;probes.length=0;writes.length=0;
 stored={app:{rows:[],logs:[],postingCopyMigratedV1:true},xAssistantDeepSeekKeyV1:'secret-never-expose',xAssistantPostingCopiesV1:{revision:9,rows:[
  row('draft',{status:'draft',enabled:false,targetAccount:'/owner'}),row('ready',{status:'ready'}),row('published',{status:'published'}),row('unknown',{status:'unknown'}),
  row('expired',{expiresAt:'2000-01-01T00:00:00.000Z'}),row('disabled',{enabled:false}),row('held'),{id:'legacy',text:'legacy private body',enabled:true},row('other',{targetAccount:'/other'})]}};
});
after(()=>{Date.now=realNow;});

test('current registered X page receives only v3 enabled/disabled counts without writes or content',async()=>{
 assert.ok((await send({kind:'WORKSPACE_HELLO'})).ok);const before=structuredClone(stored),writeCount=writes.length;
 const result=await status();assert.ok(result.ok,result.error);const s=result.state;
 assert.equal(s.protocol,2);assert.equal(s.version,'7.5.2');assert.equal(s.extensionId,'diagnosticextensionfixture');assert.equal(s.account,'/owner');assert.equal(s.revision,9);
 assert.deepEqual(s.counts,{enabled:6,disabled:3});assert.equal(s.total,9);assert.equal(s.eligible,6);
 for(const key of ['expired','historyBlocked','unassigned','otherAccounts','rows'])assert.equal(s[key],undefined);
 const serialized=JSON.stringify(s);assert.doesNotMatch(serialized,/secret-never-expose|private full text|legacy private body|sourceUrls|data:image/);
 assert.deepEqual(stored,before);assert.equal(writes.length,writeCount);assert.deepEqual(probes[0].target,{tabId:1,frameIds:[0]});
});
test('unregistered, non-X, iframe and extension-panel sources cannot query diagnostics',async()=>{
 for(const sender of [page,{...page,url:'https://example.com/'},{...page,frameId:1},panel])assert.equal((await status('/owner',sender)).ok,false);
 assert.equal(probes.length,0);
});
test('live account mismatch, detached document and malformed account all fail closed',async()=>{
 await send({kind:'WORKSPACE_HELLO'});assert.equal((await status('/owner/anything')).ok,false);assert.equal(probes.length,0);
 liveAccount='/other';const mismatch=await status();assert.equal(mismatch.ok,false);assert.match(mismatch.error,/账号或页面已变化/);
 liveAccount='/owner';liveDocument='doc-replaced';assert.equal((await status()).ok,false);
});
test('workspace replacement during the read-only DOM probe invalidates the result',async()=>{
 await send({kind:'WORKSPACE_HELLO'});duringProbe=()=>{stored.xAssistantWorkspaceOwnersV1[1].identity='replaced:instance-new';};
 const result=await status();assert.equal(result.ok,false);assert.match(result.error,/页面实例已失效/);
});
test('empty library reports zero enabled and disabled entries',async()=>{
 stored.xAssistantPostingCopiesV1={revision:10,rows:[]};await send({kind:'WORKSPACE_HELLO'});const result=await status();assert.ok(result.ok,result.error);
 assert.equal(result.state.total,0);assert.equal(result.state.eligible,0);assert.deepEqual(result.state.counts,{enabled:0,disabled:0});
});
