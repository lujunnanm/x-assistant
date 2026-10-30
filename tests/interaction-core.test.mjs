import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../interaction-core.js',import.meta.url),'utf8');
const context={crypto:{getRandomValues:a=>{a[0]=0;return a;}}};context.globalThis=context;vm.runInNewContext(source,context);
const core=context.XAssistantCore;

test('interaction ratio is three unfollowed then one followed',()=>{
 assert.deepEqual([...core.pattern],['unfollowed','unfollowed','unfollowed','followed']);
 assert.deepEqual([0,1,2,3,4,5,6,7].map(core.desiredAuthorType),['unfollowed','unfollowed','unfollowed','followed','unfollowed','unfollowed','unfollowed','followed']);
 assert.equal(core.nextCycleIndex(3),0);
});

test('each random timer uses hundredth-second precision inside its inclusive range',()=>{
 assert.equal(core.randomSeconds(5,10,0),5);
 assert.equal(core.randomSeconds(5,10,0.999999),10);
 assert.equal(core.randomSeconds(5,20,0.5),12.5);
 assert.equal(core.randomSeconds(5,10,0.1234),5.61);
 assert.equal(core.formatSeconds(5),'5.00');
 assert.equal(core.formatSeconds(5.6),'5.60');
 assert.throws(()=>core.randomSeconds(10,5,0));
});

test('editor text preserves visual line breaks used by the X composer',()=>{
 assert.equal(core.editorText({innerText:'第一句\r\n尽快回关\n',textContent:'第一句尽快回关'}),'第一句\n尽快回关');
 assert.equal(core.editorText({textContent:'单行内容'}),'单行内容');
});
