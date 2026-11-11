import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../interaction-fallback-library.js',import.meta.url),'utf8');
const context={Math};context.globalThis=context;vm.runInNewContext(source,context);
const library=context.XAssistantFallbackLibrary;

test('fallback reply library contains exactly 50 unique entries across three languages',()=>{
 assert.equal(library.size,50);
 assert.deepEqual(Object.fromEntries(Object.entries(library.rows).map(([key,value])=>[key,value.length])),{zh:30,en:10,ja:10});
 const all=Object.values(library.rows).flat();assert.equal(new Set(all).size,50);
});

test('fallback picker follows source language and appends the exact suffix only for non-followers',()=>{
 assert.equal(library.pick('蓝V来交朋友',()=>0),library.rows.zh[0]);
 assert.equal(library.pick('Looking for mutuals',()=>0),library.rows.en[0]);
 assert.equal(library.pick('相互フォロー募集',()=>0),library.rows.ja[0]);
 assert.equal(library.compose('蓝V来交朋友',true,()=>0),library.rows.zh[0]);
 assert.equal(library.compose('蓝V来交朋友',false,()=>0),'来打个招呼，认识一下，回关我交个朋友呀');
 assert.ok(!library.compose('蓝V来交朋友',null,()=>0).includes(library.suffix));
 assert.equal(library.appendFollowBack('这条内容挺有意思。'),'这条内容挺有意思，回关我交个朋友呀');
 assert.equal(library.appendFollowBack('已经写好，回关我交个朋友呀'),'已经写好，回关我交个朋友呀');
 assert.ok([...library.appendFollowBack('字'.repeat(180))].length<=130);
});

test('normal and fallback replies append language-matched friendship tails',()=>{
 for(const [lang,text] of [['zh','你好，认识一下'],['en','Nice to meet you'],['ja','こんにちは、よろしくお願いします']]){
  const result=library.appendFollowBack(text);
  assert.ok(result.endsWith(library.suffixes[lang]));
  assert.equal(library.appendFollowBack(result),result);
  assert.ok(library.compose(text,false,()=>0).endsWith(library.suffixes[lang]));
  assert.ok(!library.compose(text,true,()=>0).endsWith(library.suffixes[lang]));
  assert.ok(!library.compose(text,null,()=>0).endsWith(library.suffixes[lang]));
  assert.ok([...library.appendFollowBack(text.repeat(50))].length<=130);
 }
 assert.ok(!library.appendFollowBack('Nice to meet you').includes(library.suffix));
 assert.ok(!library.appendFollowBack('こんにちは').includes(library.suffix));
});
test('body language wins over usernames and foreign hashtags',()=>{
 assert.equal(library.pick('Nice to meet you here #蓝V互关',()=>0),library.rows.en[0]);
 assert.equal(library.pick('こんにちは、よろしくお願いします #newmutuals',()=>0),library.rows.ja[0]);
 assert.equal(library.pick('你好，很高兴认识你 #followback',()=>0),library.rows.zh[0]);
});
