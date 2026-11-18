import test from 'node:test';
import assert from 'node:assert/strict';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
import {generateReply,generateNotificationReply} from '../ai-client.mjs';
import {recoverGeneration,sanitizeHTTPDiagnostic,createAIError} from '../ai-recovery.mjs';
import {withContext,fixtureImageResponse} from './reply-test-fixtures.mjs';
const secret='fixture-only-sensitive-credential';
function adapter(message){return (url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:secret})},resource:p=>'extension://'+p,fetcher:async url=>url.startsWith('extension:')?{ok:true,text:async()=>'JSON rules'}:url.startsWith('https://pbs.twimg.com/')?fixtureImageResponse():{ok:false,status:400,json:async()=>({error:{message,type:'invalid_request_error',code:'invalid_image_url',param:'messages[1].content[2].image_url.url'}})}});}
test('actual provider error reason survives adapter, client, recovery and safe status text without raw input or credentials',async()=>{
 const reports=[];
 await assert.rejects(recoverGeneration(()=>generateReply(withContext({id:'123',text:'private-input-text'}),adapter('Failed to download image from https://pbs.twimg.com/media/private.jpg ; Bearer '+secret+'; private-input-text')),
  {check:async()=>{},report:async r=>reports.push(r),sleep:async()=>{},binding:{postId:'123'}}),e=>{
   assert.equal(e.code,'http_400');assert.match(e.message,/Failed to download image/);assert.match(e.message,/invalid_image_url/);
   assert.doesNotMatch(e.message,/fixture-only-sensitive|private-input-text|private\.jpg|Bearer/);return true;
  });
 assert.equal(reports.length,1);assert.match(reports[0].reason,/Failed to download image/);
});
test('malformed provider errors still report HTTP 400 and never replace it with a parser error',async()=>{
 for(const json of [async()=>{throw Error('bad body');},async()=>({error:{message:{raw:'secret'}}}),async()=>null]){
  const r=await directGenerate('/reply',{body:'{}'},{storage:{get:async()=>({[API_KEY_STORAGE]:secret})},resource:p=>'extension://'+p,fetcher:async u=>u.startsWith('extension:')?{ok:true,text:async()=>'JSON'}:{ok:false,status:400,json}});
  assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'HTTP 400'});
 }
});
test('provider message is bounded, redacted and displayed only as a diagnostic, never as an action',async()=>{
 const r=await adapter('secret='+secret+'; https://example.com/x?token=opaque ; sk-'+'x'.repeat(40)+'; Authorization: opaque-token\n'+ 'x'.repeat(1000))('/reply',{body:JSON.stringify({text:'hello'})});
 const d=r.diagnostic;assert.ok(d);assert.ok(d.message.length<=240);assert.doesNotMatch(JSON.stringify(d),/fixture-only-sensitive|https:\/\/|sk-xxxx|opaque-token/);
 assert.equal(d.action,undefined);
});
test('both reply routes keep the actual image count and do not forward arbitrary response fields',async()=>{
 for(const generate of [generateReply,generateNotificationReply]){
  const post=withContext({id:'123',text:'hello'});post.context.root.imageUrls=post.context.target.imageUrls=['https://pbs.twimg.com/media/fixture.jpg'];
  await assert.rejects(generate(post,adapter('Unsupported image input')),e=>{
   assert.equal(e.status,400);assert.equal(e.diagnostic.imageCount,1);assert.match(e.message,/图片 1 张/);return true;
  });
 }
 const d=sanitizeHTTPDiagnostic({error:{message:'Invalid request',code:secret,param:secret,type:'invalid_request_error',headers:{Authorization:secret},action:'send'}},{secrets:[secret]});
 assert.deepEqual(d,{message:'Invalid request',type:'invalid_request_error'});
 for(const status of [401,403,429,500])assert.equal(createAIError('http',status,{message:'untrusted'}).diagnostic,undefined);
});
