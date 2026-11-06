import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('all DOM action drivers use background-resilient render waits',async()=>{
 for(const name of ['reply-engine.js','overlay.js','notifications.js','posting.js','module-entry.js']){
  assert.match(await read(name),/waitForPage/,name);
 }
 assert.doesNotMatch(await read('scheduler.js'),/backgroundPaused|浏览器在后台，任务已安全暂停/);
});

test('late task-owned interaction composers recover without stopping the module',async()=>{
 const source=await read('overlay.js');
 assert.match(source,/recoverDelayedComposer/);
 assert.match(source,/cause\?\.cause\?\.code==='EDITOR_NOT_READY'/);
 assert.match(source,/updateRuntime\(\{phase:'waiting',error:null\}\)/);
});
