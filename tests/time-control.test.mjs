import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../time-policy.js';
import {confirmSchedule,restoreSchedule,scheduledStart} from '../posting-schedule.mjs';
const T=globalThis.XAssistantTimePolicy;
test('all timing defaults and bounds share one schema',()=>{
 const config=T.normalize();assert.equal(Object.keys(config).length,8);
 assert.deepEqual(config.posting,{min:1200,max:1800});assert.deepEqual(config.interaction,{min:20,max:30});
 for(const [name,f] of Object.entries(T.fields)){
  assert.equal(T.milliseconds(config,name,()=>0),f.min*1000);
  assert.ok(T.milliseconds(config,name,()=>.999999)<=f.max*1000);
  assert.throws(()=>T.normalize({...config,[name]:{min:f.floor-1,max:f.max}}));
  assert.throws(()=>T.normalize({...config,[name]:{min:f.min,max:f.ceiling+1}}));
 }
});
test('invalid ranges, strings, fractions, unknown fields and bad random values cannot save',()=>{
 for(const value of [null,[],{unknown:{min:1,max:1}},{posting:{min:5,max:4}},{posting:{min:'20',max:30}},{posting:{min:1.5,max:30}},{notifications:{min:30,max:40}}])assert.throws(()=>T.normalize(value));
 for(const value of [-1,1,NaN,Infinity])assert.throws(()=>T.milliseconds({},'posting',()=>value));
});
test('fixed and random custom posting delays preserve account deadlines and receipt time',()=>{
 const config=T.normalize({posting:{min:42,max:42},startup:{min:7,max:7}});
 assert.equal(confirmSchedule(1000,()=>.75,config).nextPostAt,43000);
 const fresh=restoreSchedule({},'/Me',{},1000,config);assert.equal(fresh.nextPostAt,8000);
 assert.equal(scheduledStart(fresh,1000,config),8000);assert.equal(scheduledStart(fresh,9000,config),9000);
 assert.deepEqual(restoreSchedule({'/me':fresh},'/ME',{},2000,T.normalize()),fresh);
});
test('scheduler uses live timing, gives posting priority, and never ties replies to follows',()=>{
 const values={notifications:90000,replyWindow:10000,guard:3000,restart:12000};
 const ctx=vm.createContext({XAssistantTime:{ms:name=>values[name]}});
 vm.runInContext(readFileSync(new URL('../scheduler-core.js',import.meta.url),'utf8'),ctx);
 const C=ctx.XAssistantSchedulerCore,post={busy:false,nextAt:9999999};let s=C.fresh(0);
 assert.equal(s.nextReplyAt,90000);assert.equal(C.choose(s,89999,post),'interaction');assert.equal(C.choose(s,90000,post),'notifications');
 for(const enabled of [false,true])assert.equal(C.choose(C.setFollowMode(s,enabled),90000,post),'notifications');
 assert.equal(C.choose(s,90000,{busy:false,nextAt:92000}),'posting');assert.equal(C.REPLY_WINDOW,10000);assert.equal(C.AUTO_RESTART_DELAY,12000);
 values.notifications=120000;s=C.finishReplies(s,91000);assert.equal(s.nextReplyAt,211000);
});
test('page time client loads, live-updates and clears reset configuration',async()=>{
 let changed;const ctx=vm.createContext({Math,chrome:{storage:{local:{get:async key=>({[key]:{interaction:{min:4,max:4}}})},onChanged:{addListener:f=>changed=f}}}});
 vm.runInContext(readFileSync(new URL('../time-policy.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(readFileSync(new URL('../time-client.js',import.meta.url),'utf8'),ctx);
 await ctx.XAssistantTime.ready;assert.equal(ctx.XAssistantTime.ms('interaction'),4000);
 changed({xAssistantTimingV1:{newValue:{interaction:{min:8,max:8}}}},'local');assert.equal(ctx.XAssistantTime.ms('interaction'),8000);
 changed({xAssistantTimingV1:{newValue:undefined}},'local');assert.ok(ctx.XAssistantTime.ms('interaction')>=20000);
});
