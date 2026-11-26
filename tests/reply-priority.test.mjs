import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const NOW=Date.parse('2026-11-20T08:00:00Z'),HOUR=3600000;
function load(){
 const ctx=vm.createContext({});
 for(const file of ['interaction-core.js','notification-policy.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 return ctx.XAssistantNotificationPolicy;
}
const P=load();
const row=(id,over={})=>({id,author:'u'+id,text:'这是一条普通的评论内容',at:NOW-60000,addressed:true,directComment:true,ownThread:true,...over});
const order=(rows,ctx)=>Array.from(P.priorityFirst(rows,ctx),r=>r.id);
const ctx=(over={})=>({now:NOW,owner:'me',known:()=>undefined,parentAuthor:()=>null,...over});

test('without a context the original rule is unchanged: own-thread tiers first, newest first inside a tier',()=>{
 assert.deepEqual(order([row('mention',{directComment:false,ownThread:false,at:NOW-1}),row('direct-old',{at:NOW-3*HOUR}),row('own-new',{directComment:false,at:NOW-10}),row('direct-new',{at:NOW-HOUR})]),
  ['direct-new','direct-old','own-new','mention']);
 assert.deepEqual(order([{id:'nan',at:NaN},row('a')]),['a'],'rows without a timestamp are still dropped');
});

test('scores never cross a tier: a spammy direct comment still outranks a great reply deeper in the thread',()=>{
 const rows=[row('deep-question',{directComment:false,text:'这个具体怎么设置？'}),row('direct-spam',{text:'蓝v互关 真诚互关 回关必回',at:NOW-5*HOUR})];
 assert.deepEqual(order(rows,ctx()),['direct-spam','deep-question']);
});

test('a real question can overtake a slightly fresher remark, but not a much fresher one',()=>{
 const plain=row('plain',{at:NOW-60000}),ask=row('ask',{text:'这个到底怎么用，有教程吗？',at:NOW-3*HOUR});
 assert.deepEqual(order([plain,ask],ctx()),['ask','plain']);
 const stale=row('stale-ask',{text:'这个到底怎么用，有教程吗？',at:NOW-24*HOUR});
 assert.deepEqual(order([plain,stale],ctx()),['plain','stale-ask']);
});

test('someone answering one of our own replies is an open conversation and goes first',()=>{
 const rows=[row('fresh',{at:NOW-60000}),row('answer',{at:NOW-HOUR,directComment:true})];
 const parentAuthor=r=>r.id==='answer'?'me':null;
 assert.deepEqual(order(rows,ctx()),['fresh','answer']);
 assert.deepEqual(order(rows,ctx({parentAuthor})),['answer','fresh']);
 assert.equal(P.replyScore(rows[1],ctx({parentAuthor})).parts.continuation,16);
 assert.equal(P.replyScore(rows[1],ctx({parentAuthor:()=>'someone'})).parts.continuation,0);
});

test('one-word reactions go later, developed comments a little earlier, follow-for-follow posts last',()=>{
 const rows=[row('tiny',{text:'哈哈',at:NOW-1000}),row('spam',{text:'求关注 互关互粉 蓝v互动',at:NOW-500}),row('mid',{text:'这个功能挺有意思的',at:NOW-2000}),
  row('long',{text:'我昨天试了一下新版本，写代码确实比之前顺手很多，就是偶尔会编接口',at:NOW-3000})];
 assert.deepEqual(order(rows,ctx()),['long','mid','tiny','spam']);
 assert.ok(P.replyScore(rows[1],ctx()).parts.spam<0);
});

test('people we already talk to come earlier, and one prolific commenter cannot take every slot',()=>{
 const known=name=>({friend:{n:2,recent:0},flood:{n:6,recent:4},stranger:undefined}[name]);
 const rows=[row('s',{author:'stranger',at:NOW-1000}),row('f',{author:'friend',at:NOW-2000}),row('x',{author:'flood',at:NOW-500})];
 assert.deepEqual(order(rows,ctx({known})),['f','s','x']);
 assert.equal(P.replyScore(rows[2],ctx({known})).parts.fairness,-30,'the fairness cost is capped');
 assert.equal(P.replyScore(rows[2],ctx({known})).parts.familiar,18,'and so is the familiarity bonus');
});

test('ordering is deterministic and total: equal scores fall back to newest first, then to the original order',()=>{
 const same=['a','b','c'].map(id=>row(id,{at:NOW-1000}));
 assert.deepEqual(order(same,ctx()),['a','b','c']);
 assert.deepEqual(order([row('old',{at:NOW-2000}),row('new',{at:NOW-1000})],ctx()),['new','old']);
 const input=[row('1'),row('2')];const before=input.map(r=>r.id).join();order(input,ctx());
 assert.equal(input.map(r=>r.id).join(),before,'the caller\'s array is not reordered in place');
});

test('scoring tolerates a missing context, missing helpers and missing text',()=>{
 assert.ok(Number.isFinite(P.replyScore({id:'1',at:NOW-1000}).score));
 assert.ok(Number.isFinite(P.replyScore(row('1',{text:undefined}),{}).score));
 const bare=vm.createContext({});vm.runInContext(readFileSync(new URL('../notification-policy.js',import.meta.url),'utf8'),bare);
 assert.ok(Number.isFinite(bare.XAssistantNotificationPolicy.replyScore(row('1',{text:'蓝v互关'}),{now:NOW}).score),'works without the interaction helpers loaded');
});
