import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createManagedService,SERVICE_KEY} from '../managed-service.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const SEARCH_KEY='xAssistantFriendSearchV1';
const TOPIC_KEY='xAssistantFriendTopicIndexV1';

function storage(initial={}){
 const data={...initial},listeners=[];
 const local={
  get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]])),
  set:async patch=>{const changes=Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,{oldValue:data[key],newValue:value}]));Object.assign(data,patch);for(const listener of listeners)listener(changes,'local');}
 };
 return{data,local,onChanged:{addListener:listener=>listeners.push(listener)}};
}

function searchButton(store){
 let button;
 const element=()=>({attributes:{},dataset:{},disabled:false,addEventListener(name,fn){this[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},click(){return this.click?.();}});
 const icon={className:'module-icon',innerHTML:'icon',replaceWith(value){button=value;}};
 const root={querySelector:selector=>selector==='[data-module="interaction"] .module-icon'?icon:null};
 const context=vm.createContext({document:{getElementById:()=>root,createElement:element},chrome:{storage:store},XAssistantRuntime:{storage:store.local},Promise,queueMicrotask});
 vm.runInContext(source('compact-controls.js'),context);
 return{get button(){return button;},ready:async()=>{for(let i=0;i<10;i++)await Promise.resolve();}};
}

test('交友搜索按钮单独持久化开关，重载与外部变更均同步显示',async()=>{
 const store=storage({[SEARCH_KEY]:false});let ui=searchButton(store);await ui.ready();
 assert.equal(ui.button.getAttribute('aria-checked'),'false');
 await ui.button.click();assert.equal(store.data[SEARCH_KEY],true);assert.equal(ui.button.getAttribute('aria-checked'),'true');
 ui=searchButton(store);await ui.ready();assert.equal(ui.button.getAttribute('aria-checked'),'true','重载后保持开启');
 await store.local.set({[SEARCH_KEY]:false});assert.equal(ui.button.getAttribute('aria-checked'),'false');
});

test('搜索键缺失时按钮与实际默认开启一致，首次点击应真正关闭',async()=>{
 const store=storage({}),ui=searchButton(store);await ui.ready();
 assert.equal(ui.button.getAttribute('aria-checked'),'true');
 await ui.button.click();assert.equal(store.data[SEARCH_KEY],false);
 assert.equal(ui.button.getAttribute('aria-checked'),'false');
});

function entry(store){
 const context=vm.createContext({URL,location:{href:'https://x.com/search?q=old',pathname:'/search',search:'?q=old'},document:{getElementById:()=>({}),querySelector:()=>null},chrome:{storage:store},XAssistantRuntime:{storage:store.local},XAssistantCore:{interactionPage:()=>true}});
 vm.runInContext(source('module-entry.js'),context);
 return context.XAssistantEntry;
}

test('关闭搜索不会沿用旧搜索地址或轮换话题；开启后恢复持久化话题',async()=>{
 const store=storage({xAssistantUnfollowedDiscoveryV1:true,[SEARCH_KEY]:false,[TOPIC_KEY]:2});
 let e=entry(store);e.captureInteractionTarget();e.setInteractionMode('home');
 assert.equal(await e.searchEnabled(),false);
 assert.equal(await e.targetFor(),'/home');assert.equal(await e.nextFriendTopic(),false);
 assert.equal(store.data[TOPIC_KEY],2);
 await store.local.set({[SEARCH_KEY]:true});
 assert.equal(await e.searchEnabled(),true);assert.equal(await e.targetFor(),'/home','旧的时间线会话不自行跳到搜索');
 e.setInteractionMode('search');assert.match(await e.targetFor(),/^\/search\?q=/);
 assert.equal(await e.nextFriendTopic(),true);assert.equal(store.data[TOPIC_KEY],3);
 e=entry(store);e.setInteractionMode('search');assert.match(await e.targetFor(),/^\/search\?q=/);
 assert.equal(store.data[TOPIC_KEY],3);
 await store.local.set({[SEARCH_KEY]:false});
 await assert.rejects(e.targetFor(),{code:'SOURCE_CHANGED'});await assert.rejects(e.nextFriendTopic(),{code:'SOURCE_CHANGED'});assert.equal(store.data[TOPIC_KEY],3);
});

test('首次缺失搜索设置可启用，但显式关闭不能被旧迁移标志覆写',async()=>{
 const first=storage({});const a=entry(first);
 assert.equal(await a.searchEnabled(),true);
 assert.match(await a.targetFor(),/^\/search\?q=/);
 assert.equal(first.data.xAssistantUnfollowedDiscoveryV1,true);
 const closed=storage({[SEARCH_KEY]:false});const b=entry(closed);
 assert.equal(await b.searchEnabled(),false);
 assert.equal(closed.data[SEARCH_KEY],false);
 assert.equal(await b.targetFor(),'/home');
});

test('切换来源必须等旧卡片卸载且新主栏有内容；仅 URL 改变不能开始',async()=>{
 for(const newMode of ['home','search'])for(const replaced of [true,false]){
  const old={isConnected:true,closest:()=>null},fresh={isConnected:true,closest:()=>null};let rows=[old],checks=[];
  const address=new URL(newMode==='home'?'https://x.com/search?q=old':'https://x.com/home'),select=path=>{address.href=new URL(path,address.href).href;};
  const store=storage({[SEARCH_KEY]:newMode==='search'});
  const context=vm.createContext({URL,location:address,history:{pushState:(_s,_t,path)=>select(path)},window:{dispatchEvent(){}},PopStateEvent:class{},
   document:{getElementById:()=>null,querySelector:q=>q.includes('Profile_Link')?{getAttribute:()=>'/me'}:q.includes('Home_Link')?{href:'https://x.com/home',click:()=>select('/home')}:null,
    querySelectorAll:q=>q.includes('primaryColumn')?rows:[]},chrome:{storage:store},XAssistantCore:{editorText:e=>e.textContent},
   XAssistantRuntime:{storage:store.local,check(){}},XAssistantTasks:{sleep:async()=>{},waitForPage:async probe=>{
    checks.push(probe());if(replaced){old.isConnected=false;rows=[];checks.push(probe());rows=[fresh];}return probe();
   }}});
  vm.runInContext(source('module-entry.js'),context);context.XAssistantEntry.setInteractionMode(newMode);
  const started=context.XAssistantEntry.enter('interaction',{});
  if(replaced){assert.equal(await started,'/me');assert.deepEqual(checks,[false,false]);}
  else{
   await assert.rejects(started,{code:'NAVIGATION'});assert.deepEqual(checks,[false]);
   await assert.rejects(context.XAssistantEntry.enter('interaction',{}),{code:'NAVIGATION'},'重试时地址已经正确，也不能漏过旧卡');
   old.isConnected=false;rows=[fresh];assert.equal(await context.XAssistantEntry.enter('interaction',{}),'/me');
  }
  assert.equal(address.pathname,newMode==='home'?'/home':'/search');
 }
});

function serviceFixture(initialSearch,{offDuringCreate=false}={}){
 const data={[SEARCH_KEY]:initialSearch},tabs=new Map(),runs={},created=[];let nextId=10;
 const service=createManagedService({read:async key=>structuredClone(data[key]),write:async(key,value)=>{data[key]=structuredClone(value);},runtimeFor:async k=>runs[k]||{},postingReady:async()=>true,now:()=>Date.parse('2026-11-04T04:00:00Z'),uuid:()=>`token-${nextId}`,
  tabs:{create:async options=>{const tab={id:nextId++,url:options.url};tabs.set(tab.id,tab);if(offDuringCreate)data[SEARCH_KEY]=false;created.push(tab.id);return tab;},get:async id=>tabs.get(id),remove:async id=>tabs.delete(id),update:async(id,options)=>{Object.assign(tabs.get(id),options);return tabs.get(id);},sendMessage:async()=>{}},
  alarms:{create:async()=>{},clear:async()=>{}}});
 return{data,tabs,created,service,runs,setSearch:value=>{data[SEARCH_KEY]=value;}};
}

test('关闭搜索从首页互动；切换来源时复用同一工作页、保留其他模块，旧来源需先收尾',async()=>{
 const f=serviceFixture(false);
 let s=await f.service.set({enabled:true,account:'/me',selected:{posting:true,interaction:true,notifications:true}});
 const id=s.workers.interaction.tabId,post=s.workers.posting.tabId,reply=s.workers.notifications.tabId;
 assert.equal(f.tabs.get(id).url,'https://x.com/home');
 assert.deepEqual(Object.keys(s.workers).sort(),['interaction','notifications','posting']);
 assert.equal(f.created.length,3);assert.equal(s.working,true);
 assert.equal((await f.service.authorize(id,'interaction','/me')).sourceMode,'home');
 assert.equal((await f.service.assignment(post)).sourceMode,undefined);
 f.runs.interaction={active:true,sourceMode:'home',phase:'submitting'};
 f.setSearch(true);s=await f.service.reconcile();
 assert.equal(s.workers.interaction.tabId,id);assert.equal(s.selected.interaction,true);
 assert.equal((await f.service.assignment(id)).sourceMode,'search');
 await assert.rejects(f.service.authorize(id,'interaction','/me'),{code:'SOURCE_CHANGED'});
 assert.equal((await f.service.assignment(post)).shouldRun,true);assert.equal((await f.service.assignment(reply)).shouldRun,true);
 assert.equal(f.tabs.get(id).url,'https://x.com/home','后台不能强行切走待核对的工作页');
 f.runs.interaction={active:false,phase:'stopped'};assert.equal((await f.service.authorize(id,'interaction','/me')).sourceMode,'search');
 f.setSearch(false);f.runs.interaction={active:true,sourceMode:'search',phase:'waiting'};await f.service.reconcile();
 await assert.rejects(f.service.authorize(id,'interaction','/me'),{code:'SOURCE_CHANGED'});
 f.runs.interaction={active:false,phase:'unknown'};await f.service.reconcile();
 await assert.rejects(f.service.authorize(id,'interaction','/me'),{code:'SEND_UNKNOWN'});
 assert.equal(f.created.length,3);
});

test('搜索设置缺失时首次启动仍可创建互动搜索页',async()=>{
 const f=serviceFixture(undefined);
 const s=await f.service.set({enabled:true,account:'/me',selected:{posting:false,interaction:true,notifications:false}});
 assert.equal(s.workers.interaction?.tabId,f.created[0]);
 assert.match(f.tabs.get(f.created[0]).url,/^https:\/\/x\.com\/search\?/);
});

test('工作页创建期间关闭搜索只导航到首页',async()=>{
 const f=serviceFixture(true,{offDuringCreate:true});
 const s=await f.service.set({enabled:true,account:'/me',selected:{interaction:true}});
 assert.equal(f.tabs.get(s.workers.interaction.tabId).url,'https://x.com/home');assert.equal(f.tabs.size,1);assert.equal(s.working,true);
});
