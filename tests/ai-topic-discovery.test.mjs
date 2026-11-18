import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createManagedService} from '../managed-service.mjs';

const SEARCH_KEY='xAssistantFriendSearchV1',TOPIC_KEY='xAssistantFriendTopicIndexV1';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function entry(initial={}){
 const data={xAssistantUnfollowedDiscoveryV1:true,[SEARCH_KEY]:true,[TOPIC_KEY]:0,...initial},writes=[];
 const local={get:async keys=>Object.fromEntries([keys].flat().map(key=>[key,data[key]])),set:async patch=>{writes.push(patch);Object.assign(data,patch);}};
 const context=vm.createContext({URL,location:{href:'https://x.com/home',pathname:'/home',search:''},document:{getElementById:()=>null},chrome:{storage:{local}},XAssistantRuntime:{storage:local}});
 vm.runInContext(read('interaction-preferences.js'),context);vm.runInContext(read('module-entry.js'),context);
 const api=context.XAssistantEntry;
 return{data,writes,api,query:async()=>new URL(await api.targetFor(),'https://x.com').searchParams.get('q')};
}

test('AI discovery rotates distinct queries across models, building, media and research without friendship keywords',async()=>{
 const f=entry(),queries=[];
 do{
  const target=new URL(await f.api.targetFor(),'https://x.com');
  assert.equal(target.pathname,'/search');assert.equal(target.searchParams.has('f'),false);
  queries.push(target.searchParams.get('q'));assert.equal(await f.api.nextFriendTopic(),true);
 }while(f.data[TOPIC_KEY]!==0&&queries.length<100);
 assert.equal(queries.length,30);assert.equal(new Set(queries).size,queries.length);
 const joined=queries.join('\n');
 for(const term of ['人工智能','artificial intelligence','生成AI','LLM','ChatGPT','Claude','Gemini','DeepSeek','AI coding','AI agent','MCP','Dify','RAG','prompt engineering','模型微调','Ollama','大模型评测','AI安全','Midjourney','ComfyUI','AI视频','语音合成','AI音乐','多模态模型','机器学习','具身智能','AI工具','AI产品'])assert.ok(joined.includes(term),term);
 assert.doesNotMatch(joined,/蓝V|交友|互关|浇友|涨粉|follow back|mutuals|友達募集|相互フォロー/i);
 for(const term of ['Gemini','Cursor','Sora','Whisper','Kimi','Llama','Mistral','Gemma']){
  assert.ok(joined.includes(term+' AI'),term+' needs AI context');
  assert.doesNotMatch(joined,new RegExp('(?:^| OR )'+term+'(?: OR |$)','m'));
 }
 assert.ok(f.writes.every(patch=>Object.keys(patch).every(key=>key===TOPIC_KEY)),'rotation does not change module or master switches');
});

test('persisted old topic indices map safely onto AI topics without resetting settings',async()=>{
 const first=entry(),old=entry({[TOPIC_KEY]:30000});
 assert.equal(await old.query(),await first.query());assert.equal(old.data[TOPIC_KEY],30000);
 assert.deepEqual(old.writes,[]);
 await old.api.nextFriendTopic();assert.equal(old.data[TOPIC_KEY],1);assert.equal(old.data[SEARCH_KEY],true);
});

test('search-off still uses the home timeline and preserves its topic index',async()=>{
 const f=entry({[SEARCH_KEY]:false,[TOPIC_KEY]:17});
 assert.equal(await f.api.targetFor(),'/home');assert.equal(await f.api.nextFriendTopic(),false);
 assert.equal(f.data[TOPIC_KEY],17);assert.deepEqual(f.writes,[]);
 f.data[SEARCH_KEY]=true;f.api.setInteractionMode('home');
 assert.equal(await f.api.targetFor(),'/home','enabling search never changes an already selected home run');
});

test('managed interaction workers start on the first AI query, not an obsolete friendship search',async()=>{
 const data={[SEARCH_KEY]:true},tabs=new Map();let nextId=1;
 const service=createManagedService({read:async key=>structuredClone(data[key]),write:async(key,value)=>{data[key]=structuredClone(value);},runtimeFor:async()=>({}),now:()=>Date.parse('2026-11-06T04:00:00Z'),uuid:()=>`worker-${nextId}`,
  tabs:{create:async options=>{const tab={id:nextId++,...options};tabs.set(tab.id,tab);return tab;},update:async(id,options)=>{Object.assign(tabs.get(id),options);return tabs.get(id);},get:async id=>tabs.get(id),sendMessage:async()=>{}},
  alarms:{create:async()=>{},clear:async()=>{}}});
 const state=await service.set({enabled:true,account:'/me',selected:{interaction:true}});
 assert.deepEqual(Object.keys(state.workers),['interaction']);
 const address=new URL(tabs.get(state.workers.interaction.tabId).url);
 assert.equal(address.pathname,'/search');assert.equal(address.searchParams.get('q'),await entry().query());
 assert.equal(state.selected.posting,false);assert.equal(state.selected.notifications,false);assert.equal(state.selected.followback,false);
});
