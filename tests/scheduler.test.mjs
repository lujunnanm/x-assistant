import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../scheduler-core.js',import.meta.url),'utf8');
const c=vm.createContext({});vm.runInContext(source,c);const C=c.XAssistantSchedulerCore;
test('60 actual work minutes then 30 wall-clock rest minutes, repeated',()=>{
 let s=C.fresh(0),now=0;
 for(let cycle=0;cycle<3;cycle++){
  for(let i=0;i<7200;i++){now+=500;s=C.tick(s,now,true);}
  assert.equal(s.mode,'replies');assert.equal(s.restUntil,now+C.REST);
  now+=C.REST-1;s=C.tick(s,now,false);assert.equal(s.mode,'replies');
  now++;s=C.tick(s,now,false);assert.equal(s.mode,'interaction');assert.equal(s.workMs,0);assert.equal(s.repliesDone,false);
 }
});
test('posting suspension and computer sleep do not consume the working hour',()=>{
 let s=C.fresh(0);s=C.tick(s,500,true);s=C.tick(s,100500,false);assert.equal(s.workMs,500);
 s=C.tick(s,5000000,true);assert.equal(s.workMs,2500);
});
test('posting wins at the 30 second boundary; reply resumes only inside rest window',()=>{
 const s={...C.fresh(0),mode:'replies',restUntil:300000};
 assert.equal(C.choose(s,69999,{nextAt:100000,busy:false}),'notifications');
 assert.equal(C.choose(s,70000,{nextAt:100000,busy:false}),'posting');
 assert.equal(C.choose(s,100000,{nextAt:500000,busy:true}),'posting');
 assert.equal(C.choose(s,110000,{nextAt:500000,busy:false}),'notifications');
 assert.equal(C.replyDeadline(s,{nextAt:500000}),270000);
 assert.equal(C.choose(s,270000,{nextAt:500000,busy:false}),'waiting');
});
test('exhausted reply batch stays idle for the rest of the window, no five-minute poll',()=>{
 const s={...C.fresh(0),mode:'replies',restUntil:1800000,repliesDone:true};
 for(const t of [0,300000,600000,1200000,1799999])assert.equal(C.choose(s,t,{nextAt:9999999,busy:false}),'waiting');
 assert.equal(C.tick(s,1800000,false).mode,'interaction');
});
test('a reply cutoff always reserves 30 seconds before either next module',()=>{
 const s={mode:'replies',restUntil:200000};
 assert.equal(C.replyDeadline(s,{nextAt:150000}),120000);
 assert.equal(C.replyDeadline(s,{nextAt:250000}),170000);
});
