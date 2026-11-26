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

test('fallback keeps source language without a follow-back suffix for every relation',()=>{
 for(const [lang,text] of [['zh','你好，认识一下'],['en','Nice to meet you'],['ja','こんにちは、よろしくお願いします']]){
  for(const followsYou of [true,false,null])assert.equal(library.compose(text,followsYou,()=>0),library.rows[lang][0]);
 }
 assert.equal(library.appendFollowBack,undefined);
});
test('body language wins over usernames and foreign hashtags',()=>{
 assert.equal(library.pick('Nice to meet you here #蓝V互关',()=>0),library.rows.en[0]);
 assert.equal(library.pick('こんにちは、よろしくお願いします #newmutuals',()=>0),library.rows.ja[0]);
 assert.equal(library.pick('你好，很高兴认识你 #followback',()=>0),library.rows.zh[0]);
});
