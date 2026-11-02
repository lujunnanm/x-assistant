import test from 'node:test';import assert from 'node:assert/strict';import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
function fixture(status=200){const calls=[];return {calls,storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-only-secret'})},resource:x=>'extension://'+x,fetcher:async(url,opts)=>{calls.push({url,opts});return url.startsWith('extension:')?{text:async()=>'rules'}:{ok:status===200,status,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text:'有具体例子吗？',footer:'交个朋友呀\n请回关我'})}}]})};}};}
test('direct API uses stored key only as authorization; no bridge',async()=>{const f=fixture(),r=await directGenerate('/reply',{body:JSON.stringify({text:'帖子'})},f);assert.equal(r.ok,true);assert.equal(f.calls[1].url,'https://api.deepseek.com/chat/completions');assert.equal(f.calls[1].opts.headers.Authorization,'Bearer fixture-only-secret');assert.ok(!f.calls[1].opts.body.includes('fixture-only-secret'));assert.match((await r.json()).text,/请回关我$/);});
test('missing key errors before any network request',async()=>{const f=fixture();f.storage.get=async()=>({});await assert.rejects(directGenerate('/reply',{body:'{}'},f),/密钥未配置/);assert.equal(f.calls.length,0);});
test('API failure exposes status only, not provider body',async()=>{const f=fixture(401),r=await directGenerate('/reply',{body:'{}'},f);assert.deepEqual(await r.json(),{error:'HTTP 401'});});
test('stored key is reread on each generation, not cached in worker',async()=>{const f=fixture();let reads=0;f.storage.get=async()=>{reads++;return{[API_KEY_STORAGE]:'fixture-only-secret'};};await directGenerate('/reply',{body:'{}'},f);await directGenerate('/reply',{body:'{}'},f);assert.equal(reads,2);});
test('credential preflight rejects invalid credentials and accepts success',async()=>{const {verifyCredential}=await import('../deepseek-direct.mjs');await assert.rejects(verifyCredential('fixture',{fetcher:async()=>({ok:false,status:401})}),/认证失败/);assert.equal(await verifyCredential('fixture',{fetcher:async()=>({ok:true})}),true);});
test('multilingual footer stays in selected language; notification omits it',async()=>{
 for(const [text,footer] of [['Start with one small step.','Let’s connect—please follow back.'],['小さな一歩から始めましょう。','仲良くしましょう。フォローバックお願いします。']]){
  const f=fixture();f.fetcher=async url=>url.startsWith('extension:')?{text:async()=>''}:{ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text,footer})}}]})};
  const r=await directGenerate('/reply',{body:'{}'},f);assert.equal((await r.json()).text,text+'\n'+footer);
  const n=await directGenerate('/notification-reply',{body:'{}'},f);assert.equal((await n.json()).text,text);
 }
});
