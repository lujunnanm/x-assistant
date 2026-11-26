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

test('legacy and mixed media heads are retained while pick, opening and confirmation use the same eligible row',async()=>{
 const mp4='data:video/mp4;base64,'+Buffer.from('\x00\x00\x00\x18ftypisom0000isom0000').toString('base64');
 const legacy=row('legacy',{text:'旧视频 https://x.com/Writer/status/123/video/1'}),mixed=row('mixed',{images:['post-images/photo.png',mp4]});
 stored.xAssistantPostingCopiesV1.rows=[legacy,mixed,row('good1'),row('good2')];
 const f=await begin();
 const wrong=await f.runtime('patch',{patch:{phase:'opening',rowId:legacy.id,text:legacy.text,libraryRevision:1}});
 assert.equal(wrong.code,'POST_COPY_CHANGED');
 for(const [id,remaining] of [['good1',1],['good2',0]]){
  const picked=(await f.runtime('pick')).state;assert.equal(picked.id,id);
  const same=(await f.runtime('pick')).state;assert.equal(same.id,id);
  const confirmed=await confirm(f.runtime,picked);assert.equal(confirmed.libraryRemaining,remaining);
  assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.slice(0,2),[legacy,mixed]);
  assert.equal(stored.xAssistantPostingCopiesV1.rows.some(item=>item.id===id),false);
 }
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[legacy,mixed]);
 assert.equal(stored.xAssistantManagedServiceV1.selected.posting,false);
 const denied=await send({kind:'SERVICE_SET',selected:{posting:true},account:'/owner'});
 assert.equal(denied.code,'POST_LIBRARY_NOT_READY');assert.match(denied.error,/旧媒体链接.*混合媒体.*原条目已保留/);
});

test('a newly unpublishable picked row cannot open and the next eligible row is selected without deleting it',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('first'),row('next')];
 const f=await begin(),stale=(await f.runtime('pick')).state;
 stored.xAssistantPostingCopiesV1={revision:2,rows:[row('first',{text:'https://pbs.twimg.com/media/old.jpg'}),row('next')]};
 const refused=await f.runtime('patch',{patch:{phase:'opening',rowId:stale.id,text:stale.text,libraryRevision:stale.libraryRevision}});
 assert.equal(refused.code,'POST_COPY_CHANGED');
 const fresh=(await f.runtime('pick')).state;assert.equal(fresh.id,'next');assert.equal(fresh.libraryRevision,2);
 await open(f.runtime,fresh);assert.equal(stored.xAssistantPostingCopiesV1.rows[0].enabled,true);
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

test('explicit duplicate rejection disables only bound copy, keeps it and schedules next without recording success',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('dup'),row('next')];
 const f=await begin(),picked=(await f.runtime('pick')).state;await open(f.runtime,picked);
 await f.runtime('patch',{patch:{phase:'submitting',submittedAt:new Date(clock).toISOString()}});
 const r=await f.runtime('patch',{patch:{phase:'rejected',receipt:{kind:'rejected',reason:'duplicate',evidence:'x_notice',message:'哇哦！你已经发过了。'}}});
 assert.ok(r.ok,r.error);assert.equal(r.state.libraryRemaining,1);assert.ok(r.state.nextAt>=clock+60000);
 assert.equal(stored.xAssistantPostingCopiesV1.rows[0].enabled,false);assert.equal(stored.xAssistantPostingCopiesV1.rows.length,2);
 assert.equal((await f.runtime('pick')).state.id,'next');assert.notEqual(r.state.receipt.kind,'confirmed');
});
test('duplicate rejection without a current submission cannot disable a library row',async()=>{
 const f=await begin(),picked=(await f.runtime('pick')).state;await open(f.runtime,picked);
 const r=await f.runtime('patch',{patch:{phase:'rejected',receipt:{kind:'rejected',reason:'duplicate',evidence:'x_notice'}}});
 assert.equal(r.ok,false);assert.equal(stored.xAssistantPostingCopiesV1.rows[0].enabled,true);
});

async function reserveNative(f){
 const picked=(await f.runtime('pick')).state;await open(f.runtime,picked);clock+=1000;
 const attemptSubmittedAt=new Date(clock).toISOString();
 assert.ok((await f.runtime('patch',{patch:{phase:'submitting',submittedAt:attemptSubmittedAt}})).ok);
 return {picked,attemptSubmittedAt};
}
const nativeConfirmed={kind:'confirmed',evidence:'x_create_result',postId:'123',url:'https://x.com/owner/status/123'};
const nativeLimit={kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88};
const nativeTemporary={kind:'not_sent',evidence:'x_create_result',reason:'temporary_rejection',code:130};

test('native success is tied to the current attempt and exact original account post; replay does not remove a reimported row',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('first'),row('next')];
 const f=await begin(),{picked,attemptSubmittedAt}=await reserveNative(f);
 for(const invalid of [
  {attemptSubmittedAt:'stale'}, {receipt:{...nativeConfirmed,url:'https://x.com/other/status/123'}},
  {receipt:{...nativeConfirmed,url:'https://x.com/owner/status/124'}},
  {receipt:{...nativeConfirmed,url:'https://example.net/owner/status/123'}}, {text:'override'},
 ]){
  const r=await f.runtime('patch',{patch:{phase:'confirmed',receipt:nativeConfirmed,attemptSubmittedAt,...invalid}});
  assert.equal(r.ok,false);assert.equal(stored.xAssistantPostingV1.phase,'submitting');
 }
 const patch={phase:'confirmed',receipt:nativeConfirmed,attemptSubmittedAt};
 const success=await f.runtime('patch',{patch});assert.ok(success.ok,success.error);
 assert.equal(success.state.completed,1);assert.equal(success.state.lastPostedAt,clock);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[row('next')]);
 stored.xAssistantPostingCopiesV1.rows.unshift(row(picked.id));
 clock+=3000;
 const replay=await f.runtime('patch',{patch});assert.ok(replay.ok,replay.error);
 assert.equal(replay.state.nextAt,success.state.nextAt);assert.equal(replay.state.completed,1);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows,[row('first'),row('next')]);
});

test('confirmed native send records success without deleting edited media, rewritten text or an already-missing row',async()=>{
 for(const replacement of [row('first',{text:'用户修改了待发稿'}),row('first',{image:'post-images/new.png'}),null]){
  stored.xAssistantPostingCopiesV1={revision:1,rows:[row('first'),row('next')]};
  const f=await begin(),{attemptSubmittedAt}=await reserveNative(f);
  const current=stored.xAssistantPostingCopiesV1={revision:2,rows:[...(replacement?[replacement]:[]),row('next')]};
  const settled=await f.runtime('patch',{patch:{phase:'confirmed',receipt:nativeConfirmed,attemptSubmittedAt}});
  assert.ok(settled.ok,settled.error);assert.equal(settled.state.receipt.postId,'123');
  assert.equal(settled.state.lastPostedAt,clock);assert.ok(settled.state.nextAt>clock);
  assert.deepEqual(stored.xAssistantPostingCopiesV1,current,'published old version must not erase unrelated library edits');
  await f.runtime('stop');await send({kind:'SERVICE_SET',enabled:false});
 }
});

test('verified non-send gives an idempotent account cooldown and retries the same row on the original page',async()=>{
 stored.xAssistantPostingCopiesV1.rows=[row('first'),row('next')];
 const f=await begin(),{picked,attemptSubmittedAt}=await reserveNative(f),initial=structuredClone(stored.xAssistantPostingCopiesV1);
 const until=clock+35*60000,patch={phase:'not_sent',receipt:{...nativeLimit,retryAt:until},attemptSubmittedAt,error:'X 原生限流'};
 const refused=await f.runtime('patch',{patch});assert.ok(refused.ok,refused.error);
 assert.equal(refused.state.nextAt,until);assert.equal(refused.state.lastPostedAt,null);
 assert.equal(stored.xAssistantPostSchedulesV1['/owner'].rateLimitedUntil,until);
 assert.deepEqual(stored.xAssistantPostingCopiesV1,initial);
 clock+=60*60000/2;
 const replay=await f.runtime('patch',{patch});assert.ok(replay.ok,replay.error);
 assert.equal(replay.state.nextAt,until,'ACK replay cannot extend earliest retry');
 const clamped=await f.runtime('patch',{patch:{phase:'waiting',nextAt:clock,error:null}});
 assert.equal(clamped.state.nextAt,until);
 const blocked=[
  await f.runtime('pick'),
  await f.runtime('patch',{patch:{phase:'opening',rowId:picked.id,text:picked.text,libraryRevision:picked.libraryRevision}}),
  await f.runtime('patch',{patch:{phase:'submitting'}}),
  await send({kind:'ACTION_ACQUIRE',module:'posting',runId:f.runId,account:'/owner',actionKind:'post'},f.worker),
 ];
 for(const response of blocked){assert.equal(response.code,'POST_RATE_WAIT');assert.equal(response.retryAt,until);assert.equal(response.httpStatus,undefined);}
 clock=until;
 const retry=await f.runtime('pick');assert.ok(retry.ok,retry.error);assert.equal(retry.state.id,picked.id);
 assert.equal(stored.xAssistantManagedServiceV1.workers.posting.tabId,f.worker.tab.id);
 assert.equal(tabs.size,1);assert.deepEqual(stored.xAssistantPostingCopiesV1,initial);
});

test('native cooldown survives stopping and reload, preserves the owned tab and rejects non-evidence',async()=>{
 const f=await begin(),{attemptSubmittedAt}=await reserveNative(f);
 for(const receipt of [{...nativeLimit,code:503},{...nativeLimit,evidence:'x_notice'},{...nativeLimit,retryAt:'bad'}]){
  const invalid=await f.runtime('patch',{patch:{phase:'not_sent',receipt,attemptSubmittedAt}});
  assert.equal(invalid.ok,false);assert.equal(stored.xAssistantPostingV1.phase,'submitting');
 }
 const invalid=await f.runtime('patch',{patch:{phase:'not_sent',receipt:nativeLimit,attemptSubmittedAt:'stale'}});
 assert.equal(invalid.ok,false);assert.equal(stored.xAssistantPostingV1.receipt,null);
 const acknowledged=await f.runtime('patch',{patch:{phase:'not_sent',receipt:{...nativeLimit,code:429},attemptSubmittedAt,error:'明确未发'}});
 const deadline=clock+30*60000;assert.ok(acknowledged.ok,acknowledged.error);
 assert.equal(acknowledged.state.nextAt,deadline);
 await f.runtime('stop');await send({kind:'SERVICE_SET',enabled:false});await events.installed({reason:'update'});
 const resumed=await begin();assert.equal(resumed.worker.tab.id,f.worker.tab.id);
 assert.equal(tabs.size,1);assert.equal(stored.xAssistantPostingV1.nextAt,deadline);
 assert.equal((await resumed.runtime('pick')).code,'POST_RATE_WAIT');
 clock=deadline;const picked=await resumed.runtime('pick');assert.ok(picked.ok,picked.error);assert.equal(picked.state.id,'news_1');
});

test('explicit temporary rejection holds the same row through 1999 ms, releases at 2000 ms and never bypasses the action gate',async()=>{
 const f=await begin();clock=stored.xAssistantPostingV1.nextAt;
 const binding={module:'posting',runId:f.runId,account:'/owner',actionKind:'post'};
 const firstPermit=await send({kind:'ACTION_ACQUIRE',...binding},f.worker);assert.equal(firstPermit.state.granted,true);
 const {picked,attemptSubmittedAt}=await reserveNative(f),clickedAt=clock;
 assert.ok((await send({kind:'ACTION_SETTLE',...binding,leaseId:firstPermit.state.leaseId,outcome:'attempted'},f.worker)).ok);
 const previous=structuredClone(stored.xAssistantPostingCopiesV1);
 const patch={phase:'not_sent',receipt:nativeTemporary,attemptSubmittedAt};
 const refused=await f.runtime('patch',{patch});assert.ok(refused.ok,refused.error);
 assert.equal(refused.state.nextAt,clickedAt+2000);assert.equal(refused.state.lastPostedAt,null);assert.equal(refused.state.completed,undefined);
 clock=clickedAt+1999;
 const replay=await f.runtime('patch',{patch});assert.equal(replay.state.nextAt,clickedAt+2000);
 assert.equal(stored.xAssistantPostSchedulesV1['/owner'].temporaryRetryUntil,clickedAt+2000);
 assert.equal((await f.runtime('pick')).code,'POST_RETRY_WAIT');
 assert.equal((await send({kind:'ACTION_ACQUIRE',...binding},f.worker)).code,'POST_RETRY_WAIT');
 clock=clickedAt+2000;
 assert.equal((await f.runtime('pick')).state.id,picked.id);
 const gate=await send({kind:'ACTION_ACQUIRE',...binding},f.worker);
 assert.equal(gate.state.granted,false);assert.ok(gate.state.retryAt>clock);
 assert.deepEqual(stored.xAssistantPostingCopiesV1,previous);
 assert.equal(stored.xAssistantManagedServiceV1.workers.posting.tabId,f.worker.tab.id);assert.equal(tabs.size,1);
});

test('repeated explicit temporary rejection retains the 2-second minimum and honors later platform deadlines',async()=>{
 const f=await begin();clock=stored.xAssistantPostingV1.nextAt;
 for(let i=0;i<3;i++){
  const {attemptSubmittedAt}=await reserveNative(f),until=clock+2000;
  for(const receipt of [{...nativeTemporary,code:187},{...nativeTemporary,code:503},{...nativeTemporary,evidence:'x_notice'},{...nativeTemporary,reason:'rate_limit'}]){
   const invalid=await f.runtime('patch',{patch:{phase:'not_sent',receipt,attemptSubmittedAt}});
   assert.equal(invalid.ok,false);assert.equal(stored.xAssistantPostingV1.phase,'submitting');
  }
  const retryAt=i===2?until+10000:undefined;
  if(i===2)stored.xAssistantPostSchedulesV1['/owner'].rateLimitedUntil=until+20000;
  const rejected=await f.runtime('patch',{patch:{phase:'not_sent',receipt:{...nativeTemporary,...(retryAt?{retryAt}:{})},attemptSubmittedAt}});
  assert.ok(rejected.ok,rejected.error);assert.equal(rejected.state.nextAt,i===2?until+20000:until);
  assert.equal(stored.xAssistantPostSchedulesV1['/owner'].temporaryRetryUntil,retryAt||until);
  clock=rejected.state.nextAt;
 }
 assert.equal(stored.xAssistantPostingCopiesV1.rows[0].enabled,true);
});
