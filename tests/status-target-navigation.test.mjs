import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../workspace.js',import.meta.url),'utf8'),body=source.slice(source.indexOf(' async function openStatusTarget'),source.indexOf(' function beginComposer'));
const row={id:'123',author:'Writer',time:'2026-11-04T00:00:00Z',text:'a',url:'https://x.com/Writer/status/123'};
function fixture({draft=false,duplicate=false,lost=false,noInline=false,noChange=false,foreign=false,staleReturn=false,historyOnly=false,module='interaction',from='https://x.com/search?q=one'}={}){
 const loc={href:from},sourceEntry={url:from,key:'S',index:4},targetEntry={url:row.url,key:'T',index:5};
 const nav={currentEntry:sourceEntry,entries:()=>[sourceEntry,targetEntry]},events=[];
 const history={length:5,back:()=>{events.push('back');loc.href=from;nav.currentEntry=sourceEntry;}};
 const article={querySelectorAll:()=>duplicate?[link,link]:[link]},link={href:foreign?'https://other.example/Writer/status/123':row.url,isConnected:true,target:'',querySelector:()=>({}),closest:()=>article,click:()=>{events.push('click');if(!noChange){loc.href=row.url;nav.currentEntry=targetEntry;history.length++;}}};
 const old={isConnected:true,closest:q=>q.includes('cellInnerDiv')?{querySelectorAll:()=>[article]}:null};
 const draftBox={text:draft?'other':'',},ctx=vm.createContext({URL,location:loc,navigation:nav,history,document:{querySelectorAll:()=>[draftBox],querySelector:()=>null},
  XAssistantDOM:{dialogs:()=>[],relocate:(_r,o,requireAddressed)=>{if(!events.length)events.push(['source',requireAddressed]);return lost?null:{article};},post:()=>historyOnly?null:{id:row.id},detailReply:(_r,diag)=>noInline?diag?{reason:'controls'}:null:{editor:{},dialog:staleReturn?old:null,article}},
  XAssistantCore:{editorText:e=>e.text},current:{module,runId:'run'},T:{check(){},waitForPage:async probe=>probe()},policy:{normalize:u=>{const x=new URL(u);return x.pathname+x.search;}},
  check(){},self:()=>'/self',progress(){},expectNavigation:path=>events.push(['expect',path]),error:(code,msg)=>Object.assign(Error(msg),{code})});
 vm.runInContext(body+';globalThis.open=openStatusTarget;',ctx);
 return {open:(opts={})=>ctx.open(row,opts),events,nav,draftBox,context:ctx};
}
test('own-thread comment visits restore their pre-visit viewport and release the hidden read clock',async()=>{
 const f=fixture({module:'notifications',from:'https://x.com/self/status/900'}),ctx=f.context,signal=new AbortController().signal;
 let leases=0,releases=0;const scrolls=[];
 ctx.window={scrollY:7200,scrollTo({top}){scrolls.push(top);this.scrollY=top;}};
 ctx.XAssistantDOM.beginDetailRead=opts=>{assert.equal(opts.id,'900');assert.equal(opts.path,'/self/status/900');assert.equal(opts.runId,'run');assert.equal(opts.signal,signal);leases++;return()=>releases++;};
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 const visit=await f.open({signal,requireAddressed:true});await visit.returnToSource();await visit.returnToSource();
 assert.equal(ctx.window.scrollY,7200);assert.deepEqual(scrolls,[7200]);assert.equal(leases,1);assert.equal(releases,1);
 assert.equal(f.events.filter(e=>e==='back').length,1);
});
test('a temporarily short restored timeline cannot certify return until the saved scroll position is reached',async()=>{
 const f=fixture({module:'notifications',from:'https://x.com/self/status/900'}),ctx=f.context;
 let ready=false,reads=0,release=0;
 ctx.window={scrollY:7200,scrollTo({top}){this.scrollY=ready?top:0;}};
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 ctx.XAssistantDOM.beginDetailRead=()=>{reads++;return()=>release++;};
 ctx.T.waitForPage=async probe=>{for(let i=0;i<3;i++){const result=probe();if(result)return result;ready=true;}return null;};
 const visit=await f.open({signal:new AbortController().signal});await visit.returnToSource();
 assert.equal(ctx.window.scrollY,7200);assert.equal(reads,1);assert.equal(release,1);
});
test('return at a deep own-thread viewport accepts verified siblings without demanding the unmounted root',async()=>{
 const f=fixture({module:'notifications',from:'https://x.com/self/status/900'}),ctx=f.context;
 ctx.window={scrollY:9000,scrollTo({top}){this.scrollY=top;}};
 const relocate=ctx.XAssistantDOM.relocate;ctx.XAssistantDOM.relocate=(...args)=>f.events.includes('back')?null:relocate(...args);
 ctx.XAssistantDOM.rows=()=>[{id:'124',author:'Sibling'}];ctx.XAssistantDOM.inThread=(id,root)=>id==='124'&&root==='900';
 const visit=await f.open();await visit.returnToSource();assert.equal(f.events.filter(e=>e==='back').length,1);
});
test('unrelated cards never certify an own-thread return, and the read clock always closes on timeout',async()=>{
 const f=fixture({module:'notifications',from:'https://x.com/self/status/900'}),ctx=f.context;
 let release=0;const relocate=ctx.XAssistantDOM.relocate;ctx.XAssistantDOM.relocate=(...args)=>f.events.includes('back')?null:relocate(...args);
 ctx.window={scrollY:9000,scrollTo({top}){this.scrollY=top;}};
 ctx.XAssistantDOM.beginDetailRead=()=>()=>release++;
 ctx.XAssistantDOM.rows=()=>[{id:'124',author:'Unrelated'}];ctx.XAssistantDOM.inThread=()=>false;
 const visit=await f.open();await assert.rejects(visit.returnToSource(),{code:'NAVIGATION',stopTargetVisit:true});assert.equal(release,1);
});
function readOnlyFixture(change={}){
 const f=fixture({module:'notifications',from:'https://x.com/self/status/900',noInline:true}),ctx=f.context;
 const main={contains:()=>change.aside!==true};ctx.document.querySelector=s=>s.includes('primaryColumn')?main:null;
 ctx.XAssistantDOM.normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
 ctx.XAssistantDOM.rows=()=>{
  const r={...row,...change,article:{...ctx.XAssistantDOM.relocate(row,'/self').article,isConnected:true}};
  return change.duplicate?[r,r]:[r];
 };
 return f;
}
function shortenedSourceFixture({readOnly=false,missing=false,offscreen=false,hidden=false,aside=false,detached=false,max=53,stuck=false,change={}}={}){
 const f=readOnly?readOnlyFixture():fixture({module:'notifications',from:'https://x.com/self/status/900'}),ctx=f.context;
 const relocate=ctx.XAssistantDOM.relocate,article=relocate(row,'/self').article;
 article.isConnected=!detached;article.closest=()=>hidden?{}:null;
 article.getBoundingClientRect=()=>({top:offscreen?950:100,bottom:offscreen?1050:200,height:100});
 ctx.document.querySelector=s=>s.includes('primaryColumn')?{contains:()=>!aside}:null;ctx.innerHeight=900;
 ctx.document.scrollingElement={scrollHeight:900+max};
 ctx.window={scrollY:294,scrollTo({top}){this.scrollY=stuck?0:Math.min(top,ctx.document.scrollingElement.scrollHeight-900);}};
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 ctx.XAssistantDOM.relocate=(...args)=>{
  if(!f.events.includes('back'))return relocate(...args);
  const restored={...row,...change};
  return missing||['id','author','time','text'].some(key=>restored[key]!==row[key])?null:{...restored,article};
 };
 return f;
}
test('a shorter source timeline can restore the exact visible anchor at its legal scroll maximum',async()=>{
 for(const readOnly of [false,true]){
  const f=shortenedSourceFixture({readOnly}),trip=await f.open({readOnly,requireAddressed:true});
  await trip.returnToSource();await trip.returnToSource();
  assert.equal(f.context.window.scrollY,53);assert.equal(f.events.filter(e=>e==='back').length,1);
 }
});
test('short source timelines never use a missing, mismatched, hidden, offscreen or non-primary anchor',async()=>{
 for(const options of [{missing:true},{offscreen:true},{hidden:true},{aside:true},{detached:true},
  ...[{id:'124'},{author:'Other'},{time:'different'},{text:'changed'}].map(change=>({change}))]){
  const f=shortenedSourceFixture(options),trip=await f.open({requireAddressed:true});
  await assert.rejects(trip.returnToSource(),{code:'NAVIGATION',stopTargetVisit:true});
  assert.equal(f.events.filter(e=>e==='back').length,1);
 }
});
test('semantic anchor recovery requires both an unreachable saved position and the current legal maximum',async()=>{
 for(const options of [{stuck:true},{stuck:true,max:1000}]){
  const f=shortenedSourceFixture(options),trip=await f.open();
  await assert.rejects(trip.returnToSource(),{code:'NAVIGATION',stopTargetVisit:true});
 }
});
test('a temporarily shortened source without its anchor waits for the numeric position instead of certifying early',async()=>{
 const f=shortenedSourceFixture({missing:true}),ctx=f.context;let retried=false;
 ctx.T.waitForPage=async probe=>{
  const first=probe();if(first)return first;
  assert.equal(ctx.window.scrollY,53);retried=true;ctx.document.scrollingElement.scrollHeight=1900;
  ctx.XAssistantDOM.relocate=()=>({article:{isConnected:true}});return probe();
 };
 const trip=await f.open();await trip.returnToSource();
 assert.equal(retried,true);assert.equal(ctx.window.scrollY,294);
});
test('read-only own-thread probes validate the native target without an inline editor and return through the proven history',async()=>{
 const f=readOnlyFixture(),ctx=f.context,waits=[];
 ctx.window={scrollY:4320,scrollTo({top}){this.scrollY=top;}};
 ctx.T.waitForPage=async(probe,options)=>{waits.push(options.timeout);return probe();};
 ctx.XAssistantReplyEngine={send:()=>assert.fail('read-only probe must never send')};
 ctx.document.execCommand=()=>assert.fail('read-only probe must never edit');
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 const trip=await f.open({readOnly:true});await trip.returnToSource();await trip.returnToSource();
 assert.equal(ctx.window.scrollY,4320);assert.equal(f.events.filter(e=>e==='click').length,1);assert.equal(f.events.filter(e=>e==='back').length,1);
 assert.deepEqual(waits,[15000,15000]);
 const normal=readOnlyFixture();await assert.rejects(normal.open(),{code:'INLINE_EDITOR_NOT_READY'});
});
test('read-only probes reject mismatched target identity, text, timestamp, duplicate cards or cards outside the primary column',async()=>{
 for(const change of [{id:'124'},{author:'Other'},{time:'2026-11-05T00:00:00Z'},{text:'changed'},{duplicate:true},{aside:true}]){
  const f=readOnlyFixture(change);await assert.rejects(f.open({readOnly:true}),{code:'TARGET_NOT_READY',stopTargetVisit:true});
  assert.equal(f.events.includes('back'),false);
 }
});
test('read-only probes do not accept changed URLs or expand allowed history returns',async()=>{
 const wrong=readOnlyFixture(),ctx=wrong.context,relocate=ctx.XAssistantDOM.relocate;
 ctx.XAssistantDOM.relocate=(...args)=>{
  const value=relocate(...args),query=value.article.querySelectorAll;
  value.article.querySelectorAll=selector=>query(selector).map(link=>({...link,click(){link.click();ctx.location.href='https://x.com/Other/status/123';}}));
  return value;
 };
 await assert.rejects(wrong.open({readOnly:true}),{code:'TARGET_NOT_READY'});
 const f=readOnlyFixture(),trip=await f.open({readOnly:true});f.nav.currentEntry={...f.nav.currentEntry,key:'other'};
 await assert.rejects(trip.returnToSource(),{code:'RETURN_UNVERIFIED'});assert.equal(f.events.includes('back'),false);
 const elsewhere=fixture({noInline:true});await assert.rejects(elsewhere.open({readOnly:true}),{code:'TARGET_MISMATCH'});assert.equal(elsewhere.events.includes('click'),false);
});
function nestedThreadFixture({readOnly=false,identity={id:'110',root:'900',author:'ancestor',parent:'900'},owned=true}={}){
 const f=fixture({module:'notifications',from:'https://x.com/ancestor/status/110',noInline:readOnly}),ctx=f.context;
 ctx.document.querySelector=s=>s.includes('primaryColumn')?{contains:()=>true}:null;
 ctx.XAssistantDOM.normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
 ctx.XAssistantDOM.originalPost=(id,owner)=>owned&&id==='900'&&owner==='/self';
 ctx.XAssistantDOM.threadIdentity=id=>id==='110'?identity:null;
 ctx.XAssistantDOM.inThread=(id,root)=>['110','123'].includes(id)&&root==='900';
 ctx.XAssistantDOM.descendantOf=(id,ancestor,root)=>['110','123'].includes(id)&&ancestor==='900'&&root==='900';
 ctx.XAssistantDOM.rows=()=>[{...row,article:{...ctx.XAssistantDOM.relocate(row,'/self').article,isConnected:true}}];
 ctx.window={scrollY:6480,scrollTo({top}){this.scrollY=top;}};
 f.reads=[];f.releases=[];ctx.XAssistantDOM.beginDetailRead=({id,path})=>{f.reads.push([id,path]);return()=>f.releases.push(id);};
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 return f;
}
test('verified nested own-thread sources support read-only branch visits and ordinary replies with per-level scroll restoration',async()=>{
 for(const readOnly of [false,true]){
  const f=nestedThreadFixture({readOnly}),trip=await f.open({readOnly,threadRootId:'900',requireAddressed:false});
  await trip.returnToSource();assert.equal(f.context.window.scrollY,6480);assert.equal(f.events.filter(e=>e==='back').length,1);
  assert.deepEqual(f.reads,readOnly?[['123','/Writer/status/123'],['110','/ancestor/status/110']]:[['110','/ancestor/status/110']]);
  assert.deepEqual(f.releases,readOnly?['123','110']:['110']);
 }
});
test('nested visits reject an unowned root and source metadata with a wrong author, id or root before clicking',async()=>{
 const identities=[{id:'110',root:'900',author:'wrong'},{id:'111',root:'900',author:'ancestor'},{id:'110',root:'901',author:'ancestor'},null];
 for(const readOnly of [false,true])for(const change of [{owned:false},...identities.map(identity=>({identity}))]){
  const f=nestedThreadFixture({readOnly,...change});
  await assert.rejects(f.open({readOnly,threadRootId:'900'}),{code:'TARGET_MISMATCH'});assert.equal(f.events.includes('click'),false);
 }
});
test('a nested source with an unmounted root accepts only descendants of that exact branch, not same-thread siblings',async()=>{
 for(const descendant of [false,true]){
  const f=nestedThreadFixture(),ctx=f.context,relocate=ctx.XAssistantDOM.relocate;
  ctx.XAssistantDOM.relocate=(...args)=>f.events.includes('back')?null:relocate(...args);
  ctx.XAssistantDOM.rows=()=>[{id:'140',author:'other'}];
  ctx.XAssistantDOM.descendantOf=(id,ancestor,root)=>id==='110'&&ancestor==='900'&&root==='900'||descendant&&id==='140'&&ancestor==='110'&&root==='900';
  const trip=await f.open({threadRootId:'900'});
  if(descendant)await trip.returnToSource();else await assert.rejects(trip.returnToSource(),{code:'NAVIGATION',stopTargetVisit:true});
  assert.equal(ctx.window.scrollY,6480);
 }
});
test('nested return rechecks source metadata without issuing a second history back',async()=>{
 const f=nestedThreadFixture(),trip=await f.open({threadRootId:'900'});
 f.context.XAssistantDOM.threadIdentity=()=>({id:'110',root:'900',author:'changed'});
 await assert.rejects(trip.returnToSource(),{code:'TARGET_UPDATED'});assert.equal(f.events.filter(e=>e==='back').length,1);
});
test('same-root source metadata without a complete acyclic parent chain never authorizes a nested visit',async()=>{
 const source=fs.readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
 for(const records of [
  [{id:'110',root:'900',author:'ancestor',parent:'119'}],
  [{id:'110',root:'900',author:'ancestor',parent:'120'},{id:'120',root:'901',author:'other',parent:'900'}],
  [{id:'110',root:'900',author:'ancestor',parent:'120'},{id:'120',root:'900',author:'other',parent:'110'}]
 ])for(const readOnly of [false,true]){
  const f=nestedThreadFixture({readOnly}),dom=vm.createContext({URL,location:{pathname:'/ancestor/status/110'},document:{querySelector:()=>null,querySelectorAll:()=>[]}});
  vm.runInContext(source,dom);
  dom.XAssistantDOM.ingestThreadRecords([{id:'900',root:'900',author:'self',parent:null},...records]);
  assert.equal(dom.XAssistantDOM.inThread('110','900'),true);
  f.context.XAssistantDOM.descendantOf=dom.XAssistantDOM.descendantOf;
  await assert.rejects(f.open({readOnly,threadRootId:'900'}),{code:'TARGET_MISMATCH'});
  assert.equal(f.events.includes('click'),false);
 }
});
test('read-only rendering leases close after timeout and never cover ordinary reply target preparation',async()=>{
 const f=nestedThreadFixture({readOnly:true});f.context.XAssistantDOM.rows=()=>[];
 await assert.rejects(f.open({readOnly:true,threadRootId:'900'}),{code:'TARGET_NOT_READY'});
 assert.deepEqual(f.reads,[['123','/Writer/status/123']]);assert.deepEqual(f.releases,['123']);
 const normal=nestedThreadFixture({readOnly:true});await assert.rejects(normal.open({threadRootId:'900'}),{code:'INLINE_EDITOR_NOT_READY'});
 assert.deepEqual(normal.reads,[]);assert.deepEqual(normal.releases,[]);
});
test('opens only a live timestamp and returns natively to its immediate original history entry',async()=>{
 const f=fixture(),v=await f.open({requireAddressed:true});await v.returnToSource();await v.returnToSource();
 assert.deepEqual(f.events,[['source',true],['expect','/Writer/status/123'],'click',['expect','/search?q=one'],'back']);
});
test('history eviction may reindex retained entries without changing the proven return',async()=>{
 for(const from of ['https://x.com/search?q=one','https://x.com/home','https://x.com/self']){
  const f=fixture({from}),visit=await f.open();
  // Chromium asynchronously evicts the oldest entry after reaching its cap.
  // Both keys and their adjacency survive; the previously captured index does not.
  for(const entry of f.nav.entries())entry.index--;
  await visit.returnToSource();await visit.returnToSource();
  assert.equal(f.events.filter(e=>e==='back').length,1);
 }
});
test('reindexing never permits a missing, replaced, nonadjacent or changed source',async()=>{
 for(const change of ['missing','replaced','nonadjacent','source-url','target-url','invalid-index']){
  const f=fixture(),visit=await f.open(),entries=f.nav.entries();
  for(const entry of entries)entry.index--;
  if(change==='missing')f.nav.entries=()=>[entries[1]];
  if(change==='replaced')entries[0].key='different-source';
  if(change==='nonadjacent')entries[1].index++;
  if(change==='source-url')entries[0].url='https://x.com/search?q=other';
  if(change==='target-url')entries[1].url='https://x.com/Other/status/123';
  if(change==='invalid-index')entries[0].index=-1;
  await assert.rejects(visit.returnToSource(),{code:'RETURN_UNVERIFIED'});
  assert.equal(f.events.includes('back'),false,change);
 }
});
test('来自首页的详情访问经核对后只返回原首页，不跳转搜索或使用伪造历史',async()=>{
 const f=fixture({from:'https://x.com/home'}),visit=await f.open();await visit.returnToSource();await visit.returnToSource();
 assert.deepEqual(f.events,[['source',false],['expect','/Writer/status/123'],'click',['expect','/home'],'back']);
 const changed=fixture({from:'https://x.com/home'}),second=await changed.open();
 changed.nav.currentEntry={...changed.nav.currentEntry,key:'foreign'};
 await assert.rejects(second.returnToSource(),{code:'RETURN_UNVERIFIED'});assert.ok(!changed.events.includes('back'));
});
test('never clicks when source identity, link ownership/uniqueness or draft guard fails',async()=>{
 for(const opts of [{lost:true},{duplicate:true},{foreign:true},{draft:true}]){
  const f=fixture(opts);await assert.rejects(f.open());assert.equal(f.events.includes('click'),false);
 }
});
test('URL alone does not certify a detail and a same-looking page without real navigation is not accepted',async()=>{
 for(const opts of [{noInline:true},{noChange:true}]){
  const f=fixture(opts);await assert.rejects(f.open(),e=>e.code==='INLINE_EDITOR_NOT_READY'&&e.stopTargetVisit);assert.equal(f.events.includes('back'),false);
 }
});
test('return rejects edited inline drafts or a changed history entry and never clicks back',async()=>{
 for(const mode of ['draft','changedEntry']){
  const f=fixture(),v=await f.open();if(mode==='draft')f.draftBox.text='manual';else f.nav.currentEntry={...f.nav.currentEntry,key:'other'};
  await assert.rejects(v.returnToSource(),e=>e.code===(mode==='draft'?'RESIDUAL_DRAFT':'RETURN_UNVERIFIED'));assert.equal(f.events.includes('back'),false);
 }
});
test('a restored URL with a still-mounted verified target/reply pair, including history-only edited details, is not a rendered return',async()=>{
 for(const historyOnly of [false,true]){
  const f=fixture({staleReturn:true,historyOnly}),v=await f.open();
  await assert.rejects(v.returnToSource(),e=>e.code==='NAVIGATION'&&e.stopTargetVisit===true);assert.equal(f.events.filter(x=>x==='back').length,1);
 }
});
test('a recycled detail article uses its current native identity, without allowing unrelated source cards',async()=>{
 for(const sourceCard of [true,false]){
  const f=fixture({module:'notifications',from:'https://x.com/self/status/900',staleReturn:true}),ctx=f.context;
  const current=sourceCard?{id:'900',author:'self'}:{id:'901',author:'unrelated'};
  ctx.XAssistantDOM.post=()=>current;
  const relocate=ctx.XAssistantDOM.relocate;ctx.XAssistantDOM.relocate=(...args)=>f.events.includes('back')?null:relocate(...args);
  ctx.XAssistantDOM.rows=()=>[current];ctx.XAssistantDOM.inThread=()=>false;
  const trip=await f.open();
  if(sourceCard)await trip.returnToSource();else await assert.rejects(trip.returnToSource(),{code:'NAVIGATION',stopTargetVisit:true});
  assert.equal(f.events.filter(e=>e==='back').length,1);
 }
});
const overlay=fs.readFileSync(new URL('../overlay.js',import.meta.url),'utf8'),reply=overlay.slice(overlay.indexOf(' const replyAndSend='),overlay.indexOf(' const relocatePost='));
test('unknown claim never visits, unknown submit never returns, confirmed receipt precedes return',async()=>{
 for(const result of ['already','unknown','confirmed']){
  const order=[],ctx=vm.createContext({account:'/owner',check(){},updateRuntime(){},activeRun:'run',replySubmitted:false,
   XAssistantWorkspace:{openStatusTarget:async()=>{order.push('open');return{returnToSource:async()=>order.push('back')}}},
   XAssistantReplyEngine:{send:async o=>{assert.equal(o.detailInline,true);order.push('claim');if(result==='already')throw Object.assign(Error(),{code:'REPLY_ALREADY_CLAIMED'});
    await o.prepareTarget();if(result==='unknown')throw Object.assign(Error(),{submitted:true,code:'SEND_UNKNOWN'});await o.onConfirmed({});}}});
  vm.runInContext(reply+';globalThis.send=replyAndSend',ctx);
  const run=ctx.send(row,'reply',{},async()=>order.push('receipt'),()=>{});
  if(result==='confirmed'){assert.equal(await run,'verified');assert.deepEqual(order,['claim','open','receipt','back']);}
  else{await assert.rejects(run,e=>result==='already'?e.code==='REPLY_ALREADY_CLAIMED':e.stopTargetVisit===true);assert.deepEqual(order,result==='already'?['claim']:['claim','open']);}
 }
});

function originalFixture({header=true,original=true,from='https://x.com/writer',module='notifications'}={}){
 const f=fixture({module,from,noInline:true}),ctx=f.context;
 ctx.self=()=>'/writer';ctx.window={scrollY:4200,scrollTo({top}){this.scrollY=top;}};
 const article=ctx.XAssistantDOM.relocate(row,'/writer').article;article.isConnected=true;
 const main={contains:a=>a===article};
 ctx.document.querySelector=s=>s.includes('UserProfileHeader_Items')?(header?{}:null):s.includes('primaryColumn')?main:null;
 ctx.XAssistantDOM.rows=()=>[{...row,article}];ctx.XAssistantDOM.originalPost=(id,owner)=>original&&id==='123'&&owner==='/writer';
 ctx.XAssistantDOM.normalize=s=>String(s).trim();ctx.XAssistantDOM.beginDetailRead=()=>()=>{};
 const back=ctx.history.back;ctx.history.back=()=>{back();ctx.window.scrollY=0;};
 const declaration=source.slice(source.indexOf(' const openOwnOriginal='),source.indexOf(' globalThis.XAssistantWorkspace='));
 vm.runInContext(declaration+';globalThis.openOriginal=openOwnOriginal;',ctx);
 return {...f,openOriginal:opts=>ctx.openOriginal(row,opts)};
}
test('own original visits use the real profile permalink and restore the exact profile history and viewport',async()=>{
 const f=originalFixture(),trip=await f.openOriginal();await trip.returnToSource();
 assert.equal(f.context.window.scrollY,4200);
 assert.deepEqual(f.events.filter(e=>typeof e==='string'),['click','back']);
 assert.equal(f.context.location.href,'https://x.com/writer');
});
test('own original navigation is restricted to the notification owner profile and native original proof',async()=>{
 for(const options of [{module:'interaction'},{from:'https://x.com/other'},{original:false}]){
  const f=originalFixture(options);await assert.rejects(f.openOriginal(),{code:'TARGET_MISMATCH'});assert.ok(!f.events.includes('click'));
 }
});
test('original return never accepts a changed history, user draft or missing profile header',async()=>{
 for(const mode of ['history','draft','header']){
  const f=originalFixture(),trip=await f.openOriginal();
  if(mode==='history')f.nav.currentEntry={...f.nav.currentEntry,key:'other'};
  if(mode==='draft')f.draftBox.text='draft';
  if(mode==='header'){const query=f.context.document.querySelector;f.context.document.querySelector=s=>s.includes('UserProfileHeader_Items')?null:query(s);}
  await assert.rejects(trip.returnToSource(),e=>['RETURN_UNVERIFIED','RESIDUAL_DRAFT','NAVIGATION'].includes(e.code));
  if(mode!=='header')assert.ok(!f.events.includes('back'));
 }
});
test('worker reports keep runtime status separate from a validated nested HTTP status and retry deadline',async()=>{
 const reportSource=source.slice(source.indexOf(' function normalizeFailure('),source.indexOf(' const normalStop=')),calls=[];
 const ctx=vm.createContext({api:{call:async msg=>calls.push(msg)},uncertain:()=>false,error:(code,message)=>Object.assign(Error(message),{code})});
 vm.runInContext(reportSource+';globalThis.sendReport=report;',ctx);
 await ctx.sendReport({module:'notifications',token:'t'},'error',Object.assign(Error('outer'),{status:503,retryAt:100,cause:{httpStatus:429,retryAt:200}}));
 assert.equal(calls[0].status,'error');assert.equal(calls[0].httpStatus,429);assert.equal(calls[0].retryAt,200);
 await ctx.sendReport({module:'notifications',token:'t'},'error',{message:'bad',httpStatus:'429',retryAt:Infinity});
 assert.equal(calls[1].httpStatus,undefined);assert.equal(calls[1].retryAt,undefined);
});

test('attachment-only, poll-only and selected-file drafts prevent native navigation and are never cleared',async()=>{
 for(const type of ['attachments','pollCreator','file']){
  const f=fixture(),ctx=f.context;
  ctx.document.querySelector=s=>type!=='file'&&s.includes(type)?{}:null;
  const query=ctx.document.querySelectorAll;ctx.document.querySelectorAll=s=>type==='file'&&s==='input[type="file"]'?[{files:[{}]}]:query(s);
  await assert.rejects(f.open(),{code:'RESIDUAL_DRAFT',preserveDrafts:true});assert.equal(f.events.includes('click'),false);
 }
});


test('read-only detail delegates short-preview matching using the exact original row reference',async()=>{
 for(const match of [true,false]){
  const f=readOnlyFixture({text:'expanded native body'}),ctx=f.context,calls=[];
  ctx.XAssistantDOM.detailTextMatches=(original,actual)=>{calls.push([original,actual]);return original===row&&actual==='expanded native body'&&match;};
  if(match){const trip=await f.open({readOnly:true});assert.equal(typeof trip.returnToSource,'function');}
  else await assert.rejects(f.open({readOnly:true}),{code:'TARGET_NOT_READY',stopTargetVisit:true});
  assert.equal(calls.length,1);assert.equal(calls[0][0],row);
 }
});
test('short-preview helper never weakens read-only id, author, time or unique-primary-card checks',async()=>{
 for(const change of [{id:'124'},{author:'Other'},{time:'different'},{duplicate:true},{aside:true}]){
  const f=readOnlyFixture(change);f.context.XAssistantDOM.detailTextMatches=()=>true;
  await assert.rejects(f.open({readOnly:true}),{code:'TARGET_NOT_READY',stopTargetVisit:true});
 }
});
