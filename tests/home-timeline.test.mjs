import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../home-timeline.js',import.meta.url),'utf8');
const PREFIX='xAssistantHomeTimelineV1:';

function fixture({managed=true,saved={},labels=['为你推荐','正在关注','AI'],selected=0}={}){
 const location=new URL('https://x.com/home'),data={...saved},writes=[],clicks=[],events=new Map(),steps=[];
 let owner='/Me',draft=false,dialog=false,media=false,loading=[],observer,waitCalls=0,mainQueries=0,clickPaint=true,getHook=null;
 const hidden='[hidden],[inert],[aria-hidden="true"]';
 const node=(kind,attrs={},label='')=>({kind,attrs:{...attrs},textContent:label,innerText:label,isConnected:true,hidden:false,rects:true,
  getAttribute(name){return this.attrs[name]??null;},getClientRects(){return this.rects?[{}]:[];},
  closest(selector){if(selector===hidden)return this.hidden?this:null;if(selector==='[role="tab"]')return this.kind==='tab'?this:null;if(selector==='[data-testid="primaryColumn"]')return main;return null;},
  contains(other){return this===other;},compareDocumentPosition(){return this.before?4:2;},
  click(){clicks.push(this.textContent);emit(this,false);select(tabs.indexOf(this));if(clickPaint)replace();}
 });
 let tabs=labels.map((label,i)=>node('tab',{role:'tab','aria-selected':String(i===selected)},label));
 let content=[node('row')];
 const main={contains:node=>node===main||tabs.includes(node)||content.includes(node)||loading.includes(node),querySelectorAll(query){mainQueries++;if(query.includes('[role="tablist"]'))return tabs;if(query.includes('progressbar'))return loading;return content;}};
 const document={documentElement:{},addEventListener:(name,fn)=>events.set(name,fn),
  querySelector(query){if(query.includes('AppTabBar_Profile_Link'))return {getAttribute:()=>owner};if(query==='[data-testid="primaryColumn"]')return main;if(query.includes('dialog'))return dialog||media?{}:null;return null;},
  querySelectorAll(query){if(query.includes('contenteditable'))return draft?[{textContent:'用户草稿'}]:[];if(query.includes('file'))return media?[{files:[{}]}]:[];return [];}
 };
 const record=r=>observer.records.push(r);
 const select=index=>{for(let i=0;i<tabs.length;i++){const tab=tabs[i],value=String(i===index),oldValue=tab.attrs['aria-selected'];if(value!==oldValue){tab.attrs['aria-selected']=value;record({type:'attributes',attributeName:'aria-selected',target:tab,oldValue});}}};
 const replace=()=>{const old=content;old.forEach(row=>row.isConnected=false);content=[node('row')];record({type:'childList',target:main,removedNodes:old});};
 const emit=(target,trusted=true)=>events.get('click')?.({target,isTrusted:trusted});
 const context=vm.createContext({URL,DOMException,location,document,MutationObserver:class{constructor(callback){this.callback=callback;this.records=[];observer=this;}observe(){}takeRecords(){return this.records.splice(0);}},
  XAssistantRuntime:{storage:{get:async key=>{getHook?.();return {[key]:data[key]};},set:async value=>{writes.push(value);Object.assign(data,value);}},check(){}},
  XAssistantWorkspace:{state:()=>({assignment:managed?{module:'interaction'}:null}),check(){}},
  XAssistantCore:{editorText:node=>node.textContent},XAssistantTasks:{waitForPage:async probe=>{waitCalls++;let value=probe();while(!value&&steps.length){await steps.shift()();value=probe();}return value;}}
 });
 vm.runInContext(source,context);
 return {api:context.XAssistantHomeTimeline,context,location,data,writes,clicks,steps,node,main,record,select,replace,emit,
  get tabs(){return tabs;},set tabs(value){tabs=value;},get content(){return content;},set content(value){content=value;},
  set owner(value){owner=value;},set draft(value){draft=value;},set dialog(value){dialog=value;},set media(value){media=value;},
  set loading(value){loading=value;},set clickPaint(value){clickPaint=value;},set getHook(value){getHook=value;},
  get waitCalls(){return waitCalls;},get mainQueries(){return mainQueries;},flush:()=>observer.callback(observer.takeRecords()),
  manual(index,{paint=true}={}){emit(tabs[index]);select(index);if(paint)replace();}
 };
}

test('home identity uses the unique visible selected native tab, not tab index',()=>{
 const f=fixture({labels:[' 为你推荐 ','  AI   工具  ','正在关注'],selected:1});
 assert.equal(f.api.capture().key,'label:AI 工具');assert.equal(f.api.capture().label,'AI 工具');
 f.tabs.reverse();f.api.check(f.api.capture());
 f.location.pathname='/search';assert.equal(f.api.capture(),null);assert.doesNotThrow(()=>f.api.check(null));
});

test('hidden, missing, multiple and ambiguous selected tabs are not accepted',()=>{
 for(const mode of ['hidden','rects','missing','multiple','duplicate']){
  const f=fixture(),token=f.api.capture();
  if(mode==='hidden')f.tabs[0].hidden=true;
  if(mode==='rects')f.tabs[0].rects=false;
  if(mode==='missing')f.tabs=[];
  if(mode==='multiple')f.tabs[1].attrs['aria-selected']='true';
  if(mode==='duplicate')f.tabs.push(f.node('tab',{role:'tab','aria-selected':'false'},'为你推荐'));
  assert.throws(()=>f.api.capture(),{code:'TIMELINE_NOT_READY'},mode);
  assert.throws(()=>f.api.check(token),{code:'TIMELINE_CHANGED'},mode);
 }
});

test('same /home URL switching and batched A -> B -> A both invalidate old candidate tokens',()=>{
 for(const roundTrip of [false,true]){
  const f=fixture(),token=f.api.capture();f.select(1);if(roundTrip)f.select(0);
  assert.equal(f.location.pathname,'/home');assert.throws(()=>f.api.check(token),{code:'TIMELINE_CHANGED'});
  assert.ok(f.api.capture().epoch>token.epoch);
 }
});

test('repeated same-value aria-selected assignments do not invent a tab change',()=>{
 const f=fixture(),token=f.api.capture();
 f.record({type:'attributes',attributeName:'aria-selected',target:f.tabs[0],oldValue:'true'});
 f.record({type:'attributes',attributeName:'aria-selected',target:f.tabs[0],oldValue:'true'});
 f.record({type:'attributes',attributeName:'aria-selected',target:f.tabs[1],oldValue:'false'});
 assert.doesNotThrow(()=>f.api.check(token));assert.equal(f.api.capture().epoch,token.epoch);
});

test('floating countdown and unrelated DOM mutations do not scan tabs or feed styles',()=>{
 const f=fixture();f.api.capture();const before=f.mainQueries;
 f.record({type:'childList',target:{},addedNodes:[f.node('countdown')],removedNodes:[f.node('oldcountdown')]});
 f.record({type:'attributes',attributeName:'aria-selected',target:f.node('foreignTab',{role:'tab','aria-selected':'true'}),oldValue:'false'});
 f.flush();assert.equal(f.mainQueries,before);
});

test('trusted native click invalidates a candidate before React changes tab attributes',()=>{
 const f=fixture(),token=f.api.capture();f.emit(f.tabs[1]);
 assert.throws(()=>f.api.check(token),{code:'TIMELINE_CHANGED'});assert.equal(f.api.capture().key,token.key);
});

test('clicking the already active tab does not invent a stalled feed transition',async()=>{
 const f=fixture(),token=f.api.capture();f.emit(f.tabs[0]);
 assert.doesNotThrow(()=>f.api.check(token));assert.ok(await f.api.ready());assert.equal(f.writes.length,0);
});

test('detail navigation and same-key home header reconstruction do not invalidate a feed on their own',()=>{
 const f=fixture(),token=f.api.capture();f.location.pathname='/Writer/status/1';assert.doesNotThrow(()=>f.api.check(token));
 f.tabs=f.tabs.map(tab=>f.node('tab',{...tab.attrs},tab.textContent));f.replace();f.location.pathname='/home';
 assert.doesNotThrow(()=>f.api.check(token));assert.equal(f.api.capture().epoch,token.epoch);
});

test('ready accepts an initial rendered list and rejects an empty initial render',async()=>{
 const f=fixture();assert.equal((await f.api.ready()).key,'label:为你推荐');
 f.content=[];await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});
 f.content=[f.node('empty')];assert.equal((await f.api.ready()).key,'label:为你推荐');
});

test('initial loading before cards blocks readiness; X bottom load-more spinner does not',async()=>{
 const f=fixture(),spinner=f.node('spinner');spinner.before=true;f.loading=[spinner];
 await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});
 spinner.before=false;assert.ok(await f.api.ready());
 spinner.before=true;spinner.hidden=true;assert.ok(await f.api.ready());
});

test('changed selection is not ready until the old feed is replaced, including a later retry',async()=>{
 const f=fixture();f.api.capture();f.select(1);
 await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});
 await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});
 f.replace();assert.equal((await f.api.ready()).key,'label:正在关注');
});

test('an observed clear allows safely reused row nodes after new feed rendering',async()=>{
 const f=fixture();f.api.capture();const old=f.content.slice();f.select(1);
 f.record({type:'childList',target:f.main,removedNodes:old}); // React cleared then reinserted the same nodes before our callback.
 assert.equal((await f.api.ready()).key,'label:正在关注');
});

test('ready waits for both new content and a loading barrier to clear',async()=>{
 const f=fixture(),spinner=f.node('spinner');spinner.before=true;f.api.capture();f.select(2);f.loading=[spinner];
 f.steps.push(()=>{f.replace();},()=>{f.loading=[];});
 assert.equal((await f.api.ready()).key,'label:AI');assert.equal(f.steps.length,0);
});

test('only managed interaction native selections persist automatically after ready',async()=>{
 for(const managed of [true,false]){
  const f=fixture({managed});f.api.capture();f.manual(2);assert.equal(f.writes.length,0);
  await f.api.ready();assert.equal(f.writes.length,managed?1:0);
  if(managed)assert.equal(f.data[PREFIX+'/me'].key,'label:AI');
 }
});

test('a failed worker tab transition never saves its preference',async()=>{
 const f=fixture();f.api.capture();f.manual(1,{paint:false});
 await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});assert.equal(f.writes.length,0);
});

test('explicit controller enable remembers the current tab per lowercase account',async()=>{
 const f=fixture({managed:false,selected:2});assert.equal(await f.api.rememberCurrent(),true);
 assert.deepEqual(Object.keys(f.data),[PREFIX+'/me']);assert.equal(f.data[PREFIX+'/me'].key,'label:AI');
 f.owner='/Other';f.select(1);await f.api.rememberCurrent();
 assert.equal(f.data[PREFIX+'/other'].key,'label:正在关注');assert.equal(f.data[PREFIX+'/me'].key,'label:AI');
});

test('rememberCurrent is non-disruptive when outside home, no account, or no unique tab',async()=>{
 for(const mode of ['route','account','tabs','ambiguous']){
  const f=fixture({managed:false});if(mode==='route')f.location.pathname='/Writer/status/1';
  if(mode==='account')f.owner=null;if(mode==='tabs')f.tabs=[];if(mode==='ambiguous')f.tabs[1].attrs['aria-selected']='true';
  assert.equal(await f.api.rememberCurrent(),false);assert.equal(f.writes.length,0);
 }
});

test('enter restores a saved native tab, verifies repaint, and never clicks an already selected tab',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{version:1,key:'label:AI',label:'AI'}}});
 assert.equal((await f.api.enter()).key,'label:AI');assert.deepEqual(f.clicks,['AI']);assert.equal(f.writes.length,0);
 assert.equal((await f.api.enter()).key,'label:AI');assert.deepEqual(f.clicks,['AI']);
});

test('each explicit enter reads the latest controller choice; no cross-account preference leaks',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});await f.api.enter();
 f.data[PREFIX+'/me']={key:'label:正在关注',label:'正在关注'};await f.api.enter();assert.deepEqual(f.clicks,['AI','正在关注']);
 f.owner='/Other';await f.api.enter();assert.equal(f.api.capture().key,'label:正在关注');assert.equal(f.clicks.length,2);
});

test('worker manual selection wins over an older saved preference on a subsequent enter',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});await f.api.enter();
 f.manual(1);await f.api.enter();assert.equal(f.api.capture().key,'label:正在关注');
 assert.deepEqual(f.clicks,['AI']);assert.equal(f.data[PREFIX+'/me'].key,'label:正在关注');
});

test('manual selection during preference read wins over the stale saved source',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});f.getHook=()=>f.manual(1);
 assert.equal((await f.api.enter()).key,'label:正在关注');assert.deepEqual(f.clicks,[]);
 assert.equal(f.data[PREFIX+'/me'].key,'label:正在关注');
});

test('manual selection while waiting for the saved tab wins without restoring it',async()=>{
 const f=fixture({labels:['为你推荐','正在关注'],saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});
 f.steps.push(()=>f.manual(1));
 assert.equal((await f.api.enter()).key,'label:正在关注');assert.deepEqual(f.clicks,[]);
 assert.equal(f.data[PREFIX+'/me'].key,'label:正在关注');
});

test('same-route epoch change during preference read is not overwritten even without a click event',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});f.getHook=()=>{f.select(1);f.replace();};
 assert.equal((await f.api.enter()).key,'label:正在关注');assert.deepEqual(f.clicks,[]);assert.equal(f.writes.length,0);
});

test('missing saved tab is an explicit failure, never an unrelated fallback',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:Missing',label:'Missing'}}});
 await assert.rejects(f.api.enter(),{code:'TIMELINE_NOT_FOUND'});assert.deepEqual(f.clicks,[]);
});

test('late-loading saved tab can be restored after header readiness',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:Late',label:'Late'}}});
 f.steps.push(()=>f.tabs.push(f.node('tab',{role:'tab','aria-selected':'false'},'Late')));
 assert.equal((await f.api.enter()).key,'label:Late');assert.deepEqual(f.clicks,['Late']);
});

test('automatic tab changes retain draft, dialog, and attachment guards',async()=>{
 for(const mode of ['draft','dialog','media']){
  const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});f[mode]=true;
  await assert.rejects(f.api.enter(),error=>error.code==='RESIDUAL_DRAFT'&&error.preserveDrafts);assert.deepEqual(f.clicks,[]);
 }
});

test('account change during preference read aborts before clicking',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});f.getHook=()=>{f.owner='/Other';};
 await assert.rejects(f.api.enter(),{code:'ACCOUNT_CHANGED'});assert.deepEqual(f.clicks,[]);
});

test('abort and missing feed repaint never authorize an automatic restored selection',async()=>{
 const f=fixture({saved:{[PREFIX+'/me']:{key:'label:AI',label:'AI'}}});
 await assert.rejects(f.api.enter({aborted:true}),{name:'AbortError'});assert.deepEqual(f.clicks,[]);
 f.clickPaint=false;await assert.rejects(f.api.enter(),{code:'TIMELINE_NOT_READY'});assert.deepEqual(f.clicks,['AI']);
});

test('saved native links cannot broaden the source beyond /home',async()=>{
 const f=fixture();f.tabs[2].attrs.href='/i/lists/123';f.data[PREFIX+'/me']={key:'href:/i/lists/123',label:'AI'};
 await assert.rejects(f.api.enter(),{code:'TIMELINE_NOT_FOUND'});assert.deepEqual(f.clicks,[]);
});

test('native tabs sharing /home href remain distinguishable by unique normalized labels',async()=>{
 const f=fixture();for(const tab of f.tabs)tab.attrs.href='/home';
 assert.equal(f.api.capture().key,'href:/home|label:为你推荐');
 f.data[PREFIX+'/me']={key:'href:/home|label:AI',label:'AI'};
 assert.equal((await f.api.enter()).key,'href:/home|label:AI');assert.deepEqual(f.clicks,['AI']);
});

test('an optional helper dependency absence does not silently authorize an unready feed',async()=>{
 const f=fixture();delete f.context.XAssistantTasks;delete f.context.XAssistantWorkspace;delete f.context.XAssistantCore;
 assert.ok(await f.api.ready());f.api.capture();f.select(1);
 await assert.rejects(f.api.ready(),{code:'TIMELINE_NOT_READY'});
});
