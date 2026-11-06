import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateReply,validatePost} from '../ai-client.mjs';
const reply=readFileSync(new URL('../bridge/reply-rules.txt',import.meta.url),'utf8'),interactionReply=readFileSync(new URL('../bridge/interaction-reply-rules.txt',import.meta.url),'utf8'),post=readFileSync(new URL('../bridge/post-rules.txt',import.meta.url),'utf8');
test('both rule sets specify actual substring restrictions before generation',()=>{
 for(const rules of [reply,post]){for(const word of ['我','本人','亲测','不是','不等于','与其','你以为'])assert.ok(rules.includes(word));assert.ok(rules.includes('按字面子串'));assert.ok(rules.includes('输出前自检'));assert.ok(rules.includes('不能把含禁用词的草稿返回'));}
});
test('interaction reply rules remove the content-value threshold',()=>{
 assert.ok(interactionReply.includes('主动互动不设内容价值门槛'));
 assert.ok(interactionReply.includes('普通问候、感谢、赞同、表情、寒暄和简单日常都要回复'));
 assert.ok(interactionReply.includes('选择 skip'));
 assert.ok(!interactionReply.includes('【价值门槛：不满足就 skip】'));
});
test('all provided reply examples pass real client validation',()=>{
 const examples=[...reply.matchAll(/输出：(\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]));assert.ok(examples.length>=7);
 for(const example of examples)assert.doesNotThrow(()=>validateReply(example,'123'));
});
test('post example passes actual body and weighted-length checks',()=>{
 const example=JSON.parse(post.match(/→ (\{[^\n]+\})/)[1]);
 assert.doesNotThrow(()=>validatePost(example,{id:'test',text:'#蓝v交友'}));
});

test('notification reply rules allow social filler without a content-value threshold',()=>{
 assert.ok(reply.includes('【回复范围：不设内容价值门槛】'));
 assert.ok(reply.includes('普通问候、感谢、赞同、夸奖、加油、表情、签到、寒暄、交友口号、简单日常都允许 send_reply'));
 assert.ok(!reply.includes('【价值门槛：不满足就 skip】'));
 for(const input of ['谢谢分享','来啦','Thanks for sharing!','ありがとうございます。']){
  const escaped=input.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');assert.match(reply,new RegExp(`输入：${escaped}\\n输出：\\{"action":"send_reply","text":"[^"]+"\\}`));
 }
});
