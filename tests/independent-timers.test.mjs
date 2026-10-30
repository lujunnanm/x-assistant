import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const overlay=await readFile(new URL('../overlay.js',import.meta.url),'utf8');
const posting=await readFile(new URL('../posting.js',import.meta.url),'utf8');
test('interaction status belongs to interaction section and never uses generic first status',()=>{
 assert.match(overlay,/<section data-module="interaction">[\s\S]*?data-status="interaction"[\s\S]*?<\/section>/);
 assert.doesNotMatch(overlay,/\$\('\.status'\)/);
 assert.match(posting,/output\.dataset\.status='posting'/);
});
test('interleaved countdown updates do not overwrite the other module',()=>{
 const interaction={textContent:''},post={textContent:''};
 const status=overlay.match(/const status=(t=>[^;]+);/)[1];
 const show=posting.match(/const show=(t=>[^;]+);/)[1];
 const ctx=vm.createContext({$:selector=>{assert.equal(selector,'[data-status="interaction"]');return interaction;},output:post,setProgress:()=>{},progress:()=>{}});
 vm.runInContext(`const status=${status};const show=${show};status('互动剩余 8.0 秒');show('发帖剩余 800.0 秒');`,ctx);
 assert.equal(interaction.textContent,'互动剩余 8.0 秒');assert.equal(post.textContent,'发帖剩余 800.0 秒');
 vm.runInContext("status('互动已结束');",ctx);assert.equal(post.textContent,'发帖剩余 800.0 秒');
 vm.runInContext("show('发帖已结束');",ctx);assert.equal(interaction.textContent,'互动已结束');
});
