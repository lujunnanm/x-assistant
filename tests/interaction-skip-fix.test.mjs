import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const ctx=vm.createContext({URL});vm.runInContext(read('interaction-core.js'),ctx);const core=ctx.XAssistantCore;
const row={id:'1',author:'friend',text:'来交朋友',views:805};
const reason=(record,extra={})=>core.interactionSkipReason(row,{self:'self',record,now:1000,...extra});
test('legacy unsent failures and AI skips become eligible without clearing history',()=>{
 for(const reply of ['failed','skipped_ai','skipped_popup','skipped_issue','ai_error'])assert.equal(reason({reply}),null,reply);
});
test('confirmed, in-flight and unknown sends remain blocked regardless of retry timestamp',()=>{
 assert.equal(reason({reply:'verified',retryAt:0}),'confirmed');
 for(const reply of ['unknown','in_flight'])assert.equal(reason({reply,retryAt:0}),'uncertain');
});
test('temporary backoff expires at the exact deadline and never blacklists the author',()=>{
 assert.equal(reason({reply:'failed',retryAt:1001}),'retry_cooldown');
 assert.equal(reason({reply:'failed',retryAt:1000}),null);
 assert.equal(reason(null,{authors:new Set(['friend'])}),'author_confirmed');
 for(const reply of ['skipped_ai','failed'])assert.equal(core.interactionSkipReason({...row,id:'2'},{self:'self',record:{reply},authors:new Set(),now:1000}),null);
});
test('social greetings are recognized while the 500-view and unrelated-content guards stay strict',()=>{
 for(const text of ['来交朋友','新人出摊，有关必回','蓝朋友早安，周三流量多多','蓝 朋友，来浇朋友','互浇互关','关注必回','有 关 必 回']){
  assert.equal(core.friendshipCandidate(text,500),true,text);assert.equal(core.friendshipCandidate(text,499),false,text);
 }
 for(const text of ['今天和朋友吃饭','蓝V认证价格介绍','周三早上好','饭馆出摊卖早餐','普通生活记录'])assert.equal(core.friendshipCandidate(text,10000),false,text);
 for(const views of [null,NaN,undefined])assert.equal(core.interactionSkipReason({...row,views},{self:'self'}),'views_missing');
});
const driver=read('overlay.js');
async function run(outcomes){
 let now=0,index=0;const records={},authors=new Set(),events=[],waits=[];
 const context=vm.createContext({Date:{now:()=>now},Math,account:'/self',activeRun:'run',pauseRequested:false,replySubmitted:false,selected:null,sessionAuthors:authors,
  core:{interactionPage:()=>true},location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},
  check:signal=>{if(signal.aborted)throw new DOMException('stop','AbortError');},publishDiagnostics:async()=>{},
  updateRuntime:async patch=>events.push(['patch',patch]),saveProcessed:async(info,record)=>{records[info.id]=structuredClone(record);},
  randomWait:async(min,max,signal,label)=>{assert.equal(min,max);waits.push({seconds:min,label});now+=min*1000;},
  XAssistantTime:{ms:()=>20000,arm:async()=>now+20000},status:()=>{},markSelected:()=>{},
  runtime:async()=>({active:index<outcomes.length,runId:'run',completed:0}),autoFollow:async()=>false,
  findCandidate:async()=>({id:String(index),author:'friend',text:'来交朋友',views:805,followState:'unrestricted'}),
  aiReply:async info=>{const type=outcomes[index++];return type==='skip'?{action:'skip',postId:info.id}:type==='ai_error'?{action:'skip',postId:info.id,skippedGenerationError:true,reasonCode:'network',reason:'连接失败'}:{action:'send_reply',postId:info.id,text:'欢迎来聊'};},
  recordOutcome:(info,reason)=>events.push(['outcome',info.id,reason]),
  replyAndSend:async(info,text,signal,confirmed)=>{const type=outcomes[index-1];if(type==='failed')throw Object.assign(Error('目标更新'),{code:'TARGET_UPDATED'});if(type==='unknown'){context.replySubmitted=true;throw Object.assign(Error('回执未知'),{submitted:true});}await confirmed();return 'verified';}
 });
 const a=driver.indexOf(' const deferRecord='),b=driver.indexOf(' // A single owner',a);
 vm.runInContext(driver.slice(a,b)+'globalThis.run=runLoop;',context);
 await context.run(new AbortController().signal,'run');return{records,authors,events,waits};
}
test('AI skip and generation failure wait, preserve reasons and allow later posts by the same author',async()=>{
 for(const first of ['skip','ai_error']){
  const f=await run([first,'confirmed']);assert.equal(f.records['0'].retryAt,60000);assert.equal(f.records['1'].reply,'verified');
  assert.equal(f.waits.length,2);assert.ok(f.waits.every(w=>w.seconds===20));assert.equal(f.authors.size,1);
  assert.deepEqual(f.events.filter(e=>e[0]==='outcome').map(e=>e[2]),[first==='skip'?'ai_skip':'ai_error','confirmed']);
 }
});
test('proven unsent errors retain the actual code, temporary backoff and normal cooldown',async()=>{
 const f=await run(['failed']);assert.equal(f.records['0'].reply,'failed');assert.equal(f.records['0'].reasonCode,'TARGET_UPDATED');assert.equal(f.records['0'].retryAt,60000);assert.equal(f.authors.size,0);assert.equal(f.waits.length,1);
});
test('unknown send keeps quarantine evidence and never acquires an automatic retry deadline',async()=>{
 const f=await run(['unknown']);assert.equal(f.records['0'].reply,'unknown');assert.equal(f.records['0'].retryAt,undefined);assert.equal(f.waits.length,1);assert.equal(f.authors.size,0);
});
test('author dedup is committed only inside the platform-confirmed callback',()=>{
 const before=driver.slice(driver.indexOf(' const runLoop'),driver.indexOf('await replyAndSend'));
 assert.ok(!before.includes('sessionAuthors.add('));assert.match(driver,/record\.reply = 'verified';\s*sessionAuthors\.add/);
});

test('skip diagnostics are persisted once per post/reason, with attempt outcomes counted separately',async()=>{
 const patches=[];const start=driver.indexOf(' const reasonLabels='),end=driver.indexOf(' const findCandidate=',start);
 const context=vm.createContext({Date,Set,updateRuntime:async patch=>patches.push(structuredClone(patch))});
 vm.runInContext(driver.slice(start,end)+'globalThis.recordCandidate=recordCandidate;globalThis.recordOutcome=recordOutcome;globalThis.publish=publishDiagnostics;',context);
 context.recordCandidate(row,'low_views');context.recordCandidate(row,'low_views');context.recordCandidate(row,null);context.recordOutcome(row,'ai_skip');context.recordOutcome(row,'ai_skip');await context.publish();
 assert.equal(patches[0].diagnostics.seen,1);assert.equal(patches[0].diagnostics.skips.low_views,1);assert.equal(patches[0].diagnostics.outcomes.ai_skip,2);
});
