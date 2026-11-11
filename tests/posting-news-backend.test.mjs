import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
const events={},event=name=>({addListener:fn=>events[name]=fn});
let stored={},clock=Date.parse('2026-11-05T04:00:00Z'),nextTab=10;
const tabs=new Map(),writes=[];
globalThis.chrome={
 storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async values=>{writes.push(structuredClone(values));Object.assign(stored,structuredClone(values));},remove:async key=>{delete stored[key];}}},
 runtime:{id:'news',getManifest:()=>({version:'7.5.2'}),getURL:path=>'chrome-extension://news/'+path,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup'),openOptionsPage:async()=>{}},
 action:{onClicked:event('clicked')},
 tabs:{create:async options=>{const tab={id:nextTab++,url:options.url};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('No tab with id: '+id+'.');return tabs.get(id);},update:async(id,options)=>Object.assign(tabs.get(id),options),sendMessage:async()=>{},onRemoved:event('removed'),onUpdated:event('updated')},
 alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:event('alarm')}
};
const realNow=Date.now;Date.now=()=>clock;await import('../background.js');
const panel={id:'news',url:'chrome-extension://news/panel.html'};
const page=id=>({id:'news',url:'https://x.com/home',tab:{id},frameId:0,documentId:'doc-'+id,documentLifecycle:'active'});
const send=(msg,sender=panel)=>new Promise(resolve=>events.message({...msg,...(sender.tab?{instanceId:'instance-'+sender.tab.id}:{})},sender,resolve));
const row=(id='news_1',extra={})=>({id,text:'新闻原文 '+id,enabled:true,newsId:'story_1',variantId:id,...extra});
async function begin(){
 const enabled=await send({kind:'SERVICE_SET',enabled:true,selected:{posting:true},account:'/owner'});assert.ok(enabled.ok,enabled.error);
 const worker=page(enabled.state.workers.posting.tabId);assert.ok((await send({kind:'WORKSPACE_HELLO'},worker)).ok);
 const started=await send({kind:'RUNTIME',module:'posting',action:'begin',account:'/owner'},worker);assert.ok(started.ok,started.error);
 const runtime=(action,extra={})=>send({kind:'RUNTIME',module:'posting',action,runId:started.state.runId,...extra},worker);
 return {runtime,worker,runId:started.state.runId};
}
async function open(runtime,picked){
 assert.ok((await runtime('patch',{patch:{phase:'opening',rowId:picked.id,text:picked.text,libraryRevision:picked.libraryRevision,receipt:null,submittedAt:null}})).ok);
 assert.ok((await runtime('patch',{patch:{phase:'filling'}})).ok);
}
async function confirm(runtime,picked){
 await open(runtime,picked);clock+=1000;
 assert.ok((await runtime('patch',{patch:{phase:'submitting',rowId:picked.id,text:picked.text,submittedAt:new Date(clock).toISOString()}})).ok);
 const result=await runtime('patch',{patch:{phase:'confirmed',completed:1,receipt:{kind:'confirmed',evidence:'visible_post',url:'https://x.com/owner/status/123'}}});assert.ok(result.ok,result.error);return result.state;
}
beforeEach(()=>{clock=Date.parse('2026-11-05T04:00:00Z');stored={app:{rows:[],logs:[],postingCopyMigratedV1:true},xAssistantPostingCopiesV1:{revision:1,rows:[row()]}};nextTab=10;tabs.clear();writes.length=0;});
after(()=>{Date.now=realNow;});

test('confirmed posting deletes exactly that row and an idempotent receipt replay cannot delete again',async()=>{
 const f=await begin(),picked=await f.runtime('pick');assert.ok(picked.ok,picked.error);
 const confirmed=await confirm(f.runtime,picked.state);assert.equal(confirmed.libraryRemaining,0);assert.deepEqual(stored.xAssistantPostingCopiesV1,{revision:2,rows:[]});assert.equal(stored.xAssistantPostingLedgerV1,undefined);
 const atomic=writes.find(value=>value.xAssistantPostingV1?.phase==='confirmed');assert.deepEqual(atomic.xAssistantPostingCopiesV1,{revision:2,rows:[]});assert.ok(atomic.xAssistantPostSchedulesV1,'runtime, deletion and next schedule must share one storage commit');
 assert.ok(writes.every(value=>value.xAssistantPostingLedgerV1===undefined));
 const revision=stored.xAssistantPostingCopiesV1.revision,replay=await f.runtime('patch',{patch:{phase:'confirmed',completed:1,receipt:{kind:'confirmed',evidence:'visible_post',url:'https://x.com/owner/status/123'}}});assert.ok(replay.ok,replay.error);assert.equal(stored.xAssistantPostingCopiesV1.revision,revision);
 assert.equal(stored.xAssistantManagedServiceV1.selected.posting,false,'last successful deletion closes the posting switch');
});

test('enabled rows are selected strictly in library order and each confirmation removes the head',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('off',{enabled:false}),...['c1','c2','c3'].map(id=>row(id))];const f=await begin();
 for(const id of ['c1','c2','c3']){
  const picked=await f.runtime('pick');assert.ok(picked.ok,picked.error);assert.equal(picked.state.id,id);
  const same=await f.runtime('pick');assert.ok(same.ok,same.error);assert.equal(same.state.id,id,'picking alone never advances the ordered queue');
  const confirmed=await confirm(f.runtime,picked.state);assert.equal(stored.xAssistantPostingCopiesV1.rows.some(item=>item.id===id),false);assert.equal(confirmed.libraryRemaining,['c1','c2','c3'].length-['c1','c2','c3'].indexOf(id)-1);
 }
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[row('off',{enabled:false})]);
 assert.equal(stored.xAssistantManagedServiceV1.selected.posting,false);
});

test('a human-reviewed unknown row is retained but disabled before ordered posting continues',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('c1'),row('c2')];const f=await begin(),picked=(await f.runtime('pick')).state;assert.equal(picked.id,'c1');await open(f.runtime,picked);clock+=1000;
 assert.ok((await f.runtime('patch',{patch:{phase:'submitting',rowId:picked.id,text:picked.text,submittedAt:new Date(clock).toISOString()}})).ok);assert.ok((await f.runtime('stop')).ok);
 const resolved=await f.runtime('resolve',{account:'/owner',reviewed:true});assert.ok(resolved.ok,resolved.error);assert.equal(resolved.state.libraryRemaining,1);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(item=>[item.id,item.enabled]),[['c1',false],['c2',true]]);
});

test('only disabled rows block posting; obsolete account, expiry and draft fields are ignored during migration',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('legacy',{enabled:false,status:'draft',targetAccount:'/other',expiresAt:'2000-01-01T00:00:00.000Z',publishMode:'once'})];
 const f=await begin(),picked=await f.runtime('pick');assert.ok(picked.ok,picked.error);assert.equal(picked.state.id,'legacy');assert.equal(picked.state.enabled,true);
 for(const key of ['status','targetAccount','expiresAt','publishMode'])assert.equal(picked.state[key],undefined);
 await f.runtime('stop');await send({kind:'SERVICE_SET',enabled:false});stored.xAssistantPostingCopiesV1={revision:2,rows:[row('off',{enabled:false})]};tabs.clear();
 const denied=await send({kind:'SERVICE_SET',enabled:true,selected:{posting:true},account:'/owner'});assert.equal(denied.ok,false);assert.equal(denied.code,'POST_LIBRARY_EMPTY');
});

test('runtime unknown still stops automatic work but does not create a row status',async()=>{
 const f=await begin(),picked=(await f.runtime('pick')).state;await open(f.runtime,picked);clock+=1000;
 assert.ok((await f.runtime('patch',{patch:{phase:'submitting',rowId:picked.id,text:picked.text,submittedAt:new Date(clock).toISOString()}})).ok);
 assert.ok((await f.runtime('stop')).ok);assert.equal(stored.xAssistantPostingV1.phase,'unknown');assert.equal(stored.xAssistantPostingCopiesV1.rows[0].status,undefined);assert.equal(stored.xAssistantPostingCopiesV1.rows[0].enabled,true);
 await send({kind:'SERVICE_SET',enabled:false});const edit=await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:1}});assert.equal(edit.ok,false);assert.match(edit.error,/未确认|暂停发帖|结果/);
});

test('clear stays locked during posting, but single-row edits do not require stopping',async()=>{
 const f=await begin();const locked=await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:1}});assert.equal(locked.ok,false);
 const old=stored.xAssistantPostingCopiesV1.rows[0],stale=(await f.runtime('pick')).state;
 const saved=await send({kind:'POST_COPIES_OP',op:{action:'upsert',expectedRevision:1,id:old.id,expected:old,row:{...old,enabled:false}}});assert.ok(saved.ok,saved.error);assert.equal(saved.state.rows[0].enabled,false);
 assert.equal(stored.xAssistantManagedServiceV1.selected.posting,false);assert.equal(stored.xAssistantManagedServiceV1.enabled,true);
 assert.equal((await f.runtime('patch',{patch:{phase:'opening',rowId:stale.id,text:stale.text,libraryRevision:stale.libraryRevision}})).ok,false);
});

test('a changed pick cannot enter the composer; reservation locks only the actual current draft through receipt',async()=>{
 stored.xAssistantPostingCopiesV1.rows.push(row('next'),row('later'));
 const f=await begin(),picked=(await f.runtime('pick')).state,schedule=structuredClone(stored.xAssistantPostSchedulesV1);
 const op=(action,id,changes={})=>{const current=stored.xAssistantPostingCopiesV1,expected=current.rows.find(r=>r.id===id);return send({kind:'POST_COPIES_OP',op:{action,id,expected,expectedRevision:current.revision,...(action==='upsert'?{row:{...expected,...changes}}:{})}});};
 assert.ok((await op('upsert',picked.id,{text:'编辑后的原文'})).ok);
 const stale=await f.runtime('patch',{patch:{phase:'opening',rowId:picked.id,text:picked.text,libraryRevision:picked.libraryRevision}});
 assert.equal(stale.code,'POST_COPY_CHANGED');assert.equal(stored.xAssistantPostingV1.phase,'waiting');
 const fresh=(await f.runtime('pick')).state;assert.equal(fresh.text,'编辑后的原文');
 await open(f.runtime,fresh);
 assert.equal((await op('delete',fresh.id)).ok,false);
 assert.ok((await op('upsert','next',{enabled:false})).ok);
 assert.ok((await op('delete','later')).ok);
 assert.equal(stored.xAssistantPostingV1.active,true);assert.deepEqual(stored.xAssistantPostSchedulesV1,schedule);
 assert.ok((await f.runtime('patch',{patch:{phase:'submitting',rowId:fresh.id,text:fresh.text,submittedAt:new Date(clock).toISOString()}})).ok);
 assert.equal((await op('upsert',fresh.id,{enabled:false})).ok,false);
 assert.ok((await f.runtime('patch',{patch:{phase:'confirmed',receipt:{kind:'confirmed'}}})).ok);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(r=>[r.id,r.enabled]),[['next',false]]);
});
