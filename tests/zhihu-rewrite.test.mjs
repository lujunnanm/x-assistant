import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateZhihuSource,appendZhihuRewrite,zhihuRewriteSourceId,validateZhihuRewriteImages} from '../zhihu-copy.mjs';
import {generateZhihuRewrite} from '../ai-client.mjs';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
const source={id:'123',questionId:'456',url:'https://www.zhihu.com/question/456/answer/123',question:'如何学习编程？',text:'每天选一个小项目，坚持完成。'};
test('Zhihu canonical identity and bounded full source',()=>{
 assert.deepEqual(validateZhihuSource(source),source);
 for(const patch of [{id:123},{id:'124'},{url:source.url+'?x=1'},{url:'https://evil.test/question/456/answer/123'},{question:''},{text:''},{text:'x'.repeat(60001)}])assert.throws(()=>validateZhihuSource({...source,...patch}));
 assert.equal(validateZhihuSource({...source,text:'x'.repeat(60000)}).text.length,60000);
});
test('library uses separate namespace, retains source, formats and deduplicates edited rows',()=>{
 const result=appendZhihuRewrite({revision:3,rows:[{id:'timeline_ai_123',text:'X 原有稿',enabled:true}]},source,{text:'学编程先把项目做完。每天动手比收藏教程更重要。'});
 assert.equal(result.library.revision,4);assert.equal(result.row.id,'zhihu_ai_123');assert.equal(result.row.enabled,true);
 assert.match(result.row.text,/。\n每天/);assert.deepEqual(result.row.sourceUrls,[source.url,'https://www.zhihu.com/question/456']);
 result.row.id='edited';result.row.enabled=false;
 assert.equal(zhihuRewriteSourceId(result.row),'123');assert.equal(appendZhihuRewrite(result.library,source,{text:'另一个稿'}).added,false);
 for(const text of ['',source.text,source.question])assert.throws(()=>appendZhihuRewrite(null,source,{text}));
});
test('question and answer go through dedicated rewrite route; malformed output retries once',async()=>{
 const calls=[];
 const result=await generateZhihuRewrite(source,async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>calls.length===1?{action:'save_copy',text:source.question,imageIndexes:[]}:{action:'save_copy',text:'学编程别只收藏教程，先动手完成一个项目。',imageIndexes:[]}};});
 assert.equal(calls.length,2);assert.equal(calls[0].url,'/zhihu-rewrite');assert.equal(calls[1].opts.rewriteRetry,true);
 assert.deepEqual(JSON.parse(calls[0].opts.body),{text:source.text,questionText:source.question,imageUrls:[]});assert.match(result.text,/完成一个项目/);assert.deepEqual(result.imageIndexes,[]);
});
test('dedicated provider prompt sends question as background, answer as substance, never as system instructions',async()=>{
 const calls=[];
 await directGenerate('/zhihu-rewrite',{body:JSON.stringify({text:source.text,questionText:source.question})},{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-key'})},resource:p=>'extension://'+p,fetcher:async(url,opts)=>{
  calls.push({url,opts});if(url.startsWith('extension:'))return {ok:true,text:async()=>readFileSync(new URL('../bridge/zhihu-rewrite-rules.txt',import.meta.url),'utf8')};
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'save_copy',text:'新写法',style:'standard',image_indexes:[]})}}]})};
 }});
 assert.equal(calls[0].url,'extension://bridge/zhihu-rewrite-rules.txt');const payload=JSON.parse(calls[1].opts.body);
 assert.equal(payload.max_tokens,8192);assert.deepEqual(JSON.parse(payload.messages[1].content),{question_text:source.question,answer_text:source.text,image_count:0});
 assert.match(payload.messages[0].content,/不把答主的亲历冒充/);assert.match(payload.messages[0].content,/问题里的预设不等于事实/);assert.match(payload.messages[0].content,/UC 编辑部/);
 assert.doesNotMatch(payload.messages[0].content,/【风格分流】|通常 3–6 句|三四句能讲完整/);
});
test('Zhihu injects only collector scripts, all packaged assets exist',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
 const group=manifest.content_scripts.find(g=>g.matches.includes('https://www.zhihu.com/*'));
 assert.deepEqual(group.js,['runtime-client.js','zhihu-dom.js','zhihu-copy.js']);
 for(const file of [...group.js,...group.css])assert.ok(readFileSync(new URL('../'+file,import.meta.url)).length);
});

test('Zhihu editorial prompt preserves substance rather than demanding a short summary',()=>{
 const rules=readFileSync(new URL('../bridge/zhihu-rewrite-rules.txt',import.meta.url),'utf8');
 for(const phrase of ['悬念必须在正文兑现','主要内容逐项保留','70%–100%','信息完整优先','10000 字符','每句话单独一行','句间不留空行','style 固定为 standard','不杜撰转折','按正文出现顺序选择最多 4 张','没有必要保留图片时 image_indexes 必须是 []'])assert.ok(rules.includes(phrase),phrase);
 assert.doesNotMatch(rules,/通常 3–6 句|先提炼最值得表达的一点/);
});
test('Zhihu retry retains editorial style and content, X rewrite keeps original routing and budget',async()=>{
 for(const route of ['zhihu-rewrite','timeline-rewrite','comment-rewrite']){
  let payload;
  await directGenerate('/'+route,{rewriteRetry:true,body:JSON.stringify({text:source.text,questionText:source.question,rootText:'原帖观点'})},{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-key'})},resource:p=>'extension://'+p,fetcher:async(url,opts)=>{
   if(url.startsWith('extension:'))return {ok:true,text:async()=> 'fixture rules'};
   payload=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"save_copy","text":"改写内容","style":"standard","image_indexes":[]}'}}]})};
  }});
  if(route==='zhihu-rewrite'){
   assert.equal(payload.max_tokens,8192);assert.match(payload.messages[0].content,/保留回答的主要论点、关键案例和数字/);assert.match(payload.messages[0].content,/style 固定 standard/);assert.doesNotMatch(payload.messages[0].content,/【风格分流】/);
  }else{assert.equal(payload.max_tokens,4096);assert.match(payload.messages[0].content,/【风格分流】/);assert.doesNotMatch(payload.messages[0].content,/UC 编辑部/);}
 }
});
test('Zhihu image selection is ordered, unique, bounded and attached atomically',()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==';
 const withImages={...source,imageUrls:['https://picx.zhimg.com/v2-a.jpg','https://pic1.zhimg.com/v2-b.png','https://pica.zhimg.com/v2-c.webp']};
 assert.deepEqual(validateZhihuSource(withImages).imageUrls,withImages.imageUrls);
 assert.deepEqual(validateZhihuRewriteImages({imageIndexes:[1,3]},3),[1,3]);
 for(const indexes of [[0],[4],[1,1],[1,2,3,1],[1,2,3,4,5],['1']])assert.throws(()=>validateZhihuRewriteImages({imageIndexes:indexes},3));
 const result=appendZhihuRewrite(null,withImages,{text:'重新组织后的完整观点。',style:'standard',imageIndexes:[1,3]},undefined,[image,image]);
 assert.equal(result.row.images.length,2);assert.throws(()=>appendZhihuRewrite(null,withImages,{text:'重新组织后的完整观点。',imageIndexes:[1]},undefined,[]));
});
