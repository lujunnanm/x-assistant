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
 assert.equal(core.editorText({innerText:'第一句\r\n交个朋友呀\n',textContent:'第一句交个朋友呀'}),'第一句\n交个朋友呀');
 assert.equal(core.editorText({textContent:'单行内容'}),'单行内容');
});

test('Draft editor block reading preserves a blank line without innerText extra newline',()=>{
 const node={innerText:'正文\n\n\n#话题',querySelectorAll:()=>[{textContent:'正文'},{textContent:''},{textContent:'#话题'}]};
 assert.equal(core.editorText(node),'正文\n\n#话题');
 assert.notEqual(core.editorText(node),'正文\n#话题');
});

test('automatic following defaults on and honors persisted false',()=>{
 assert.equal(core.autoFollowEnabled(undefined),true);
 assert.equal(core.autoFollowEnabled(true),true);
 assert.equal(core.autoFollowEnabled(false),false);
});

test('disabled following accepts only posts strictly above 5000 views',()=>{
 assert.equal(core.highExposure(5001),true);
 assert.equal(core.highExposure(5000),false);
 assert.equal(core.highExposure(4999),false);
 assert.equal(core.highExposure(null),false);
});
