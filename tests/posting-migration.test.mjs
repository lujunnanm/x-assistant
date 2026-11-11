import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';

const events={},on=name=>({addListener:fn=>{events[name]=fn;}});
let stored={},clock=Date.parse('2026-11-04T04:00:00Z'),nextTab=10;
const tabs=new Map(),created=[];
globalThis.chrome={
 storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async values=>Object.assign(stored,structuredClone(values)),remove:async key=>{for(const item of Array.isArray(key)?key:[key])delete stored[item];}}},
 runtime:{id:'copy-migration',getURL:path=>'chrome-extension://copy-migration/'+path,onMessage:on('message'),onInstalled:on('installed'),onStartup:on('startup'),openOptionsPage:async()=>{}},
 action:{onClicked:on('clicked')},
 tabs:{create:async options=>{created.push(options);const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('missing tab');return tabs.get(id);},update:async(id,options)=>Object.assign(tabs.get(id),options),sendMessage:async()=>{},onRemoved:on('removed'),onUpdated:on('updated')},
 alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:on('alarm')}
};
const realNow=Date.now;Date.now=()=>clock;await import('../background.js');
const panel={id:'copy-migration',url:'chrome-extension://copy-migration/panel.html'};
const page={id:'copy-migration',url:'https://x.com/home',tab:{id:1},frameId:0,documentId:'doc-1',documentLifecycle:'active'};
const send=(msg,sender=panel)=>new Promise(resolve=>events.message(msg,sender,resolve));
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
beforeEach(()=>{stored={};clock=Date.parse('2026-11-04T04:00:00Z');tabs.clear();created.length=0;nextTab=10;});

test('upgrade backs up old rows once, clears old bank, leaves new bank empty and preserves unknown evidence',async()=>{
 const old=[{id:'legacy',type:'post',enabled:true,text:'旧文案'}];
 stored.app={rows:old,logs:[{time:'t',message:'保留日志'}],revision:7};
 stored.xAssistantPostingV1={active:false,phase:'unknown',runId:'unknown-run',rowId:'legacy',text:'发送结果未知'};
 events.installed({reason:'update'});await settle();
 assert.deepEqual(stored.app.rows,[]);
 assert.equal(stored.app.postingCopyMigratedV1,true);
 assert.deepEqual(stored.xAssistantLegacyCopyBackupV1.rows,old);
 assert.equal(stored.xAssistantLegacyCopyBackupV1.revision,7);
 assert.ok(stored.xAssistantLegacyCopyBackupV1.backedUpAt);
 assert.equal(stored.app.logs.some(entry=>entry.message==='保留日志'),true);
 assert.equal(stored.xAssistantPostingV1.phase,'unknown');
 assert.equal(stored.xAssistantPostingV1.text,'发送结果未知');
 assert.deepEqual((await send({kind:'POST_COPIES_GET'})).state,{revision:0,rows:[]});
 const locked=await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:0}});
 assert.equal(locked.ok,false,'unknown old send must be reviewed before editing the new bank');
 const backup=structuredClone(stored.xAssistantLegacyCopyBackupV1);
 events.installed({reason:'update'});await settle();
 assert.deepEqual(stored.xAssistantLegacyCopyBackupV1,backup,'repeat install never overwrites the first backup');
 assert.deepEqual(stored.app.rows,[]);
});

test('v7.4 posting states migrate to v3-style enable flags and the once-only ledger is removed',async()=>{
 stored.app={rows:[],logs:[],revision:3,postingCopyMigratedV1:true};
 stored.xAssistantPostingCopiesV1={revision:9,rows:[
  {id:'draft',text:'旧草稿',enabled:false,status:'draft',targetAccount:'@old',expiresAt:'2026-12-01T00:00:00.000Z',publishMode:'once'},
  {id:'ready',text:'旧待发',enabled:true,status:'ready',targetAccount:'@old',publishMode:'once'},
  {id:'published',text:'旧已发布',enabled:true,status:'published',publishedAt:'2026-11-01T00:00:00.000Z',postUrl:'https://x.com/old/status/1'},
  {id:'unknown',text:'旧未知',enabled:true,status:'unknown'}
 ]};
 stored.xAssistantPostingLedgerV1={published:{published:{at:1}},fingerprints:{abc:{at:1}}};
 events.installed({reason:'update'});await settle();
 assert.equal(stored.xAssistantPostingCopiesV1.revision,10);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[
  {id:'draft',text:'旧草稿',enabled:true},
  {id:'ready',text:'旧待发',enabled:true},
  {id:'published',text:'旧已发布',enabled:false},
  {id:'unknown',text:'旧未知',enabled:false}
 ]);
 assert.equal(stored.xAssistantPostingLedgerV1,undefined);
 assert.equal(stored.app.schemaVersion,3);
 assert.equal(stored.app.postingCopySimpleV1,true);
 assert.equal(stored.app.postingCopyOrderedDeleteV1,true);
 assert.equal(stored.xAssistantManagedServiceV1?.enabled,false);
});

test('upgrade removes the AI image caption and its source link from existing publish text',async()=>{
 stored.app={rows:[],logs:[],revision:3,postingCopyMigratedV1:true};
 stored.xAssistantPostingCopiesV1={revision:4,rows:[{id:'captioned',text:'正文\n\n（AI概念配图）\nhttps://example.com/news',enabled:true,sourceUrls:['https://example.com/news'],image:'post-images/real.png'}]};
 events.installed({reason:'update'});await settle();
 assert.equal(stored.xAssistantPostingCopiesV1.revision,5);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[{id:'captioned',text:'正文',enabled:true,image:'post-images/real.png',sourceUrls:['https://example.com/news']}]);
});

test('empty new bank rejects posting enable even if legacy rows exist, without a worker',async()=>{
 stored.app={rows:[{id:'legacy',type:'post',enabled:true,text:'旧库不能启用发帖'}],logs:[],postingCopyMigratedV1:true};
 const result=await send({kind:'SERVICE_SET',enabled:true,selected:{posting:true},account:'/me'});
 assert.equal(result.ok,false);
 assert.match(result.error,/文案|空|发帖/);
 assert.equal(created.length,0);
 assert.notEqual(stored.xAssistantManagedServiceV1?.enabled,true);
 assert.notEqual(stored.xAssistantManagedServiceV1?.selected?.posting,true);
});

test('panel can save pasted post copy exactly, work pages cannot write it, and old rows remain unused',async()=>{
 stored.app={rows:[],logs:[],postingCopyMigratedV1:true};
 const text='  第一行，原样！\n第二行 #标签 @grok  ';
 const op={action:'upsert',id:'pasted',expected:null,row:{id:'pasted',text,enabled:true},expectedRevision:0};
 const saved=await send({kind:'POST_COPIES_OP',op});assert.equal(saved.ok,true,saved.error);
 assert.deepEqual((await send({kind:'POST_COPIES_GET'})).state.rows,[{id:'pasted',text,enabled:true}]);
 assert.deepEqual(stored.app.rows,[]);
 const untrusted=await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:1}},page);
 assert.equal(untrusted.ok,false);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[{id:'pasted',text,enabled:true}]);
 const enabled=await send({kind:'SERVICE_SET',enabled:true,selected:{posting:true},account:'/me'});
 assert.equal(enabled.ok,true,enabled.error);
 assert.equal(enabled.state.selected.posting,true);
 assert.equal(created.length,1);
 const denied=await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:1}});
 assert.equal(denied.ok,false,'editing is locked while posting is enabled');
});

test('interaction and reply may stay enabled while the new posting bank is edited',async()=>{
 stored.app={rows:[],logs:[],postingCopyMigratedV1:true};
 const enabled=await send({kind:'SERVICE_SET',enabled:true,selected:{interaction:true,notifications:true},account:'/me'});
 assert.equal(enabled.ok,true,enabled.error);
 assert.equal(enabled.state.selected.posting,false);
 assert.deepEqual(Object.keys(enabled.state.workers).sort(),['interaction','notifications']);
 const result=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:'new',expected:null,row:{id:'new',text:'粘贴内容',enabled:true},expectedRevision:0}});
 assert.equal(result.ok,true,result.error);
 assert.equal(stored.xAssistantManagedServiceV1.enabled,true);
 assert.deepEqual(Object.keys(stored.xAssistantManagedServiceV1.workers).sort(),['interaction','notifications']);
});

test('clearing the bank while master is off cannot be bypassed by enabling master with posting still selected',async()=>{
 stored.app={rows:[],logs:[],postingCopyMigratedV1:true};
 const row={id:'one',text:'准备发布的原文',enabled:true};
 assert.equal((await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:row.id,expected:null,row,expectedRevision:0}})).ok,true);
 assert.equal((await send({kind:'SERVICE_SET',selected:{posting:true},account:'/me'})).ok,true);
 assert.equal((await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:1}})).ok,true);
 const denied=await send({kind:'SERVICE_SET',enabled:true,account:'/me'});
 assert.equal(denied.code,'POST_LIBRARY_EMPTY');
 assert.notEqual(stored.xAssistantManagedServiceV1.enabled,true);
 assert.equal(created.length,0);
});

after(()=>{Date.now=realNow;});
