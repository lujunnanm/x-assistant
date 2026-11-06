import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../workspace.js',import.meta.url),'utf8');
const fn=code.slice(code.indexOf(' async function openStatusTarget'),code.indexOf(' function beginComposer'));
const row={author:'BlueTearsPT',id:'2118139765837140108',time:'2026-11-05T00:34:07.000Z',text:'original',url:'https://x.com/BlueTearsPT/status/2118139765837140108'};
function setup(opt={}){
 const source='https://x.com/search?q=friend&f=live',entry={key:'s',index:4,url:source},to={key:'t',index:5,url:row.url};
 const location={href:source},log=[],evt=new Map(),docEvents=new Map();
 const listeners=(map)=>({addEventListener:(k,f)=>map.set(k,f),removeEventListener:(k,f)=>{assert.equal(map.get(k),f);map.delete(k)}});
 const nav={currentEntry:entry,entries:()=>opt.missingPrevious?[to]:[entry,to],...listeners(evt)};
 const goto=(a)=>{const from=nav.currentEntry;nav.currentEntry=a;location.href=a.url;evt.get('currententrychange')?.({from});};
 const detailCard={isConnected:true,closest:()=>null},sourceCard={querySelectorAll:()=>[link]};
 const link={href:row.url,target:'',isConnected:true,closest:()=>sourceCard,querySelector:()=>({}),click(){
  log.push('clickTimestamp');goto(opt.nonAdjacent?{...to,index:7}:to);
  if(opt.changedKey)goto({...to,key:'x'});
  if(opt.touched)docEvents.get('input')?.({isTrusted:true});
 }};
 const history={length:5,back(){log.push('back');goto(entry);detailCard.isConnected=!!opt.stale;
  if(opt.manualBack)docEvents.get('click')?.({isTrusted:true});}};
 const primaryTab={closest:()=>null},owner=()=>opt.ownerChanged&&log.length?'/other':'/self';
 const document={...listeners(docEvents),querySelectorAll:q=>q.includes('primaryColumn')?[detailCard]:
  q.includes('contenteditable')&&location.href===row.url&&opt.draft?[{text:'draft'}]:[],
  querySelector:q=>q.includes('tablist')&&!opt.noTabs?primaryTab:q.includes('attachments')&&opt.media?{}:null};
 const context={URL,location,history,navigation:opt.noNavigation?undefined:nav,document,
  XAssistantDOM:{dialogs:()=>[],detailReply:(_r,diag)=>diag?{reason:opt.reason||'target',cards:opt.cards??1,target:opt.target??0}:null,
   relocate:()=>log.includes('back')&&opt.lostSource?null:{article:sourceCard}},
  XAssistantCore:{editorText:e=>e.text},current:{module:opt.module||'interaction'},T:{check(){},waitForPage:async probe=>probe()},
  policy:{normalize:val=>{const u=new URL(val);return u.pathname+u.search;}},check(){},self:owner,progress(){},expectNavigation(){},error:(c,m)=>Object.assign(Error(m),{code:c})};
 vm.runInNewContext(fn+';this.open=openStatusTarget;',context);
 return {call:()=>context.open(row),log,checkClean:()=>{assert.equal(evt.size,0);assert.equal(docEvents.size,0)}};
}
test('proven untouched target-card mismatch returns to repainted exact search before allowing a single unsent skip',async()=>{
 const f=setup();await assert.rejects(f.call(),e=>e.code==='TARGET_SKIPPED_UNSENT'&&!e.submitted&&!e.stopTargetVisit&&!e.preserveDrafts);
 assert.deepEqual(f.log,['clickTimestamp','back']);f.checkClean();
});
for(const [name,opt,back] of [
 ['no history evidence',{noNavigation:true},false],['nonadjacent entry',{nonAdjacent:true},false],
 ['second history transition',{changedKey:true},false],['missing original history',{missingPrevious:true},false],
 ['user interaction',{touched:true},false],['text draft',{draft:true},false],['media draft',{media:true},false],
 ['account changed',{ownerChanged:true},false],['other module',{module:'notifications'},false],
 ['missing editor',{reason:'controls'},false],['multiple target cards',{target:2},false],['no cards',{cards:0},false],
 ['stale detail tree',{stale:true},true],['missing original result',{lostSource:true},true],
 ['search controls not repainted',{noTabs:true},true],['user interaction during return',{manualBack:true},true]
])test('unverified target remains stopped: '+name,async()=>{
 const f=setup(opt);await assert.rejects(f.call(),e=>e.code!=='TARGET_SKIPPED_UNSENT'&&e.stopTargetVisit===true&&!e.submitted);
 assert.equal(f.log.includes('back'),back);f.checkClean();
});
test('end-to-end pre-submit boundary: claim is released, no send, confirmed, unknown or double Back',async()=>{
 const f=setup(),actions=[];
 const ctx={XAssistantDOM:{},XAssistantTasks:{},XAssistantWorkspace:{check(){},openStatusTarget:f.call},
  XAssistantRuntime:{call:async m=>{actions.push([m.kind,m.outcome]);return m.kind==='REPLY_CLAIM'?{claimed:true,claimId:'id'}:{};}},
  account:'/self',activeRun:'run',check(){},updateRuntime(){},replySubmitted:false};
 vm.runInNewContext(fs.readFileSync(new URL('../reply-engine.js',import.meta.url),'utf8'),ctx);
 const overlay=fs.readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
 vm.runInNewContext(overlay.slice(overlay.indexOf(' const replyAndSend='),overlay.indexOf(' const relocatePost='))+';this.send=replyAndSend;',ctx);
 await assert.rejects(ctx.send(row,'reply',{},()=>assert.fail('unexpected confirmation'),()=>assert.fail('unexpected submit')),e=>e.code==='TARGET_SKIPPED_UNSENT'&&!e.stopTargetVisit&&!e.submitted);
 assert.deepEqual(actions,[['REPLY_CLAIM',undefined],['REPLY_SETTLE','released']]);assert.deepEqual(f.log,['clickTimestamp','back']);
 assert.equal(ctx.replySubmitted,false);f.checkClean();
});
