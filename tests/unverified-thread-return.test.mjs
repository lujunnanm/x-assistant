import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../workspace.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf(' async function openStatusTarget'),source.indexOf(' function beginComposer'));
function setup(opt={}){
 const row={id:'123',author:'Writer',time:'2026-11-16T00:00:00Z',text:'original',url:'https://x.com/Writer/status/123'};
 const branch=opt.rootSource?'900':'110',author=opt.rootSource?'self':'ancestor';
 const initial=`https://x.com/${author}/status/${branch}`,entry={key:'s',index:4,url:initial},to={key:'t',index:5,url:row.url};
 const location={href:initial},log=[],evt=new Map(),docEvents=new Map();
 const listeners=map=>({addEventListener:(k,f)=>map.set(k,f),removeEventListener:(k,f)=>{assert.equal(map.get(k),f);map.delete(k);}});
 const navigation={currentEntry:entry,entries:()=>opt.missingPrevious?[to]:[entry,to],...listeners(evt)};
 const goto=a=>{const from=navigation.currentEntry;navigation.currentEntry=a;location.href=a.url;evt.get('currententrychange')?.({from});};
 const detailCard={isConnected:true,closest:()=>null};
 const sourceCard={isConnected:true,closest:()=>opt.hiddenSource?{}:null,querySelectorAll:()=>[link]};
 const link={href:row.url,target:'',isConnected:true,closest:()=>sourceCard,querySelector:()=>({}),click(){
  log.push('click');goto(opt.nonAdjacent?{...to,index:7}:to);
  if(opt.reindex){entry.index--;to.index--;}
  if(opt.changedKey)goto({...to,key:'user'});
  if(opt.changedRoute)location.href='https://x.com/Other/status/321';
  if(opt.touched)docEvents.get(opt.touched)?.({isTrusted:true});
 }};
 const window={scrollY:4800,scrollTo({top}){log.push(['scroll',top]);this.scrollY=top;}};
 const history={length:5,back(){log.push('back');goto(entry);detailCard.isConnected=!!(opt.stale||opt.reusedAncestor);window.scrollY=0;
  if(opt.manualBack)docEvents.get('click')?.({isTrusted:true});}};
 const atTarget=()=>location.href===row.url;
 const main={contains:a=>!opt.aside&&(a===sourceCard||a===detailCard)};
 const document={...listeners(docEvents),querySelectorAll:q=>q.includes('primaryColumn')?[detailCard]:
  q.includes('contenteditable')&&atTarget()&&opt.draft?[{text:'draft'}]:
  q.includes('input[type="file"]')&&atTarget()&&opt.file?[{files:[{}]}]:[],
  querySelector:q=>q.includes('attachments')||q.includes('pollCreator')?atTarget()&&(opt.media||opt.poll)?{}:null:
   q.includes('primaryColumn')?main:null};
 const owner=()=>opt.ownerChanged&&log.length?'/other':'/self';
 const D={dialogs:()=>atTarget()&&opt.dialog?[{}]:[],normalize:s=>String(s||'').trim(),
  originalPost:(id,account)=>!opt.unowned&&id==='900'&&account==='/self',
  threadIdentity:id=>{
   if(id===branch)return {id,root:opt.sourceChanged&&log.length||opt.sourceChangedAfterBack&&log.includes('back')?'901':'900',author,parent:opt.rootSource?null:'900'};
   if(id===row.id)return opt.unbound?null:{id,root:opt.otherRoot||opt.targetChanged&&log.length?'901':'900',author:opt.otherAuthor?'other':'writer',parent:branch};
   return null;
  },
  inThread:(id,root)=>!opt.unbound&&id===row.id&&root==='900',
  descendantOf:(id,ancestor,root)=>root==='900'&&(id===branch&&ancestor==='900'||opt.descendant&&id==='140'&&ancestor===branch),
  detailReply:(_r,diag)=>_r.id===branch&&opt.reusedAncestor&&location.href===initial&&!(log.includes('back')&&opt.sourceSurfaceChanged)?{article:sourceCard,dialog:{},editor:{}}:diag?{reason:opt.reason||'target',cards:opt.cards??1,target:opt.target??0}:null,
  relocate:()=>log.includes('back')&&opt.lostSource?null:{...row,article:sourceCard},
  rows:()=>[{id:opt.descendant||opt.sibling?'140':branch,author:opt.sibling?'sibling':author,time:row.time,text:'source text',article:sourceCard}],
  beginDetailRead:({id})=>{log.push(['read',id]);return()=>log.push(['endRead',id]);},
 };
 const ctx={URL,location,history,navigation:opt.noNavigation?undefined:navigation,document,window,
  XAssistantDOM:D,XAssistantCore:{editorText:e=>e.text},current:{module:'notifications',runId:'run'},
  T:{check(){},waitForPage:async probe=>probe()},policy:{normalize:u=>{const x=new URL(u);return x.pathname+x.search;}},
  check(){},self:owner,progress(){},expectNavigation(){},error:(code,message)=>Object.assign(Error(message),{code})};
 vm.runInNewContext(fn+';this.open=openStatusTarget;',ctx);
 return {call:()=>ctx.open(row,{threadRootId:'900',readOnly:!!opt.readOnly}),log,ctx,
  clean:()=>{assert.equal(evt.size,0);assert.equal(docEvents.size,0);}};
}
const skipped=e=>e.code==='TARGET_SKIPPED_UNSENT'&&e.submitted===false&&e.confirmed===false&&e.returnedToSource===true&&!e.stopTargetVisit&&!e.preserveDrafts;
for(const rootSource of [true,false])for(const mode of ['target','editor','readonly'])test(`unsubmitted ${mode} failure restores exact native ${rootSource?'root':'branch'} source and viewport`,async()=>{
 const f=setup({rootSource,...mode==='editor'?{reason:'controls',target:1}:mode==='readonly'?{readOnly:true}:{}});
 await assert.rejects(f.call(),e=>skipped(e)&&e.failureKind===(mode==='editor'?'editor_unavailable':'target_identity'));
 assert.equal(f.ctx.location.href,`https://x.com/${rootSource?'self/status/900':'ancestor/status/110'}`);
 assert.equal(f.ctx.window.scrollY,4800);assert.equal(f.log.filter(x=>x==='back').length,1);f.clean();
});
for(const reason of ['reply_wrapper','not_adjacent','unbound','not_reply'])test('an unsubmitted malformed editor can only skip after native thread recovery: '+reason,async()=>{
 const f=setup({reason,target:1});await assert.rejects(f.call(),e=>skipped(e)&&e.failureKind==='editor_unavailable');f.clean();
});
test('history eviction preserves exact native adjacency for an owned-thread safe return',async()=>{
 const f=setup({reindex:true});await assert.rejects(f.call(),skipped);assert.equal(f.log.filter(x=>x==='back').length,1);f.clean();
});
for(const [name,opt] of [
 ['unbound target',{unbound:true}],['target other root',{otherRoot:true}],['target other author',{otherAuthor:true}],
 ['source metadata changed',{sourceChanged:true}],['target metadata changed',{targetChanged:true}],
 ['no navigation API',{noNavigation:true}],['history no longer adjacent',{nonAdjacent:true}],['source history missing',{missingPrevious:true}],
 ['user navigation',{changedKey:true}],['target route changed',{changedRoute:true}],['account changed',{ownerChanged:true}],
 ['text draft',{draft:true}],['attachment draft',{media:true}],['poll draft',{poll:true}],['file draft',{file:true}],['dialog',{dialog:true}],
 ['trusted edit',{touched:'beforeinput'}],['trusted click',{touched:'click'}],['trusted submission',{touched:'submit'}],
 ['duplicate target cards',{target:2}],['no native cards',{cards:0}],['missing controls without target identity',{reason:'controls',target:0}],
])test('thread failure preserves target and never guesses a Back: '+name,async()=>{
 const f=setup(opt);await assert.rejects(f.call(),e=>e.code!=='TARGET_SKIPPED_UNSENT'&&e.stopTargetVisit===true);
 assert.equal(f.log.includes('back'),false);f.clean();
});
for(const [name,opt] of [
 ['stale target DOM',{stale:true}],['source metadata changed after Back',{sourceChangedAfterBack:true}],
 ['source unrelated sibling',{lostSource:true,sibling:true}],['hidden source',{hiddenSource:true}],['source aside',{aside:true}],
 ['user takes over Back',{manualBack:true}],
])test('restored URL alone never clears failure: '+name,async()=>{
 const f=setup(opt);await assert.rejects(f.call(),e=>e.code!=='TARGET_SKIPPED_UNSENT'&&e.stopTargetVisit===true);
 assert.equal(f.log.filter(x=>x==='back').length,1);f.clean();
});
test('an unmounted source anchor can certify a repainted exact nested descendant, not a same-root sibling',async()=>{
 const f=setup({lostSource:true,descendant:true});await assert.rejects(f.call(),skipped);
 assert.equal(f.ctx.window.scrollY,4800);f.clean();
});
test('unowned root never permits even the native source click',async()=>{
 const f=setup({unowned:true});await assert.rejects(f.call(),{code:'TARGET_MISMATCH'});assert.deepEqual(f.log,[]);f.clean();
});

test('reused ancestor cards do not block Back when the same exact native source reply surface rebinds',async()=>{
 for(const rootSource of [true,false]){
  const f=setup({rootSource,reusedAncestor:true});await assert.rejects(f.call(),skipped);
  assert.equal(f.ctx.window.scrollY,4800);assert.equal(f.log.filter(x=>x==='back').length,1);f.clean();
 }
});
test('reused cards without the original source surface proof never certify return',async()=>{
 const f=setup({reusedAncestor:true,sourceSurfaceChanged:true});
 await assert.rejects(f.call(),{code:'NAVIGATION',stopTargetVisit:true});assert.equal(f.log.filter(x=>x==='back').length,1);f.clean();
});
