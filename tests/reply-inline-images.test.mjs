import test from 'node:test';
import assert from 'node:assert/strict';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
import {generateReply,generateNotificationReply} from '../ai-client.mjs';
import {recoverGeneration} from '../ai-recovery.mjs';
import {inlineReplyImages,serializeVisionRequest,REPLY_IMAGE_MAX_BYTES,REPLY_BODY_MAX_BYTES} from '../reply-images.mjs';
import {withContext,fixtureImageBase64,fixtureImageResponse} from './reply-test-fixtures.mjs';

function fixture({image=()=>fixtureImageResponse(),complete}={}){
 const calls=[],post=withContext({id:'123',text:'这早餐怎么样？'});
 post.context.root.imageUrls=post.context.target.imageUrls=['https://pbs.twimg.com/media/Breakfast.jpg'];
 const adapter=(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'test-secret'})},resource:p=>'extension://'+p,fetcher:async(url,options)=>{
  calls.push({url,options});
  if(url.startsWith('extension:'))return{ok:true,text:async()=>'JSON rules'};
  if(url.startsWith('https://pbs.twimg.com/'))return image(url,options);
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  return complete?.(options)||{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"send_reply","text":"鸡蛋看着不错。"}'}}]})};
 }});
 return{post,calls,adapter,uploads:()=>calls.filter(c=>c.url.startsWith('https://api.deepseek.com/')),downloads:()=>calls.filter(c=>c.url.startsWith('https://pbs.twimg.com/'))};
}
test('both routes download the owned photo without credentials then send base64 in one completion request',async()=>{
 for(const generate of [generateReply,generateNotificationReply]){
  const f=fixture(),original=JSON.stringify(f.post);await generate(f.post,f.adapter);
  assert.equal(f.downloads().length,1);assert.equal(f.uploads().length,1);assert.equal(JSON.stringify(f.post),original);
  const d=f.downloads()[0];assert.equal(d.url,'https://pbs.twimg.com/media/Breakfast?format=jpg&name=large');
  assert.equal(d.options.credentials,'omit');assert.equal(d.options.redirect,'error');assert.equal(d.options.referrerPolicy,'no-referrer');assert.equal(d.options.headers,undefined);
  const u=f.uploads()[0],body=JSON.parse(u.options.body);assert.equal(u.options.headers.Authorization,'Bearer test-secret');
  const blocks=body.messages[1].content,images=blocks.filter(p=>p.type==='image_url');
  assert.deepEqual(images,[{type:'image_url',image_url:{url:'data:image/png;base64,'+fixtureImageBase64,detail:'auto'}}]);
  assert.deepEqual(JSON.parse(blocks[1].text),{image_of_post:'123',image_index:1});
  assert.equal(body.messages[0].role,'system');assert.equal(typeof body.messages[0].content,'string');
  assert.equal(d.options.signal,u.options.signal);assert.doesNotMatch(u.options.body,/test-secret/);
 }
});
test('a CDN failure skips only this generation, with no provider request or blind text fallback',async()=>{
 for(const generate of [generateReply,generateNotificationReply]){
  const f=fixture({image:()=>new Response('unavailable',{status:403})}),reports=[];
  const r=await recoverGeneration(()=>generate(f.post,f.adapter),{check:async()=>{},report:async r=>reports.push(r),sleep:async()=>{},binding:{postId:'123'}});
  assert.equal(r.skippedGenerationError,true);assert.equal(r.reasonCode,'image_read');assert.equal(f.uploads().length,0);assert.equal(f.downloads().length,1);assert.equal(reports.length,1);
 }
});
test('stop while reading an image prevents uploading any partial image or text',async()=>{
 const controller=new AbortController(),f=fixture({image:(_u,opts)=>{controller.abort();opts.signal.throwIfAborted();}});
 await assert.rejects(f.adapter('/reply',{body:JSON.stringify({text:f.post.text,context:f.post.context}),signal:controller.signal}),{name:'AbortError'});
 assert.equal(f.uploads().length,0);
});
test('HTML, empty and mismatched media never reach the model as a picture',async()=>{
 for(const [data,type] of [['<html>blocked</html>','text/html'],['<html>blocked</html>','image/png'],['','image/jpeg']]){
  const f=fixture({image:()=>new Response(data,{headers:{'content-type':type}})});
  await assert.rejects(generateReply(f.post,f.adapter),e=>['image_format','image_read'].includes(e.code));assert.equal(f.uploads().length,0);
 }
});
test('repeated URLs across different posts are read once but keep each post attribution',async()=>{
 const f=fixture();f.post.id='124';f.post.context.target={...f.post.context.target,id:'124',parentId:'123'};
 await generateReply(f.post,f.adapter);
 const blocks=JSON.parse(f.uploads()[0].options.body).messages[1].content;
 assert.equal(f.downloads().length,1);assert.equal(blocks.filter(p=>p.type==='image_url').length,2);
 assert.deepEqual([JSON.parse(blocks[1].text).image_of_post,JSON.parse(blocks[3].text).image_of_post],['123','124']);
});
test('pure text retains its original single request and string user content',async()=>{
 const f=fixture();delete f.post.context.root.imageUrls;delete f.post.context.target.imageUrls;
 await generateNotificationReply(f.post,f.adapter);assert.equal(f.downloads().length,0);assert.equal(f.uploads().length,1);
 assert.equal(typeof JSON.parse(f.uploads()[0].options.body).messages[1].content,'string');
});
test('32 MiB per-image limit is enforced on both declared and actual streamed size',async()=>{
 let cancelled=0;
 for(const declared of [true,false]){
  const f=fixture({image:()=>({ok:true,headers:new Headers({'content-type':'image/png',...(declared?{'content-length':String(REPLY_IMAGE_MAX_BYTES+1)}:{})}),body:new ReadableStream({start(c){if(!declared)c.enqueue(new Uint8Array(REPLY_IMAGE_MAX_BYTES+1));},cancel(){cancelled++;}})})});
  await assert.rejects(generateReply(f.post,f.adapter),{code:'image_limit'});assert.equal(f.uploads().length,0);
 }
 assert.equal(cancelled,2);
});
test('inline aggregate budget includes duplicate blocks and full-body check includes system text and UTF-8 bytes',async()=>{
 const bytes=new Uint8Array(19*1024*1024);bytes.set([137,80,78,71,13,10,26,10]);let reads=0;
 const part={type:'image_url',image_url:{url:'https://pbs.twimg.com/media/A.jpg',detail:'auto'}};
 await assert.rejects(inlineReplyImages([part,part],{fetcher:async()=>{reads++;return new Response(bytes,{headers:{'content-type':'image/png'}});}}),{code:'image_limit'});
 assert.equal(reads,1);assert.equal(part.image_url.url,'https://pbs.twimg.com/media/A.jpg');
 assert.throws(()=>serializeVisionRequest({messages:[{role:'system',content:'中'.repeat(Math.floor(REPLY_BODY_MAX_BYTES/3))}]}),{code:'image_limit'});
});
test('a later attachment failure cannot upload an incomplete collection',async()=>{
 const f=fixture({image:u=>u.includes('Second')?new Response('gone',{status:404}):fixtureImageResponse()});
 f.post.context.root.imageUrls=f.post.context.target.imageUrls=['https://pbs.twimg.com/media/First.jpg','https://pbs.twimg.com/media/Second.jpg'];
 await assert.rejects(generateNotificationReply(f.post,f.adapter),{code:'image_read'});
 assert.equal(f.downloads().length,2);assert.equal(f.uploads().length,0);
});
test('all supported image formats are byte-preserving, and arbitrary locations are never fetched',async()=>{
 for(const [type,header] of [['image/png','\x89PNG\r\n\x1a\n'],['image/jpeg','\xff\xd8\xff'],['image/webp','RIFFxxxxWEBP'],['image/gif','GIF89a']]){
  const bytes=Uint8Array.from(header,c=>c.charCodeAt(0)),parts=await inlineReplyImages([{type:'image_url',image_url:{url:'https://pbs.twimg.com/media/A.jpg'}}],{fetcher:async()=>new Response(bytes,{headers:{'content-type':type}})});
  assert.equal(parts[0].image_url.url,'data:'+type+';base64,'+btoa(header));
 }
 for(const url of ['https://evil.test/A.jpg','https://pbs.twimg.com/profile_images/A.jpg','file:///tmp/a.png','data:image/png;base64,AAAA','https://video.twimg.com/tweet_video/A.mp4']){
  await assert.rejects(inlineReplyImages([{type:'image_url',image_url:{url}}],{fetcher:()=>assert.fail('untrusted fetch')}),{code:'invalid_input'});
 }
});
test('redirects and raw downloader exceptions are bounded safe errors, with no key or URL leakage',async()=>{
 for(const image of [()=>({ok:true,redirected:true}),()=>{throw Error('secret=test-secret https://pbs.twimg.com/media/private.jpg');}]){
  const f=fixture({image});await assert.rejects(generateReply(f.post,f.adapter),e=>e.code==='image_read'&&!/test-secret|https:/.test(e.message));assert.equal(f.uploads().length,0);
 }
});
