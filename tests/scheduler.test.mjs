import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../scheduler-core.js',import.meta.url),'utf8'),ctx);const C=ctx.XAssistantSchedulerCore;
const post={busy:false,nextAt:99999999};
test('interaction has no hourly rest; notifications run every ten minutes',()=>{
 let s=C.fresh(0);assert.equal(C.choose(s,599999,post),'interaction');assert.equal(C.choose(s,600000,post),'notifications');
 s=C.finishReplies(s,620000);assert.equal(s.nextReplyAt,1220000);assert.equal(C.choose(s,1219999,post),'interaction');
 for(let i=0;i<20;i++){s=C.tick(s,s.nextReplyAt);assert.equal(C.choose(s,s.nextReplyAt,post),'notifications');s=C.finishReplies(s,s.nextReplyAt+1000);}
});
test('posting always wins and overdue reply check resumes afterwards',()=>{
 const s=C.fresh(0);assert.equal(C.choose(s,600000,{busy:true,nextAt:9999999}),'posting');
 assert.equal(C.choose(s,600000,{busy:false,nextAt:620000}),'posting');
 assert.equal(C.choose(s,600000,post),'notifications');assert.equal(C.replyDeadline(s,{nextAt:900000}),870000);
});
test('legacy rest state migrates without preserving hourly rest',()=>{
 const s=C.tick({mode:'replies',restUntil:99999999},1000);assert.equal(s.mode,'interaction');assert.equal(s.nextReplyAt,601000);
});
test('automatic follow never changes notification schedule',()=>{
 const s=C.fresh(0);for(const enabled of [true,false]){
  const next=C.setFollowMode(s,enabled,900000);assert.equal(next.nextReplyAt,600000);assert.equal(C.choose(next,900000,post),'notifications');
 }
});
