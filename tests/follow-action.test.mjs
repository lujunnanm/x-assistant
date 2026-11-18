import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
test('interaction follow only persists the job, without touching the timeline DOM or waiting on a permit',async()=>{
 const calls=[];const c=vm.createContext({account:'/me',activeRun:'run',check(){},autoFollow:async()=>true,api:{call:async m=>{calls.push(m);return 'queued';}}});
 vm.runInContext(source.slice(source.indexOf(' const followAuthor='),source.indexOf(' const markSelected='))+';globalThis.enqueue=followAuthor;',c);
 assert.equal(await c.enqueue({id:'123',author:'ann'},{}),'queued');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{kind:'FOLLOW_ENQUEUE',runId:'run',account:'/me',postId:'123',author:'ann'}]);
 c.autoFollow=async()=>false;assert.equal(await c.enqueue({id:'456',author:'bob'},{}),'skipped_disabled');assert.equal(calls.length,1);
});
test('a settings update beats a stale in-flight worker read and only local changes apply',async()=>{
 const key='xAssistantAutoFollowV1';
 let changed,resolve;
 const context=vm.createContext({
  getLocal:name=>{assert.equal(name,key);return new Promise(r=>{resolve=r;});},
  core:{autoFollowEnabled:value=>value!==false},
  chrome:{storage:{onChanged:{addListener:fn=>{changed=fn;}}}}
 });
 vm.runInContext(source.slice(source.indexOf(' const FOLLOW_SETTING='),source.indexOf(' const addFollowed='))+';globalThis.autoFollow=autoFollow;',context);
 const pending=context.autoFollow();
 changed({[key]:{newValue:false}},'local');resolve(true);assert.equal(await pending,false);
 const next=context.autoFollow();
 changed({[key]:{newValue:true}},'sync');resolve(false);assert.equal(await next,false);
 const resumed=context.autoFollow();
 changed({[key]:{newValue:true}},'local');resolve(false);assert.equal(await resumed,true);
});
