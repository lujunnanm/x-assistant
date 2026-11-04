import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const KEY='xAssistantNotificationRepliesV1', BASE=Date.UTC(2026,10,2);
const scripts=['task-utils.js','notification-policy.js','notifications.js'].map(n=>readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const row=(id,age=1000,extra={})=>({id,author:'person'+id,at:BASE-age,time:new Date(BASE-age).toISOString(),text:'hello '+id,addressed:true,...extra});
function fixture({rows=[row('1')],db={},processed={},generate,send,patchFailure,loading=false,missingNav=false,absoluteNav=false,draft=false}={}){
 let now=BASE,scrolls=0,top=0,pauses=0,resumes=0;
 const storage={[KEY]:{'/me':structuredClone(db)},xAssistantProcessedV1:{posts:processed}}, generated=[],sent=[],order=[],delays=[],patches=[];
 const controller=new AbortController(),location={pathname:'/home'};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const links=(missingNav?[]:['/home','/notifications','/notifications/mentions']).map(href=>({getAttribute:()=>absoluteNav?'https://x.com'+href+'/?filter=all':href,click:()=>{location.pathname=href;order.push('nav:'+href);}}));
 const context=vm.createContext({Date:Clock,URL,DOMException,Error,setTimeout,clearTimeout,AbortController,innerHeight:900,location,
  chrome:{storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async data=>Object.assign(storage,structuredClone(data))}}},
  history:{state:null,pushState:(_s,_t,path)=>{location.pathname=path;order.push('spa:'+path);}},PopStateEvent:class{},
  document:{querySelectorAll:selector=>selector==='[contenteditable="true"]'?(draft?[{}]:[]):links,querySelector:()=>loading?{}:null},
  window:{dispatchEvent:()=>{},scrollTo:()=>{top++;scrolls=0;},scrollBy:()=>scrolls++},
  XAssistantRuntime:{sleep:async ms=>{delays.push(ms);now+=ms;},runtime:async(_module,action,{patch}={})=>{if(patch){patches.push(patch);if(patchFailure)patchFailure(patch,storage);}return{phase:'waiting'};},call:async msg=>{generated.push(msg.post.id);return generate?generate(msg,{advance:ms=>now+=ms,controller}):{postId:msg.post.id,action:'send_reply',text:'reply'};}},
  XAssistantDOM:{account:()=>'/me',dialogs:()=>[],rows:()=>typeof rows==='function'?rows(scrolls):rows},
  XAssistantTime:{ms:()=>15000},XAssistantCore:{editorText:()=>draft?'unsent draft':'',randomSeconds:(min,max)=>{assert.equal(min,3);assert.equal(max,5);return 4;}},
  XAssistantPopup:{cancel:async()=>true},XAssistantInteraction:{pause:async()=>{pauses++;return{};},resume:async()=>{resumes++;}},
  XAssistantReplyEngine:{send:async opts=>{order.push('before:'+opts.row.id);await opts.onBeforeSubmit();assert.equal(storage[KEY]['/me'].records[opts.row.id].status,'in_flight');if(send)return send(opts,{sent,order,advance:ms=>now+=ms});sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});order.push('confirmed:'+opts.row.id);}}
 });
 scripts.forEach(s=>vm.runInContext(s,context));
 const scan=options=>context.XAssistantNotifications.scan({account:'/Me',runId:'run',signal:controller.signal,...options});
 return{scan,context,storage,generated,sent,order,delays,patches,controller,advance:ms=>now+=ms,db:()=>storage[KEY]['/me'],now:()=>now,nav:()=>location.pathname,counts:()=>({scrolls,top,pauses,resumes})};
}
test('latest-first replies reserve before sending, confirm, use configured cooldown, then rest',async()=>{
 const f=fixture({rows:[row('old',9000),row('new',1000),row('mid',5000)]});
 const result=await f.scan();
 assert.deepEqual(f.sent,['new','mid','old']);assert.equal(result.complete,true);assert.equal(result.stats.confirmed,3);
 for(const id of f.sent)assert.equal(f.db().records[id].status,'confirmed');
 assert.ok(f.now()>=BASE+12000);assert.equal(f.db().nextAt,0);assert.equal(f.nav(),'/home');assert.equal(f.counts().resumes,1);
 assert.ok(f.patches.some(p=>p.phase==='notification_scan'));
});
test('only confirmed records exclude repeats; failed, skipped and legacy batchSeen retry next window',async()=>{
 const f=fixture({rows:['1','2','3','4','5'].map(id=>row(id)),db:{records:{'1':{status:'confirmed'},'2':{status:'skipped'},'3':{status:'failed'},'4':{status:'skipped_updated'}},batchSeen:{'2':true,'3':true,'5':true},batchUntil:BASE},processed:{'5':{reply:'verified'}}});
 await f.scan();assert.deepEqual(f.sent,['2','3','4']);assert.equal(f.db().batchSeen,undefined);assert.equal(f.db().batchUntil,undefined);
 await f.scan();assert.deepEqual(f.sent,['2','3','4']);
});
test('a skipped AI choice is tried only once in a window, but eligible in the next',async()=>{
 let skip=true;const f=fixture({generate:msg=>({postId:msg.post.id,action:skip?'skip':'send_reply',text:'ok'})});
 const first=await f.scan();assert.equal(first.stats.aiSkipped,1);assert.equal(f.db().records['1'].status,'skipped');
 skip=false;await f.scan();assert.deepEqual(f.sent,['1']);
});
test('generation failures are separate from AI choices and can recover next window',async()=>{
 let broken=true;const f=fixture({generate:msg=>broken?{postId:msg.post.id,action:'skip',skippedGenerationError:true,reasonCode:'AI_NETWORK',reason:'连接失败'}:{postId:msg.post.id,action:'send_reply',text:'ok'}});
 const first=await f.scan();assert.equal(first.stats.aiFailed,1);assert.equal(first.stats.aiSkipped,0);assert.equal(first.complete,true);assert.equal(f.db().records['1'].reasonCode,'AI_NETWORK');
 broken=false;await f.scan();assert.deepEqual(f.sent,['1']);
});
test('work-window expiry during generation creates no phantom attempted record',async()=>{
 let late=true;const f=fixture({generate:(msg,{advance})=>{if(late)advance(45000);return{postId:msg.post.id,action:'send_reply',text:'ok'};}});
 const first=await f.scan({yieldAt:BASE+40000,cooldownSlot:true});assert.equal(first.reason,'yield');assert.equal(f.sent.length,0);assert.equal(f.db().records['1'],undefined);
 late=false;await f.scan();assert.deepEqual(f.sent,['1']);
});
test('after a target update, next candidate is sent and updated target remains retryable',async()=>{
 let stale=true;const f=fixture({rows:[row('1'),row('2',2000)],send:async(opts,{sent})=>{if(opts.row.id==='1'&&stale)throw Object.assign(Error('目标帖子已更新'),{code:'TARGET_UPDATED',submitted:false});sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});}});
 let result=await f.scan();assert.deepEqual(f.sent,['2']);assert.equal(result.stats.failed,1);assert.equal(f.db().records['1'].reasonCode,'TARGET_UPDATED');
 stale=false;await f.scan();assert.deepEqual(f.sent,['2','1']);
});
test('popup cancellation skips this attempt without conflating target and editor failures',async()=>{
 const f=fixture({send:async()=>{throw Object.assign(Error('回复框已有残留'),{code:'RESIDUAL_DRAFT',submitted:false});}});
 const result=await f.scan();assert.equal(result.stats.failed,1);assert.equal(f.db().records['1'].status,'skipped_issue');assert.equal(f.db().records['1'].reasonCode,'RESIDUAL_DRAFT');assert.equal(result.complete,true);
 await f.scan();assert.equal(f.generated.length,1);
});
test('unknown send is archived for that row and the scanner continues with the next row',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)],send:async(opts,{sent})=>{if(opts.row.id==='1')throw Object.assign(Error('结果未知'),{code:'SEND_UNKNOWN',submitted:true});sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});}});
 const result=await f.scan();assert.equal(result.stats.failed,1);assert.equal(f.db().records['1'].status,'unknown');assert.deepEqual(f.sent,['2']);
 await f.scan();assert.deepEqual(f.generated,['1','2']);assert.deepEqual(f.sent,['2']);
});
test('confirmed receipt survives a later persistence error without becoming unknown',async()=>{
 const f=fixture({send:async opts=>{await opts.onConfirmed({kind:'confirmed'});throw Object.assign(Error('runtime save failed'),{confirmed:true,submitted:true});}});
 await assert.rejects(f.scan(),/runtime save failed/);assert.equal(f.db().records['1'].status,'confirmed');await f.scan();assert.equal(f.generated.length,1);
});
test('abort before click clears the false in-flight reservation and can retry',async()=>{
 const f=fixture({send:async()=>{throw Object.assign(new DOMException('stopped','AbortError'),{submitted:false});}});
 await assert.rejects(f.scan(),e=>e.name==='AbortError');assert.equal(f.db().records['1'].status,'failed');assert.equal(f.db().records['1'].reasonCode,'INTERRUPTED_BEFORE_SEND');
});
test('Grok, self, body mentions, stale and future replies never reach AI',async()=>{
 const f=fixture({rows:[row('g',1000,{author:'GROK'}),row('self',1000,{author:'me'}),row('mention',1000,{addressed:false}),row('stale',86400001),row('future',-1),row('valid')]});
 const result=await f.scan();assert.deepEqual(f.generated,['valid']);assert.equal(result.stats.excluded.grok,1);assert.equal(result.stats.excluded.not_addressed,1);assert.equal(f.context.XAssistantNotifications.shouldIgnore('grokfan'),false);
});
test('old interaction unknown records are skipped while later eligible rows continue',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)],processed:{'1':{reply:'unknown'}}});await f.scan();assert.deepEqual(f.generated,['2']);assert.deepEqual(f.sent,['2']);
});
test('rolling 24-hour boundary rechecked after AI generation',async()=>{
 const f=fixture({rows:[row('1',86400000-1000)],generate:(msg,{advance})=>{advance(2000);return{postId:msg.post.id,action:'send_reply',text:'ok'};}});
 await f.scan();assert.equal(f.sent.length,0);assert.equal(f.db().records['1'],undefined);
});
test('new arrivals later than window start wait until next work window',async()=>{
 const f=fixture({rows:[row('1',-1000)]});await f.scan();assert.equal(f.sent.length,0);await f.scan();assert.deepEqual(f.sent,['1']);
});
test('notifications freshly parse DOM after every attempted reply',async()=>{
 let list=[row('1')];const f=fixture({rows:()=>list,send:async(opts,{sent})=>{sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});list=opts.row.id==='1'?[row('2',2000)]:[];}});
 await f.scan();assert.deepEqual(f.sent,['1','2']);
});
test('100 changing screens rest, not fatal stop or false completion',async()=>{
 const f=fixture({rows:screen=>[row(String(screen),1000,{author:'Grok'})]});const result=await f.scan();assert.equal(result.reason,'scan_limit');assert.equal(result.rest,true);assert.equal(result.complete,false);
});
test('loading stalls rest without marking scan complete',async()=>{
 const f=fixture({rows:[],loading:true});const result=await f.scan();assert.equal(result.complete,false);assert.equal(result.rest,true);
});
test('all notification scans acquire the interaction handoff',async()=>{
 const f=fixture({rows:[]});await f.scan({cooldownSlot:true});assert.equal(f.counts().pauses,1);await f.scan();assert.equal(f.counts().pauses,2);
});
test('overlapping scans rejected rather than sharing mutable session globals',async()=>{
 let resolve;const f=fixture({generate:msg=>new Promise(r=>{resolve=()=>r({postId:msg.post.id,action:'skip'});})});
 const first=f.scan();await new Promise(r=>setImmediate(r));assert.ok(resolve);
 await assert.rejects(f.scan(),/正在执行/);resolve();await first;
});
test('pure policy accepts exact 24h boundary and ignores invalid timestamps',()=>{
 const f=fixture(),p=f.context.XAssistantNotificationPolicy;
 assert.equal(p.recent(BASE-86400000,BASE),true);assert.equal(p.recent(BASE-86400001,BASE),false);assert.equal(p.recent(NaN,BASE),false);assert.equal(p.recent(BASE+1,BASE),false);
 assert.deepEqual(Array.from(p.newestFirst([{at:1},{at:3},{at:NaN},{at:2}]),r=>r.at),[3,2,1]);
});

test('post-confirmation scan-state save failure never overwrites confirmed record',async()=>{
 const f=fixture({patchFailure:(patch,storage)=>{if(patch.phase==='notification_scan'&&storage[KEY]['/me'].records?.['1']?.status==='confirmed')throw Error('scan state write failed');}});
 await assert.rejects(f.scan(),/scan state write failed/);assert.equal(f.db().records['1'].status,'confirmed');
});

test('missing navigation uses SPA fallback without stranding the scan',async()=>{const f=fixture({rows:[],missingNav:true});const result=await f.scan();assert.equal(result.complete,true);assert.ok(f.order.includes('spa:/notifications/mentions'));assert.equal(f.nav(),'/home');assert.equal(f.sent.length,0);});
test('absolute notification links with query and trailing slash stay same-origin',async()=>{const f=fixture({rows:[],absoluteNav:true});await f.scan();assert.ok(f.order.includes('nav:/notifications/mentions'));assert.ok(!f.order.some(x=>x.startsWith('spa:')));});
test('missing navigation never overwrites an inline draft',async()=>{const f=fixture({missingNav:true,draft:true});await assert.rejects(f.scan(),/内联草稿/);assert.equal(f.order.length,0);assert.equal(f.sent.length,0);});

for(const outcome of ['skip','generation_failure','success'])test('notification cooldown: '+outcome,async()=>{
 const starts=[];let f;
 f=fixture({rows:[row('a'),row('b')],generate:msg=>{
  starts.push(f.now());
  return outcome==='skip'?{postId:msg.post.id,action:'skip'}:outcome==='generation_failure'?{postId:msg.post.id,action:'skip',skippedGenerationError:true,reason:'生成格式错误'}:{postId:msg.post.id,action:'send_reply',text:'reply'};
 }});
 await f.scan();assert.equal(starts.length,2);assert.equal(starts[1]-starts[0],outcome==='success'?15000:0);
 assert.equal(f.sent.length,outcome==='success'?2:0);
});
test('failed AI generations leave rows retryable and continue to the next candidate',async()=>{
 const f=fixture({rows:[row('a'),row('b')],generate:msg=>({postId:msg.post.id,action:'skip',skippedGenerationError:true,reason:'连接失败'})});
 const result=await f.scan();assert.equal(f.generated.length,2);assert.equal(f.sent.length,0);assert.equal(result.stats.aiFailed,2);
 assert.equal(f.db().records.a.status,'ai_error');
});
test('successful-reply cooldown honors stop requests',async()=>{
 const f=fixture({rows:[row('a'),row('b')]});
 await assert.rejects(f.scan({show:text=>{if(text.startsWith('下一条'))f.controller.abort();}}),e=>e.name==='AbortError');assert.equal(f.generated.length,1);assert.equal(f.sent.length,1);
});

test('leaving notifications during AI generation rests without sending the stale result',async()=>{
 let f;f=fixture({generate:msg=>{f.context.location.pathname='/search';f.context.location.search='?q=test';return{postId:msg.post.id,action:'send_reply',text:'stale'};}});
 const result=await f.scan();assert.equal(result.reason,'page_changed');assert.equal(result.rest,true);assert.equal(result.complete,false);
 assert.equal(f.sent.length,0);assert.equal(f.db().records['1'],undefined);assert.equal(f.nav(),'/search');
 assert.equal(f.db().lastScan.page,'/search?q=test');assert.equal(f.counts().resumes,0);
});
test('navigation during cooldown ends the round before generating another reply',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)]});
 const result=await f.scan({show:text=>{if(text.startsWith('下一条'))f.context.location.pathname='/search';}});
 assert.equal(result.reason,'page_changed');assert.deepEqual(f.sent,['1']);assert.deepEqual(f.generated,['1']);
 assert.equal(f.db().records['1'].status,'confirmed');assert.equal(f.db().records['2'],undefined);
});
test('navigation while scrolling is a recoverable end of batch, not a fatal error',async()=>{
 const f=fixture({rows:[]});f.context.window.scrollBy=()=>{f.context.location.pathname='/home';};
 const result=await f.scan();assert.equal(result.reason,'page_changed');assert.equal(f.db().lastScan.reason,'page_changed');assert.equal(f.sent.length,0);
});
test('changed-page scan does not mark an unsent target processed and retries it next window',async()=>{
 let move=true,f;f=fixture({generate:msg=>{if(move){move=false;f.context.location.pathname='/search';}return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 await f.scan();assert.equal(f.sent.length,0);await f.scan();assert.deepEqual(f.sent,['1']);assert.equal(f.db().records['1'].status,'confirmed');
});
test('a page change with an inline draft remains blocked without navigation or sending',async()=>{
 let f;f=fixture({generate:msg=>{f.context.location.pathname='/search';f.context.document.querySelectorAll=()=>[{}];f.context.XAssistantCore.editorText=()=> 'user draft';return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 await assert.rejects(f.scan(),e=>e.code==='RESIDUAL_DRAFT');assert.equal(f.sent.length,0);assert.equal(f.nav(),'/search');assert.equal(f.counts().resumes,0);
});
test('a page change with an open dialog is not treated as a safe handoff',async()=>{
 let f;f=fixture({generate:msg=>{f.context.location.pathname='/compose/post';f.context.XAssistantDOM.dialogs=()=>[{}];return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 await assert.rejects(f.scan(),e=>e.code==='CLEANUP_FAILED');assert.equal(f.sent.length,0);assert.equal(f.counts().resumes,0);
});
test('page change preserves unknown-send evidence while safely ending the batch',async()=>{
 for(const code of ['SEND_UNKNOWN','PAGE_CHANGED']){
  let f;f=fixture({send:async()=>{f.context.location.pathname='/search';throw Object.assign(Error('unknown receipt'),{code,submitted:true});}});
  const result=await f.scan();assert.equal(result.reason,'page_changed');assert.equal(f.db().records['1'].status,'unknown');assert.equal(f.counts().resumes,0);
 }
});
test('account change takes precedence over a recoverable navigation change',async()=>{
 let f;f=fixture({generate:msg=>{f.context.location.pathname='/search';f.context.XAssistantDOM.account=()=>'/another';return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 await assert.rejects(f.scan(),e=>e.code==='ACCOUNT_CHANGED');assert.equal(f.sent.length,0);assert.equal(f.counts().resumes,0);
});
