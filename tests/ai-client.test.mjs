import test from 'node:test';import assert from 'node:assert/strict';import {validateReply,generateReply,generateTimelineRewrite,validateTimelineRewrite} from '../ai-client.mjs';
test('AI output only permits bound reply or skip',()=>{assert.equal(validateReply({action:'send_reply',text:'可以从短篇读起。'},'123').postId,'123');assert.equal(validateReply({action:'skip'},'123').action,'skip');for(const v of [{action:'delete',text:'x'},{action:'send_reply',text:''},{action:'send_reply',text:'我最近在读一本书'},{action:'send_reply',text:'http://evil.test'}])assert.throws(()=>validateReply(v,'123'));});
test('direct-adapter request only sends post text; invalid and failed output cannot send',async()=>{let body;const result=await generateReply({id:'123',text:'读书推荐'},async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({action:'send_reply',text:'试试短篇小说。'})};});assert.deepEqual(body,{text:'读书推荐'});assert.equal(result.postId,'123');await assert.rejects(generateReply({id:'bad',text:'x'}));await assert.rejects(generateReply({id:'123',text:'x'},async()=>({ok:false,status:401})));});
test('proactive AI may choose skip while unknown actions remain invalid',async()=>{
 const skipped=await generateReply({id:'123',text:'普通交友帖'},async()=>({ok:true,json:async()=>({action:'skip',text:''})}));
 assert.deepEqual(skipped,{action:'skip',text:'',postId:'123',skipReason:'model_choice'});
 await assert.rejects(generateReply({id:'123',text:'普通交友帖'},async()=>({ok:true,json:async()=>({action:'relationship_reply',text:''})})));
});
test('raw provider error bodies are not exposed and invalid JSON gets format classification',async()=>{
 await assert.rejects(generateReply({id:'123',text:'内容'},async()=>({ok:false,status:500,json:async()=>({error:'secret text'})})),e=>e.code==='http'&&e.status===500&&!e.message.includes('secret'));
 await assert.rejects(generateReply({id:'123',text:'内容'},async()=>({ok:true,json:async()=>{throw Error('untrusted raw payload');}})),e=>e.code==='format');
});
test('reply weighted bound blocks Chinese overflow before the public sender',()=>{
 assert.throws(()=>validateReply({action:'send_reply',text:'字'.repeat(141)},'123'),e=>e.code==='content_length');
 assert.doesNotThrow(()=>validateReply({action:'send_reply',text:'a'.repeat(180)},'123'));
});
test('unknown commands and footer-only content never produce send instructions',()=>{
 for(const v of [{action:'follow',text:'hello'},{action:'send_reply',text:'交个朋友呀\n请回关我'},{action:'send_reply',text:'尽快回关'}])assert.throws(()=>validateReply(v,'123'));
});
test('replies strip legacy footers without appending promotional text',()=>{
 for(const body of ['可以从短篇读起。','可以从短篇读起。\n关注我交个朋友呀','可以从短篇读起。\n交个朋友呀\n请回关我'])assert.equal(validateReply({action:'send_reply',text:body},'123').text,'可以从短篇读起。');
});
test('timeline rewrite sends only source text and accepts a distinct complete copy',async()=>{
 let body;const post={id:'123',text:'原帖正文'};
 const result=await generateTimelineRewrite(post,async(url,opts)=>{body={url,json:JSON.parse(opts.body)};return{ok:true,json:async()=>({action:'save_copy',text:'重新组织后的正文'})};});
 assert.deepEqual(body,{url:'/timeline-rewrite',json:{text:'原帖正文'}});
 assert.deepEqual(result,{action:'save_copy',text:'重新组织后的正文',postId:'123'});
});
test('comment rewrite sends the comment and root post to the dedicated fusion route',async()=>{
 let body;const post={id:'123',text:'评论观点',rootPost:{id:'100',text:'所属帖子观点'}};
 const result=await generateTimelineRewrite(post,async(url,opts)=>{body={url,json:JSON.parse(opts.body)};return{ok:true,json:async()=>({action:'save_copy',text:'融合后的新观点'})};});
 assert.deepEqual(body,{url:'/comment-rewrite',json:{text:'评论观点',rootText:'所属帖子观点'}});
 assert.deepEqual(result,{action:'save_copy',text:'融合后的新观点',postId:'123'});
});
test('timeline rewrite output is normalized to one sentence per line',()=>{
 assert.equal(validateTimelineRewrite({action:'save_copy',text:'第一句。第二句！\n\n第三句？'},{id:'123',text:'原帖正文'}).text,'第一句。\n第二句！\n第三句？');
});
test('only reaction and verification drafts get blank lines; missing or unknown styles use standard layout',()=>{
 const post={id:'123',text:'原帖正文'},text='第一句。第二句！\n\n第三句？';
 for(const style of ['reaction','verify'])assert.deepEqual(validateTimelineRewrite({action:'save_copy',text,style},post),{action:'save_copy',postId:'123',text:'第一句。\n\n第二句！\n\n第三句？',style});
 for(const style of [undefined,'standard','unknown',{mode:'reaction'}])assert.deepEqual(validateTimelineRewrite({action:'save_copy',text,style},post),{action:'save_copy',postId:'123',text:'第一句。\n第二句！\n第三句？'});
});
test('timeline rewrite never accepts skip, unchanged, empty or oversized output',()=>{
 const post={id:'123',text:'原帖正文'};
 for(const value of [{action:'skip',text:''},{action:'save_copy',text:'原帖正文'},{action:'save_copy',text:'原 帖，正文！'},{action:'save_copy',text:'  '},{action:'save_copy',text:'字'.repeat(10001)}])assert.throws(()=>validateTimelineRewrite(value,post));
});
test('timeline rewrite rejects editor-added fact-check transitions and retries once',async()=>{
 const post={id:'123',text:'原文在追问这件事有没有答案。'};
 for(const text of ['先把事实和猜疑分开。','先说结论，这事没有答案。','需要注意的是，这只是传闻。','目前仍然没有明确定论。']){
  assert.throws(()=>validateTimelineRewrite({action:'save_copy',text},post),e=>e.code==='rewrite_editorialized');
 }
 const calls=[];
 const result=await generateTimelineRewrite(post,async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,json:async()=>calls.length===1?{action:'save_copy',text:'先把事实和猜疑分开。'}:{action:'save_copy',text:'这事到底有没有答案？'}};
 });
 assert.equal(result.text,'这事到底有没有答案？');
 assert.deepEqual(calls.map(c=>c.opts.rewriteRetry),[false,true]);
});
test('rewrite rejects added inference framing that turns statements into questions',()=>{
 const post={id:'123',text:'美女大举考公进入体制内。',rootPost:{id:'100',text:'美女流向最多的行业，往往是当下最红火的行业。'}};
 for(const text of [
  '按这个说法看，现在美女大举考公进入体制内，是不是说明这个行业最红火？',
  '照这个逻辑来看，现在美女大举考公进入体制内，是否意味着这个行业最红火？'
 ])assert.throws(()=>validateTimelineRewrite({action:'save_copy',text},post),e=>e.code==='rewrite_editorialized');
 assert.doesNotThrow(()=>validateTimelineRewrite({action:'save_copy',text:'美女流向哪个行业，哪个行业往往就是当下最红火的行业。\n现在美女大举考公进入体制内，看来这个行业确实红火。'},post));
});
test('comment fusion cannot return either input unchanged',async()=>{
 const post={id:'123',text:'评论观点',rootPost:{id:'100',text:'所属帖子观点'}};
 for(const text of [post.text,post.rootPost.text])assert.throws(()=>validateTimelineRewrite({action:'save_copy',text},post));
 await assert.rejects(generateTimelineRewrite({id:'123',text:'评论',rootPost:{id:'123',text:'所属帖子'}}));
});
test('timeline rewrite makes one corrective retry on malformed, skipped or unchanged output',async()=>{
 const post={id:'123',text:'原帖正文',rootPost:{id:'100',text:'所属帖子观点'}};
 for(const value of [{action:'send_reply',text:'无效动作'},{action:'skip',text:''},{action:'save_copy',text:'  '},{action:'save_copy',text:post.text},{action:'save_copy',text:post.rootPost.text}]){
  const calls=[];
  const result=await generateTimelineRewrite(post,async(url,opts)=>{
   calls.push({url,opts});
   return {ok:true,json:async()=>calls.length===1?value:{action:'save_copy',text:'这是融合后的观点。'}};
  });
  assert.equal(result.text,'这是融合后的观点。');
  assert.deepEqual(calls.map(c=>c.opts.rewriteRetry),[false,true]);
  assert.deepEqual(calls.map(c=>JSON.parse(c.opts.body)),[0,1].map(()=>({text:post.text,rootText:post.rootPost.text})));
 }
});
test('persistent rewrite failures expose the exact classification and never accept an unchanged or empty draft',async()=>{
 const post={id:'123',text:'评论原文',rootPost:{id:'100',text:'所属原帖'}};
 for(const [value,code] of [
  [null,'rewrite_format'],[{action:'skip',text:''},'rewrite_skipped'],
  [{action:'save_copy',text:'评论，原文！'},'rewrite_unchanged'],[{action:'save_copy',text:post.rootPost.text},'rewrite_root_only']
 ]){
  let calls=0;
  await assert.rejects(generateTimelineRewrite(post,async()=>{calls++;return{ok:true,json:async()=>{if(value===null)throw Error('raw');return value;}};}),{code});
  assert.equal(calls,2);
 }
 let calls=0;
 await assert.rejects(generateTimelineRewrite(post,async()=>{calls++;return{ok:false,status:401};}),{code:'http',status:401});
 assert.equal(calls,1);
});
