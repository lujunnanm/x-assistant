import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../interaction-core.js',import.meta.url),'utf8');
const context={URL,crypto:{getRandomValues:a=>{a[0]=0;return a;}}};context.globalThis=context;vm.runInNewContext(source,context);
const core=context.XAssistantCore;

test('interaction no longer exposes a followed/unfollowed rotation policy',()=>{
 assert.equal(core.pattern,undefined);
 assert.equal(core.desiredAuthorType,undefined);
 assert.equal(core.nextCycleIndex,undefined);
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

test('interaction accepts only friendship posts with at least 500 views',()=>{
 for(const text of ['#蓝v交友 来认识一下','想认识一些新朋友','交个朋友','Looking for new friends!','Let\'s connect #mutuals','友達募集']){
  assert.equal(core.friendshipRelated(text),true,text);
  assert.equal(core.friendshipCandidate(text,500),true,text);
 }
 for(const text of ['今天和朋友吃饭','科技新闻更新','普通生活记录',''])assert.equal(core.friendshipRelated(text),false,text);
 assert.equal(core.friendshipCandidate('#蓝V互动',499),false);
 assert.equal(core.friendshipCandidate('#蓝V互动',null),false);
 assert.equal(core.friendshipCandidate('普通帖子',50000),false);
});

test('interaction supports home and top/latest post searches, not people or media tabs',()=>{
 for(const p of ['/home','/search?q=交友','/search?q=test&f=top','/search?q=test&f=live'])assert.equal(core.interactionPage(p),true);
 for(const p of ['/search','/search?q=test&f=user','/search?q=test&f=image','/notifications','https://evil.example/home'])assert.equal(core.interactionPage(p),false);
});

test('fixed remaining cooldown preserves fractional milliseconds without invalid range',()=>{
 for(const value of [0,0.001,3.141,12.349,29.999,45.001])assert.equal(core.randomSeconds(value,value),value);
 assert.throws(()=>core.randomSeconds(-0.001,-0.001));
 assert.throws(()=>core.randomSeconds(NaN,NaN));
});

test('localized view parser survives deletion of obsolete cleanup module',()=>{for(const [value,count] of [['49 views. View post analytics',49],['1.2K views',1200],['2.5万 次查看',25000],['1,234 views',1234]])assert.equal(core.parseViews(value),count);assert.equal(core.parseViews('no count'),null);});
