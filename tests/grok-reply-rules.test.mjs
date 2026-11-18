import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateReply,validateReply} from '../ai-client.mjs';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rules=read('bridge/reply-rules.txt');
const includesAll=phrases=>{for(const phrase of phrases)assert.ok(rules.includes(phrase),phrase);};
// These verify prompt contracts and mock transport, not actual model agreement or humor.
test('Grok answer behavior is shared and tied to actual target author rather than mentions or display names',()=>{
 assert.equal(rules,read('bridge/interaction-reply-rules.txt'));
 includesAll(['只有 reply_target.author 确认为 grok（不区分大小写）','看的是实际目标作者','不看显示名','author 缺失或不是 grok 时按普通回复处理','别人引用 grok，都不触发本分支']);
});
test('agreeing with Grok permits very short language-aware reactions without explanations or mandatory tails',()=>{
 includesAll(['认同 grok 的核心回答','“666”“卧槽”“哈哈”','也可以只用一个表情符号','不固定轮换','不补解释、不复述它的答案、不加尾句','文字跟随目标回答的主要语言','纯数字或单个表情无需为了凑语言再加字']);
});
test('disagreeing permits mild AI-directed teasing without invented factual errors or jokes about victims',()=>{
 includesAll(['稍微调侃一下这个 AI 或这次回答','“这傻 AI，又绕进去了”“呆逼，这也能绕偏”','不升级成长篇辩论或说教','不顺带攻击提问的人','只是观点不同，不把它硬说成事实错误','不假装赞同或看出了错误','不把玩笑用到真实伤亡、受害者']);
});
test('questions addressed to Grok remain distinct from its answers and only that answer branch permits emoji',()=>{
 includesAll(['别人向 @grok 提问仍然跳过，不抢答','grok 已经作出的回答不因正文提到 @grok 就跳过','目标作者不是 grok，且目标评论只是在 @grok 提问','普通回复不加 emoji；确认回复 grok 的回答时可以只用一个表情符号']);
});
test('short text, numbers, emoji and teasing survive both existing adapters and protocol checks',async()=>{
 for(const notification of [false,true])for(const text of ['666','卧槽','哈哈','😂','这傻 AI，又绕进去了。','呆逼，这也能绕偏。']){
  const root={id:'1',author:'reader',text:'请分析这段代码。',parentId:null};
  const target={id:'2',author:'GrOk',text:'这里有一处循环条件写错了。',parentId:'1'};
  const post={id:'2',account:'/Me',text:target.text,context:{version:1,root,history:[],target}};
  let payload,requests=0;
  const result=await generateReply(post,(url,options)=>directGenerate(url,options,{
   storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-key'})},resource:p=>'extension://'+p,
   fetcher:async(u,o)=>{
    if(u.startsWith('extension://'))return {ok:true,text:async()=>read(u.slice('extension://'.length))};
    assert.equal(u,'https://api.deepseek.com/chat/completions');requests++;payload=JSON.parse(o.body);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text})}}]})};
   }
  }),notification);
  const input=JSON.parse(payload.messages[1].content);
  assert.equal(input.current_account,'me');assert.equal(input.reply_target.author,'grok');assert.equal(input.original_post.author,'reader');
  assert.equal(requests,1);assert.equal(result.text,text);assert.ok(payload.messages[0].content.startsWith(rules));
  if(notification)assert.match(payload.messages[0].content.slice(rules.length),/目标作者不是 grok 且只是在问 @grok/);
  assert.doesNotThrow(()=>validateReply({action:'send_reply',text},'2'));
 }
});
