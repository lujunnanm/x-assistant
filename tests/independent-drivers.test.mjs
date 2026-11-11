import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const keys={posting:'xAssistantPostingV1',interaction:'xAssistantRuntimeV1'};
const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function fixture(module,{active=false,locked=false,blocked=false,generating=false,workspaceReady=Promise.resolve({tabId:7})}={}){
 const states={posting:{active,runId:'old-post',account:'/owner',nextAt:Date.now()+60000},interaction:{active,runId:'old-interaction',account:'/owner'}};
 const calls=[],locks=[],events=[],storageListeners=[];
 const node=()=>({dataset:{},style:{setProperty(){}},textContent:'',setAttribute(){},append(){},classList:{remove(){},add(){}}});
 const sections={posting:node(),interaction:node()},output=node(),follow=node();
 const root={dataset:{},querySelector:selector=>selector.includes('data-module="posting"')?sections.posting:selector.includes('data-module="interaction"')?sections.interaction:selector.includes('data-setting')?follow:output};
 const profile={href:'https://x.com/owner',getAttribute:()=>'/owner'};
 const store={xAssistantAutoFollowV1:true,xAssistantFollowedV1:{handles:{}}};
 const context=vm.createContext({Date,Math,Number,Object,String,Set,Map,Promise,Error,DOMException,AbortController,URL,
  performance:{now:()=>0},location:{href:'https://x.com/home',pathname:'/home',search:''},
  document:{getElementById:()=>root,createElement:()=>node(),querySelector:selector=>selector.includes('AppTabBar_Profile_Link')?profile:null,querySelectorAll:()=>[]},
  window:{addEventListener(){},dispatchEvent:event=>{events.push(event.detail);},scrollTo(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},
  navigator:{locks:{request:async(name,options,fn)=>{locks.push({name,options});return fn(locked?null:{});}}},
  chrome:{storage:{local:{get:async request=>Object.fromEntries((Array.isArray(request)?request:[request]).map(key=>[key,key===keys.posting?states.posting:key===keys.interaction?states.interaction:store[key]])),set:async value=>Object.assign(store,value)},onChanged:{addListener:fn=>storageListeners.push(fn)}}},
  XAssistantEntry:{searchEnabled:async()=>false},
  XAssistantWorkspace:{ready:workspaceReady,check:()=>{if(blocked)throw Object.assign(Error('页面已切换'),{code:'PAGE_CHANGED'});}},
  XAssistantRuntime:{sleep:(_ms,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('任务已停止','AbortError')),{once:true})),runtime:async(name,action,extra={})=>{
   calls.push({name,action,...extra});
   assert.equal(name,module,'driver must never read or change another module');
   if(action==='begin')states[name]={...states[name],active:true,runId:'run-'+module,nextAt:Date.now()+(generating?0:60000)};
   if(action==='pick')return{id:'post_1',text:'reference'};
   if(action==='patch')states[name]={...states[name],...extra.patch};
   if(action==='stop'){assert.equal(extra.runId,'run-'+module);states[name]={...states[name],active:false};}
   return states[name];
  },call:async message=>{if(generating&&message.kind==='AI_POST'){calls.push({ai:true,...message});return new Promise(()=>{});}throw Error('AI or public action is forbidden in fixture');}},
  XAssistantCore:{autoFollowEnabled:v=>v!==false,interactionPage:()=>true,randomSeconds:min=>min,formatSeconds:n=>n.toFixed(1)},
  XAssistantTasks:{waitForPage:async fn=>fn()},
  XAssistantPopup:{cancel:async()=>{throw Error('unowned composer cleanup is forbidden in fixture');}},
  XAssistantTime:{ready:Promise.resolve(),pending:async()=>Date.now()+60000,ms:()=>60000},
 });
 const taskContext=vm.createContext({DOMException,Date,Promise,setTimeout,clearTimeout});
 vm.runInContext(source('task-utils.js'),taskContext);context.XAssistantTasks.bounded=taskContext.XAssistantTasks.bounded;
 vm.runInContext(source(module==='posting'?'posting.js':'overlay.js'),context);
 return{context,calls,locks,events,states,driver:context[module==='posting'?'XAssistantPostingDriver':'XAssistantInteractionDriver']};
}
for(const module of ['posting','interaction']){
 test(module+' never resumes an old active state during injection',async()=>{
  const f=fixture(module,{active:true});await flush();
  assert.equal(f.driver.isRunning(),false);assert.equal(f.locks.length,0);assert.equal(f.calls.length,0);
 });
 test(module+' starts independently and stop carries only its runId',async()=>{
  const f=fixture(module);await f.driver.start(false,'home');await flush();
  assert.equal(f.driver.isRunning(),true);
  if(module==='interaction')assert.equal(f.calls.find(c=>c.action==='begin')?.sourceMode,'home');
  assert.equal(f.locks.length,1);assert.equal(f.locks[0].options.ifAvailable,true);assert.equal('steal' in f.locks[0].options,false);
  assert.ok(f.events.some(e=>e.module===module&&e.running===true));
  await f.driver.stop({preserveDrafts:true});
  assert.equal(f.driver.isRunning(),false);assert.equal(f.states[module].active,false);
  assert.ok(f.calls.some(c=>c.action==='stop'&&c.runId==='run-'+module));
  assert.ok(f.events.some(e=>e.module===module&&e.running===false));
 });
 test(module+' cannot steal another tab lock or stop its task',async()=>{
  const f=fixture(module,{active:true,locked:true});
  await assert.rejects(f.driver.start(false,'home'),/另一个 X 标签页/);await f.driver.finished();
  assert.equal(f.driver.isRunning(),false);assert.equal(f.states[module].active,true);assert.equal(f.calls.length,0);
 });
 test(module+' workspace route check rejects before beginning a task',async()=>{
  const f=fixture(module,{blocked:true});
  await assert.rejects(f.driver.start(false,'home'),/页面已切换/);await f.driver.finished();
  assert.equal(f.calls.length,0);assert.equal(f.driver.isRunning(),false);
 });
}
test('drivers have no cross-module coordinator, reload, or automatic handoff',()=>{
 for(const name of ['posting.js','overlay.js'])assert.doesNotMatch(source(name),/XAssistantScheduler|createInteractionGate|x-assistant-page-actions|steal\s*:|location\.reload\(/);
 assert.doesNotMatch(source('overlay.js'),/runtime\('(?:posting|notifications)'/);
 assert.doesNotMatch(source('posting.js'),/XAssistantInteraction/);
});
test('interaction defers processed ledger until claimed pre-submit and skips claimed targets intact',()=>{
 const s=source('overlay.js');
 assert.match(s,/module:'interaction',runId:activeRun/);
 assert.match(s,/async\(\)=>\{await filters\?\.refresh\(\);record\.reply='in_flight';await saveProcessed\(info,record\);\}/);
 const guard=s.slice(s.indexOf("if(e.code==='REPLY_ALREADY_CLAIMED')"),s.indexOf('if (e.confirmed'));
 assert.match(guard,/continue;/);assert.doesNotMatch(guard,/saveProcessed|deferRecord/);
});
test('explicit homepage interaction mode is not overridden by enabled friend search',async()=>{
 const store={xAssistantUnfollowedDiscoveryV1:true,xAssistantFriendSearchV1:true,xAssistantFriendTopicIndexV1:0};
 const context=vm.createContext({URL,location:{pathname:'/search',search:'?q=own',href:'https://x.com/search?q=own'},document:{getElementById:()=>({}),querySelector:()=>null},chrome:{storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),set:async o=>Object.assign(store,o)}}},XAssistantCore:{interactionPage:()=>true}});
 vm.runInContext(source('interaction-preferences.js'),context);vm.runInContext(source('module-entry.js'),context);
 const entry=context.XAssistantEntry;entry.setInteractionMode('home');
 assert.equal(await entry.targetFor(),'/home');assert.equal(await entry.nextFriendTopic(),false);
 entry.setInteractionMode('search');assert.match(await entry.targetFor(),/^\/search\?/);
});

test('posting driver has no AI rewrite dependency',()=>{
 const s=source('posting.js');
 assert.doesNotMatch(s,/AI_POST|generated\.text/);
 assert.match(s,/await publish\(row,signal,runId\)/);
});
test('interaction AI generation is abortable before the provider responds',async()=>{
 const context=vm.createContext({DOMException,Date,Promise,setTimeout,clearTimeout,activeRun:'run',api:{call:()=>new Promise(()=>{})}});
 vm.runInContext(source('task-utils.js'),context);
 const driver=source('overlay.js');
 vm.runInContext(driver.slice(driver.indexOf(' const aiReply='),driver.indexOf(' // Sending is'))+'globalThis.generate=aiReply;',context);
 const controller=new AbortController();const pending=context.generate({id:'1',text:'hello'},controller.signal);
 controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
});

for(const module of ['posting','interaction'])test(module+' first start waits for HELLO readiness without a boot dependency cycle',async()=>{
 let release;const workspaceReady=new Promise(resolve=>release=resolve);
 const f=fixture(module,{workspaceReady});const starting=f.driver.start(false,'home');await flush();
 assert.equal(f.calls.length,0);assert.equal(f.locks.length,0);
 release({tabId:7});await starting;assert.equal(f.driver.isRunning(),true);
 await f.driver.stop({preserveDrafts:true});assert.equal(f.driver.isRunning(),false);
});
