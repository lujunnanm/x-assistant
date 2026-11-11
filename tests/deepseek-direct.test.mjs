import test from 'node:test';import assert from 'node:assert/strict';import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
function fixture(status=200){const calls=[];return {calls,storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-only-secret'})},resource:x=>'extension://'+x,fetcher:async(url,opts)=>{calls.push({url,opts});return url.startsWith('extension:')?{text:async()=>'rules'}:{ok:status===200,status,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text:'有具体例子吗？',footer:'交个朋友呀\n请回关我'})}}]})};}};}
test('direct API uses stored key only as authorization; no bridge',async()=>{const f=fixture(),r=await directGenerate('/reply',{body:JSON.stringify({text:'帖子'})},f);assert.equal(r.ok,true);assert.equal(f.calls[1].url,'https://api.deepseek.com/chat/completions');assert.equal(f.calls[1].opts.headers.Authorization,'Bearer fixture-only-secret');assert.ok(!f.calls[1].opts.body.includes('fixture-only-secret'));assert.equal((await r.json()).text,'有具体例子吗？');});
test('missing key errors before any network request',async()=>{const f=fixture();f.storage.get=async()=>({});await assert.rejects(directGenerate('/reply',{body:'{}'},f),/密钥未配置/);assert.equal(f.calls.length,0);});
test('API failure exposes status only, not provider body',async()=>{const f=fixture(401),r=await directGenerate('/reply',{body:'{}'},f);assert.deepEqual(await r.json(),{error:'HTTP 401'});});
test('stored key is reread on each generation, not cached in worker',async()=>{const f=fixture();let reads=0;f.storage.get=async()=>{reads++;return{[API_KEY_STORAGE]:'fixture-only-secret'};};await directGenerate('/reply',{body:'{}'},f);await directGenerate('/reply',{body:'{}'},f);assert.equal(reads,2);});
test('credential preflight rejects invalid credentials and accepts success',async()=>{const {verifyCredential}=await import('../deepseek-direct.mjs');await assert.rejects(verifyCredential('fixture',{fetcher:async()=>({ok:false,status:401})}),/认证失败/);assert.equal(await verifyCredential('fixture',{fetcher:async()=>({ok:true})}),true);});
test('both proactive and notification replies ignore legacy multilingual footer',async()=>{
 for(const [text,footer] of [['Start with one small step.','Let’s connect—please follow back.'],['小さな一歩から始めましょう。','仲良くしましょう。フォローバックお願いします。']]){
  const f=fixture();f.fetcher=async url=>url.startsWith('extension:')?{text:async()=>'rules'}:{ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text,footer})}}]})};
  const r=await directGenerate('/reply',{body:'{}'},f);assert.equal((await r.json()).text,text);
  const n=await directGenerate('/notification-reply',{body:'{}'},f);assert.equal((await n.json()).text,text);
 }
});
test('notification mode removes the content-value reply threshold',async()=>{
 const f=fixture();await directGenerate('/notification-reply',{body:JSON.stringify({text:'谢谢'})},f);
 const request=JSON.parse(f.calls[1].opts.body);
 assert.match(request.messages[0].content,/不设内容价值门槛/);
 assert.doesNotMatch(request.messages[0].content,/风格分流/);
 assert.doesNotMatch(request.messages[0].content,/通知回帖同样执行价值门槛/);
 assert.equal(request.messages[1].content,JSON.stringify({post_text:'谢谢'}));
 assert.equal(request.model,'deepseek-flash');
});
test('interaction mode removes the content-value reply threshold',async()=>{
 const f=fixture();await directGenerate('/reply',{body:JSON.stringify({text:'今天的日常'})},f);
 assert.equal(f.calls[0].url,'extension://bridge/interaction-reply-rules.txt');
 const request=JSON.parse(f.calls[1].opts.body);
 assert.match(request.messages[0].content,/不设内容价值门槛/);
 assert.match(request.messages[0].content,/由插件文案库兜底/);
 assert.doesNotMatch(request.messages[0].content,/严格执行价值门槛/);
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
 const payload=JSON.parse(f.calls[1].opts.body);assert.match(payload.messages[0].content,/最多 90 加权字符/);assert.doesNotMatch(payload.messages[0].content,/风格分流/);
 assert.equal(payload.messages[1].content,JSON.stringify({reference_text:'选题'}));
});
test('timeline rewrite uses its packaged rules and full-copy output budget',async()=>{
 const f=fixture();f.fetcher=async(url,opts)=>{f.calls.push({url,opts});return url.startsWith('extension:')?{ok:true,text:async()=>'timeline rewrite rules'}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'save_copy',text:'改写正文'})}}]})};};
 const result=await directGenerate('/timeline-rewrite',{body:JSON.stringify({text:'原帖正文'})},f);
 assert.equal(f.calls[0].url,'extension://bridge/timeline-rewrite-rules.txt');
 const payload=JSON.parse(f.calls[1].opts.body);assert.match(payload.messages[0].content,/^timeline rewrite rules\n【风格分流】/);assert.equal(payload.messages[1].content,JSON.stringify({reference_text:'原帖正文'}));assert.equal(payload.max_tokens,4096);
 assert.match(payload.messages[0].content,/领取步骤 → standard.*回本快.*→ reaction.*正式通报 → verify/s);
 assert.match(payload.messages[0].content,/围绕素材原有问题直接提问/);
 assert.match(payload.messages[0].content,/不得把核查流程写进正文/);
 assert.match(payload.messages[0].content,/先把事实和猜疑分开/);
 assert.deepEqual(await result.json(),{action:'save_copy',text:'改写正文'});
});
test('comment rewrite uses dedicated fusion rules and sends both texts as untrusted references',async()=>{
 const f=fixture();f.fetcher=async(url,opts)=>{f.calls.push({url,opts});return url.startsWith('extension:')?{ok:true,text:async()=>'comment fusion rules'}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'save_copy',text:'融合改写正文'})}}]})};};
 const result=await directGenerate('/comment-rewrite',{body:JSON.stringify({text:'评论观点',rootText:'所属帖子观点'})},f);
 assert.equal(f.calls[0].url,'extension://bridge/comment-rewrite-rules.txt');
 const payload=JSON.parse(f.calls[1].opts.body);assert.match(payload.messages[0].content,/^comment fusion rules\n【风格分流】/);assert.equal(payload.messages[1].content,JSON.stringify({reference_post_text:'所属帖子观点',comment_text:'评论观点'}));assert.equal(payload.max_tokens,4096);
 assert.match(payload.messages[0].content,/评论先融合成一个人的完整观点，再判定整条/);
 assert.deepEqual(await result.json(),{action:'save_copy',text:'融合改写正文'});
});
test('rewrite retry uses only trusted corrective guidance, not the prior model output',async()=>{
 const f=fixture();
 await directGenerate('/comment-rewrite',{body:JSON.stringify({text:'评论',rootText:'所属原帖'}),rewriteRetry:true},f);
 const {messages}=JSON.parse(f.calls[1].opts.body);
 assert.match(messages[0].content,/重新生成.*"save_copy"/s);
 assert.match(messages[0].content,/同时融入原帖和评论/);
 assert.match(messages[0].content,/仍按风格分流填写 style/);
 assert.match(messages[0].content,/不得加入编辑者核查、提醒、判断、总结或免责声明/);
 assert.equal(messages[1].content,JSON.stringify({reference_post_text:'所属原帖',comment_text:'评论'}));
});
