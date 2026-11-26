import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const KEY='xAssistantNotificationRepliesV1', BASE=Date.UTC(2026,10,2);
const scripts=['task-utils.js','notification-policy.js','interaction-fallback-library.js','notifications.js'].map(n=>readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const row=(id,age=1000,extra={})=>({id,author:'person'+id,at:BASE-age,time:new Date(BASE-age).toISOString(),text:'hello '+id,addressed:true,...extra});
function fixture({rows=[row('1')],db={},processed={},generate,send,patchFailure,loading=false,missingNav=false,absoluteNav=false,draft=false,preliked=[],beforeLike,beforeLikeValidate,afterLike,unconfirmedLike=false,onLike,rootCount=null,rootReady=()=>true,selected=()=>true,explicitEmpty=true,excludedSpinner=false,directChild=()=>true,metadataDirect=0,startPath='/home',originalRoot=()=>true,inThread=(id,root)=>id!==root,shared={},ownReplies=[],probe,foldControls=[],scrollEnd=1}={}){
 let now=BASE,scrolls=0,top=0,pauses=0,resumes=0;
 const storage={[KEY]:{'/me':structuredClone(db)},xAssistantProcessedV1:{posts:processed},xAssistantReplyClaimsV1:{'/me':shared}}, generated=[],sent=[],probes=[],probeReturns=[],order=[],delays=[],patches=[],liked=new Set(preliked),likeClicks=[];
 const controller=new AbortController(),location={pathname:startPath};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const links=(missingNav?[]:['/home','/notifications','/notifications/mentions']).map(href=>({getAttribute:()=>absoluteNav?'https://x.com'+href+'/?filter=all':href,click:()=>{location.pathname=href;order.push('nav:'+href);}}));
 let detail=null,rootLink=null;
 const rawRows=()=>typeof rows==='function'?rows(scrolls,now-BASE,location.pathname):rows;
 const main={contains:a=>!a.aside,
   querySelector:selector=>selector.includes('aria-selected')&&selected(now-BASE)?{getAttribute:()=>'/notifications/mentions'}:selector.includes('emptyState')&&explicitEmpty&&!loading&&!rawRows().length?{}:null,
   querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?domRows().map(r=>r.article):selector.startsWith('button')?foldControls:selector.includes('progressbar')&&(loading||excludedSpinner)?[{closest:()=>excludedSpinner?{}:null}]:[]};
 const fakeRoot=()=>detail&&rootReady(now-BASE,location.pathname)?[{...row(detail.rootId,1000,{author:'me',replyCount:rootCount}),article:{isConnected:true,stamp:{link:rootLink,id:detail.rootId,author:'me'},querySelector:()=>({closest:()=>null})}}]:[];
 const decorate=r=>({...r,article:{isConnected:true,getBoundingClientRect:()=>({top:r.offscreen?1000:100,bottom:r.offscreen?1100:200,height:100}),querySelectorAll:selector=>selector==='[data-testid="unlike"]'?(liked.has(r.id)?[{}]:[]):selector==='[data-testid="like"]'&&!liked.has(r.id)?[{disabled:false,click:()=>{onLike?.(r,storage);likeClicks.push(r.id);if(!unconfirmedLike)liked.add(r.id);}}]:[]}});
 const domRows=()=>[...rawRows().map(decorate),...fakeRoot()];
 const context=vm.createContext({Date:Clock,URL,DOMException,Error,setTimeout,clearTimeout,AbortController,innerHeight:900,location,
  chrome:{storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async data=>Object.assign(storage,structuredClone(data))}}},
  history:{state:null,pushState:(_s,_t,path)=>{location.pathname=path;order.push('spa:'+path);}},PopStateEvent:class{},
  document:{scrollingElement:{get scrollHeight(){return 900+scrollEnd*720;}},querySelectorAll:selector=>selector==='[contenteditable="true"]'?(draft?[{}]:[]):links,querySelector:sel=>sel.includes('primaryColumn')?main:loading?{}:null},
  window:{get scrollY(){return scrolls*720;},dispatchEvent:()=>{},scrollTo:({top:position=0}={})=>{top++;scrolls=position/720;},scrollBy:()=>scrolls++},
  XAssistantRuntime:{sleep:async ms=>{delays.push(ms);now+=ms;},runtime:async(_module,action,{patch}={})=>{if(patch){patches.push(patch);if(patchFailure)patchFailure(patch,storage);}return{phase:'waiting'};},call:async msg=>{generated.push(msg.post.id);return generate?generate(msg,{advance:ms=>now+=ms,controller}):{postId:msg.post.id,action:'send_reply',text:'reply'};}},
  XAssistantActions:{click:async()=>assert.fail('回帖模块不得申请点赞许可')},
  ...(probe?{XAssistantWorkspace:{check(){},expectNavigation(){},openStatusTarget:async(r,o)=>{assert.equal(o.readOnly,true);assert.equal(o.requireAddressed,true);const source=location.pathname;probes.push(r.id);location.pathname='/'+r.author+'/status/'+r.id;await probe(r,{options:o,location,controller,advance:ms=>now+=ms});return {returnToSource:async()=>{probeReturns.push(r.id);location.pathname=source;}};}}}:{}),
  XAssistantDOM:{account:()=>'/me',dialogs:()=>[],rows:domRows,statusStamp:a=>a.stamp,beginDetailRead:()=>()=>{},threadIdentity:id=>{const r=rawRows().find(r=>r.id===id);return r&&detail?{id,root:detail.rootId,author:r.author.toLowerCase(),parent:r.parent||detail.rootId}:id===detail?.rootId?{id,root:id,author:'me',parent:null}:null;},loadedDirectChildren:()=>metadataDirect,inThread,hasOwnReply:(id,owner)=>owner==='/me'&&ownReplies.includes(id),originalPost:originalRoot,directChildOf:id=>directChild(id),directOnOwnOriginal:id=>directChild(id)&&rawRows().some(r=>r.id===id&&r.ownOriginalComment===true),replyVideoOnly:()=>false,relocate:row=>domRows().find(current=>current.id===row.id&&current.author===row.author)||null},
  XAssistantTime:{ms:()=>15000},XAssistantCore:{editorText:()=>draft?'unsent draft':'',randomSeconds:(min,max)=>{assert.equal(min,3);assert.equal(max,5);return 4;}},
  XAssistantPopup:{cancel:async()=>true},XAssistantInteraction:{pause:async()=>{pauses++;return{};},resume:async()=>{resumes++;}},
  XAssistantReplyPreparation:{generate:async opts=>{const source=location.pathname;const result=await context.XAssistantTasks.bounded(()=>context.XAssistantRuntime.call({kind:'AI_NOTIFICATION_REPLY',runId:opts.runId,post:opts.row}),opts);opts.validate();if(location.pathname!==source){const draft=context.document.querySelectorAll('[contenteditable="true"]').some(e=>context.XAssistantCore.editorText(e).trim());const code=context.XAssistantDOM.dialogs().length?'CLEANUP_FAILED':draft?'RESIDUAL_DRAFT':'PAGE_CHANGED';throw new context.XAssistantTasks.TaskError(code,'page changed');}if(result.postId!==opts.row.id)throw new context.XAssistantTasks.TaskError('TARGET_MISMATCH','目标不匹配');return result;}},
  XAssistantReplyEngine:{send:async opts=>{const prepared=await opts.prepareReply();if(prepared.action==='skip')return prepared;opts.text=prepared.text;order.push('before:'+opts.row.id);await opts.onBeforeSubmit();assert.equal(storage[KEY]['/me'].records[opts.row.id].status,'in_flight');if(send)return send(opts,{sent,order,advance:ms=>now+=ms});sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});order.push('confirmed:'+opts.row.id);}}
 });
 scripts.forEach(s=>vm.runInContext(s,context));
 const scan=options=>{
   detail=options?.rootId?options:null;
   rootLink=detail?{getAttribute:()=>detail.threadPath,click:()=>{location.pathname=detail.threadPath;order.push('nav:'+detail.threadPath);}}:null;
   return context.XAssistantNotifications.scan({account:'/Me',runId:'run',signal:controller.signal,...options});
 };
 return{scan,context,storage,generated,sent,probes,probeReturns,order,delays,patches,likeClicks,liked,controller,advance:ms=>now+=ms,db:()=>storage[KEY]['/me'],now:()=>now,nav:()=>location.pathname,counts:()=>({scrolls,top,pauses,resumes})};
}
function branchFixture({nodes,pages,db={},shared={},capable=true}){
 const byId=new Map(nodes.map(r=>[r.id,r])),visits=[],returns=[],rootId='123',rootPath='/me/status/123';
 const descendant=(id,ancestor)=>{const seen=new Set();let current=byId.get(id);
  while(current&&!seen.has(current.id)){seen.add(current.id);if(current.parent===ancestor)return true;current=byId.get(current.parent);}return false;};
 const f=fixture({db,shared,rootCount:nodes.filter(r=>r.parent===rootId).length,
  rows:(_screen,_elapsed,path)=>(pages[path.split('/').at(-1)]||[]).map(id=>byId.get(id)),
  inThread:(id,root)=>root===rootId&&descendant(id,rootId),directChild:(id,parent=rootId)=>byId.get(id)?.parent===parent});
 const D=f.context.XAssistantDOM;
 Object.assign(D,{inBranch:(id,parent)=>descendant(id,parent),loadedBranchIds:parent=>nodes.filter(r=>descendant(r.id,parent)).map(r=>r.id),
  loadedThreadIds:()=>nodes.map(r=>r.id),loadedDirectChildren:parent=>nodes.filter(r=>r.parent===parent).length,directChildOf:(id,parent)=>byId.get(id)?.parent===parent});
 if(capable)f.context.XAssistantWorkspace={check(){},expectNavigation(){},openStatusTarget:async(r,o)=>{
  assert.equal(o.readOnly,true);assert.equal(o.threadRootId,rootId);
  assert.ok(D.relocate(r,'/me'),'each branch must open from its still-mounted native source card');
  const source=f.nav(),position=f.context.window.scrollY;visits.push(r.id);
  f.context.location.pathname=new URL(r.url).pathname;
  return {returnToSource:async()=>{assert.equal(f.nav(),new URL(r.url).pathname);returns.push(r.id);f.context.location.pathname=source;f.context.window.scrollTo({top:position});}};
 }};
 return {...f,visits,returns,scan:(options={})=>f.scan({rootId,threadPath:rootPath,...options})};
}
const branchRow=(id,parent,replyCount=0,author='person'+id)=>row(id,1000,{parent,author,replyCount,isComment:true,ownThread:true,
 directComment:parent==='123',ownOriginalComment:true,url:'https://x.com/'+author+'/status/'+id});
test('recursive native details traverse grandchildren and share receipts without revisiting a branch',async()=>{
 const nodes=[branchRow('a','123',1),branchRow('b','a',1),branchRow('c','b'),branchRow('sibling','123')];
 const f=branchFixture({nodes,pages:{123:['a','b','sibling'],a:['a','b','sibling'],b:['b','c','sibling']}});
 const result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.visits,['a','b']);assert.deepEqual(f.returns,['b','a']);
 assert.deepEqual(f.sent,['a','sibling','b','c']);assert.equal(new Set(f.sent).size,4);
 for(const id of f.sent)assert.equal(f.db().records[id].status,'confirmed','nested saves must not overwrite earlier receipts');
 assert.equal(f.nav(),'/me/status/123');assert.equal(result.stats.confirmed,4);
});
test('already-replied and own comments still expose their unread child branches',async()=>{
 const nodes=[branchRow('done','123',1),branchRow('manual-child','done'),branchRow('self','123',1,'me'),branchRow('own-child','self')];
 const f=branchFixture({nodes,pages:{123:['done','self'],done:['done','manual-child'],self:['self','own-child']},db:{records:{done:{status:'confirmed'}}}});
 const result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.visits,['done','self']);
 assert.deepEqual(f.sent,['manual-child','own-child']);assert.equal(f.db().records.done.status,'confirmed');
});
test('missing branch navigation capability leaves known unread branches pending, never complete',async()=>{
 const f=branchFixture({nodes:[branchRow('a','123',1),branchRow('b','a')],pages:{123:['a']},capable:false});
 const result=await f.scan();
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['a']);assert.deepEqual(f.visits,[]);
});
test('a fully read native branch is not reopened only to rediscover the same children',async()=>{
 const f=branchFixture({nodes:[branchRow('a','123',1),branchRow('b','a')],pages:{123:['a','b'],a:['a','b']}});
 const result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['a','b']);assert.deepEqual(f.visits,[]);
});
test('unknown sends in nested details stay quarantined while other descendants are replied',async()=>{
 const f=branchFixture({nodes:[branchRow('a','123',2),branchRow('unknown','a'),branchRow('fresh','a')],pages:{123:['a'],a:['a','unknown','fresh']},shared:{unknown:{status:'unknown'}}});
 const result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['a','fresh']);assert.equal(result.stats.excluded.unknown_send,1);
 assert.equal(f.storage.xAssistantReplyClaimsV1['/me'].unknown.status,'unknown');
});
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
test('native own replies prevent duplicate generation even when the local ledger is missing',async()=>{
 const f=fixture({rootCount:3,rows:['manual','unknown','fresh'].map(id=>row(id,1000,{directComment:true,ownOriginalComment:true})),
  ownReplies:['manual','unknown'],shared:{unknown:{status:'unknown'}}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.deepEqual(f.generated,['fresh']);assert.deepEqual(f.sent,['fresh']);
 assert.equal(result.stats.excluded.already_replied,1);
 assert.equal(result.stats.excluded.unknown_send,1,'native reply evidence does not clear an unresolved send claim');
});
test('visible unbound comment is read-only probed and replied only after exact thread membership is proven',async()=>{
 const bound=new Set(),f=fixture({rootCount:1,rows:[row('late',1000,{isComment:true})],
  inThread:(id,root)=>root==='123'&&bound.has(id),probe:async r=>{bound.add(r.id);}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,true);assert.deepEqual(f.probes,['late']);assert.deepEqual(f.probeReturns,['late']);
 assert.deepEqual(f.generated,['late']);assert.deepEqual(f.sent,['late']);
});
test('unbound or different-thread comments are probed only once per pass and never sent without proof',async()=>{
 const f=fixture({rootCount:1,rows:[row('other-thread',1000,{isComment:true})],inThread:(id,root)=>root==='999',probe:async()=>{}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.probes,['other-thread']);assert.deepEqual(f.probeReturns,['other-thread']);
 assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[]);
});
test('an unresolved comment stays pending after scrolling unmounts its card',async()=>{
 const f=fixture({rootCount:2,rows:screen=>screen===0?[row('unresolved',1000,{isComment:true})]:[row('known',1000,{directComment:true,ownOriginalComment:true})],
  inThread:(id,root)=>root==='123'&&id==='known',probe:async()=>{}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.deepEqual(f.probes,['unresolved']);assert.deepEqual(f.sent,['known']);
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.equal(result.evidence.unboundReplyCards,1,'the final viewport must not forget an earlier unresolved card');
});
test('slow membership probes count as reading progress and cannot strand the next screen',async()=>{
 const f=fixture({rootCount:14,rows:screen=>screen===0?
  Array.from({length:13},(_,i)=>row('unresolved'+i,1000,{isComment:true})):
  [row('deep',1000,{directComment:true,ownOriginalComment:true})],
  inThread:(id,root)=>root==='123'&&id==='deep',probe:async()=>{}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.deepEqual(f.probes,Array.from({length:13},(_,i)=>'unresolved'+i));
 assert.deepEqual(f.sent,['deep'],'more than 60 seconds of useful probes must not stop before the first scroll');
 assert.equal(result.complete,false);assert.equal(result.evidence.unboundReplyCards,13);
 assert.ok(!result.detail.includes('连续 60 秒'));
});
test('a reused native Show more replies button loads every successive batch after proven new cards',async()=>{
 let clicks=0;const button={get isConnected(){return clicks<3;},disabled:false,innerText:'Show more replies',getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,click(){clicks++;}};
 const f=fixture({rootCount:4,foldControls:[button],rows:()=>Array.from({length:clicks+1},(_,i)=>row('batch'+i,1000,{directComment:true,ownOriginalComment:true}))});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(clicks,3);assert.deepEqual(f.sent,['batch0','batch1','batch2','batch3']);
 assert.equal(result.complete,true);
});
test('an unresponsive expansion yields pending after one short observation instead of searching deeper',async()=>{
 let f,clicks=0;const button={get isConnected(){return !f||f.counts().scrolls===0;},disabled:false,innerText:'Show replies',getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,click(){clicks++;}};
 f=fixture({rootCount:3,foldControls:[button],rows:screen=>[row('page'+Math.min(screen,1),1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(clicks,1);assert.deepEqual(f.sent,['page0']);
 assert.equal(f.counts().scrolls,0);assert.equal(f.counts().top,1);assert.equal(button.isConnected,true);
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_FOLDED');
 assert.ok(f.now()-BASE<4000,'an empty expansion must not wait a reply cooldown or long stability window');
});
test('a removed expansion with no new targets yields before the bottom and completes on a later pass',async()=>{
 let clicks=0;const button={get isConnected(){return clicks===0;},disabled:false,innerText:'Show replies',getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,click(){clicks++;}};
 const f=fixture({rootCount:1,foldControls:[button],rows:[row('known',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(clicks,1);assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['known']);assert.equal(f.counts().scrolls,0);assert.equal(f.counts().top,1);assert.ok(f.now()-BASE<4000);
 const retry=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(retry.complete,true);assert.equal(clicks,1);assert.equal(f.counts().scrolls,1);
 assert.deepEqual(f.sent,['known'],'the vanished fold neither blocks completion nor resends a confirmed reply');
});
test('a removed expansion at the verified bottom can complete without an extra scroll',async()=>{
 let clicks=0;const button={get isConnected(){return clicks===0;},disabled:false,innerText:'Show replies',getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,click(){clicks++;}};
 const f=fixture({scrollEnd:0,rootCount:1,foldControls:[button],rows:[row('known',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,true);assert.equal(clicks,1);assert.equal(f.counts().scrolls,0);assert.deepEqual(f.sent,['known']);
 assert.ok(f.now()-BASE<4000);
});
test('later exact membership proof clears an earlier unbound checkpoint in the same pass',async()=>{
 const bound=new Set(),f=fixture({rootCount:1,rows:()=>[row('late',1000,{isComment:true})],
  inThread:(id,root)=>root==='123'&&bound.has(id),probe:async r=>{bound.add(r.id);}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['late']);
});
test('a failed read-only target proof preserves the failure and never blindly returns or sends',async()=>{
 const f=fixture({rootCount:1,rows:[row('wrong-target',1000,{isComment:true})],inThread:()=>false,
  probe:async()=>{throw Object.assign(Error('native target did not match'),{code:'TARGET_MISMATCH',stopTargetVisit:true,preserveDrafts:true});}});
 await assert.rejects(f.scan({rootId:'123',threadPath:'/me/status/123'}),e=>e.code==='TARGET_MISMATCH'&&e.stopTargetVisit&&e.preserveDrafts);
 assert.deepEqual(f.probes,['wrong-target']);assert.deepEqual(f.probeReturns,[]);
 assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[]);
});
test('read-only membership probes exclude self, offscreen and non-comment cards',async()=>{
 const f=fixture({rootCount:1,rows:[row('self',1000,{isComment:true,author:'me'}),row('offscreen',1000,{isComment:true,offscreen:true}),row('not-comment')],
  inThread:()=>false,probe:async()=>assert.fail('unsafe probe')});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.deepEqual(f.probes,[]);assert.deepEqual(f.sent,[]);
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
 const f=fixture({scrollEnd:3,rootCount:4,rows:screen=>[row('page'+Math.min(screen,3),1000,{directComment:true,ownOriginalComment:true})]});
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
test('a skipped AI choice remains unsent with no generic fallback',async()=>{
 const f=fixture({generate:msg=>({postId:msg.post.id,action:'skip',text:''})});
 const first=await f.scan();assert.equal(first.stats.libraryFallback,0);assert.equal(first.stats.aiSkipped,1);
 assert.equal(f.db().records['1'].status,'skipped');assert.deepEqual(f.sent,[]);
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
 const f=fixture({rows:[row('g',1000,{author:'GROK'}),row('self',1000,{author:'me'}),row('mention',1000,{addressed:false}),row('stale',7*86400000+1),row('future',-1),row('valid')]});
 const result=await f.scan();assert.deepEqual(f.generated,['valid']);assert.equal(result.stats.excluded.grok,1);assert.equal(result.stats.excluded.not_addressed,1);assert.equal(f.context.XAssistantNotifications.shouldIgnore('grokfan'),false);
});
test('image-only comments reach vision reply generation while empty comments remain excluded',async()=>{
 const f=fixture({rows:[row('photo',500,{text:'',imageUrls:['https://pbs.twimg.com/media/A.jpg']}),row('empty',600,{text:''})]});
 const result=await f.scan();assert.deepEqual(f.generated,['photo']);assert.deepEqual(f.sent,['photo']);assert.equal(result.stats.excluded.empty,1);
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
test('own thread traverses beyond 100 screens and replies to the final comment without restarting',async()=>{
 const f=fixture({scrollEnd:105,rootCount:106,rows:screen=>[row('page'+Math.min(screen,105),1000,{directComment:true,ownOriginalComment:true})]});
 const options={rootId:'123',threadPath:'/me/status/123'};
 const first=await f.scan(options);
 assert.equal(first.complete,true);assert.equal(first.reason,'visible_exhausted');
 assert.deepEqual(f.sent,Array.from({length:106},(_,i)=>'page'+i));
 assert.equal(f.counts().top,1,'the same pass must reach the last screen');
 const second=await f.scan(options);
 assert.equal(second.complete,false);assert.equal(second.reason,'THREAD_COMMENTS_PENDING');assert.equal(second.stats.confirmed,0);
 assert.equal(f.counts().scrolls,1,'a later pass with no fresh replies must yield after its first scroll');
 assert.equal(f.sent.length,106,'confirmed comments must not be sent again on a later pass');
});
test('own thread without new targets yields within four seconds after one scroll and never rescans the top',async()=>{
 const f=fixture({scrollEnd:100000,rootCount:2,rows:[row('one',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['one']);
 assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);
 assert.ok(f.now()-BASE<4000,'a depleted viewport must yield immediately after one short render observation');
});
test('a thread with no eligible reply exits after one short observation without waiting an existing reply cooldown',async()=>{
 const f=fixture({scrollEnd:8,rootCount:2,rows:[row('done',1000,{directComment:true,ownOriginalComment:true})],db:{records:{done:{status:'confirmed'}}}});
 const shows=[],session={nextReplyAt:BASE+15000};
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123',traversalSession:session,show:text=>shows.push(text)});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,[]);assert.deepEqual(f.generated,[]);assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);
 assert.ok(f.now()-BASE<4000);assert.ok(!shows.some(text=>text.startsWith('下一条')),'no reply target means no cooldown wait');
});
test('the last confirmed reply does not pay another reply gap before leaving an exhausted detail',async()=>{
 let confirmedAt;
 const f=fixture({rootCount:1,rows:[row('only',1000,{directComment:true,ownOriginalComment:true})],
  send:async(opts,{sent})=>{sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});confirmedAt=f.now();}});
 const shows=[],result=await f.scan({rootId:'123',threadPath:'/me/status/123',show:text=>shows.push(text)});
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['only']);
 assert.ok(f.now()-confirmedAt<=1500,'only the final short render observation may follow the last confirmation');
 assert.ok(!shows.some(text=>text.startsWith('下一条')));assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);
});
for(const reinject of [false,true])test('31-second reply spacing survives independent originals'+(reinject?' and script reinjection':''),async()=>{
 let list=[row('first',1000,{directComment:true,ownOriginalComment:true})];const generatedAt=[],confirmedAt=[];
 const f=fixture({rootCount:1,rows:()=>list,
  generate:msg=>{generatedAt.push(f.now());return{postId:msg.post.id,action:'send_reply',text:'reply'};},
  send:async(opts,{sent})=>{sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});confirmedAt.push(f.now());}});
 f.context.XAssistantTime.ms=()=>31000;
 await f.scan({rootId:'100',threadPath:'/me/status/100'});
 assert.ok(f.now()-confirmedAt[0]<=1500,'the first post still exits without paying the next send cooldown');
 if(reinject)vm.runInContext(scripts.at(-1),f.context);
 list=[];const emptyAt=f.now(),shows=[];
 const empty=await f.scan({rootId:'200',threadPath:'/me/status/200',show:text=>shows.push(text)});
 assert.equal(empty.complete,false);assert.equal(empty.reason,'THREAD_COMMENTS_PENDING');
 assert.ok(f.now()-emptyAt<4000,'an intervening empty original must not wait for the persisted send deadline');
 assert.ok(!shows.some(text=>text.startsWith('下一条')));assert.deepEqual(f.sent,['first']);
 list=[row('second',1000,{directComment:true,ownOriginalComment:true})];
 await f.scan({rootId:'300',threadPath:'/me/status/300'});
 assert.deepEqual(f.sent,['first','second']);
 assert.equal(generatedAt[1]-confirmedAt[0],31000,'a fresh scan must respect the previous original reply deadline before generating');
 assert.equal(confirmedAt[1]-confirmedAt[0],31000);
 assert.equal(f.db().nextReplyAt,confirmedAt[1]+31000,'the absolute send deadline remains persisted after leaving the second post');
});
test('a confirmed single-round sample persists the 31-second gap for the next independent original',async()=>{
 let one=true,list=[row('trial',1000,{directComment:true,ownOriginalComment:true})];const generatedAt=[];
 const f=fixture({rootCount:1,rows:()=>list,generate:msg=>{generatedAt.push(f.now());return{postId:msg.post.id,action:'send_reply',text:'reply'};}});
 f.context.XAssistantTime.ms=()=>31000;
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:one}}),check(){},expectNavigation(){}};
 const first=await f.scan({rootId:'100',threadPath:'/me/status/100'});
 assert.equal(first.reason,'trial_sample_confirmed');assert.equal(first.sample,true);assert.deepEqual(f.sent,['trial']);
 assert.equal(f.db().nextReplyAt,generatedAt[0]+31000,'the early sample return must not discard confirmed send spacing');
 one=false;list=[row('next',1000,{directComment:true,ownOriginalComment:true})];
 await f.scan({rootId:'200',threadPath:'/me/status/200'});
 assert.deepEqual(f.sent,['trial','next']);assert.equal(generatedAt[1]-generatedAt[0],31000);
});
test('another account persisted reply deadline does not delay the current account',async()=>{
 const f=fixture({rootCount:1,rows:[row('fresh',1000,{directComment:true,ownOriginalComment:true})]});
 f.context.XAssistantTime.ms=()=>31000;
 f.storage[KEY]['/another']={records:{},nextReplyAt:BASE+31000};
 const result=await f.scan({rootId:'100',threadPath:'/me/status/100'});
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['fresh']);assert.ok(f.now()-BASE<4000);
 assert.equal(f.storage[KEY]['/another'].nextReplyAt,BASE+31000,'saving this account must preserve another account deadline');
});
test('newly revealed but already-replied cards yield pending instead of repeatedly scrolling for fresh targets',async()=>{
 const f=fixture({scrollEnd:5,rootCount:3,rows:screen=>[row(screen===0?'done-top':screen===1?'done-next':'unseen-deeper',1000,{directComment:true,ownOriginalComment:true})],
  db:{records:{'done-top':{status:'confirmed'},'done-next':{status:'confirmed'}}}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,[]);assert.deepEqual(f.generated,[]);assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);
 assert.ok(f.now()-BASE<4000);assert.equal(f.db().records['unseen-deeper'],undefined);
 assert.equal(result.stats.seen,2);assert.equal(result.stats.excluded.already_replied,2,'the revealed page is still reviewed before yielding');
});
const frontierOptions={rootId:'123',threadPath:'/me/status/123',retryOriginal:true};
const frontierRows=screen=>[row(screen===0?'done-top':screen===1?'done-next':'fresh-deep',1000,{directComment:true,ownOriginalComment:true})];
const frontierDB={records:{'done-top':{status:'confirmed'},'done-next':{status:'confirmed'}}};
test('pending originals resume the verified frontier and reach fresh replies beyond two already-replied screens',async()=>{
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 const first=await f.scan(frontierOptions);
 assert.equal(first.complete,false);assert.equal(first.evidence.cursorAdvanced,true);assert.equal(first.evidence.resumePending,true);
 assert.equal(f.db().threads['123'].views['123'].anchor.id,'done-next');assert.equal(f.db().threads['123'].views['123'].scrollY,720);
 const second=await f.scan(frontierOptions);
 assert.equal(second.complete,true);assert.deepEqual(f.sent,['fresh-deep']);assert.equal(f.counts().top,1,'a pending re-entry must not rewind to the first screen');
 assert.equal(second.evidence.cursorAdvanced,true);assert.equal(second.evidence.resumePending,false);
});
test('script reinjection retains the frontier without persisting DOM nodes or attempted exclusions',async()=>{
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 await f.scan(frontierOptions);vm.runInContext(scripts.at(-1),f.context);
 await f.scan(frontierOptions);assert.deepEqual(f.sent,['fresh-deep']);assert.equal(f.counts().top,1);
 const saved=f.db().threads['123'].views['123'];assert.equal(saved.anchor.author,'personfresh-deep');assert.equal(saved.anchor.parent,'123');
 assert.ok(!JSON.stringify(saved).includes('article'));assert.equal(saved.observed,undefined);
});
test('a fresh document may restore pixels only when its live native anchor identity matches',async()=>{
 const first=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 await first.scan(frontierOptions);
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:first.db()});
 const result=await f.scan(frontierOptions);
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['fresh-deep']);assert.equal(f.counts().scrolls,2);
 assert.equal(f.counts().top,1,'the one scrollTo restores the verified saved viewport, not the top');
});
test('a missing cursor is retired only at a verified native end and discovered fresh replies remain queued',async()=>{
 const first=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 await first.scan(frontierOptions);
 const db=first.db();db.records.replacement={status:'confirmed'};
 let replaced=true;const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,db,
  rows:screen=>replaced&&screen===1?[row('replacement',1000,{directComment:true,ownOriginalComment:true})]:frontierRows(screen)});
 const down=f.context.window.scrollBy;f.context.window.scrollBy=(...args)=>{if(f.counts().scrolls<2)down(...args);};
 const result=await f.scan(frontierOptions);
 assert.equal(result.complete,false);assert.deepEqual(f.sent,[]);assert.equal(result.evidence.cursorAdvanced,false);assert.equal(result.evidence.retainView,false);
 assert.equal(f.db().threads['123'].views['123'].anchor.id,'fresh-deep');assert.equal(f.db().threads['123'].views['123'].seek,null);
 assert.ok(f.db().threads['123'].views['123'].retries['fresh-deep']);
 await f.scan(frontierOptions);assert.deepEqual(f.sent,['fresh-deep'],'new replies are handled even while the old anchor remains missing');
});
test('saved pixels cannot resume a cursor whose body, author, timestamp or native parent changed',async()=>{
 const first=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 await first.scan(frontierOptions);
 for(const change of [{text:'changed body'},{author:'different-author'},{time:'2026-11-01T01:00:00.000Z'},{parent:'another-parent'}]){
  const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,db:first.db(),
   rows:screen=>frontierRows(screen).map(r=>screen===1?{...r,...change}:r)});
  const down=f.context.window.scrollBy;f.context.window.scrollBy=(...args)=>{if(f.counts().scrolls<2)down(...args);};
  const result=await f.scan(frontierOptions);
  assert.equal(result.complete,false);assert.equal(result.evidence.cursorAdvanced,false);assert.deepEqual(f.sent,[]);
  assert.equal(f.db().threads['123'].views['123'].anchor.id,'fresh-deep');assert.equal(f.db().threads['123'].views['123'].seek,null);
 }
});
test('a cursor cannot bypass current original ownership verification after a document change',async()=>{
 const first=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB});
 await first.scan(frontierOptions);
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:first.db(),originalRoot:()=>false});
 const result=await f.scan(frontierOptions);
 assert.equal(result.reason,'THREAD_ROOT_NOT_READY');assert.equal(result.complete,false);assert.deepEqual(f.sent,[]);assert.deepEqual(f.generated,[]);
});
test('a virtualized original card is not required again when the current native resume anchor proves the view',async()=>{
 let f;f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,db:frontierDB,
  rootReady:()=>!f||f.counts().scrolls===0});
 await f.scan(frontierOptions);const result=await f.scan(frontierOptions);
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['fresh-deep']);assert.equal(f.counts().top,1);
});
for(const force of [false,true])test((force?'explicit':'periodic')+' top recheck handles new comments without losing the deeper frontier',async()=>{
 let freshTop=false;
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:4,db:frontierDB,
  rows:screen=>freshTop&&screen===0?[row('new-top',1000,{directComment:true,ownOriginalComment:true})]:frontierRows(screen)});
 await f.scan(frontierOptions);freshTop=true;if(!force)f.advance(1800000);
 const result=await f.scan({...frontierOptions,recheckTop:force});
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['new-top','fresh-deep']);assert.equal(f.counts().scrolls,2);
 assert.equal(f.counts().top,3,'only one top probe and one verified frontier restore are added');
});
test('an early sample during a top recheck preserves the unvisited deep frontier',async()=>{
 let freshTop=false;
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:4,db:frontierDB,
  rows:screen=>freshTop&&screen===0?[row('new-top',1000,{directComment:true,ownOriginalComment:true})]:frontierRows(screen)});
 await f.scan(frontierOptions);freshTop=true;
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),check(){},expectNavigation(){}};
 const result=await f.scan({...frontierOptions,recheckTop:true});
 assert.equal(result.sample,true);assert.equal(f.db().threads['123'].views['123'].anchor.id,'done-next');
 assert.deepEqual(f.sent,['new-top']);
});
test('a context-unavailable comment retains a retry anchor and is retried without rewinding the whole thread',async()=>{
 let ready=false;
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,
  db:{records:{'done-top':{status:'confirmed'},'done-end':{status:'confirmed'}}},
  rows:screen=>[row(screen===0?'done-top':screen===1?'context-hole':'done-end',1000,{directComment:true,ownOriginalComment:true})],
  generate:msg=>ready?{postId:msg.post.id,action:'send_reply',text:'reply'}:{postId:msg.post.id,action:'skip',skipReason:'context_unavailable'}});
 const first=await f.scan(frontierOptions);assert.equal(first.complete,false);assert.deepEqual(f.sent,[]);
 assert.ok(f.db().threads['123'].views['123'].retries['context-hole']);
 await f.scan(frontierOptions);assert.deepEqual(f.generated,['context-hole'],'the failed context is not retried in a busy loop');
 ready=true;f.advance(300000);const result=await f.scan(frontierOptions);
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['context-hole']);assert.equal(f.counts().top,3);
 assert.equal(f.db().threads['123'].views['123'].retries['context-hole'],undefined);
});
test('a failed context still mounted at the frontier waits for its retry deadline instead of retrying every scan',async()=>{
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:1,rootCount:1,
  rows:[row('context-hole',1000,{directComment:true,ownOriginalComment:true})],
  generate:msg=>({postId:msg.post.id,action:'skip',skipReason:'context_unavailable'})});
 await f.scan(frontierOptions);const again=await f.scan(frontierOptions);
 assert.equal(again.complete,false);assert.deepEqual(f.generated,['context-hole']);
 f.advance(300000);await f.scan(frontierOptions);assert.deepEqual(f.generated,['context-hole','context-hole']);
});
test('a pending child branch does not contaminate a separately completed sibling checkpoint',async()=>{
 const nodes=[branchRow('a','123',1),branchRow('missing','a'),branchRow('b','123',1),branchRow('read','b')];
 const f=branchFixture({nodes,pages:{123:['a','b'],a:['a'],b:['b','read']}});
 const result=await f.scan();assert.equal(result.complete,false);
 assert.equal(f.db().threads['123'].views.b.pending,false);assert.equal(f.db().threads['123'].views['123'].pending,true);
 assert.deepEqual(f.sent,['a','b','read']);
});
test('an unknown send at a resumed frontier remains quarantined while a deeper fresh comment is replied',async()=>{
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:2,rootCount:3,rows:frontierRows,
  db:{records:{'done-top':{status:'confirmed'},'done-next':{status:'unknown'}}}});
 await f.scan(frontierOptions);await f.scan(frontierOptions);
 assert.deepEqual(f.generated,['fresh-deep']);assert.deepEqual(f.sent,['fresh-deep']);assert.equal(f.db().records['done-next'].status,'unknown');
});
function nativeSeekFixture({db,stall=false,freshAt=null}={}){
 const make=screen=>row('node'+screen,1000,{directComment:true,ownOriginalComment:true});
 const anchor=make(12);
 db??={records:Object.fromEntries(Array.from({length:15},(_,i)=>['node'+i,{status:'confirmed'}])),threads:{'123':{views:{'123':{
  path:'/me/status/123',rootId:'123',pending:true,lastTopCheckAt:BASE,scrollY:8640,
  anchor:{id:anchor.id,author:anchor.author,parent:'123',time:anchor.time,text:anchor.text,clipped:false,imageUrls:[]},retries:{},pendingBranches:[]}}}}};
 if(freshAt!==null)delete db.records['node'+freshAt];
 const f=fixture({startPath:frontierOptions.threadPath,scrollEnd:15,rootCount:16,db,rows:screen=>[make(screen)]});
 let loaded=1,steps=0;
 const jump=f.context.window.scrollTo,down=f.context.window.scrollBy;
 Object.defineProperty(f.context.document.scrollingElement,'scrollHeight',{get:()=>900+Math.min(15,loaded+1)*720});
 f.context.window.scrollTo=({top})=>jump({top:Math.min(top,loaded*720)});
 f.context.window.scrollBy=(...args)=>{steps++;if(!stall&&f.counts().scrolls<15){loaded=Math.max(loaded,f.counts().scrolls+1);down(...args);}};
 return {...f,steps:()=>steps};
}
test('bounded native seeking keeps the old deep frontier and continues in the retained DOM without shallow success',async()=>{
 const f=nativeSeekFixture();
 const first=await f.scan(frontierOptions);
 assert.equal(first.complete,false);assert.equal(first.evidence.retainView,true);assert.equal(first.evidence.seekAdvanced,true);assert.equal(first.evidence.cursorAdvanced,false);
 assert.equal(f.steps(),6);assert.equal(f.db().threads['123'].views['123'].anchor.id,'node12');assert.equal(f.db().threads['123'].views['123'].scrollY,8640);
 assert.equal(f.db().threads['123'].views['123'].seek.position.anchor.id,'node7');assert.deepEqual(f.generated,[]);
 const second=await f.scan(frontierOptions);
 assert.equal(second.evidence.retainView,false);assert.equal(second.evidence.cursorAdvanced,true);
 assert.equal(f.db().threads['123'].views['123'].anchor.id,'node13');
 await f.scan(frontierOptions);const last=await f.scan(frontierOptions);
 assert.equal(last.complete,true);assert.deepEqual(f.sent,['node15']);
});
test('losing retained DOM does not relabel repeated shallow seeking as coverage or overwrite the original frontier',async()=>{
 let db;
 for(let round=0;round<3;round++){
  const f=nativeSeekFixture({db}),result=await f.scan(frontierOptions);db=f.db();
  assert.equal(result.complete,false);assert.equal(result.evidence.cursorAdvanced,false);assert.equal(result.evidence.retainView,true);
  assert.equal(db.threads['123'].views['123'].anchor.id,'node12');assert.equal(db.threads['123'].views['123'].scrollY,8640);
  assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[]);
 }
});
test('a stalled native seek releases the view for deferred retry without claiming progress or sending from the search',async()=>{
 const f=nativeSeekFixture({stall:true}),result=await f.scan(frontierOptions);
 assert.equal(result.complete,false);assert.equal(result.evidence.retainView,false);assert.equal(result.evidence.seekAdvanced,false);assert.equal(result.evidence.cursorAdvanced,false);
 assert.equal(f.steps(),1);assert.equal(f.db().threads['123'].views['123'].anchor.id,'node12');assert.deepEqual(f.generated,[]);
});
test('fresh comments encountered during read-only seek remain queued and are replied after restoring the frontier',async()=>{
 const f=nativeSeekFixture({freshAt:3});
 await f.scan(frontierOptions);assert.deepEqual(f.sent,[]);assert.ok(f.db().threads['123'].views['123'].retries.node3);
 await f.scan(frontierOptions);assert.deepEqual(f.sent,[]);
 await f.scan(frontierOptions);assert.deepEqual(f.sent,['node3']);
 assert.equal(f.db().threads['123'].views['123'].retries.node3,undefined);
});
function nestedNativeSeekFixture({stallAt=Infinity,abortWait=false,unknown=false}={}){
 const a=branchRow('a','123',14),nodes=Array.from({length:14},(_,i)=>branchRow('node'+i,'a'));
 const byId=new Map([a,...nodes].map(r=>[r.id,r])),old=nodes[12],branchPath=new URL(a.url).pathname;
 const db={records:Object.fromEntries([a,...nodes.slice(0,13)].map(r=>[r.id,{status:'confirmed'}])),threads:{'123':{views:{a:{
  path:branchPath,rootId:'123',pending:true,lastTopCheckAt:BASE,scrollY:8640,
  anchor:{id:old.id,author:old.author,parent:'a',time:old.time,text:old.text,clipped:false,imageUrls:[]},retries:{},pendingBranches:[]}}}}};
 const f=fixture({startPath:frontierOptions.threadPath,rootCount:1,scrollEnd:13,db,
  rows:(screen,_ms,path)=>path===branchPath?[a,nodes[Math.min(screen,13)]]:[a],
  ...(unknown?{send:async()=>{throw Object.assign(Error('uncertain receipt'),{submitted:true});}}:{})});
 const D=f.context.XAssistantDOM;
 Object.assign(D,{threadIdentity:id=>id==='123'?{id,root:id,author:'me',parent:null}:byId.has(id)?{id,root:'123',author:byId.get(id).author,parent:byId.get(id).parent}:null,
  inThread:(id,root)=>root==='123'&&byId.has(id),inBranch:(id,parent)=>parent==='123'?byId.has(id):parent==='a'&&id.startsWith('node'),
  loadedThreadIds:()=>[...byId.keys()],loadedBranchIds:id=>id==='a'?nodes.map(r=>r.id):[],
  loadedDirectChildren:id=>id==='a'?14:1,directChildOf:(id,parent)=>byId.get(id)?.parent===parent});
 let loaded=1,opens=0,backs=0;const waits=[],jump=f.context.window.scrollTo,down=f.context.window.scrollBy;
 Object.defineProperty(f.context.document.scrollingElement,'scrollHeight',{get:()=>f.nav()===branchPath?900+Math.min(13,loaded+1)*720:900});
 f.context.window.scrollTo=({top})=>jump({top:f.nav()===branchPath?Math.min(top,loaded*720):0});
 f.context.window.scrollBy=(...args)=>{if(f.nav()===branchPath&&f.counts().scrolls<Math.min(13,stallAt)){loaded=Math.max(loaded,f.counts().scrolls+1);down(...args);}};
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:unknown}}),check(){},expectNavigation(){},progress:(_step,opts)=>{
  if(opts?.until){waits.push(opts.until-f.now());if(abortWait)f.controller.abort();}},openStatusTarget:async(r,opts)=>{
   assert.equal(r.id,'a');assert.equal(opts.readOnly,true);opens++;f.context.location.pathname=branchPath;jump({top:0});
   return {returnToSource:async()=>{assert.equal(f.nav(),branchPath);backs++;f.context.location.pathname=frontierOptions.threadPath;jump({top:0});}};
  }};
 return {...f,opens:()=>opens,backs:()=>backs,waits,scan:()=>f.scan(frontierOptions)};
}
test('a retained nested branch drains bounded seek batches in the same native trip before returning once',async()=>{
 const f=nestedNativeSeekFixture(),result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['node13']);assert.equal(f.opens(),1);assert.equal(f.backs(),1);
 assert.deepEqual(f.waits,[30000]);assert.ok(f.delays.includes(30000));assert.equal(f.nav(),frontierOptions.threadPath);
});
test('a nested seek that stalls returns once without reopening or pretending the root still owns the child view',async()=>{
 const f=nestedNativeSeekFixture({stallAt:7}),result=await f.scan();
 assert.equal(result.complete,false);assert.deepEqual(f.sent,[]);assert.equal(f.opens(),1);assert.equal(f.backs(),1);
 assert.deepEqual(f.waits,[30000]);assert.equal(result.evidence.retainView,false);assert.equal(f.db().threads['123'].views.a.anchor.id,'node12');
});
test('stopping a retained nested branch preserves its current view and never issues a stale Back',async()=>{
 const f=nestedNativeSeekFixture({abortWait:true});
 await assert.rejects(f.scan(),{name:'AbortError'});assert.equal(f.opens(),1);assert.equal(f.backs(),0);assert.deepEqual(f.sent,[]);
});
test('an unknown nested sample cannot trigger a return from the held branch',async()=>{
 const f=nestedNativeSeekFixture({unknown:true});
 await assert.rejects(f.scan(),e=>e.code==='SEND_UNKNOWN'&&e.submitted&&e.preserveDrafts);
 assert.equal(f.backs(),0);assert.equal(f.db().records.node13.status,'unknown');
});
test('completed branches cache the actual final child count and unchanged branches are not reopened',async()=>{
 const nodes=[branchRow('a','123',1),branchRow('b','a')],f=branchFixture({nodes,pages:{123:['a'],a:['a','b']}});
 const send=f.context.XAssistantReplyEngine.send;f.context.XAssistantReplyEngine.send=async opts=>{const result=await send(opts);if(opts.row.id==='b')nodes[0].replyCount=2;return result;};
 await f.scan();assert.equal(f.db().threads['123'].views.a.observedBranchCount,2,'use the platform fixture count after reply, not the entry count or a guessed increment');
 const next=branchFixture({nodes:[branchRow('a','123',2),branchRow('b','a')],pages:{123:['a'],a:['a','b']},db:f.db()});
 await next.scan();assert.deepEqual(next.visits,[]);assert.deepEqual(next.sent,[]);
});
test('changed, decreased, unknown or pending child counts still reopen the branch',async()=>{
 const f=branchFixture({nodes:[branchRow('a','123',2),branchRow('b','a')],pages:{123:['a'],a:['a','b']}});
 await f.scan();const db=f.db();assert.equal(db.threads['123'].views.a.observedBranchCount,2);
 for(const count of [3,1,0,null]){
  const next=branchFixture({nodes:[branchRow('a','123',count),branchRow('b','a')],pages:{123:['a'],a:['a','b']},db});
  await next.scan();assert.deepEqual(next.visits,['a']);
 }
 const pendingDB=structuredClone(db);pendingDB.threads['123'].views.a.pending=true;
 const pending=branchFixture({nodes:[branchRow('a','123',2),branchRow('b','a')],pages:{123:['a'],a:['a','b']},db:pendingDB});
 await pending.scan();assert.deepEqual(pending.visits,['a']);
});
test('a virtualized final root count is unknown rather than the stale entry count',async()=>{
 let f;f=fixture({startPath:frontierOptions.threadPath,rootCount:7,rows:[row('one',1000,{directComment:true,ownOriginalComment:true})],rootReady:()=>!f||f.counts().scrolls===0});
 const result=await f.scan(frontierOptions);assert.equal(result.finalCommentCount,null);
 assert.equal(f.db().threads['123'].views['123'].pending,true);assert.equal(result.evidence.resumePending,true);
 await f.scan(frontierOptions);assert.equal(f.counts().top,1,'an unknown final counter must not discard the verified deep frontier');
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
test('pure policy keeps the 24h helper, a 7-day mention window and ignores invalid timestamps',()=>{
 const f=fixture(),p=f.context.XAssistantNotificationPolicy;
 assert.equal(p.recent(BASE-86400000,BASE),true);assert.equal(p.recent(BASE-86400001,BASE),false);assert.equal(p.recent(NaN,BASE),false);assert.equal(p.recent(BASE+1,BASE),false);
 assert.equal(p.inReplyScope({at:BASE-3*86400000,directComment:true,ownOriginalComment:true},BASE),true);
 assert.equal(p.inReplyScope({at:BASE-3*86400000,directComment:false},BASE),true);
 assert.equal(p.inReplyScope({at:BASE-7*86400000,directComment:false},BASE),true);assert.equal(p.inReplyScope({at:BASE-7*86400000-1,directComment:false},BASE),false);
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
 assert.deepEqual(f.generated,[]);
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
test('13-second reply hydration yields quickly as pending and is retried rather than marked complete',async()=>{
 const f=fixture({rootCount:1,excludedSpinner:true,rows:(screen,elapsed)=>screen&&elapsed>=13000?[row('reply',500,{directComment:true,ownOriginalComment:true})]:[]});
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(r.complete,false);assert.equal(r.reason,'THREAD_COMMENTS_PENDING');assert.deepEqual(f.sent,[]);
 assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);assert.ok(f.now()-BASE<4000);
 f.advance(13000);
 const retry=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(retry.complete,true);assert.deepEqual(f.sent,['reply']);assert.equal(f.counts().scrolls,1);
});
test('total reply count is not a direct-child target; empty transient roots stay pending',async()=>{
 const f=fixture({rootCount:99,directChild:id=>id==='child',rows:[row('child'),row('grandchild')]});
 const r=await f.scan({rootId:'123',threadPath:'/me/status/123',expectedCommentCount:99});
 assert.equal(r.complete,true);assert.equal(r.reason,'visible_exhausted');assert.equal(r.evidence.seenDirect,1);assert.equal(r.evidence.seenThread,2);
 const g=fixture({rootCount:0,rows:[]});
 const pending=await g.scan({rootId:'123',threadPath:'/me/status/123',expectedCommentCount:2});
 assert.equal(pending.complete,false);assert.equal(pending.reason,'THREAD_COMMENTS_PENDING');assert.ok(g.now()-BASE<4000);
 assert.equal(g.counts().scrolls,1);assert.equal(g.counts().top,1);
});
const foldButton=(text,{nested=false,visible=true,onClick}={})=>({isConnected:true,innerText:text,getClientRects:()=>visible?[{}]:[],
 closest:()=>nested?{}:null,click:()=>onClick?onClick():assert.fail('an unrelated or hidden fold must not be clicked')});
test('a spam fold that remains after one click stays pending without loop-clicking',async()=>{
 for(const label of ['显示可能的垃圾信息','Show probable spam']){
  let clicks=0;
  const f=fixture({rootCount:4,metadataDirect:2,foldControls:[foldButton(label,{onClick:()=>clicks++})],
   rows:[row('one',500,{directComment:true}),row('two',600,{directComment:true})],db:{records:{one:{status:'confirmed'}}}});
  const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
  assert.equal(clicks,1);assert.equal(result.reason,'THREAD_COMMENTS_FOLDED');assert.equal(result.complete,false);
  assert.equal(result.evidence.expectedDirect,null);assert.equal(result.evidence.displayedReplies,4);assert.equal(result.evidence.seenDirect,2);
  assert.match(f.patches.at(-1).lastIssue.message,/折叠.*未记为完成/);
  assert.deepEqual(f.generated,['two']);assert.deepEqual(f.sent,['two']);
 }
});
test('other buttons and hidden or nested copies do not prove folded replies; AI failures remain visible',async()=>{
 const opts={rootCount:2,metadataDirect:1,rows:[row('one',500,{directComment:true})]};
 const f=fixture({...opts,foldControls:[foldButton('查看更多'),foldButton('显示可能的垃圾信息',{nested:true}),foldButton('Show probable spam',{visible:false})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.reason,'visible_exhausted');assert.equal(result.evidence.displayedReplies,2);
 const g=fixture({...opts,foldControls:[foldButton('显示可能的垃圾信息',{onClick:()=>{}})],
  generate:msg=>({postId:msg.post.id,action:'skip',skippedGenerationError:true,reasonCode:'AI_NETWORK',reason:'连接失败'})});
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
   await opts.prepareTarget();await opts.prepareReply();assert.equal(f.nav(),'/child/status/1');opts.validate(opts.row);
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
 f.context.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();await opts.prepareReply();await opts.onBeforeSubmit();throw Object.assign(Error('no receipt'),{submitted:true});};
 const r=await f.scan({mentionsOnly:true});assert.equal(r.reason,'trial_sample_unknown');assert.equal(r.sample,true);assert.equal(f.nav(),'/child/status/1');
 assert.deepEqual(f.generated,['1']);assert.deepEqual(f.likeClicks,[]);assert.equal(f.db().records['1'].status,'unknown');
});
test('candidate visit failure after its link click stops the run on that exact target without liking or a return',async()=>{
 const f=fixture({rows:[row('1'),row('2',2000)]});
 f.context.XAssistantWorkspace={state:()=>({assignment:{singleRound:true}}),check(){},expectNavigation(){},openStatusTarget:async()=>{
   f.context.location.pathname='/child/status/1';throw Object.assign(Error('子详情未就绪'),{code:'INLINE_EDITOR_NOT_READY',stopTargetVisit:true});}};
 f.context.XAssistantReplyEngine.send=o=>o.prepareTarget();
 await assert.rejects(f.scan({mentionsOnly:true}),e=>e.code==='INLINE_EDITOR_NOT_READY');assert.equal(f.nav(),'/child/status/1');
 assert.equal(f.patches.at(-1).lastIssue.targetId,'1');assert.deepEqual(f.generated,[]);assert.deepEqual(f.likeClicks,[]);
});


test('read leases cover only exact original DOM observation and the one scroll, not candidate generation or sending',async()=>{
 let depth=0,leases=0;
 const f=fixture({rootCount:1,rows:(screen,elapsed)=>screen&&elapsed>=1300?[row('child',1,{directComment:true,ownOriginalComment:true})]:[],
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
  if(!woke&&f.counts().scrolls===1&&opts.timeout===1500){woke=true;f.advance(17000);return Promise.resolve(null);}
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
 f.context.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();await opts.prepareReply();await opts.onBeforeSubmit();f.sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});onConfirm();};
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

test('the next native scroll has its own short observation after a slow reply and preserves the send gap',async()=>{
 let lease=0,seenFirst=false,start=null;const confirmations=[];
 const rest=row('422',2000,{ownOriginalComment:true,directComment:true});
 const f=fixture({scrollEnd:2,rootCount:2,rows:(screen,ms)=>{if(!screen)return [];if(!seenFirst)return [ownChild];if(screen===2&&lease){start??=ms;if(ms-start>=700)return [rest];}return [];},
  send:async(opts,{sent,advance})=>{sent.push(opts.row.id);if(opts.row.id==='421'){advance(30000);seenFirst=true;}await opts.onConfirmed({kind:'confirmed'});confirmations.push(f.now());}});
 // Once hydrated X leaves a mounted card until the next navigation.
 const raw=f.context.XAssistantDOM.rows;let retained=[];
 f.context.XAssistantDOM.rows=(...args)=>{const rows=raw(...args);if(rows.some(r=>r.id==='422'))retained=rows;return retained.length?retained:rows;};
 f.context.XAssistantDOM.beginDetailRead=()=>{lease++;return ()=>lease--;};
 const r=await f.scan(exactRoot);
 assert.deepEqual(f.sent,['421','422']);assert.equal(f.counts().scrolls,2);assert.equal(r.complete,true);
 assert.equal(confirmations[1]-confirmations[0],15000,'reading a new screen must not bypass the next send interval');
 assert.equal(f.now(),confirmations[1],'there is no empty cooldown or speculative wait at the bottom');
});
test('unrendered metadata at the bottom stays pending without a second speculative render wait',async()=>{
 let replied=false,confirmedAt;
 const f=fixture({rootCount:2,rows:screen=>screen&&!replied?[ownChild]:[],
  send:async(opts,{sent,advance})=>{sent.push(opts.row.id);advance(30000);replied=true;await opts.onConfirmed({kind:'confirmed'});confirmedAt=f.now();}});
 f.context.XAssistantDOM.loadedThreadIds=()=>['421','422'];
 const result=await f.scan(exactRoot);
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['421']);assert.equal(f.counts().scrolls,1);assert.equal(f.counts().top,1);
 assert.equal(f.now(),confirmedAt,'metadata alone must not start another empty wait after reaching the bottom');
 assert.equal(f.db().records['422'],undefined);
});
test('cards seen before a reply but unmounted before individual review do not advance completion',async()=>{
 let gone=false;
 const f=fixture({rootCount:2,rows:()=>gone?[]:[ownChild,row('422',2000,{directComment:true,ownOriginalComment:true})],
  send:async(opts,{sent})=>{sent.push(opts.row.id);await opts.onConfirmed({kind:'confirmed'});gone=true;}});
 const r=await f.scan(exactRoot);assert.equal(r.complete,false);assert.equal(r.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.sent,['421']);assert.match(r.detail,/未核对卡片/);assert.equal(f.counts().scrolls,1);
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

test('normal conversation ending is reported separately from incomplete context and generation failure',async()=>{
 for(const [skipReason,label] of [['conversation_ended','对话已自然结束'],['context_unavailable','原帖或交流记录未读全'],['video_post','视频帖已跳过']]){
  const f=fixture({generate:msg=>({postId:msg.post.id,action:'skip',text:'',skipReason})});
  const messages=[],r=await f.scan({show:message=>messages.push(message)});assert.equal(r.stats.aiSkipped,1);assert.equal(r.stats.aiFailed,0);assert.deepEqual(f.sent,[]);
  assert.equal(r.stats.failed,skipReason==='context_unavailable'?1:0);
  assert.equal(f.db().records['1'].reasonCode,skipReason);assert.ok(f.db().records['1'].reason.includes(label));
  assert.ok(messages.some(message=>message.includes(label)),label);
 }
});

function withDetailVisit(f,{returnError,media=false}={}){
 const cx=f.context;let returns=0;
 cx.XAssistantWorkspace={check(){},expectNavigation(){},openStatusTarget:async target=>{
  const source=cx.location.pathname;cx.location.pathname='/'+target.author+'/status/'+target.id;
  return{returnToSource:async()=>{returns++;if(returnError)throw returnError;cx.location.pathname=source;}};
 }};
 const query=cx.document.querySelector;cx.document.querySelector=s=>media&&s.includes('attachments')?{}:query(s);
 cx.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();const prepared=await opts.prepareReply();if(prepared.action==='skip')return prepared;assert.fail('unexpected send');};
 return()=>returns;
}
const safelyReturnedUnsent=()=>Object.assign(Error('target unavailable; returned to verified source'),{
 code:'TARGET_SKIPPED_UNSENT',submitted:false,confirmed:false,returnedToSource:true
});
test('a safely returned unsent target stays retryable while the next own-thread comment proceeds',async()=>{
 const target=row('missing',1000,{ownThread:true,directComment:true}),next=row('next',2000,{ownThread:true,directComment:true});
 const f=fixture({rows:[target,next],rootCount:2}),visits=[];let recovered=false;
 const send=f.context.XAssistantReplyEngine.send;
 f.context.XAssistantWorkspace={check(){},expectNavigation(){},openStatusTarget:async r=>{
  const source=f.nav();visits.push(r.id);f.context.location.pathname='/'+r.author+'/status/'+r.id;
  f.context.location.pathname=source;if(r.id==='missing'&&!recovered)throw safelyReturnedUnsent();
  return {returnToSource:async()=>{assert.equal(f.nav(),source);}};
 }};
 f.context.XAssistantReplyEngine.send=async opts=>{await opts.prepareTarget();return send(opts);};
 const opts={rootId:'123',threadPath:'/me/status/123'};
 const result=await f.scan(opts);
 assert.deepEqual(f.generated,['next']);assert.deepEqual(f.sent,['next']);assert.deepEqual(visits,['missing','next']);
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.equal(f.db().records.missing.status,'failed');assert.equal(f.db().records.missing.reasonCode,'TARGET_SKIPPED_UNSENT');
 const retry=f.db().threads['123'].views['123'].retries.missing;
 assert.equal(retry.anchor.id,'missing');assert.equal(retry.anchor.author,target.author);assert.equal(retry.anchor.parent,'123');
 assert.ok(retry.nextAt>f.now()&&retry.nextAt<=f.now()+300000);assert.equal(f.nav(),'/me/status/123');
 await f.scan(opts);assert.deepEqual(visits,['missing','next'],'a safe return does not immediately reopen the failed target');
 recovered=true;f.advance(300001);await f.scan(opts);
 assert.deepEqual(f.sent,['next','missing']);assert.equal(f.db().records.missing.status,'confirmed');
});
test('a safely returned read-only branch remains pending and does not block the next branch',async()=>{
 const nodes=[branchRow('missing','123',1),branchRow('unseen','missing'),branchRow('next','123',1),branchRow('child','next')];
 const f=branchFixture({nodes,pages:{123:['missing','next'],missing:['missing','unseen'],next:['next','child']},
  db:{records:{missing:{status:'confirmed'},next:{status:'confirmed'}}}}),open=f.context.XAssistantWorkspace.openStatusTarget;
 const failedVisits=[];
 f.context.XAssistantWorkspace.openStatusTarget=async(r,o)=>{
  if(r.id!=='missing')return open(r,o);
  assert.equal(o.readOnly,true);failedVisits.push(r.id);
  const source=f.nav();f.context.location.pathname=new URL(r.url).pathname;f.context.location.pathname=source;
  throw safelyReturnedUnsent();
 };
 const result=await f.scan();
 assert.deepEqual(failedVisits,['missing']);assert.deepEqual(f.visits,['next']);assert.deepEqual(f.returns,['next']);
 assert.deepEqual(f.sent,['child']);assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.ok(f.db().threads['123'].views['123'].pendingBranches.includes('missing'));
 assert.equal(f.db().records.missing.status,'confirmed','branch preparation must not replace its parent reply receipt');
 assert.equal(f.db().records.unseen,undefined);assert.equal(f.nav(),'/me/status/123');
});
test('a safely returned unbound probe remains pending without another probe or an unproven send',async()=>{
 const f=fixture({rootCount:1,rows:[row('unbound',1000,{isComment:true})],inThread:()=>false,
  probe:async(_r,{location})=>{location.pathname='/me/status/123';throw safelyReturnedUnsent();}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.deepEqual(f.probes,['unbound']);assert.deepEqual(f.probeReturns,[]);assert.deepEqual(f.sent,[]);
 assert.equal(result.evidence.unboundReplyCards,1);
});
test('the safe-return marker never overrides draft, unknown, account, route or return-proof failures',async()=>{
 for(const mode of ['draft','unknown','confirmed','stop','proof','account','route']){
  const f=fixture({rows:[row('blocked'),row('later',2000)],rootCount:2});
  f.context.XAssistantReplyEngine.send=async()=>{
   const error=safelyReturnedUnsent();
   if(mode==='draft')error.preserveDrafts=true;
   if(mode==='unknown')error.submitted=true;
   if(mode==='confirmed')error.confirmed=true;
   if(mode==='stop')error.stopTargetVisit=true;
   if(mode==='proof')delete error.returnedToSource;
   if(mode==='account')f.context.XAssistantDOM.account=()=>'/other';
   if(mode==='route')f.context.location.pathname='/personblocked/status/blocked';
   throw error;
  };
  if(mode==='route')assert.equal((await f.scan({rootId:'123',threadPath:'/me/status/123'})).reason,'page_changed');
  else if(mode==='unknown'){
   const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
   assert.equal(f.db().records.blocked.status,'unknown');assert.equal(result.stats.confirmed,0);
  }else await assert.rejects(f.scan({rootId:'123',threadPath:'/me/status/123'}));
  assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[],mode);
  assert.equal(f.db().threads?.['123']?.views?.['123']?.retries?.blocked,undefined,mode);
 }
});
test('fatal generation error returns from verified comment detail before stopping, leaving a valid restart route',async()=>{
 for(const code of ['http_400','http_401','missing_key']){
  const f=fixture({generate:()=>{throw Object.assign(Error('DeepSeek 请求失败'),{code});}}),returns=withDetailVisit(f);
  await assert.rejects(f.scan(),e=>e.code===code);
  assert.equal(returns(),1);assert.equal(f.nav(),'/notifications/mentions');assert.deepEqual(f.sent,[]);
  assert.equal(f.db().records['1'].reasonCode,code);assert.equal(f.db().records['1'].status,'failed');
 }
});
test('generation recovery cannot leave drafts, unsafe histories, changed accounts, stop, or uncertain sends',async()=>{
 for(const mode of ['draft','return-failed','account','stop','unknown','confirmed']){
  const e=Object.assign(Error('failed'),{code:mode==='account'?'ACCOUNT_CHANGED':mode==='unknown'?'SEND_UNKNOWN':'http_400',
   ...(mode==='stop'?{name:'AbortError'}:{}),...(mode==='unknown'?{submitted:true}:{}),...(mode==='confirmed'?{submitted:true,confirmed:true}:{})});
  const f=fixture({generate:()=>{throw e;}}),returns=withDetailVisit(f,{media:mode==='draft',returnError:mode==='return-failed'?Object.assign(Error('history changed'),{code:'RETURN_UNVERIFIED'}):null});
  await assert.rejects(f.scan());assert.equal(returns(),mode==='return-failed'?1:0,mode);assert.deepEqual(f.sent,[]);
  assert.match(f.nav(),/\/status\/1$/);
 }
});

test('return repaint timeout after AI skip keeps original recoverable error and never issues a second Back',async()=>{
 const failure=Object.assign(Error('原来源页地址或实际内容未恢复'),{code:'NAVIGATION',stopTargetVisit:true});
 const f=fixture({generate:msg=>({postId:msg.post.id,action:'skip',text:'',skipReason:'conversation_ended'})});
 const returns=withDetailVisit(f,{returnError:failure});
 await assert.rejects(f.scan(),error=>error===failure&&!error.preserveDrafts);
 assert.equal(returns(),1);assert.deepEqual(f.sent,[]);
 assert.equal(f.db().records['1'].reasonCode,'NAVIGATION');
});


test('ordinary show-replies expands a branch; nested own-thread comments bypass the 24h cap',async()=>{
 let clicks=0;
 const button={isConnected:true,innerText:'显示回复',getClientRects:()=>clicks?[]:[{}],closest:()=>null,click:()=>clicks++};
 const f=fixture({rootCount:99,foldControls:[button],rows:()=>clicks?[row('nested',3*86400000,{ownThread:true,directComment:false})]:[]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(clicks,1);assert.deepEqual(f.sent,['nested']);assert.equal(result.reason,'visible_exhausted');
});
test('a persistent show-replies control cannot silently complete or loop-click',async()=>{
 let clicks=0;
 const button={isConnected:true,innerText:'Show more replies',getClientRects:()=>[{}],closest:()=>null,click:()=>clicks++};
 const f=fixture({rootCount:99,foldControls:[button]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(clicks,1);assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_FOLDED');
});
test('loaded nested metadata without a rendered card remains pending',async()=>{
 const f=fixture({rootCount:99});f.context.XAssistantDOM.loadedThreadIds=()=>['1','unmounted'];
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');assert.equal(f.counts().top,1);
});
test('visible addressed comment cards wait for exact thread metadata instead of being silently completed',async()=>{
 const f=fixture({rootCount:1,rows:[row('unbound',500,{directComment:true,isComment:true})],inThread:()=>false});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');assert.equal(result.evidence.unboundReplyCards,1);
 assert.deepEqual(f.generated,[]);assert.equal(f.counts().top,1);
});
test('unrelated mentions stay actionable for 7 days, older ones are excluded',async()=>{
 const f=fixture({rows:[row('old',8*86400000,{ownThread:false,directComment:false}),row('recent',3*86400000,{ownThread:false,directComment:false})]});
 const result=await f.scan({mentionsOnly:true});assert.deepEqual(f.sent,['recent']);assert.equal(result.stats.excluded.outside_window,1);
});

test('own-thread comments precede newer unrelated mentions; direct comments stay first',()=>{
 const p=fixture().context.XAssistantNotificationPolicy;
 const rows=[{id:'mention',at:9},{id:'own-old',at:1,ownThread:true},{id:'own-new',at:2,ownThread:true},{id:'direct',at:0,directComment:true,ownThread:true}];
 assert.deepEqual(Array.from(p.priorityFirst(rows),r=>r.id),['direct','own-new','own-old','mention']);
});

test('spam folds reveal comments for the same scan while preserving reply deduplication',async()=>{
 for(const label of ['显示可能的垃圾信息','Show probable spam','顯示可能的垃圾訊息']){
  let clicks=0;
  const button=foldButton(label,{onClick:()=>{clicks++;button.isConnected=false;}});
  const f=fixture({rootCount:3,foldControls:[button],rows:()=>clicks?[
   row('done',500,{ownThread:true}),row('uncertain',600,{ownThread:true}),row('fresh',3*86400000,{ownThread:true})]:[],
   db:{records:{done:{status:'confirmed'}}},shared:{uncertain:{status:'unknown'}}});
  const result=await f.scan({rootId:'123',threadPath:'/me/status/123'});
  assert.equal(clicks,1);assert.equal(result.complete,true);
  assert.deepEqual(f.generated,['fresh']);assert.deepEqual(f.sent,['fresh']);
 }
});
test('spam folds do not click disabled controls or operate outside a verified thread',async()=>{
 const disabled=foldButton('显示可能的垃圾信息');disabled.disabled=true;
 const f=fixture({foldControls:[disabled]});
 assert.equal((await f.scan({rootId:'123',threadPath:'/me/status/123'})).complete,false);
 const g=fixture({foldControls:[foldButton('显示可能的垃圾信息')]});
 await g.scan({mentionsOnly:true});
 const h=fixture({foldControls:[foldButton('显示可能的垃圾信息')],rootReady:(_ms,path)=>!path.includes('/status/')});
 assert.equal((await h.scan({rootId:'123',threadPath:'/me/status/123'})).reason,'THREAD_ROOT_NOT_READY');
});

test('visible verified siblings are checkpointed before the first send, not marked sent',async()=>{
 const opts={rootId:'123',threadPath:'/me/status/123'};
 const rows=['a','b'].map((id,i)=>row(id,1000+i,{ownThread:true,directComment:true}));
 const f=fixture({rows,rootCount:2});const send=f.context.XAssistantReplyEngine.send;let witnessed=false;
 f.context.XAssistantReplyEngine.send=async options=>{
  if(!witnessed){const queued=f.db().threads['123'].views['123'].retries;
   const ids=Object.keys(queued);assert.equal(ids.length,1);assert.equal(queued[ids[0]].discoveryOnly,true);
   assert.equal(f.db().records[ids[0]],undefined);witnessed=true;}
  return send(options);
 };
 await f.scan(opts);assert.ok(witnessed);assert.equal(new Set(f.sent).size,2);assert.deepEqual(Object.keys(f.db().threads['123'].views['123'].retries),[]);
});

// Real branch index + notification scanner + mocked native send. No platform writes.
const nativeTree=readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
const record48=(id,parent,author,replyCount=0)=>({id,parent,root:'123',author,replyCount});
const root48={rootId:'123',rootPostedAt:BASE-2000,threadPath:'/me/status/123',countWindow48:true};
function wireTree48(f,records){
 const ctx=vm.createContext({});vm.runInContext(nativeTree,ctx);const actual=ctx.XAssistantDOM;
 actual.ingestThreadRecords([record48('123',null,'me',records.filter(r=>r.parent==='123').length),...records]);
 Object.assign(f.context.XAssistantDOM,Object.fromEntries(['branchTurns','threadIdentity','directChildOf','inBranch','loadedThreadIds','loadedBranchIds','loadedDirectChildren','hasOwnReply'].map(k=>[k,actual[k]])));
 return actual;
}
test('48h scanner replies once to the latest external leaf only; skips a separate self-last branch; receipt survives a replay',async()=>{
 const records=[record48('130','123','a',2),record48('131','130','me',1),record48('132','130','a'),record48('141','131','b'),record48('133','123','c',1),record48('150','133','me')];
 const f=fixture({rootCount:2,rows:records.map(r=>branchRow(r.id,r.parent,r.replyCount,r.author))});
 wireTree48(f,records);const out=await f.scan(root48);assert.equal(out.complete,true);assert.deepEqual(f.generated,['141']);assert.deepEqual(f.sent,['141']);
 await f.scan(root48);assert.deepEqual(f.sent,['141']);
});
test('48h scanner refuses to conclude complete when count exceeds native replies or branch has missing children',async()=>{
 for(const [count,child] of [[1,1],[3,0]]){
  const rec=record48('130','123','a',child),f=fixture({rootCount:count,rows:[branchRow(rec.id,rec.parent,child,rec.author)]});
  wireTree48(f,[rec]);const out=await f.scan(root48);
  assert.equal(out.complete,false);if(child)assert.deepEqual(f.sent,[]);else assert.deepEqual(f.sent,['130']);
 }
});
test('48h scanner reevaluates native latest before generating or submitting; races never send to the older comment',async()=>{
 const r=record48('130','123','a'),f=fixture({rootCount:1,rows:[branchRow(r.id,r.parent,r.replyCount,r.author)]});
 const native=wireTree48(f,[r]);let validations=0;
 f.context.XAssistantReplyEngine.send=async o=>{
  await o.prepareReply();o.validate(o.row);validations++;
  native.ingestThreadRecords([record48('130','123','a',1),record48('131','130','me')]);
  o.validate(o.row);assert.fail('must not reach send after owner replied');
 };
 await f.scan(root48);assert.equal(validations,1);assert.deepEqual(f.sent,[]);assert.equal(f.db().records['130'],undefined);
});
test('48h nested permalink traversal reaches the latest hidden follow-up, not the direct comment or another conversation',async()=>{
 const records=[record48('130','123','a',1),record48('131','130','me',1),record48('150','131','someone')];
 const nodes=records.map(r=>branchRow(r.id,r.parent,r.replyCount,r.author));
 const f=branchFixture({nodes,pages:{123:['130'],130:['130','131'],131:['131','150']}});
 wireTree48(f,records);
 const result=await f.scan({countWindow48:true,rootPostedAt:BASE-2000});
 assert.deepEqual(f.visits,['130','131']);assert.deepEqual(f.sent,['150']);assert.equal(result.complete,true);
});
test('48h confirmed cross-module receipts settle a leaf without generation; unknown receipts remain review-only, never sent',async()=>{
 for(const status of ['unknown','confirmed']){
  const r=record48('130','123','a'),f=fixture({rootCount:1,rows:[branchRow(r.id,r.parent,r.replyCount,r.author)],shared:{130:{status}}});
  wireTree48(f,[r]);const out=await f.scan(root48);assert.equal(out.complete,status==='confirmed');
  assert.deepEqual(f.generated,[]);assert.deepEqual(f.sent,[]);
 }
});

test('72h cutoff applies to the latest comment, not the old original; excludes own-latest, expired comments and prior receipts',async()=>{
 const D=86400000,records=[record48('200','123','a'),record48('201','123','b'),record48('202','123','me'),record48('203','123','c')];
 const f=fixture({rootCount:4,rows:records.map(r=>({...branchRow(r.id,r.parent,r.replyCount,r.author),at:r.id==='201'?BASE-3*D-1:BASE-3*D})),shared:{203:{status:'confirmed'}}});
 wireTree48(f,records);
 const o=await f.scan({...root48,catchupSince:BASE-3*D,rootPostedAt:BASE-12*D});
 assert.deepEqual(f.sent,['200']);assert.equal(o.complete,true);assert.equal(o.finalCommentCount,4);
});
test('72h seed scan never generates or submits from mentions; only owned conversation IDs are collected',async()=>{
 const f=fixture({startPath:'/notifications/mentions',rows:[row('201'),row('202'),row('203',4*86400000)],scrollEnd:0});
 Object.assign(f.context.XAssistantDOM,{threadIdentity:id=>({id,root:id==='201'?'130':'131'}),ownsOriginal:id=>id!=='202'});
 const s=await f.scan({collectRootsSince:BASE-3*86400000,until:BASE});assert.deepEqual([...s.hints],['130']);assert.deepEqual(f.sent,[]);assert.deepEqual(f.generated,[]);
});
test('catch-up clears stale cursor-only branch work for an independently verified self-last branch; no send',async()=>{
 const records=[record48('130','123','a',1),record48('140','130','me')];
 const f=fixture({rootCount:1,rows:records.map(r=>branchRow(r.id,r.parent,r.replyCount,r.author)),db:{catchup72Threads:{123:{views:{123:{path:'/me/status/123',rootId:'123',pendingBranches:['999']}}}}}});
 wireTree48(f,records);const out=await f.scan({...root48,catchupSince:BASE-3*86400000});
 assert.equal(out.complete,true);assert.equal(out.finalCommentCount,1);assert.deepEqual(f.sent,[]);
});
test('X duplicate on one eligible comment skips only its target, continues to the next and never counts as confirmed',async()=>{
 const f=fixture({rows:[row('101',1),row('102',2)],send:async(o,{sent})=>{if(o.row.id==='101'){
  const receipt={kind:'rejected',reason:'duplicate',evidence:'x_notice',message:'哇哦！你已经发过了。'};await o.onDuplicate(receipt);return {action:'skip',skipReason:'platform_duplicate',receipt};}
  sent.push(o.row.id);await o.onConfirmed({kind:'confirmed'});}});
 const r=await f.scan();assert.deepEqual(f.sent,['102']);assert.equal(r.stats.confirmed,1);assert.equal(r.stats.duplicateSkipped,1);assert.equal(r.stats.failed,0);assert.equal(f.db().records['101'].status,'duplicate_skipped');
 await f.scan();assert.deepEqual(f.generated,['101','102']);assert.deepEqual(f.sent,['102']);
});
test('known unanswered ID below the fold is mounted and sent before drilling into the incomplete top branch; no second send',async()=>{
 const a=branchRow('130','123',1,'a'),b=branchRow('140','123',0,'b');
 const f=fixture({rootCount:2,scrollEnd:1,rows:(screen)=>screen?[b]:[a]});
 wireTree48(f,[record48('130','123','a',1),record48('140','123','b',0)]);
 f.context.XAssistantWorkspace={check(){},expectNavigation(){},openStatusTarget:async()=>{assert.deepEqual(f.sent,['140']);throw Object.assign(Error('simulated end'),{code:'TEST_END'});}};
 await assert.rejects(f.scan({...root48,catchupSince:BASE-8000}),{code:'TEST_END'});
 assert.deepEqual(f.sent,['140']);assert.equal(f.db().records['140'].status,'confirmed');
});
test('red banner with inconclusive delivery holds only its comment, sends the next and never resubmits the pending one',async()=>{
 const f=fixture({rows:[row('101',1),row('102',2)],send:async(o,{sent})=>{
  if(o.row.id==='101'){await o.onHold('pending_readback',null,o.text);return {action:'skip',skipReason:'pending_readback'};}
  sent.push(o.row.id);await o.onConfirmed({kind:'confirmed'});}});
 const r=await f.scan();assert.equal(r.stats.deferred,1);assert.equal(r.stats.confirmed,1);assert.deepEqual(f.sent,['102']);
 assert.equal(f.db().records['101'].status,'unknown');assert.equal(f.db().records['101'].reasonCode,'PENDING_TARGET_READBACK');assert.ok(f.db().records['101'].text);
 await f.scan();assert.deepEqual(f.sent,['102']);assert.deepEqual(f.generated,['101','102']);
});

const own={directComment:true,ownOriginalComment:true};
test('reply order inside a scan follows the priority score: a real question overtakes a slightly fresher remark',async()=>{
 const f=fixture({rows:[row('plain',60000,own),row('ask',10*60000,{...own,text:'这个怎么用？'})]});
 const result=await f.scan();
 assert.equal(result.complete,true);assert.deepEqual(f.sent,['ask','plain']);
});
test('replies confirmed in other threads make a person familiar; a recent flood of replies to one person costs them priority',async()=>{
 const H=3600000,records={};
 for(const [i,age] of [30,29].entries())records['f'+i]={status:'confirmed',author:'Friend',at:BASE-age*H};
 for(let i=0;i<4;i++)records['x'+i]={status:'confirmed',author:'flood',at:BASE-(i+1)*H};
 const f=fixture({db:{records},rows:[row('a',1000,{...own,author:'flood'}),row('b',2000,{...own,author:'friend'}),row('c',3000,{...own,author:'stranger'})]});
 await f.scan();assert.deepEqual(f.sent,['b','c','a']);
});
test('within one scan a prolific commenter yields the next slot to someone else',async()=>{
 const f=fixture({rows:[row('s1',1000,{...own,author:'spammer'}),row('s2',2000,{...own,author:'spammer'}),row('o',3000,{...own,author:'other'})]});
 await f.scan();assert.deepEqual(f.sent,['s1','o','s2']);
});

// 灯神 2: a visit with readToBottom reads the whole thread in one pass.
test('readToBottom: fresh comments below many already-answered screens are replied in the same visit',async()=>{
 const done={};for(let i=0;i<10;i++)done['done'+i]={status:'confirmed'};
 const f=fixture({scrollEnd:13,rootCount:13,db:{records:done},
  rows:screen=>[row(screen<10?'done'+screen:'fresh'+screen,1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123',readToBottom:true});
 assert.deepEqual(f.sent,['fresh10','fresh11','fresh12','fresh13']);
 assert.equal(result.complete,true);assert.equal(f.counts().top,1,'one pass from the top, no restart');
});
test('readToBottom: the old two-answered-screens case reaches the deeper comment at once',async()=>{
 const f=fixture({scrollEnd:5,rootCount:3,rows:screen=>[row(screen===0?'done-top':screen===1?'done-next':'unseen-deeper',1000,{directComment:true,ownOriginalComment:true})],
  db:{records:{'done-top':{status:'confirmed'},'done-next':{status:'confirmed'}}}});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123',readToBottom:true});
 assert.deepEqual(f.sent,['unseen-deeper']);assert.equal(result.complete,true);
});
test('readToBottom: a page that scrolls but never shows new cards yields after a bounded number of screens',async()=>{
 const f=fixture({scrollEnd:100000,rootCount:2,rows:[row('one',1000,{directComment:true,ownOriginalComment:true})]});
 const result=await f.scan({rootId:'123',threadPath:'/me/status/123',readToBottom:true});
 assert.deepEqual(f.sent,['one']);
 assert.equal(result.complete,false);assert.equal(result.reason,'THREAD_COMMENTS_PENDING');
 assert.ok(f.counts().scrolls>=10&&f.counts().scrolls<=20,'bounded: '+f.counts().scrolls);
});
