import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../workspace.js',import.meta.url),'utf8'),body=source.slice(source.indexOf(' async function openStatusTarget'),source.indexOf(' function beginComposer'));
const row={id:'123',author:'Writer',time:'2026-11-04T00:00:00Z',text:'a',url:'https://x.com/Writer/status/123'};
function fixture({draft=false,duplicate=false,lost=false,noInline=false,noChange=false,foreign=false,staleReturn=false,historyOnly=false,from='https://x.com/search?q=one'}={}){
 const loc={href:from},sourceEntry={url:from,key:'S',index:4},targetEntry={url:row.url,key:'T',index:5};
 const nav={currentEntry:sourceEntry,entries:()=>[sourceEntry,targetEntry]},events=[];
 const history={length:5,back:()=>{events.push('back');loc.href=from;nav.currentEntry=sourceEntry;}};
 const article={querySelectorAll:()=>duplicate?[link,link]:[link]},link={href:foreign?'https://other.example/Writer/status/123':row.url,isConnected:true,target:'',querySelector:()=>({}),closest:()=>article,click:()=>{events.push('click');if(!noChange){loc.href=row.url;nav.currentEntry=targetEntry;history.length++;}}};
 const old={isConnected:true,closest:q=>q.includes('cellInnerDiv')?{querySelectorAll:()=>[article]}:null};
 const draftBox={text:draft?'other':'',},ctx=vm.createContext({URL,location:loc,navigation:nav,history,document:{querySelectorAll:()=>[draftBox]},
  XAssistantDOM:{dialogs:()=>[],relocate:(_r,o,requireAddressed)=>{if(!events.length)events.push(['source',requireAddressed]);return lost?null:{article};},post:()=>historyOnly?null:{id:row.id},detailReply:(_r,diag)=>noInline?diag?{reason:'controls'}:null:{editor:{},dialog:staleReturn?old:null,article}},
  XAssistantCore:{editorText:e=>e.text},current:{module:'interaction'},T:{check(){},waitForPage:async probe=>probe()},policy:{normalize:u=>{const x=new URL(u);return x.pathname+x.search;}},
  check(){},self:()=>'/self',progress(){},expectNavigation:path=>events.push(['expect',path]),error:(code,msg)=>Object.assign(Error(msg),{code})});
 vm.runInContext(body+';globalThis.open=openStatusTarget;',ctx);
 return {open:(opts={})=>ctx.open(row,opts),events,nav,draftBox};
}
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
  await assert.rejects(v.returnToSource(),e=>e.code==='NAVIGATION');assert.equal(f.events.filter(x=>x==='back').length,1);
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
