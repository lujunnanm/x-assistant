import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createManagedService} from '../managed-service.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const prefSource=read('interaction-preferences.js'),entrySource=read('module-entry.js'),panel=read('panel.js');
const KEY='xAssistantInteractionPreferencesV1',VIEWS='xAssistantInteractionViewsV1',INDEX='xAssistantFriendTopicIndexV1',SEARCH='xAssistantFriendSearchV1';
const object=value=>JSON.parse(JSON.stringify(value));
const makePrefs=()=>{const c=vm.createContext({});vm.runInContext(prefSource,c);return c.XAssistantInteractionPrefs;};
const prefs=makePrefs();
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function storage(initial={}){
 const data={xAssistantUnfollowedDiscoveryV1:true,[SEARCH]:true,...initial},listeners=[],writes=[];
 let fail=false;
 const get=async keys=>Object.fromEntries([keys].flat().map(key=>[key,data[key]]));
 const external=(key,value,area='local')=>{
  const oldValue=data[key];if(area==='local')data[key]=value;
  for(const listener of listeners)listener({[key]:{oldValue,newValue:value}},area);
 };
 const local={get,set:async patch=>{
  if(fail)throw Error('storage unavailable');
  writes.push(object(patch));for(const [key,value] of Object.entries(patch))external(key,value);
 }};
 return{data,writes,external,fail:()=>{fail=true;},api:{local,onChanged:{addListener:fn=>listeners.push(fn)}}};
}
function entryFixture(initial={},page={}){
 const store=storage(initial),location=new URL(page.url||'https://x.com/home');
 const win=vm.createContext({URL,location,chrome:{storage:store.api},
  document:{getElementById:()=>null,querySelector:s=>s.includes('Profile_Link')?{getAttribute:()=>'/me'}:null,querySelectorAll:s=>s.includes('primaryColumn')?page.rows?.()||[]:[]},
  window:{dispatchEvent(){}},PopStateEvent:class{},CustomEvent:class{},history:{pushState:(_s,_t,path)=>{location.href=new URL(path,location.href);}},
  XAssistantTasks:{sleep:async()=>{},waitForPage:page.wait||(()=>{throw Error('unexpected wait');})},
  XAssistantRuntime:{check(){}},XAssistantCore:{editorText:n=>n.textContent}});
 vm.runInContext(prefSource,win);vm.runInContext(entrySource,win);
 const entry=win.XAssistantEntry;
 return {...store,entry,location,win,query:async()=>new URL(await entry.targetFor(),location).searchParams.get('q')};
}

test('keyword list trims, deduplicates and validates bounded plain-text input',()=>{
 assert.deepEqual(object(prefs.parseKeywords('  Claude   Code\r\n\nclaude code\n 足球 \nC++')),['Claude Code','足球','C++']);
 assert.throws(()=>prefs.parseKeywords('a'.repeat(121)),/120/);
 assert.throws(()=>prefs.parseKeywords(Array.from({length:21},(_,i)=>'term'+i).join('\n')),/20/);
 assert.throws(()=>prefs.parseKeywords('foo\u0000bar'),/控制字符/);
 for(const n of [-1,499,100001,'500',undefined])assert.equal(prefs.normalize({minViews:n}).minViews,5000);
 for(const n of [0,100,500,5400,5500,100000])assert.equal(prefs.normalize({minViews:n}).minViews,n);
});

test('search rotates only configured keywords, one keyword does not trigger a tight rotation, and clearing restores defaults',async()=>{
 const f=entryFixture({[KEY]:{keywords:['足球','C++ & Rust'],minViews:1500},[INDEX]:0});
 assert.equal(await f.query(),'足球');assert.equal(await f.entry.nextFriendTopic(),true);
 assert.equal(await f.query(),'C++ & Rust');assert.equal(await f.entry.nextFriendTopic(),true);
 assert.equal(await f.query(),'足球');
 f.external(KEY,{keywords:['网球'],minViews:1500});
 assert.equal(await f.entry.nextFriendTopic(),false);assert.equal(await f.query(),'网球');
 f.external(KEY,{keywords:[],minViews:1500});
 assert.match(await f.query(),/人工智能/);
 assert.ok(f.writes.every(patch=>Object.keys(patch).join()===INDEX));
});

test('homepage ignores custom keywords, but both source modes use the configured threshold',async()=>{
 const f=entryFixture({[KEY]:{keywords:['咖啡'],minViews:5500}});
 assert.equal((await f.entry.filtersFor()).keyword,'咖啡');
 f.entry.setInteractionMode('home');
 const home=await f.entry.filtersFor();
 assert.equal(home.path,'/home');assert.equal(home.keyword,null);assert.equal(home.minViews,5500);
 f.external(KEY,{keywords:['网球'],minViews:5500});
 assert.doesNotThrow(()=>home.validate());await home.refresh();
 f.external(KEY,{keywords:['网球'],minViews:6000});
 assert.throws(()=>home.validate(),{code:'INTERACTION_FILTER_CHANGED'});
});

test('a changed rule disqualifies an already picked target, including a storage event not yet delivered',async()=>{
 const f=entryFixture({[KEY]:{keywords:['咖啡'],minViews:5000}});
 const first=await f.entry.filtersFor();
 f.data[KEY]={keywords:['咖啡'],minViews:7000}; // persistent update before the notification is delivered
 await assert.rejects(first.refresh(),{code:'INTERACTION_FILTER_CHANGED'});
 const second=await f.entry.filtersFor();
 f.external(KEY,{keywords:['网球'],minViews:7000});
 assert.throws(()=>second.validate(),{code:'INTERACTION_FILTER_CHANGED'});
 const latest=await f.entry.filtersFor();
 f.external(KEY,{keywords:['股票'],minViews:8500},'sync');
 assert.doesNotThrow(()=>latest.validate());await latest.refresh();
});

test('changing queries on the same search route cannot use old cards after the URL changes',async()=>{
 const stale={isConnected:true,closest:()=>null},fresh={isConnected:true,closest:()=>null};
 let rows=[stale],observations=[];
 const f=entryFixture({[KEY]:{keywords:['咖啡'],minViews:5000}},{url:'https://x.com/search?q=old',rows:()=>rows,
  wait:async probe=>{observations.push(probe());stale.isConnected=false;rows=[];observations.push(probe());rows=[fresh];return probe();}});
 assert.equal(await f.entry.enter('interaction',{}),'/me');
 assert.deepEqual(observations,[false,false]);
 assert.equal(f.location.searchParams.get('q'),'咖啡');
});

test('search query and threshold are separate: a post need not include the query',()=>{
 const c=vm.createContext({URL});vm.runInContext(read('interaction-core.js'),c);
 const core=c.XAssistantCore,opts={minViews:1500,self:'self'};
 const post={author:'sports',text:'今晚开赛',views:1501};
 assert.equal(core.interactionSkipReason(post,opts),null);
 for(const views of [null,1499,1500])assert.equal(core.interactionSkipReason({...post,views},opts),'low_exposure');
 assert.equal(core.interactionSkipReason({...post,text:'  '},opts),'no_text');
 assert.equal(core.interactionSkipReason({...post,text:'',clipped:true},opts),null,'a clipped candidate may be expanded before requiring text');
 assert.equal(core.interactionSkipReason({...post,author:'self'},opts),'self');
 assert.equal(core.interactionSkipReason(post,{...opts,record:{reply:'unknown'}}),'uncertain');
});

test('managed worker initially opens the saved custom query, with no extra worker or setting change',async()=>{
 const data={[KEY]:{keywords:['足球','摄影'],minViews:2500},[INDEX]:1,[SEARCH]:true},tabs=new Map();
 const svc=createManagedService({read:async key=>data[key],write:async(key,value)=>{data[key]=value;},runtimeFor:async()=>({}),uuid:()=> 'token',
  tabs:{create:async options=>{const tab={id:5,...options};tabs.set(5,tab);return tab;},update:async(id,options)=>Object.assign(tabs.get(id),options),get:async id=>tabs.get(id)},
  alarms:{create:async()=>{},clear:async()=>{}}});
 const state=await svc.set({enabled:true,account:'/me',selected:{interaction:true}});
 assert.deepEqual(Object.keys(state.workers),['interaction']);
 assert.equal(new URL(tabs.get(5).url).searchParams.get('q'),'摄影');assert.equal(data[INDEX],1);
});

async function settingsFixture(store){
 const elements={};
 for(const id of ['interaction-filters','interaction-keywords','interaction-views','interaction-views-value','interaction-filters-save','interaction-filters-status','interaction-views-status'])
  elements[id]={value:'',disabled:true,setAttribute(k,v){this[k]=v;}};
 const c=vm.createContext({chrome:{storage:store.api},$:id=>elements[id]});
 vm.runInContext(prefSource,c);vm.runInContext(panel.slice(panel.indexOf('function bindInteractionFilters()'),panel.indexOf('// Read-only counters')),c);
 await tick();
 return {save:()=>elements['interaction-filters'].onsubmit({preventDefault(){}}),range:elements['interaction-views'],keywords:elements['interaction-keywords'],
  status:elements['interaction-views-status']};
}

test('the slider commits on release in 100-view steps without saving draft keywords',async()=>{
 const store=storage({[INDEX]:9,[KEY]:{minViews:3500,keywords:['篮球']}}),ui=await settingsFixture(store);
 assert.equal(ui.range.value,'3500');assert.equal(ui.range.disabled,false);
 ui.keywords.value=' 网球 \n网球\n足球';ui.keywords.oninput();
 ui.range.value='3600';ui.range.oninput();assert.equal(ui.range['aria-valuetext'],'大于 3,600 次');
 assert.deepEqual(store.writes,[],'input only previews');
 await ui.range.onchange();
 assert.deepEqual(store.writes,[{[VIEWS]:3600}]);assert.match(ui.status.textContent,/已生效/);
 assert.equal(ui.keywords.value,' 网球 \n网球\n足球');assert.equal(store.data[INDEX],9);
 assert.deepEqual(store.data[KEY].keywords,['篮球']);
 await ui.save();
 assert.deepEqual(store.writes[1],{[KEY]:{keywords:['网球','足球'],minViews:3500},[INDEX]:0});
 assert.equal(ui.keywords.value,'网球\n足球');assert.equal(ui.range.value,'3600');
 const reloaded=await settingsFixture(store);assert.equal(reloaded.range.value,'3600');
});

test('an invalid or failed slider save restores the last effective threshold',async()=>{
 const store=storage({[VIEWS]:3300}),ui=await settingsFixture(store);
 ui.range.value='3399';ui.range.oninput();await ui.range.onchange();
 assert.equal(ui.range.value,'3300');assert.deepEqual(store.writes,[]);
 store.fail();ui.range.value='3400';ui.range.oninput();await ui.range.onchange();
 assert.match(ui.status.textContent,/失败/);assert.equal(ui.range.value,'3300');
 assert.equal(store.data[VIEWS],3300);assert.equal(ui.range.disabled,false);
});

test('rapid slider changes are serialized and the latest committed value wins',async()=>{
 const store=storage({[VIEWS]:3000}),ui=await settingsFixture(store);
 const set=store.api.local.set;let release;
 store.api.local.set=async patch=>{if(patch[VIEWS]===3100)await new Promise(resolve=>{release=resolve;});await set(patch);};
 ui.range.value='3100';ui.range.oninput();const first=ui.range.onchange();
 ui.range.value='3200';ui.range.oninput();await ui.range.onchange();
 ui.range.value='3300';ui.range.oninput();await ui.range.onchange();
 release();await first;
 assert.deepEqual(store.writes,[{[VIEWS]:3100},{[VIEWS]:3300}]);
 assert.equal(ui.range.value,'3300');assert.equal(store.data[VIEWS],3300);
});

test('committed slider override is authoritative for both sources and takes effect without keyword save',async()=>{
 const f=entryFixture({[KEY]:{keywords:['网球'],minViews:5500}});
 const prior=await f.entry.filtersFor();assert.equal(prior.minViews,5500);
 f.external(VIEWS,3200);
 assert.throws(()=>prior.validate(),{code:'INTERACTION_FILTER_CHANGED'});
 const search=await f.entry.filtersFor();assert.equal(search.minViews,3200);assert.equal(search.keyword,'网球');
 f.entry.setInteractionMode('home');
 assert.equal((await f.entry.filtersFor()).minViews,3200);
 f.data[VIEWS]=0;
 await assert.rejects(search.refresh(),{code:'INTERACTION_FILTER_CHANGED'});
 assert.equal((await f.entry.filtersFor()).minViews,0,'zero is an explicit slider threshold');
});

test('rule change during the existing cooldown prevents the prepared reply from submitting',async()=>{
 const f=entryFixture({[KEY]:{keywords:[],minViews:5000}});
 f.entry.setInteractionMode('home');
 const source=read('overlay.js');
 const c=vm.createContext({Date:{now:()=>1000},location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},
  XAssistantEntry:f.entry,check(){},requireSource:async()=>{},core:{interactionPage:()=>true},
  runtime:async()=>({active:true,runId:'run',nextAt:5000}),autoFollow:async()=>false,status(){},markSelected(){},homeSource:null,
  findCandidate:async(_signal,_follow,_unsent,filters)=>{assert.equal(filters.minViews,5000);return {id:'1',author:'me2',text:'AI 编程',views:5200};},
  aiReply:async()=>({action:'send_reply',postId:'1',text:'草稿'}),
  randomWait:async()=>{f.external(VIEWS,5300);},
  selected:null,replyAndSend:async()=>assert.fail('old target cannot be submitted'),saveProcessed:async()=>assert.fail('unsent target is not claimed')
 });
 vm.runInContext(source.slice(source.indexOf(' const runLoop ='),source.indexOf(' // A single owner'))+';globalThis.run=runLoop;',c);
 await assert.rejects(c.run({aborted:false},'run','home'),{code:'INTERACTION_FILTER_CHANGED'});
});

function admitSearch(f){
 let status='running',active='interaction',shouldRun=true,reject=false;
 f.win.XAssistantWorkspace={state:()=>({status,active,assignment:{sourceMode:'search',shouldRun}}),expectNavigation(){},check:()=>{if(reject)throw Error('页面归属变化');}};
 f.entry.setInteractionMode('search');
 return {setStatus:s=>{status=s;},setActive:m=>{active=m;},setAllowed:v=>{shouldRun=v;},reject:()=>{reject=true;}};
}

test('running search accepts an inline keyword and invalidates the old target without overwriting storage',async()=>{
 const f=entryFixture({[KEY]:{keywords:['后台一','后台二'],minViews:5300},[INDEX]:1,[VIEWS]:5400},{url:'https://x.com/search?q=old'});
 admitSearch(f);const old=await f.entry.filtersFor();
 assert.equal(old.keyword,'后台二');
 assert.equal(f.entry.setPageKeyword('  足球  '),'足球');
 assert.throws(()=>old.validate(),{code:'INTERACTION_FILTER_CHANGED'});
 assert.equal(await f.query(),'足球');
 const custom=await f.entry.filtersFor();
 assert.equal(custom.keyword,'足球');assert.equal(custom.minViews,5400);
 assert.equal(await f.entry.nextFriendTopic(),false,'page override does not rotate');
 assert.deepEqual(f.writes,[]);assert.equal(f.data[INDEX],1);
 f.external(KEY,{keywords:['后台甲','后台乙'],minViews:5300});
 assert.doesNotThrow(()=>custom.validate());await custom.refresh();
 f.external(VIEWS,5500);assert.throws(()=>custom.validate(),{code:'INTERACTION_FILTER_CHANGED'});
 assert.equal((await f.entry.filtersFor()).minViews,5500);
 assert.equal(f.entry.setPageKeyword(''),null);assert.equal(await f.query(),'后台乙');
 assert.equal(await f.entry.nextFriendTopic(),true);
});

test('inline override is rejected outside a running owned search list and cleared by a switch to home',async()=>{
 const f=entryFixture({[KEY]:{keywords:['后台词']}},{url:'https://x.com/search?q=old'});
 assert.throws(()=>f.entry.setPageKeyword('足球'),/仅可/);
 const state=admitSearch(f);
 state.setStatus('starting');assert.throws(()=>f.entry.setPageKeyword('足球'),/仅可/);state.setStatus('running');
 state.setActive('posting');assert.throws(()=>f.entry.setPageKeyword('足球'),/仅可/);state.setActive('interaction');
 state.setAllowed(false);assert.throws(()=>f.entry.setPageKeyword('足球'),/仅可/);state.setAllowed(true);
 f.location.href='https://x.com/writer/status/123';assert.throws(()=>f.entry.setPageKeyword('足球'),/仅可/);
 f.location.href='https://x.com/search?q=old';
 assert.throws(()=>f.entry.setPageKeyword('足球\n网球'),/一个/);
 assert.equal(f.entry.setPageKeyword('足球'),'足球');
 state.reject();assert.throws(()=>f.entry.setPageKeyword('网球'),/归属/);
 assert.equal(f.entry.pageKeyword(),'足球');
 f.entry.setInteractionMode('home');assert.equal(f.entry.pageKeyword(),null);
 assert.equal(await f.entry.targetFor(),'/home');
 f.entry.setInteractionMode('search');assert.equal(await f.query(),'后台词');
});

test('manual keyword change uses the same fresh-list proof, even if the browser URL changes before results',async()=>{
 const stale={isConnected:true,closest:()=>null},fresh={isConnected:true,closest:()=>null};
 let rows=[stale],observations=[];
 const f=entryFixture({[KEY]:{keywords:['原词'],minViews:5000}},{url:'https://x.com/search?q=old',rows:()=>rows,
  wait:async probe=>{observations.push(probe());stale.isConnected=false;rows=[];observations.push(probe());rows=[fresh];return probe();}});
 admitSearch(f);f.entry.setPageKeyword('长焦摄影');
 assert.equal(await f.entry.enter('interaction',{}),'/me');
 assert.deepEqual(observations,[false,false]);
 assert.equal(f.location.searchParams.get('q'),'长焦摄影');
});
test('adopted native query pins the exact X route and waits for a fresh result even at its committed URL',async()=>{
 const stale={isConnected:true,closest:()=>null},fresh={isConnected:true,closest:()=>null};
 let rows=[stale],observations=[];
 const f=entryFixture({[KEY]:{keywords:['后台一','后台二'],minViews:7500},[INDEX]:1},{url:'https://x.com/search?q=old',rows:()=>rows,
  wait:async probe=>{observations.push(probe());stale.isConnected=false;rows=[];observations.push(probe());rows=[fresh];return probe();}});
 admitSearch(f);const old=await f.entry.filtersFor();
 const path='/search?q=C%2B%2B&f=live&src=typed_query',previous=f.entry.snapshotSearchList();
 f.location.href='https://x.com'+path;f.entry.acceptNativeSearch({path,keyword:'C++',previous});
 assert.throws(()=>old.validate(),{code:'INTERACTION_FILTER_CHANGED'});assert.equal(f.entry.waitingForList(),true);
 const filters=await f.entry.filtersFor();assert.equal(filters.path,path);assert.equal(filters.keyword,'C++');assert.equal(filters.minViews,7500);
 assert.equal(await f.entry.enter('interaction',{}),'/me');assert.deepEqual(observations,[false,false]);
 assert.equal(f.entry.waitingForList(),false);assert.equal(await f.entry.nextFriendTopic(),false);assert.deepEqual(f.writes,[]);
});
test('a newer native query replaces an in-progress list wait instead of timing out the old query',async()=>{
 let f;const oldCard={isConnected:true,closest:()=>null};
 f=entryFixture({[KEY]:{keywords:['后台词']}},{url:'https://x.com/search?q=one',rows:()=>[oldCard],wait:async probe=>{
  const path='/search?q=three';f.location.href='https://x.com'+path;f.entry.acceptNativeSearch({path,keyword:'three',previous:f.entry.snapshotSearchList()});return probe();
 }});
 admitSearch(f);const path='/search?q=two';f.location.href='https://x.com'+path;
 f.entry.acceptNativeSearch({path,keyword:'two',previous:f.entry.snapshotSearchList()});
 await assert.rejects(f.entry.enter('interaction',{}),{code:'INTERACTION_FILTER_CHANGED'});
 assert.equal(await f.entry.targetFor(),'/search?q=three');assert.equal(f.entry.waitingForList(),true);
});
test('a committed native query with stale results keeps the list pending after a bounded wait',async()=>{
 const stale={isConnected:true,closest:()=>null};
 const f=entryFixture({}, {url:'https://x.com/search?q=old',rows:()=>[stale],wait:async probe=>probe()});
 admitSearch(f);const path='/search?q=waiting';f.location.href='https://x.com'+path;
 f.entry.acceptNativeSearch({path,keyword:'waiting',previous:[stale]});
 await assert.rejects(f.entry.enter('interaction',{}),{code:'SEARCH_RESULTS_WAIT'});
 assert.equal(f.entry.waitingForList(),true);
});
