import test from 'node:test';
import assert from 'node:assert/strict';
const events={},event=name=>({addListener:fn=>{events[name]=fn;}}),calls=[],tabs=new Map();
const store={
 xAssistantManagedServiceV1:{enabled:true,account:'/me',selected:{interaction:true},workers:{interaction:{tabId:1,token:'worker',status:'running'}}},
 xAssistantRuntimeV1:{active:true,owner:1,documentId:'doc:instance',runId:'run',account:'/me',phase:'waiting',sourceMode:'home'},
 xAssistantWorkspaceOwnersV1:{1:{identity:'doc:instance',instanceId:'instance'}},xAssistantFriendSearchV1:false,xAssistantAutoFollowV1:true,
 xAssistantProcessedV1:{posts:{'123':{author:'@ann',reply:'verified',follow:'pending'}}}
};
tabs.set(1,{id:1,windowId:7,url:'https://x.com/home'});
globalThis.chrome={storage:{local:{get:async k=>({[k]:structuredClone(store[k])}),set:async v=>Object.assign(store,structuredClone(v))},onChanged:event('storage')},
 runtime:{id:'queue-test',getURL:p=>'chrome-extension://queue-test/'+p,onMessage:event('message'),onInstalled:event('install'),onStartup:event('startup'),openOptionsPage:async()=>{}},
 action:{onClicked:event('clicked')},alarms:{create:async()=>{},clear:async()=>{},onAlarm:event('alarm')},
 tabs:{create:async o=>{calls.push(['create',o]);const t={id:2,...o};tabs.set(2,t);return t;},get:async id=>tabs.get(id),update:async(id,o)=>{calls.push(['update',id,o]);Object.assign(tabs.get(id),o);},onRemoved:event('removed'),onUpdated:event('updated'),onReplaced:event('replaced')},
 scripting:{executeScript:async options=>{
  calls.push(['script',options.target,options.args[1]]);
  const click=options.args[1]==='click';
  return [{documentId:'queue-doc',result:click?{state:'followed',clicked:true}:{state:'unfollowed',targetId:'77'}}];
 }}
};
await import('../background.js');
const sender={id:'queue-test',url:'https://x.com/home',tab:{id:1,windowId:7},frameId:0,documentId:'doc'};
const send=(msg,who=sender)=>new Promise(resolve=>events.message({instanceId:'instance',...msg},who,resolve));
test('real background handler authenticates enqueue, runs outside reply handler, and saves completion without regressing to queued',async()=>{
 const message={kind:'FOLLOW_ENQUEUE',runId:'run',account:'/me',postId:'123',author:'ann'};
 for(const patch of [{runId:'stale'},{postId:'999'},{author:'other'}])assert.equal((await send({...message,...patch})).ok,false);
 const result=await send(message);assert.equal(result.ok,true,result.error);assert.equal(result.state,'queued');
 assert.equal(calls.length,0,'enqueue does not await or begin navigation inline');
 for(let i=0;i<30&&!store.xAssistantFollowedV1?.handles.ann;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(store.xAssistantProcessedV1.posts['123'].follow,'verified');
 assert.equal(store.xAssistantFollowedV1.handles.ann.owner,'me');
 assert.deepEqual(calls[0],['create',{url:'https://x.com/ann/status/123',windowId:7,active:false}]);
 assert.deepEqual(calls.find(c=>c[2]==='click')[1],{tabId:2,documentIds:['queue-doc']});
 assert.equal(calls.filter(c=>c[2]==='click').length,1);
 const late=await send({kind:'PROCESSED',id:'123',record:{author:'@ann',reply:'verified',follow:'queued'}});
 assert.equal(late.ok,true);assert.equal(store.xAssistantProcessedV1.posts['123'].follow,'verified');
 store.xAssistantAutoFollowV1=false;
 assert.equal((await send(message)).state,'skipped_disabled');
 assert.equal(calls.filter(c=>c[2]==='click').length,1);
});
