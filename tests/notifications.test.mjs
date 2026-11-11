import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const KEY='xAssistantNotificationRepliesV1', BASE=Date.UTC(2026,10,2);
const scripts=['task-utils.js','notification-policy.js','interaction-fallback-library.js','notifications.js'].map(n=>readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const row=(id,age=1000,extra={})=>({id,author:'person'+id,at:BASE-age,time:new Date(BASE-age).toISOString(),text:'hello '+id,addressed:true,...extra});
function fixture({rows=[row('1')],db={},processed={},generate,send,patchFailure,loading=false,missingNav=false,absoluteNav=false,draft=false,preliked=[],beforeLike,beforeLikeValidate,afterLike,unconfirmedLike=false,onLike,rootCount=null,rootReady=()=>true,selected=()=>true,explicitEmpty=true,excludedSpinner=false,directChild=()=>true,metadataDirect=0,startPath='/home',originalRoot=()=>true,inThread=(id,root)=>id!==root,shared={},foldControls=[]}={}){
 let now=BASE,scrolls=0,top=0,pauses=0,resumes=0;
 const storage={[KEY]:{'/me':structuredClone(db)},xAssistantProcessedV1:{posts:processed},xAssistantReplyClaimsV1:{'/me':shared}}, generated=[],sent=[],order=[],delays=[],patches=[],liked=new Set(preliked),likeClicks=[];
 const controller=new AbortController(),location={pathname:startPath};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const links=(missingNav?[]:['/home','/notifications','/notifications/mentions']).map(href=>({getAttribute:()=>absoluteNav?'https://x.com'+href+'/?filter=all':href,click:()=>{location.pathname=href;order.push('nav:'+href);}}));
 let detail=null,rootLink=null;
 const rawRows=()=>typeof rows==='function'?rows(scrolls,now-BASE):rows;
 const main={contains:a=>!a.aside,
   querySelector:selector=>selector.includes('aria-selected')&&selected(now-BASE)?{getAttribute:()=>'/notifications/mentions'}:selector.includes('emptyState')&&explicitEmpty&&!loading&&!rawRows().length?{}:null,
   querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?domRows().map(r=>r.article):selector.startsWith('button')?foldControls:selector.includes('progressbar')&&(loading||excludedSpinner)?[{closest:()=>excludedSpinner?{}:null}]:[]};
 const fakeRoot=()=>detail&&rootReady(now-BASE,location.pathname)?[{...row(detail.rootId,1000,{author:'me',replyCount:rootCount}),article:{isConnected:true,stamp:{link:rootLink,id:detail.rootId,author:'me'},querySelector:()=>({closest:()=>null})}}]:[];
 const decorate=r=>({...r,article:{isConnected:true,querySelectorAll:selector=>selector==='[data-testid="unlike"]'?(liked.has(r.id)?[{}]:[]):selector==='[data-testid="like"]'&&!liked.has(r.id)?[{disabled:false,click:()=>{onLike?.(r,storage);likeClicks.push(r.id);if(!unconfirmedLike)liked.add(r.id);}}]:[]}});
 const domRows=()=>[...rawRows().map(decorate),...fakeRoot()];
 const context=vm.createContext({Date:Clock,URL,DOMException,Error,setTimeout,clearTimeout,AbortController,innerHeight:900,location,
  chrome:{storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async data=>Object.assign(storage,structuredClone(data))}}},
  history:{state:null,pushState:(_s,_t,path)=>{location.pathname=path;order.push('spa:'+path);}},PopStateEvent:class{},
  document:{querySelectorAll:selector=>selector==='[contenteditable="true"]'?(draft?[{}]:[]):links,querySelector:sel=>sel.includes('primaryColumn')?main:loading?{}:null},
  window:{dispatchEvent:()=>{},scrollTo:()=>{top++;scrolls=0;},scrollBy:()=>scrolls++},
  XAssistantRuntime:{sleep:async ms=>{delays.push(ms);now+=ms;},runtime:async(_module,action,{patch}={})=>{if(patch){patches.push(patch);if(patchFailure)patchFailure(patch,storage);}return{phase:'waiting'};},call:async msg=>{generated.push(msg.post.id);return generate?generate(msg,{advance:ms=>now+=ms,controller}):{postId:msg.post.id,action:'send_reply',text:'reply'};}},
  XAssistantActions:{click:async()=>assert.fail('回帖模块不得申请点赞许可')},
  XAssistantDOM:{account:()=>'/me',dialogs:()=>[],rows:domRows,statusStamp:a=>a.stamp,beginDetailRead:()=>()=>{},loadedDirectChildren:()=>metadataDirect,inThread,originalPost:originalRoot,directChildOf:id=>directChild(id),directOnOwnOriginal:id=>directChild(id)&&rawRows().some(r=>r.id===id&&r.ownOriginalComment===true),relocate:row=>domRows().find(current=>current.id===row.id&&current.author===row.author)||null},
  XAssistantTime:{ms:()=>15000},XAssistantCore:{editorText:()=>draft?'unsent draft':'',randomSeconds:(min,max)=>{assert.equal(min,3);assert.equal(max,5);return 4;}},
  XAssistantPopup:{cancel:async()=>true},XAssistantInteraction:{pause:async()=>{pauses++;return{};},resume:async()=>{resumes++;}},
  XAssistantReplyEngine:{send:async opts=>{order.push('before:'+opts.row.id);await opts.onBeforeSubmit();assert.equal(storage[KEY]['/me'].records[opts.row.id].status,'in_flight');if(send)return send(opts,{sent,order,advance:ms=>now+=ms});sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});order.push('confirmed:'+opts.row.id);}}
 });
 scripts.forEach(s=>vm.runInContext(s,context));
 const scan=options=>{
   detail=options?.rootId?options:null;
   rootLink=detail?{getAttribute:()=>detail.threadPath,click:()=>{location.pathname=detail.threadPath;order.push('nav:'+detail.threadPath);}}:null;
   return context.XAssistantNotifications.scan({account:'/Me',runId:'run',signal:controller.signal,...options});
 };
 return{scan,context,storage,generated,sent,order,delays,patches,likeClicks,liked,controller,advance:ms=>now+=ms,db:()=>storage[KEY]['/me'],now:()=>now,nav:()=>location.pathname,counts:()=>({scrolls,top,pauses,resumes})};
}
test('pending original retry verifies its rendered root, thread membership and existing reply records',async()=>{
 const path='/me/status/900',opts={threadPath:path,rootId:'900',retryOriginal:true,expectedCommentCount:3};
 const rows=['already','unknown','fresh','outside'].map(id=>row(id,1000,{directComment:true,ownOriginalComment:true}));
 const f=fixture({startPath:path,rows,rootCount:3,inThread:id=>['already','unknown','fresh'].includes(id),
  db:{records:{already:{status:'confirmed'}}},shared:{unknown:{status:'unknown'}}});
 const result=await f.scan(opts);
 assert.deepEqual(f.generated,['fresh']);assert.deepEqual(f.sent,['fresh']);
 assert.equal(result.stats.excluded.already_replied,1);assert.equal(result.stats.excluded.unknown_send,1);
 assert.equal(result.complete,true);
 const unsafe=fixture({startPath:path,rows,rootCount:3,originalRoot:()=>false});
 assert.equal((await unsafe.scan(opts)).reason,'THREAD_ROOT_NOT_READY');
 assert.deepEqual(unsafe.generated,[]);assert.deepEqual(unsafe.sent,[]);
});
test('pending original recovery does not navigate from or send on another route',async()=>{
 const f=fixture({startPath:'/me/status/901',rows:[row('fresh',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({threadPath:'/me/status/900',rootId:'900',retryOriginal:true});
 assert.equal(result.reason,'page_changed');assert.equal(f.nav(),'/me/status/901');
 assert.deepEqual(f.generated,[]);assert.deepEqual(f.order,[]);
});
test('latest-first replies reserve before sending, confirm, use configured cooldown, then rest',async()=>{
 const f=fixture({rows:[row('old',9000),row('new',1000),row('mid',5000)]});
 const result=await f.scan();
 assert.deepEqual(f.sent,['new','mid','old']);assert.equal(result.complete,true);assert.equal(result.stats.confirmed,3);
 for(const id of f.sent)assert.equal(f.db().records[id].status,'confirmed');
 assert.ok(f.now()>=BASE+12000);assert.equal(f.db().nextAt,0);assert.equal(f.nav(),'/notifications/mentions');assert.equal(f.counts().resumes,0);
 assert.ok(f.patches.some(p=>p.phase==='notification_scan'));
});
test('detail drains successive screens without a 15-second stall on an already handled viewport',async()=>{
 const f=fixture({rootCount:4,rows:screen=>[row('page'+Math.min(screen,3),1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.deepEqual(f.sent,['page0','page1','page2','page3']);assert.equal(result.complete,true);
 assert.equal(f.counts().scrolls,3);
});
test('comments directly below my posts are replied before other addressed replies',async()=>{
 const f=fixture({rows:[row('new-other',1000,{directComment:false}),row('old-direct',9000,{directComment:true,ownOriginalComment:true}),row('mid-direct',5000,{directComment:true,ownOriginalComment:true})]});
 await f.scan();assert.deepEqual(f.sent,['mid-direct','old-direct','new-other']);
});
test('direct comments on my posts remain eligible beyond 24h and drain before recent mentions',async()=>{
 const f=fixture({rows:[row('recent-mention',1000,{directComment:false}),row('old-own-comment',3*86400000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan();assert.deepEqual(f.sent,['old-own-comment','recent-mention']);
 assert.deepEqual(f.likeClicks,[]);assert.equal(result.stats.confirmed,2);
});
test('already replied comments are not revisited for likes, even with historical like data',async()=>{
 const rows=[row('needs-like',1000,{directComment:true,ownOriginalComment:true}),row('already-liked',2000,{directComment:true,ownOriginalComment:true})];
 const f=fixture({rows,preliked:['already-liked'],db:{records:{'needs-like':{status:'confirmed',like:{status:'unknown'}},'already-liked':{status:'confirmed',like:{status:'confirmed'}}}}});
 const result=await f.scan();assert.deepEqual(f.sent,[]);assert.deepEqual(f.likeClicks,[]);
 assert.equal(result.complete,true);assert.equal(f.db().records['needs-like'].like.status,'unknown');
});
test('only confirmed records exclude repeats; failed, skipped and legacy batchSeen retry next window',async()=>{
 const f=fixture({rows:['1','2','3','4','5'].map(id=>row(id)),db:{records:{'1':{status:'confirmed'},'2':{status:'skipped'},'3':{status:'failed'},'4':{status:'skipped_updated'}},batchSeen:{'2':true,'3':true,'5':true},batchUntil:BASE},processed:{'5':{reply:'verified'}}});
 await f.scan();assert.deepEqual(f.sent,['2','3','4']);assert.equal(f.db().batchSeen,undefined);assert.equal(f.db().batchUntil,undefined);
 await f.scan();assert.deepEqual(f.sent,['2','3','4']);
});
test('a skipped AI choice uses the fallback library and is confirmed',async()=>{
 const f=fixture({generate:msg=>({postId:msg.post.id,action:'skip',text:''})});
 const first=await f.scan();assert.equal(first.stats.libraryFallback,1);assert.equal(first.stats.aiSkipped,0);
 assert.equal(f.db().records['1'].status,'confirmed');assert.deepEqual(f.sent,['1']);
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
 const result=await f.scan();assert.equal(result.stats.failed,1);assert.equal(f.db().records['1'].status,'failed');assert.equal(f.db().records['1'].reasonCode,'RESIDUAL_DRAFT');assert.equal(result.complete,true);
 await f.scan();assert.equal(f.generated.length,2);
});
test('author-blocked notices permanently skip that reply and continue the batch',async()=>{
 const f=fixture({rows:[row('blocked'),row('next',2000)],send:async(opts,{sent})=>{
  if(opts.row.id==='blocked')throw Object.assign(Error('作者已屏蔽当前账号，跳过此帖'),{code:'AUTHOR_BLOCKED',submitted:false});
  sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});
 }});
 await f.scan();assert.deepEqual(f.sent,['next']);assert.equal(f.db().records.blocked.status,'skipped_issue');
 await f.scan();assert.deepEqual(f.generated,['blocked','next']);
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
test('comments eligible at batch start remain in the fixed batch after AI generation',async()=>{
 const f=fixture({rows:[row('1',86400000-1000)],generate:(msg,{advance})=>{advance(2000);return{postId:msg.post.id,action:'send_reply',text:'ok'};}});
 await f.scan();assert.deepEqual(f.sent,['1']);assert.equal(f.db().records['1'].status,'confirmed');
});
test('new arrivals later than window start wait until next work window',async()=>{
 const f=fixture({rows:[row('1',-1000)]});await f.scan();assert.equal(f.sent.length,0);await f.scan();assert.deepEqual(f.sent,['1']);
});
test('fixed batch cutoff keeps the same initial comment set across rescans',async()=>{
 const cutoff=BASE;let first=true;
 const f=fixture({rows:()=>first?[row('initial',1000)]:[row('initial',1000),row('arrived-later',-1000)]});
 await f.scan({until:cutoff});first=false;await f.scan({until:cutoff});
 assert.deepEqual(f.sent,['initial']);assert.equal(f.db().records['arrived-later'],undefined);
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
test('notification scans neither pause nor resume another module',async()=>{
 const f=fixture({rows:[]});await f.scan({cooldownSlot:true});await f.scan();
 assert.equal(f.counts().pauses,0);assert.equal(f.counts().resumes,0);
});
test('overlapping scans rejected rather than sharing mutable session globals',async()=>{
 let resolve;const f=fixture({generate:msg=>new Promise(r=>{resolve=()=>r({postId:msg.post.id,action:'skip'});})});
 const first=f.scan();await new Promise(r=>setImmediate(r));assert.ok(resolve);
 await assert.rejects(f.scan(),/正在执行/);resolve();await first;
});
test('pure policy accepts exact 24h boundary and ignores invalid timestamps',()=>{
 const f=fixture(),p=f.context.XAssistantNotificationPolicy;
 assert.equal(p.recent(BASE-86400000,BASE),true);assert.equal(p.recent(BASE-86400001,BASE),false);assert.equal(p.recent(NaN,BASE),false);assert.equal(p.recent(BASE+1,BASE),false);
 assert.equal(p.inReplyScope({at:BASE-3*86400000,directComment:true,ownOriginalComment:true},BASE),true);
 assert.equal(p.inReplyScope({at:BASE-3*86400000,directComment:false},BASE),false);
 assert.deepEqual(Array.from(p.newestFirst([{at:1},{at:3},{at:NaN},{at:2}]),r=>r.at),[3,2,1]);
 assert.deepEqual(Array.from(p.priorityFirst([{id:'new',at:3},{id:'direct-old',at:1,directComment:true,ownOriginalComment:true},{id:'direct-new',at:2,directComment:true,ownOriginalComment:true}]),r=>r.id),['direct-new','direct-old','new']);
});

test('post-confirmation scan-state save failure never overwrites confirmed record',async()=>{
 const f=fixture({patchFailure:(patch,storage)=>{if(patch.phase==='notification_scan'&&storage[KEY]['/me'].records?.['1']?.status==='confirmed')throw Error('scan state write failed');}});
 await assert.rejects(f.scan(),/scan state write failed/);assert.equal(f.db().records['1'].status,'confirmed');
});

test('missing native navigation leaves the original route intact and makes the missing link visible',async()=>{const f=fixture({rows:[],missingNav:true});const result=await f.scan();assert.equal(result.reason,'NAV_LINK_UNAVAILABLE');assert.deepEqual(f.order,[]);assert.equal(f.nav(),'/home');assert.equal(f.patches.at(-1).lastIssue.targetId,'/notifications/mentions');});
test('absolute notification links with query and trailing slash stay same-origin',async()=>{const f=fixture({rows:[],absoluteNav:true});await f.scan();assert.ok(f.order.includes('nav:/notifications/mentions'));assert.ok(!f.order.some(x=>x.startsWith('spa:')));});
test('missing navigation never overwrites an inline draft',async()=>{const f=fixture({missingNav:true,draft:true});await assert.rejects(f.scan(),/内联草稿/);assert.equal(f.order.length,0);assert.equal(f.sent.length,0);});

for(const outcome of ['fallback','generation_failure','success'])test('notification cooldown: '+outcome,async()=>{
 const starts=[];let f;
 f=fixture({rows:[row('a'),row('b')],generate:msg=>{
  starts.push(f.now());
  return outcome==='fallback'?{postId:msg.post.id,action:'skip'}:outcome==='generation_failure'?{postId:msg.post.id,action:'skip',skippedGenerationError:true,reason:'生成格式错误'}:{postId:msg.post.id,action:'send_reply',text:'reply'};
 }});
 await f.scan();assert.equal(starts.length,2);assert.equal(starts[1]-starts[0],outcome==='generation_failure'?0:15000);
 assert.equal(f.sent.length,outcome==='generation_failure'?0:2);
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
  await assert.rejects(f.scan(),e=>e.code==='SEND_UNKNOWN'&&e.submitted);assert.equal(f.db().records['1'].status,'unknown');assert.equal(f.counts().resumes,0);
 }
});
test('account change takes precedence over a recoverable navigation change',async()=>{
 let f;f=fixture({generate:msg=>{f.context.location.pathname='/search';f.context.XAssistantDOM.account=()=>'/another';return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 await assert.rejects(f.scan(),e=>e.code==='ACCOUNT_CHANGED');assert.equal(f.sent.length,0);assert.equal(f.counts().resumes,0);
});

test('addressed replies in someone elses thread are replied to without likes',async()=>{
 const f=fixture({rows:[row('other-thread',1000,{directComment:true}),row('unknown-thread',2000,{directComment:true,ownOriginalComment:null})]});
 await f.scan();assert.deepEqual(f.likeClicks,[]);assert.equal(f.sent.length,2);
});

test('historically liked own comments do not stop the reply batch',async()=>{
 const f=fixture({rows:[row('new',1000,{directComment:true,ownOriginalComment:true}),row('marker',2000,{directComment:true,ownOriginalComment:true}),row('older',3000,{directComment:true,ownOriginalComment:true})],preliked:['marker']});
 const result=await f.scan();
 assert.equal(result.complete,true);
 assert.deepEqual(f.sent,['new','marker','older']);assert.deepEqual(f.likeClicks,[]);
 assert.equal(f.counts().resumes,0);
});
test('persistent loading gets a longer bounded observation window without false completion',async()=>{
 const f=fixture({rows:[],loading:true});
 const result=await f.scan();
 assert.equal(result.complete,false);assert.equal(result.rest,true);
 assert.ok(f.now()-BASE>=15000);assert.ok(f.counts().scrolls<100);
});

test('detail replies are confirmed without likes and pre-liked rows do not end the batch',async()=>{
 const f=fixture({rows:[row('1',1000,{directComment:true,ownOriginalComment:true}),row('2',2000,{directComment:true,ownOriginalComment:true})],preliked:['2'],
 send:async(opts,{sent})=>{assert.equal(f.likeClicks.length,0);sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});}});
 const result=await f.scan({threadPath:'/me/status/100',rootId:'100',ignoreLikedBoundary:true});
 assert.deepEqual(f.sent,['1','2']);assert.deepEqual(f.likeClicks,[]);assert.equal(result.complete,true);
});

test('profile-owned detail scan does not navigate home or resume interaction between posts',async()=>{
 const f=fixture({rows:[row('comment',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({threadPath:'/me/status/root',rootId:'root',ignoreLikedBoundary:true,returnToHome:false});
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['comment']);
 assert.equal(f.nav(),'/me/status/root');assert.equal(f.counts().resumes,0);
 assert.ok(!f.order.includes('nav:/home'));
 await f.scan({mentionsOnly:true,ignoreLikedBoundary:true});
 assert.equal(f.nav(),'/notifications/mentions');assert.equal(f.counts().resumes,0);
});

test('post detail confirms with one downward scroll and still replies to newly revealed comments',async()=>{
 const f=fixture({rows:screen=>screen===0?[row('first',1000,{directComment:true,ownOriginalComment:true})]:[row('second',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({threadPath:'/me/status/root',rootId:'root',returnToHome:false,ignoreLikedBoundary:true});
 assert.deepEqual(f.sent,['first','second']);assert.equal(f.counts().scrolls,1);assert.equal(result.complete,true);
});


test('single detail confirmation without new replies has no extra 1200ms polling delay',async()=>{
 const f=fixture({rows:[row('one',1000,{directComment:true,ownOriginalComment:true})]});
 await f.scan({threadPath:'/me/status/root',rootId:'root',returnToHome:false,ignoreLikedBoundary:true});
 assert.deepEqual(f.sent,['one']);assert.equal(f.counts().scrolls,1);
 assert.ok(!f.delays.includes(1200));
});


test('every module-owned navigation registers its destination before changing page',async()=>{
 const f=fixture({rows:[]}),destinations=[];
 f.context.XAssistantWorkspace={check:()=>{},expectNavigation:path=>destinations.push([path,f.nav()])};
 await f.scan();
 assert.deepEqual(destinations,[['/notifications','/home'],['/notifications/mentions','/notifications']]);
 assert.equal(f.nav(),'/notifications/mentions');
});

test('an atomic shared-reply claim conflict never overwrites existing evidence',async()=>{
 const f=fixture();
 f.context.XAssistantReplyEngine.send=async opts=>{
  assert.equal(opts.module,'notifications');assert.equal(opts.runId,'run');
  throw Object.assign(Error('already owned'),{code:'REPLY_ALREADY_CLAIMED'});
 };
 const result=await f.scan();
 assert.equal(result.stats.confirmed,0);assert.equal(result.stats.failed,0);
 assert.equal(f.db().records['1'],undefined);
 assert.deepEqual(f.generated,['1']);
});

test('historical in-flight like evidence does not strand an unreplied comment',async()=>{
 const f=fixture({rows:[row('1',1000,{directComment:true,ownOriginalComment:true})],db:{records:{'1':{like:{status:'in_flight',runId:'old'}}}}});
 const result=await f.scan();assert.deepEqual(f.sent,['1']);assert.deepEqual(f.likeClicks,[]);
 assert.equal(result.stats.confirmed,1);assert.equal(f.db().records['1'].status,'confirmed');
 assert.equal(f.db().records['1'].like.status,'in_flight');
});
test('notification worker has no like action or liked-boundary branch',()=>{
 const source=scripts.at(-1);
 assert.doesNotMatch(source,/kind:\s*['"]like['"]/);
 assert.doesNotMatch(source,/liked_boundary|likeDirectComment|checkedLike/);
});

test('unknown X error on the owned compose route remains unknown, visible and non-retryable across runs; no cleanup or second send',async()=>{
 const f=fixture({rows:[row('2118124070718128465'),row('2',2000)],send:async(opts,{sent})=>{
  if(opts.row.id==='2'){sent.push('2');await opts.onConfirmed({kind:'confirmed'});return;}
  f.context.location.pathname='/compose/post';
  throw Object.assign(Error('出错了，别担心，让我们再试一次。'),{code:'SEND_UNKNOWN',submitted:true});
 }});
 f.context.XAssistantPopup.cancel=()=>assert.fail('must preserve submitted composer');
 await assert.rejects(f.scan(),e=>e.code==='SEND_UNKNOWN'&&e.submitted&&e.preserveDrafts&&/出错了/.test(e.message));
 const rec=f.db().records['2118124070718128465'];assert.equal(rec.status,'unknown');assert.equal(rec.reasonCode,'SEND_UNKNOWN');
 assert.ok(f.patches.some(p=>p.lastIssue?.code==='SEND_UNKNOWN'&&p.lastIssue.targetId==='2118124070718128465'&&p.lastIssue.message===rec.reason));
 assert.equal(f.db().lastScan.reason,'error');assert.equal(f.nav(),'/compose/post');
 f.context.location.pathname='/home';await f.scan({runId:'next-run'});
 assert.deepEqual(f.generated,['2118124070718128465','2']);assert.deepEqual(f.sent,['2']);
 assert.equal(f.db().records['2118124070718128465'].status,'unknown');
});
test('an unknown shared claim from another worker is excluded before generation, like or send even without a local ledger entry',async()=>{
 const id='2118124070718128465', f=fixture({rows:[row(id,1000,{directComment:true,ownOriginalComment:true})]});
 f.storage.xAssistantReplyClaimsV1={'/me':{[id]:{status:'unknown',module:'interaction'}}};
 const out=await f.scan();assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[]);assert.deepEqual(f.likeClicks,[]);
 assert.equal(out.stats.excluded.unknown_send,1);assert.equal(f.storage.xAssistantReplyClaimsV1['/me'][id].status,'unknown');
});
test('known detail uses its exact native timestamp anchor without spending a link-probe timeout in a hidden tab',async()=>{
 const f=fixture({rows:[],missingNav:true});f.context.document.hidden=true;
 const all=f.context.XAssistantTasks;let linkProbes=0;
 const real=all.waitFor;all.waitFor=(probe,opts)=>{if(opts.timeout===2000)linkProbes++;return real(probe,opts);};
 await f.scan({threadPath:'/me/status/123',rootId:'123'});
 assert.ok(f.order.includes('nav:/me/status/123'));assert.equal(linkProbes,0);
});
test('AI and pre-submit errors expose exact target and original message without being counted as a sent reply',async()=>{
 const a=fixture({rows:[row('ai')],generate:()=>({postId:'ai',action:'skip',skippedGenerationError:true,reasonCode:'AI_NETWORK',reason:'连接失败细节'})});
 await a.scan();assert.ok(a.patches.some(p=>p.lastIssue?.code==='AI_NETWORK'&&p.lastIssue.message==='连接失败细节'&&p.lastIssue.targetId==='ai'));assert.deepEqual(a.sent,[]);
 const b=fixture({send:async()=>{throw Object.assign(Error('回复输入框未就绪'),{code:'EDITOR_NOT_READY',submitted:false});}});
 await b.scan();assert.ok(b.patches.some(p=>p.lastIssue?.code==='EDITOR_NOT_READY'&&p.lastIssue.targetId==='1'));assert.deepEqual(b.sent,[]);
});

test('nested preserved draft stops the notification batch and cannot be discarded by legacy cleanup',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)],send:async()=>{throw Object.assign(Error('编辑器发生变化'),{code:'TARGET_MISMATCH',submitted:false,cause:{cause:{preserveDrafts:true}}});}});
 f.context.XAssistantPopup.cancel=()=>assert.fail('must not discard unrelated draft');
 await assert.rejects(f.scan(),e=>e.preserveDrafts&&e.code==='TARGET_MISMATCH');
 assert.deepEqual(f.generated,['1']);assert.deepEqual(f.sent,[]);
 assert.equal(f.db().records['1'].status,'skipped_issue');
 f.context.XAssistantDOM.dialogs=()=>[{}];
 assert.equal(await f.context.XAssistantNotifications.discardResidual(),false);
});

test('a stale profile/other timeline with a missing correct root is observed for 15s, never scanned or checkpointed',async()=>{
 const f=fixture({rows:[row('unrelated',500,{directComment:true})],rootReady:(_ms,path)=>!path.includes('/status/')});
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(r.complete,false);assert.equal(r.finalCommentCount,null);assert.equal(r.reason,'THREAD_ROOT_NOT_READY');
 assert.deepEqual(f.sent,[]);assert.equal(f.patches.at(-1).lastIssue.targetId,'123');assert.ok(f.now()-BASE>=15500);
});
test('delayed replies hydrate after the only downward scroll even with a persistent inline-composer spinner',async()=>{
 const f=fixture({rootCount:1,excludedSpinner:true,rows:(screen,elapsed)=>screen&&elapsed>=13000?[row('reply',500,{directComment:true,ownOriginalComment:true})]:[]});
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(r.complete,true);assert.deepEqual(f.sent,['reply']);assert.equal(f.counts().scrolls,1);assert.ok(f.now()-BASE>=13000);
});
test('late comments use a real time bound; a grandchild or a zero stub cannot complete the parent count',async()=>{
 for(const [count,fromProfile,rows] of [[2,2,[row('child'),row('grandchild')]],[0,2,[]]]){
  const f=fixture({rootCount:count,directChild:id=>id==='child',rows});
  const r=await f.scan({rootId:'123',threadPath:'/me/status/123',expectedCommentCount:fromProfile});
  assert.equal(r.complete,false);assert.equal(r.reason,'THREAD_COMMENTS_PENDING');assert.equal(f.counts().scrolls,1);
  assert.match(f.patches.at(-1).lastIssue.message,/123.*直接评论.*2/);assert.ok(f.now()-BASE>=15500);
 }
});
const foldButton=(text,{nested=false,visible=true}={})=>({isConnected:true,innerText:text,getClientRects:()=>visible?[{}]:[],
 closest:()=>nested?{}:null,click:()=>assert.fail('a folded-reply notice must never be clicked by the scanner')});
test('X-folded replies are a distinct incomplete result; visible verified replies still send normally',async()=>{
 for(const label of ['显示可能的垃圾信息','Show probable spam']){
  const f=fixture({rootCount:4,metadataDirect:2,foldControls:[foldButton(label)],
   rows:[row('one',500,{directComment:true}),row('two',600,{directComment:true})],db:{records:{one:{status:'confirmed'}}}});
  const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
  assert.equal(result.reason,'THREAD_COMMENTS_FOLDED');assert.equal(result.complete,false);
  assert.equal(result.evidence.expectedDirect,4);assert.equal(result.evidence.seenDirect,2);
  assert.match(f.patches.at(-1).lastIssue.message,/折叠.*未记为完成/);
  assert.deepEqual(f.generated,['two']);assert.deepEqual(f.sent,['two']);
 }
});
test('other buttons and hidden or nested copies do not prove folded replies; AI failures remain visible',async()=>{
 const opts={rootCount:2,metadataDirect:1,rows:[row('one',500,{directComment:true})]};
 const f=fixture({...opts,foldControls:[foldButton('查看更多'),foldButton('显示可能的垃圾信息',{nested:true}),foldButton('Show probable spam',{visible:false})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.reason,'THREAD_COMMENTS_PENDING');assert.equal(result.evidence.expectedDirect,2);
 const g=fixture({...opts,foldControls:[foldButton('显示可能的垃圾信息')],
  generate:msg=>({postId:msg.post.id,skippedGenerationError:true,reasonCode:'AI_NETWORK',reason:'连接失败'})});
 assert.equal((await g.scan({rootId:'123',threadPath:'/me/status/123'})).reason,'THREAD_COMMENTS_FOLDED');
 assert.equal(g.patches.filter(p=>p.lastIssue).at(-1).lastIssue.code,'AI_NETWORK');
 assert.deepEqual(g.sent,[]);
});
test('only a selected mentions timeline qualifies: rows in an unrelated tab and an empty loading shell are not sent or completed',async()=>{
 for(const opts of [{rows:[row('stale')],selected:()=>false},{rows:[],explicitEmpty:false}]){
  const f=fixture(opts),r=await f.scan({mentionsOnly:true});
  assert.equal(r.reason,'MENTIONS_NOT_READY');assert.equal(r.complete,false);assert.equal(f.sent.length,0);
  assert.equal(f.patches.at(-1).lastIssue.targetId,'/notifications/mentions');assert.ok(f.now()-BASE>=16500);
 }
 const f=fixture({rows:[row('late')],selected:ms=>ms>=13000});assert.equal((await f.scan({mentionsOnly:true})).complete,true);assert.deepEqual(f.sent,['late']);
});
test('only the child comment on its own native route is offered to the inline engine; confirmed trial returns without liking',async()=>{
 const f=fixture({rows:[row('1',500,{ownOriginalComment:true,directComment:true}),row('2',1000,{ownOriginalComment:true,directComment:true})],rootCount:2});
 const trips=[];
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),expectNavigation(){},check(){},
  openStatusTarget:async(child,opt)=>{assert.equal(child.id,'1');assert.equal(opt.requireAddressed,true);trips.push('to:'+child.id);
   f.context.location.pathname='/child/status/1';return {returnToSource:async()=>{trips.push('back');f.context.location.pathname='/me/status/123';}};}};
 f.context.XAssistantReplyEngine.send=async opts=>{
   assert.equal(opts.detailInline,true);assert.equal(opts.requireAddressed,false);
   await opts.prepareTarget();assert.equal(f.nav(),'/child/status/1');opts.validate(opts.row);
   await opts.onBeforeSubmit();await opts.onConfirmed({kind:'confirmed'});
 };
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(r.reason,'trial_sample_confirmed');assert.equal(r.sample,true);assert.equal(r.complete,false);
 assert.deepEqual(f.generated,['1']);assert.deepEqual(trips,['to:1','back']);assert.deepEqual(f.likeClicks,[]);
});
test('unknown single-round sample never returns, likes or opens the second candidate',async()=>{
 const f=fixture({rows:[row('1',1,{ownOriginalComment:true,directComment:true}),row('2',2,{ownOriginalComment:true,directComment:true})]});
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),check(){},expectNavigation(){},openStatusTarget:async r=>{
  assert.equal(r.id,'1');f.context.location.pathname='/child/status/1';return {returnToSource:()=>assert.fail('returned from unknown')};}};
 f.context.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();await opts.onBeforeSubmit();throw Object.assign(Error('no receipt'),{submitted:true});};
 const r=await f.scan({mentionsOnly:true});assert.equal(r.reason,'trial_sample_unknown');assert.equal(r.sample,true);assert.equal(f.nav(),'/child/status/1');
 assert.deepEqual(f.generated,['1']);assert.deepEqual(f.likeClicks,[]);assert.equal(f.db().records['1'].status,'unknown');
});
test('candidate visit failure after its link click stops the run on that exact target without liking or a return',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)]});
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),check(){},expectNavigation(){},openStatusTarget:async()=>{
   f.context.location.pathname='/child/status/1';throw Object.assign(Error('子详情未就绪'),{code:'INLINE_EDITOR_NOT_READY',stopTargetVisit:true});}};
 f.context.XAssistantReplyEngine.send=o=>o.prepareTarget();
 await assert.rejects(f.scan({mentionsOnly:true}),e=>e.code==='INLINE_EDITOR_NOT_READY');assert.equal(f.nav(),'/child/status/1');
 assert.equal(f.patches.at(-1).lastIssue.targetId,'1');assert.deepEqual(f.generated,['1']);assert.deepEqual(f.likeClicks,[]);
});


test('read leases cover only exact original DOM observation and the one scroll, not candidate generation or sending',async()=>{
 let depth=0,leases=0;
 const f=fixture({rootCount:1,rows:(screen,elapsed)=>screen&&elapsed>=12000?[row('child',1,{directComment:true,ownOriginalComment:true})]:[],
  generate:msg=>{assert.equal(depth,0);return {postId:msg.post.id,action:'send_reply',text:'ok'};},
  send:async(opts,{sent})=>{assert.equal(depth,0);sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});}});
 const scroll=f.context.window.scrollBy;f.context.window.scrollBy=(...args)=>{assert.equal(depth,1);return scroll(...args);};
 f.context.XAssistantDOM.beginDetailRead=({id,path,runId,signal})=>{assert.equal(depth++,0);assert.equal(path,f.nav());assert.equal(id,'123');assert.equal(runId,'run');assert.equal(signal,f.controller.signal);leases++;return ()=>{depth--;};};
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});assert.equal(result.complete,true);assert.ok(leases>=2);assert.equal(depth,0);assert.deepEqual(f.likeClicks,[]);
});
test('metadata with no mounted comment is visible as evidence, never a reply candidate or completion marker',async()=>{
 const f=fixture({rootCount:6,metadataDirect:6,rows:[]});const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.reason,'THREAD_COMMENTS_PENDING');assert.equal(result.complete,false);assert.equal(result.evidence.primaryArticles,1);
 assert.equal(result.evidence.threadRows,0);assert.equal(result.evidence.metadataDirect,6);assert.equal(f.db().lastScan.evidence.metadataDirect,6);
 assert.match(f.patches.at(-1).lastIssue.message,/主栏卡 1.*同串评论卡 0.*元数据 6/);assert.deepEqual(f.generated,[]);assert.deepEqual(f.likeClicks,[]);
});
test('an abort during initial detail load releases the lease and never scrolls for replies',async()=>{
 const f=fixture({rows:[],rootReady:(_ms,path)=>!path.includes('/status/')});let released=0;
 f.context.XAssistantDOM.beginDetailRead=()=>{f.controller.abort();return ()=>{released++;};};
 await assert.rejects(f.scan({rootId:'123',threadPath:'/me/status/123'}),{name:'AbortError'});assert.equal(released,1);assert.equal(f.counts().scrolls,0);
});

test('a callback waking just after the render deadline still reads already-mounted verified replies once, without another scroll',async()=>{
 const f=fixture({rootCount:1,rows:(screen,elapsed)=>screen&&elapsed>=17000?[row('late',1,{directComment:true,ownOriginalComment:true})]:[]});
 const tasks=f.context.XAssistantTasks;const wait=tasks.waitForPage;let woke=false;
 tasks.waitForPage=(probe,opts)=>{
  if(!woke&&f.counts().scrolls===1&&opts.timeout===15500){woke=true;f.advance(15551);return Promise.resolve(null);}
  return wait(probe,opts);
 };
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.ok(woke);assert.equal(r.complete,true);assert.deepEqual(f.sent,['late']);assert.equal(f.counts().scrolls,1);
});

const exactRoot={rootId:'123',threadPath:'/me/status/123',ignoreLikedBoundary:true};
const ownChild=row('421',1000,{ownOriginalComment:true,directComment:true});
function boundTrip(f,{onConfirm=()=>{},onReturn=()=>{},eligible=()=>true,allowReturn=true}={}){
 const child='/person421/status/421';let backs=0;
 f.context.XAssistantDOM.detailReply=target=>eligible()&&f.nav()===child&&target.id==='421'?{dialog:{}}:null;
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),check(){},expectNavigation(){},
  openStatusTarget:async target=>{
   assert.equal(target.id,'421');f.context.location.pathname=child;
   return {returnToSource:async()=>{if(!allowReturn||f.nav()!==child)throw Object.assign(Error('详情已被切换'),{code:'PAGE_CHANGED'});backs++;f.context.location.pathname=exactRoot.threadPath;onReturn();}};
  }};
 f.context.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();await opts.onBeforeSubmit();f.sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});onConfirm();};
 return ()=>backs;
}
test('confirmed child returns to source without a like or a second reply when the source vanishes',async()=>{
 let returned=false;
 const f=fixture({rows:()=>returned?[]:[ownChild],rootCount:1});
 const backs=boundTrip(f,{onReturn:()=>returned=true});const r=await f.scan(exactRoot);
 assert.equal(backs(),1);assert.deepEqual(f.sent,['421']);assert.deepEqual(f.likeClicks,[]);
 assert.equal(f.db().records['421'].status,'confirmed');
 assert.ok(!f.patches.some(p=>p.lastIssue?.code==='LIKE_TARGET'));
});
test('historical confirmed or unknown likes do not block a fresh detail reply',async()=>{
 for(const previous of ['confirmed','unknown']){
  const f=fixture({rows:[ownChild],preliked:previous==='confirmed'?['421']:[],db:{records:{'421':{like:{status:previous}}}}});
  boundTrip(f);await f.scan(exactRoot);assert.deepEqual(f.likeClicks,[]);assert.deepEqual(f.sent,['421']);
  assert.equal(f.db().records['421'].status,'confirmed');assert.equal(f.db().records['421'].like.status,previous);
 }
});

test('reading budget excludes off-source reply time and reveals the next verified comment after a single scroll',async()=>{
 let lease=0,seenFirst=false,start=null;
 const rest=row('422',2000,{ownOriginalComment:true,directComment:true});
 const f=fixture({rootCount:2,rows:(screen,ms)=>{if(!screen)return [];if(!seenFirst)return [ownChild];if(lease){start??=ms;if(ms-start>=2200)return [rest];}return [];},
  send:async(opts,{sent,advance})=>{sent.push(opts.row.id);if(opts.row.id==='421'){advance(30000);seenFirst=true;}await opts.onConfirmed({kind:'confirmed'});}});
 // Once hydrated X leaves a mounted card until the next navigation.
 const raw=f.context.XAssistantDOM.rows;let retained=[];
 f.context.XAssistantDOM.rows=(...args)=>{const rows=raw(...args);if(rows.some(r=>r.id==='422'))retained=rows;return retained.length?retained:rows;};
 f.context.XAssistantDOM.beginDetailRead=()=>{lease++;return ()=>lease--;};
 const r=await f.scan(exactRoot);
 assert.deepEqual(f.sent,['421','422']);assert.equal(f.counts().scrolls,1);assert.equal(r.complete,true);
});
test('cards seen before a reply but unmounted before individual review do not advance completion',async()=>{
 let gone=false;
 const f=fixture({rootCount:2,rows:()=>gone?[]:[ownChild,row('422',2000,{directComment:true,ownOriginalComment:true})],
  send:async(opts,{sent})=>{sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});gone=true;}});
 const r=await f.scan(exactRoot);assert.equal(r.complete,false);assert.equal(r.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['421']);assert.match(r.detail,/逐条核对前已卸载/);assert.equal(f.counts().scrolls,1);
});
test('several verified replies missing historical likes are not revisited or resent',async()=>{
 const list=['421','422','423'].map(id=>row(id,1000,{ownOriginalComment:true,directComment:true}));
 const f=fixture({rows:s=>s?[]:list,db:{records:Object.fromEntries(list.map(r=>[r.id,{status:'confirmed'}]))},rootCount:3});
 const r=await f.scan(exactRoot);assert.deepEqual(f.sent,[]);assert.deepEqual(f.likeClicks,[]);assert.equal(r.complete,true);
});

test('original-post entry uses the same verified status stamp as row parsing, never the first decoration time',async()=>{
 const options={threadPath:'/me/status/123',rootId:'123'};
 const f=fixture({rows:[row('456',1000,{directComment:true})],rootCount:1});
 const r=await f.scan(options);
 assert.ok(f.order.includes('nav:/me/status/123'));assert.deepEqual(f.sent,['456']);assert.equal(r.complete,true);
 for(const bad of [null,{id:'999',author:'me'},{id:'123',author:'other'},{id:'123',author:'me',link:{getAttribute:()=>'/me/status/999'}}]){
  const wrong=fixture({rows:[],rootCount:0});const real=wrong.context.XAssistantDOM.statusStamp;
  wrong.context.XAssistantDOM.statusStamp=article=>bad&&{...real(article),...bad};
  const result=await wrong.scan(options);
  assert.equal(result.reason,'NAV_LINK_UNAVAILABLE');assert.equal(result.complete,false);assert.deepEqual(wrong.sent,[]);
  assert.ok(!wrong.order.some(x=>x.startsWith('nav:')));
 }
});

test('exact same-origin native Notifications sidebar may already point to Mentions; go directly and verify selected tab before scanning',async()=>{
 for(const selected of [true,false]){
  const f=fixture({missingNav:true,rows:[row('native')],selected:()=>selected}),doc=f.context.document,original=doc.querySelector;
  const sidebar={isConnected:true,target:'',getClientRects:()=>[{}],getAttribute:key=>key==='href'?'/notifications/mentions':null,closest:()=>null,click(){f.context.location.pathname='/notifications/mentions';f.order.push('native-sidebar');}};
  doc.querySelector=s=>s==='a[data-testid="AppTabBar_Notifications_Link"][href="/notifications/mentions"]'?sidebar:original(s);
  const declared=[];f.context.XAssistantWorkspace={check(){},expectNavigation:path=>declared.push(path)};
  const r=await f.scan({mentionsOnly:true});assert.deepEqual(declared,['/notifications/mentions']);assert.equal(f.order[0],'native-sidebar');
  assert.deepEqual(f.sent,selected?['native']:[]);assert.equal(r.complete,selected);if(!selected)assert.equal(r.reason,'MENTIONS_NOT_READY');
 }
});
test('no native direct-to-mentions shortcut from content, hidden controls, foreign routes or unverified targets',async()=>{
 for(const attrs of [{target:'_blank'},{getAttribute:()=>'https://example.invalid/notifications/mentions'},{closest:()=>({})},{getClientRects:()=>[]},{isConnected:false}]){
  const f=fixture({missingNav:true,rows:[row('uncertain')]}),doc=f.context.document,original=doc.querySelector;
  const anchor={target:'',getClientRects:()=>[{}],getAttribute:key=>key==='href'?'/notifications/mentions':null,closest:()=>null,click:()=>assert.fail('unsafe shortcut'),...attrs};
  doc.querySelector=s=>s==='a[data-testid="AppTabBar_Notifications_Link"][href="/notifications/mentions"]'?anchor:original(s);
  const r=await f.scan({mentionsOnly:true});assert.equal(r.reason,'NAV_LINK_UNAVAILABLE');assert.deepEqual(f.sent,[]);assert.equal(f.nav(),'/home');
 }
});
