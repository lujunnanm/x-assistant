import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const workspace=read('workspace.js'),overlay=read('overlay.js');
const slice=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return text.slice(a,b);};
const openBody=slice(workspace,' async function openStatusTarget',' function beginComposer');
const checkBody=slice(overlay,' const abortError=',' const requireSource=');
const sendBody=slice(overlay,' const replyAndSend=',' const relocatePost=');
const loopBody=slice(overlay,'  const runLoop =',' // A single owner per module;');
const startBody=slice(overlay,' const start=async',' const stop=async');
const token=(key='following',epoch=1)=>({key,label:key,epoch});
const changed=extra=>Object.assign(Error('首页标签已切换'),{code:'TIMELINE_CHANGED',...extra});

function homeGuard(location,initial=token()){
 let current=initial;
 const checks=[];
 return {checks,set:value=>{current=value;},capture:()=>({...current}),ready:async()=>({...current}),
  check(expected){checks.push(expected);if(new URL(location.href).pathname==='/home'&&(expected.key!==current.key||expected.epoch!==current.epoch))throw changed();}};
}

function navigationFixture({key='following',returnKey=key,returnEpoch=2,relocateAfter=true}={}){
 const from='https://x.com/home',row={id:'123',author:'Writer',text:'AI tools',time:'2026-11-06T00:00:00Z',url:'https://x.com/Writer/status/123',homeTimeline:token(key)};
 const location={href:from},home=homeGuard(location,token(key));
 const sourceEntry={url:from,key:'S',index:4},targetEntry={url:row.url,key:'T',index:5};
 const navigation={currentEntry:sourceEntry,entries:()=>[sourceEntry,targetEntry]},events=[];
 const article={querySelectorAll:()=>[link]};
 const link={href:row.url,isConnected:true,target:'',closest:()=>article,querySelector:()=>({}),click(){events.push('open');location.href=row.url;navigation.currentEntry=targetEntry;history.length++;}};
 const history={length:5,back(){events.push('back');location.href=from;navigation.currentEntry=sourceEntry;home.set(token(returnKey,returnEpoch));}};
 const context=vm.createContext({URL,location,navigation,history,
  document:{querySelectorAll:()=>[],querySelector:()=>({})},XAssistantHomeTimeline:home,
  XAssistantDOM:{dialogs:()=>[],relocate:()=>events.includes('back')&&!relocateAfter?null:{article},detailReply:()=>({article,editor:{},dialog:null}),rows:()=>[{id:'999',author:'other'}]},
  XAssistantCore:{editorText:e=>e.text||''},current:{module:'interaction'},T:{check(){},waitForPage:async probe=>probe()},
  policy:{normalize:value=>{const u=new URL(value);return u.pathname+u.search;}},check(){},self:()=>'/self',progress(){},expectNavigation(){},error:(code,message)=>Object.assign(Error(message),{code})});
 vm.runInContext(openBody+';globalThis.open=openStatusTarget;',context);
 return {home,row,context,events,open:()=>context.open(row,{signal:new AbortController().signal})};
}

for(const key of ['for-you','following','list:123456','custom:AI'])test('native status return verifies selected home tab: '+key,async()=>{
 const f=navigationFixture({key}),visit=await f.open();
 await visit.returnToSource();await visit.returnToSource();
 assert.deepEqual(f.events,['open','back'],'a repainted epoch with the same tab key is allowed; never issue double Back');
 assert.equal(f.home.checks[0].key,key);
});

test('wrong home tab cannot pass a nonempty rows + tablist fallback after returning',async()=>{
 const f=navigationFixture({key:'list:123',returnKey:'following',relocateAfter:false}),visit=await f.open();
 await assert.rejects(visit.returnToSource(),{code:'RETURN_UNVERIFIED',preserveDrafts:true});
 assert.deepEqual(f.events,['open','back']);
});

test('changing the home tab after selection prevents even the native target visit',async()=>{
 const f=navigationFixture();f.home.set(token('for-you',2));
 await assert.rejects(f.open(),{code:'TIMELINE_CHANGED'});assert.deepEqual(f.events,[]);
});

function loopFixture(changeAt){
 const location={href:'https://x.com/home',pathname:'/home',search:''},home=homeGuard(location),events=[];
 let active=true;
 const context=vm.createContext({URL,DOMException,AbortController,Date,Map,Set,location,homeSource:null,account:'/self',selfHandle:()=> 'self',
  selected:null,sessionAuthors:new Set(),replySubmitted:false,XAssistantWorkspace:{check(){}},XAssistantHomeTimeline:home,
  document:{querySelector:()=>null},core:{interactionPage:()=>true},requireSource:async()=>{},
  XAssistantEntry:{targetFor:async()=>'/home'},runtime:async()=>({active,runId:'run'}),autoFollow:async()=>false,status(){},markSelected(){},
  findCandidate:async()=>{events.push('scan');if(changeAt==='scan')home.set(token('list:123',2));return {id:'123',author:'writer',text:'AI tools',followState:'unrestricted',followsYou:true};},
  aiReply:async row=>{events.push('generate');if(changeAt==='generation')home.set(token('list:123',2));return{action:'send_reply',postId:row.id,text:'Useful detail'};},
  recordOutcome(){},replyAndSend:async(row,text,signal,confirmed)=>{events.push(['send',row.homeTimeline]);await confirmed();return'verified';},
  saveProcessed:async()=>{},updateRuntime:async()=>{},waitAfterAttempt:async()=>{active=false;}});
 vm.runInContext(checkBody+loopBody+';globalThis.run=runLoop;',context);
 return {context,events,home,run:()=>context.run(new AbortController().signal,'run','home')};
}

test('the real interaction loop binds the selected home tab to its selected row',async()=>{
 const f=loopFixture();await f.run();
 const sent=f.events.find(e=>Array.isArray(e)&&e[0]==='send');assert.ok(sent);
 assert.deepEqual(JSON.parse(JSON.stringify(sent[1])),token());
});
for(const stage of ['scan','generation'])test('home tab change during '+stage+' invalidates the candidate before any send',async()=>{
 const f=loopFixture(stage);await assert.rejects(f.run(),{code:'TIMELINE_CHANGED'});
 assert.ok(!f.events.some(e=>Array.isArray(e)&&e[0]==='send'));
 if(stage==='scan')assert.ok(!f.events.includes('generate'));
});

test('real per-scan guard rejects a home tab change while candidate records are awaited',async()=>{
 const location={href:'https://x.com/home'},home=homeGuard(location),events=[];
 const context=vm.createContext({URL,DOMException,location,homeSource:token(),account:'/self',selfHandle:()=> 'self',
  document:{querySelector:()=>null},XAssistantWorkspace:{check(){}},XAssistantHomeTimeline:home,
  processed:async()=>{home.set(token('list:123',2));return {posts:{}};},followCooldownActive:async()=>false,
  visiblePosts:()=>[{id:'1',author:'writer',text:'AI tools'}],sessionAuthors:new Set(),core:{interactionSkipReason:()=>null},
  recordCandidate(){},publishDiagnostics:async()=>{},inspectFollowState:async()=>{events.push('relation');return {state:'unfollowed'};}});
 vm.runInContext(checkBody+slice(overlay,' const findCandidate=',' const aiReply=')+';globalThis.pick=findCandidate;',context);
 await assert.rejects(context.pick(new AbortController().signal,false),{code:'TIMELINE_CHANGED'});
 assert.deepEqual(events,[]);
});

test('real claim -> prepareTarget chain releases an unsent claim when the home tab changes during claim acquisition',async()=>{
 const location={href:'https://x.com/home'},home=homeGuard(location),events=[];
 const context=vm.createContext({URL,DOMException,location,homeSource:token(),account:'/self',selfHandle:()=> 'self',activeRun:'run',replySubmitted:false,updateRuntime(){},
  XAssistantHomeTimeline:home,XAssistantDOM:{},XAssistantTasks:{},XAssistantWorkspace:{check(){},openStatusTarget:async()=>assert.fail('must not visit stale target')},
  XAssistantRuntime:{call:async message=>{events.push([message.kind,message.outcome]);if(message.kind==='REPLY_CLAIM'){home.set(token('list:123',2));return {claimed:true,claimId:'claim'};}return {};}}});
 vm.runInContext(read('reply-engine.js'),context);
 vm.runInContext(checkBody+sendBody+';globalThis.send=replyAndSend;',context);
 await assert.rejects(context.send({id:'1',homeTimeline:token()},'reply',new AbortController().signal,()=>assert.fail('not confirmed'),()=>assert.fail('not submitted')),{code:'TIMELINE_CHANGED'});
 assert.deepEqual(events,[['REPLY_CLAIM',undefined],['REPLY_SETTLE','released']]);assert.equal(context.replySubmitted,false);
});

for(const outcome of ['confirmed','unknown'])test('tab errors after '+outcome+' never turn into an unsent retry or a second Back',async()=>{
 const location={href:'https://x.com/home'},home=homeGuard(location),events=[];
 const context=vm.createContext({URL,DOMException,location,homeSource:token(),account:'/self',selfHandle:()=> 'self',activeRun:'run',replySubmitted:false,updateRuntime(){},XAssistantHomeTimeline:home,
  XAssistantWorkspace:{check(){},openStatusTarget:async()=>({returnToSource:async()=>{events.push('back');throw Object.assign(Error('wrong tab'),{code:'RETURN_UNVERIFIED',preserveDrafts:true});}})},
  XAssistantReplyEngine:{send:async options=>{await options.prepareTarget();events.push('submit');if(outcome==='unknown')throw changed({submitted:true});await options.onConfirmed({});}}});
 vm.runInContext(checkBody+sendBody+';globalThis.send=replyAndSend;',context);
 await assert.rejects(context.send({id:'1',homeTimeline:token()},'reply',new AbortController().signal,async()=>events.push('receipt'),()=>{}),e=>e.submitted&&e.stopTargetVisit&&(outcome==='unknown'?!e.confirmed:e.confirmed));
 assert.deepEqual(events,outcome==='unknown'?['submit']:['submit','receipt','back']);
 assert.equal(context.replySubmitted,outcome==='unknown');
});

function startFixture(failure){
 let calls=0;const events=[];
 const context=vm.createContext({AbortController,Date,Set,running:false,controller:null,homeSource:null,selected:null,activeRun:null,account:null,runPromise:Promise.resolve(),
  XAssistantWorkspace:{ready:Promise.resolve()},navigator:{locks:{request:async(name,opts,work)=>work({})}},
  check(){},document:{querySelector:()=>null},location:{href:'https://x.com/home',pathname:'/home'},core:{interactionPage:()=>true},requireSource:async()=>{},selfHandle:()=> 'self',
  api:{runtime:async(module,action)=>action==='begin'?{runId:'run'}:{}},emitState:(active,error)=>events.push({active,error}),
  XAssistantTime:{ready:Promise.resolve(),pending:async()=>0},status(){},sessionAuthors:new Set(),diagnostics:{},observedPosts:new Set(),observedReasons:new Set(),
  recoverDelayedComposer:async()=>false,updateRuntime:async()=>{},
  runLoop:async()=>{calls++;if(calls===1){context.sessionAuthors.add('already-confirmed');throw failure;}assert.ok(context.sessionAuthors.has('already-confirmed'),'author dedupe survives a safe source-tab rescan');}});
 vm.runInContext(startBody+';globalThis.begin=start;globalThis.finished=()=>runPromise;',context);
 return {events,get calls(){return calls;},run:async()=>{await context.begin(false,'home');await context.finished();}};
}

test('a proven unsent home-tab change rescans in the same run without clearing confirmed authors',async()=>{
 const f=startFixture(changed());await f.run();assert.equal(f.calls,2);assert.equal(f.events.at(-1).error,null);
});
for(const flags of [{submitted:true},{confirmed:true},{preserveDrafts:true},{stopTargetVisit:true}])test('outer owner never automatically rescans an unsafe tab change: '+Object.keys(flags)[0],async()=>{
 const f=startFixture(changed(flags));await f.run();assert.equal(f.calls,1);assert.equal(f.events.at(-1).error.code,'TIMELINE_CHANGED');
});

function entryFixture({search=false,enterFailure=null}={}){
 const calls=[],location={href:'https://x.com/home',pathname:'/home',search:''};
 const data={xAssistantUnfollowedDiscoveryV1:true,xAssistantFriendSearchV1:search,xAssistantFriendTopicIndexV1:0};
 const local={get:async keys=>Object.fromEntries([keys].flat().map(key=>[key,data[key]])),set:async patch=>Object.assign(data,patch)};
 const context=vm.createContext({URL,location,chrome:{storage:{local}},document:{getElementById:()=>null,querySelector:q=>q==='[data-testid="AppTabBar_Profile_Link"]'?{getAttribute:()=>'/self'}:null,querySelectorAll:()=>[]},
  XAssistantRuntime:{storage:local,check(){}},XAssistantWorkspace:{ready:Promise.resolve(),check(){}},
  XAssistantCore:{editorText:()=>''},XAssistantHomeTimeline:{enter:async signal=>{calls.push(signal);if(enterFailure)throw enterFailure;}}});
 vm.runInContext(read('interaction-preferences.js'),context);vm.runInContext(read('module-entry.js'),context);
 return {context,calls,entry:context.XAssistantEntry,location};
}

test('the actual home interaction entry restores the selected timeline before admitting the worker',async()=>{
 const f=entryFixture(),signal=new AbortController().signal;
 assert.equal(await f.entry.enter('interaction',signal),'/self');assert.deepEqual(f.calls,[signal]);
});
test('timeline restoration failure propagates without admitting a home interaction worker',async()=>{
 const f=entryFixture({enterFailure:Object.assign(Error('selected tab unavailable'),{code:'TIMELINE_NOT_READY'})});
 await assert.rejects(f.entry.enter('interaction',new AbortController().signal),{code:'TIMELINE_NOT_READY'});assert.equal(f.calls.length,1);
});
test('posting and keyword-search entries do not restore or overwrite home timeline selection',async()=>{
 const post=entryFixture();await post.entry.enter('posting',new AbortController().signal);assert.deepEqual(post.calls,[]);
 const search=entryFixture({search:true}),target=new URL(await search.entry.targetFor(),'https://x.com');
 Object.assign(search.location,{href:target.href,pathname:target.pathname,search:target.search});
 await search.entry.enter('interaction',new AbortController().signal);assert.deepEqual(search.calls,[]);
});
