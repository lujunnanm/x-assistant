import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [html,js]=await Promise.all([read('panel.html'),read('panel.js')]);
const source=js.slice(js.indexOf('function bindInteractionSetting('),js.indexOf('function bindInteractionFilters()'));
const search='xAssistantFriendSearchV1',follow='xAssistantAutoFollowV1',tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
 const make=()=>({disabled:true,textContent:'读取中…',attributes:{},
  setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];}});
 const nodes=Object.fromEntries(['search-toggle','search-status','follow-toggle','follow-status'].map(id=>['interaction-'+id,make()]));
 const writes=[],initial={},listeners=[];let fail=false;
 vm.runInNewContext(source,{
  $:id=>nodes[id],
  chrome:{storage:{local:{
   get:key=>new Promise((resolve,reject)=>{initial[key]={resolve,reject};}),
   set:async value=>{writes.push(JSON.stringify(value));if(fail)throw Error('storage unavailable');}
  },onChanged:{addListener:fn=>{listeners.push(fn);}}}}
 });
 return {search:nodes['interaction-search-toggle'],follow:nodes['interaction-follow-toggle'],
  sourceStatus:nodes['interaction-search-status'],followStatus:nodes['interaction-follow-status'],writes,
  init:(key,value)=>initial[key].resolve({[key]:value}),reject:key=>initial[key].reject(Error('offline')),fail:()=>{fail=true;},
  external:(key,value,area='local')=>listeners.forEach(listener=>listener({[key]:{newValue:value}},area))};
}

test('interaction settings expose both preferences as accessible switches, with distinct explanations',()=>{
 assert.match(html,/<a href="#interaction-settings">互动设置<\/a>/);
 assert.match(html,/<button id="interaction-search-toggle"[^>]+role="switch"[^>]+aria-label="在搜索时间线上互动"/);
 assert.match(html,/<button id="interaction-follow-toggle"[^>]+role="switch"[^>]+aria-label="自动关注"/);
 assert.match(html,/仅切换来源，不启动互动/);
 assert.match(html,/关闭后队列暂停，不影响互动或独立回关模块/);
 assert.match(html,/<a href="#followback-settings">回关设置<\/a>/);
 assert.match(html,/<button id="followback-sweep-toggle"[^>]+role="switch"[^>]+aria-label="完整遍历认证关注者"/);
 assert.match(html,/冷却时间用于继续刷列表和预找下一位/);
});

test('default-on search changes only its existing preference, not auto-follow or the module state',async()=>{
 const f=fixture();
 await f.search.onclick();assert.deepEqual(f.writes,[]);
 f.init(search,undefined);f.init(follow,true);await tick();
 assert.equal(f.search.getAttribute('aria-checked'),'true');
 await f.search.onclick();
 assert.deepEqual(f.writes,[JSON.stringify({[search]:false})]);
 assert.equal(f.search.getAttribute('aria-checked'),'false');
 assert.equal(f.follow.getAttribute('aria-checked'),'true');
 assert.match(f.sourceStatus.textContent,/首页时间线/);
 f.external(search,true,'sync');assert.equal(f.search.getAttribute('aria-checked'),'false');
 f.external(search,true);assert.equal(f.search.getAttribute('aria-checked'),'true');
 assert.match(f.sourceStatus.textContent,/关键词搜索结果/);
});

test('auto-follow preserves the existing value across settings loads and writes only its key',async()=>{
 const f=fixture();f.init(follow,false);f.init(search,false);await tick();
 assert.equal(f.follow.getAttribute('aria-checked'),'false');
 await f.follow.onclick();assert.deepEqual(f.writes,[JSON.stringify({[follow]:true})]);
 assert.equal(f.follow.getAttribute('aria-checked'),'true');
 assert.equal(f.search.getAttribute('aria-checked'),'false');
 f.external(follow,false);assert.equal(f.follow.getAttribute('aria-checked'),'false');
 const reloaded=fixture();reloaded.init(follow,undefined);await tick();
 assert.equal(reloaded.follow.getAttribute('aria-checked'),'true','legacy default remains enabled');
});

test('newer local state wins over initial reads and failed saves keep each preference unchanged',async()=>{
 const f=fixture();f.external(search,false);f.external(follow,false);f.init(search,true);f.init(follow,true);await tick();
 f.fail();await f.search.onclick();await f.follow.onclick();
 for(const button of [f.search,f.follow]){
  assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-checked'),'false');
 }
 assert.match(f.sourceStatus.textContent,/失败/);assert.match(f.followStatus.textContent,/失败/);
});

test('failure to read one preference does not unlock it or prevent use of the other',async()=>{
 const f=fixture();f.reject(search);f.init(follow,true);await tick();
 assert.equal(f.search.disabled,true);assert.match(f.sourceStatus.textContent,/无法读取/);
 assert.equal(f.follow.disabled,false);
 await f.search.onclick();assert.deepEqual(f.writes,[]);
 await f.follow.onclick();assert.deepEqual(f.writes,[JSON.stringify({[follow]:false})]);
});
