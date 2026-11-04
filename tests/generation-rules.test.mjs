import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateReply,validatePost} from '../ai-client.mjs';
const reply=readFileSync(new URL('../bridge/reply-rules.txt',import.meta.url),'utf8'),interactionReply=readFileSync(new URL('../bridge/interaction-reply-rules.txt',import.meta.url),'utf8'),post=readFileSync(new URL('../bridge/post-rules.txt',import.meta.url),'utf8');
test('both rule sets specify actual substring restrictions before generation',()=>{
 for(const rules of [reply,post]){for(const word of ['我','本人','亲测','不是','不等于','与其','你以为'])assert.ok(rules.includes(word));assert.ok(rules.includes('按字面子串'));assert.ok(rules.includes('输出前自检'));assert.ok(rules.includes('不能把含禁用词的草稿返回'));}
});
test('interaction reply rules never skip and use a social fallback for low-information posts',()=>{
 assert.ok(interactionReply.includes('主动互动不跳过任何已入选帖子'));
 assert.ok(interactionReply.includes('来交个朋友，方便的话回关一下'));
 assert.ok(!interactionReply.includes('{"action":"skip"'));
});
test('all provided reply examples pass real client validation',()=>{
 const examples=[...reply.matchAll(/输出：(\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]));assert.ok(examples.length>=7);
 for(const example of examples)assert.doesNotThrow(()=>validateReply(example,'123'));
});
test('post example passes actual body and weighted-length checks',()=>{
 const example=JSON.parse(post.match(/→ (\{[^\n]+\})/)[1]);
 assert.doesNotThrow(()=>validatePost(example,{id:'test',text:'#蓝v交友'}));
});

test('notification reply rules require concrete value and skip social filler',()=>{
 for(const phrase of ['价值门槛','单纯问候、感谢、赞同、夸奖','通知回帖同样执行此门槛','不能增加信息、帮助或具体讨论价值'])assert.ok(reply.includes(phrase));
 for(const input of ['谢谢分享','来啦','Thanks for sharing!','ありがとうございます。']){
  const escaped=input.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');assert.match(reply,new RegExp(`输入：${escaped}\\n输出：\\{"action":"skip","text":""\\}`));
 }
});
