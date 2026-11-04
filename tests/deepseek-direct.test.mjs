import test from 'node:test';import assert from 'node:assert/strict';import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
function fixture(status=200){const calls=[];return {calls,storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-only-secret'})},resource:x=>'extension://'+x,fetcher:async(url,opts)=>{calls.push({url,opts});return url.startsWith('extension:')?{text:async()=>'rules'}:{ok:status===200,status,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text:'有具体例子吗？',footer:'交个朋友呀\n请回关我'})}}]})};}};}
test('direct API uses stored key only as authorization; no bridge',async()=>{const f=fixture(),r=await directGenerate('/reply',{body:JSON.stringify({text:'帖子'})},f);assert.equal(r.ok,true);assert.equal(f.calls[1].url,'https://api.deepseek.com/chat/completions');assert.equal(f.calls[1].opts.headers.Authorization,'Bearer fixture-only-secret');assert.ok(!f.calls[1].opts.body.includes('fixture-only-secret'));assert.equal((await r.json()).text,'有具体例子吗？');});
test('missing key errors before any network request',async()=>{const f=fixture();f.storage.get=async()=>({});await assert.rejects(directGenerate('/reply',{body:'{}'},f),/密钥未配置/);assert.equal(f.calls.length,0);});
test('API failure exposes status only, not provider body',async()=>{const f=fixture(401),r=await directGenerate('/reply',{body:'{}'},f);assert.deepEqual(await r.json(),{error:'HTTP 401'});});
test('stored key is reread on each generation, not cached in worker',async()=>{const f=fixture();let reads=0;f.storage.get=async()=>{reads++;return{[API_KEY_STORAGE]:'fixture-only-secret'};};await directGenerate('/reply',{body:'{}'},f);await directGenerate('/reply',{body:'{}'},f);assert.equal(reads,2);});
test('credential preflight rejects invalid credentials and accepts success',async()=>{const {verifyCredential}=await import('../deepseek-direct.mjs');await assert.rejects(verifyCredential('fixture',{fetcher:async()=>({ok:false,status:401})}),/认证失败/);assert.equal(await verifyCredential('fixture',{fetcher:async()=>({ok:true})}),true);});
test('notification replies ignore legacy footer fields without changing natural body',async()=>{
 for(const [text,footer] of [['Start with one small step.','Let’s connect—please follow back.'],['小さな一歩から始めましょう。','仲良くしましょう。フォローバックお願いします。']]){
  const f=fixture();f.fetcher=async url=>url.startsWith('extension:')?{text:async()=>'rules'}:{ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text,footer})}}]})};
  const n=await directGenerate('/notification-reply',{body:'{}'},f);assert.equal((await n.json()).text,text);
 }
});
test('notification mode applies the same high-value reply threshold',async()=>{
 const f=fixture();await directGenerate('/notification-reply',{body:JSON.stringify({text:'谢谢'})},f);
 const request=JSON.parse(f.calls[1].opts.body);
 assert.match(request.messages[0].content,/通知回帖同样执行价值门槛/);
 assert.equal(request.messages[1].content,JSON.stringify({post_text:'谢谢'}));
 assert.equal(request.model,'deepseek-flash');
});
test('interaction mode always replies and allows a social follow-back fallback',async()=>{
 const f=fixture();await directGenerate('/reply',{body:JSON.stringify({text:'今天的日常'})},f);
 assert.equal(f.calls[0].url,'extension://bridge/interaction-reply-rules.txt');
 const request=JSON.parse(f.calls[1].opts.body);
 assert.match(request.messages[0].content,/禁止返回 skip/);
 assert.match(request.messages[0].content,/交友、请求回关或互动邀请/);
});
test('interaction model skip is deterministically converted to a same-language fallback',async()=>{
 const f=fixture();f.fetcher=async url=>url.startsWith('extension:')?{text:async()=>'rules'}:{ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'skip',text:''})}}]})};
 const r=await directGenerate('/reply',{body:JSON.stringify({text:'今天冒个泡'})},f);
 assert.deepEqual(await r.json(),{action:'send_reply',text:'来交个朋友，方便的话回关一下。'});
});
test('malformed and truncated completions cannot be treated as valid results',async()=>{
 for(const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:'not json'}},{finish_reason:'stop',message:{content:'[]'}},{finish_reason:'stop',message:{content:'null'}}]){
  const f=fixture();f.fetcher=async url=>url.startsWith('extension:')?{text:async()=>'rules'}:{ok:true,json:async()=>({choices:[choice]})};
  await assert.rejects(directGenerate('/reply',{body:'{}'},f),e=>e.code==='format');
 }
});
test('missing packaged rules fail explicitly before sending input to API',async()=>{
 const f=fixture();f.fetcher=async()=>({ok:false,status:404,text:async()=>''});
 await assert.rejects(directGenerate('/reply',{body:'{}'},f),e=>e.code==='prompt_load');
});
test('cancelled generation never starts a provider request',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(directGenerate('/reply',{body:'{}',signal:controller.signal},f),{name:'AbortError'});
 assert.equal(f.calls.length,1); // local rules only
});
test('post character budget is supplied only as a system constraint',async()=>{
 const f=fixture();await directGenerate('/post',{body:JSON.stringify({text:'选题'}),maxBodyWeight:90},f);
 const payload=JSON.parse(f.calls[1].opts.body);assert.match(payload.messages[0].content,/最多 90 加权字符/);
 assert.equal(payload.messages[1].content,JSON.stringify({reference_text:'选题'}));
});
