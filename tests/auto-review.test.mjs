import test from 'node:test';import assert from 'node:assert/strict';
let stored={};
globalThis.chrome={storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async data=>{Object.assign(stored,structuredClone(data));}}},
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},tabs:{get:async id=>({id,windowId:7,url:'https://x.com/home'}),update:async()=>({}),create:async()=>({id:99})},alarms:{clear:async()=>{},create:()=>{}}};
const {reviewPlan,nextReview,autoReview}=await import('../bg/auto-review.mjs');
const {matchesSend,coveredSince,normalizeForMatch,readbackOwn}=await import('../bg/readback.mjs');

const SUBMIT=Date.parse('2026-11-04T04:00:00Z'),iso=new Date(SUBMIT).toISOString(),MIN=60000;
const service={enabled:true,account:'/me',selected:{posting:true,notifications:true},workers:{},revision:1};
const postingRun={active:false,phase:'unknown',account:'/me',runId:'run-1',rowId:'a',text:'今天试了新模型 https://t.co/abc 🚀',submittedAt:iso,owner:1,revision:3};

test('matching ignores shortened links, emoji and spacing; requires own account and post time',()=>{
 const row={author:'/me',at:SUBMIT+5000,text:'今天试了新模型  t.co/abc…',media:false,truncated:false};
 assert.equal(normalizeForMatch('a https://x.com/y 🚀  b'),'a b');
 assert.equal(matchesSend(row,{account:'/me',text:postingRun.text,since:SUBMIT,kind:'post'}),true);
 assert.equal(matchesSend({...row,author:'/other'},{account:'/me',text:postingRun.text,since:SUBMIT,kind:'post'}),false);
 assert.equal(matchesSend({...row,at:SUBMIT-10*MIN},{account:'/me',text:postingRun.text,since:SUBMIT,kind:'post'}),false); // An older identical post.
 assert.equal(matchesSend({...row,text:'今天试了新模型，还挺好用'},{account:'/me',text:postingRun.text,since:SUBMIT,kind:'post'}),false);
 const long='一'.repeat(300);
 assert.equal(matchesSend({...row,text:'一'.repeat(200),truncated:true},{account:'/me',text:long,since:SUBMIT,kind:'post'}),true);
 assert.equal(matchesSend({...row,text:'',media:true},{account:'/me',text:'',since:SUBMIT,kind:'post'}),true); // Media-only post.
 assert.equal(matchesSend({...row,text:'',media:true},{account:'/me',text:'',since:SUBMIT,kind:'reply'}),false);
 assert.equal(matchesSend({...row,pinned:true},{account:'/me',text:postingRun.text,since:SUBMIT,kind:'post'}),false);
});

test('absence needs real coverage: older own cards past the send, the list end, or an empty list',()=>{
 const old={author:'/me',at:SUBMIT-40*MIN};
 assert.equal(coveredSince([old],{account:'/me',since:SUBMIT}),false);
 assert.equal(coveredSince([old,{...old,at:SUBMIT-50*MIN}],{account:'/me',since:SUBMIT}),true);
 assert.equal(coveredSince([{...old,pinned:true},{...old,pinned:true}],{account:'/me',since:SUBMIT}),false);
 assert.equal(coveredSince([],{account:'/me',since:SUBMIT,bottom:true}),true);
});

test('review waits 2 minutes, needs two misses with the last at 10 minutes, and gives up to a person after 5 unreadable tries',()=>{
 assert.equal(reviewPlan(postingRun,service,'posting',SUBMIT+MIN).due,false);
 const plan=reviewPlan(postingRun,service,'posting',SUBMIT+2*MIN);assert.equal(plan.due,true);
 assert.equal(nextReview(plan,{status:'found',id:'5'}).outcome,'confirmed');
 const miss=nextReview(plan,{status:'absent'},SUBMIT+2*MIN);assert.equal(miss.outcome,undefined);assert.equal(miss.review.nextAt,SUBMIT+10*MIN);
 const second=reviewPlan({...postingRun,autoReview:miss.review},service,'posting',SUBMIT+10*MIN);
 assert.equal(nextReview(second,{status:'absent'},SUBMIT+10*MIN).outcome,'not_sent');
 // Never while the run is still active, switched off, or for another account.
 assert.equal(reviewPlan({...postingRun,active:true},service,'posting',SUBMIT+20*MIN),null);
 assert.equal(reviewPlan(postingRun,{...service,enabled:false},'posting',SUBMIT+20*MIN),null);
 assert.equal(reviewPlan(postingRun,{...service,account:'/other'},'posting',SUBMIT+20*MIN),null);
 assert.equal(reviewPlan({...postingRun,autoReview:{runId:'run-1',submittedAt:iso,misses:0,inconclusive:5}},service,'posting',SUBMIT+20*MIN),null);
});

const seed=()=>{stored={
 xAssistantManagedServiceV1:structuredClone(service),
 xAssistantPostingV1:structuredClone(postingRun),
 xAssistantPostingCopiesV1:{revision:4,rows:[{id:'a',text:postingRun.text,enabled:true},{id:'b',text:'next',enabled:true}]},
 xAssistantTimingV1:undefined,app:{logs:[]}
};};

test('a found post is confirmed: the copy leaves the library, the cooldown counts from the real post, the module resumes',async()=>{
 seed();
 const done=await autoReview({now:()=>SUBMIT+2*MIN,readback:async args=>{assert.equal(args.kind,'post');assert.equal(args.windowId,undefined);return {status:'found',id:'777',url:'https://x.com/me/status/777'};}});
 assert.deepEqual(done,[{module:'posting',outcome:'confirmed'}]);
 const run=stored.xAssistantPostingV1;
 assert.equal(run.phase,'stopped');assert.equal(run.resolution.automatic,true);assert.equal(run.receipt.postId,'777');
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(r=>r.id),['b']);
 assert.equal(stored.xAssistantPostSchedulesV1['/me'].lastPostedAt,SUBMIT);
});

test('a post missing at both readbacks is judged not sent and its copy stays first in line',async()=>{
 seed();
 await autoReview({now:()=>SUBMIT+2*MIN,readback:async()=>({status:'absent'})});
 assert.equal(stored.xAssistantPostingV1.phase,'unknown');assert.equal(stored.xAssistantPostingV1.autoReview.misses,1);
 const early=await autoReview({now:()=>SUBMIT+5*MIN,readback:async()=>{throw Error('not due yet');}});assert.deepEqual(early,[]);
 const done=await autoReview({now:()=>SUBMIT+10*MIN,readback:async()=>({status:'absent'})});
 assert.deepEqual(done,[{module:'posting',outcome:'not_sent'}]);
 assert.equal(stored.xAssistantPostingV1.phase,'stopped');assert.equal(stored.xAssistantPostingV1.resolution.outcome,'not_sent');
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(r=>[r.id,r.enabled]),[['a',true],['b',true]]);
});

test('a reply review settles the comment record and the cross-module claim together',async()=>{
 seed();delete stored.xAssistantPostingV1;
 stored.xAssistantNotificationsRuntimeV1={active:false,phase:'unknown',account:'/me',runId:'r2',text:'哈哈，这都行',submittedAt:iso,revision:1};
 stored.xAssistantNotificationRepliesV1={'/me':{records:{'55':{status:'unknown',text:'哈哈，这都行'},'56':{status:'confirmed',text:'别的'}}}};
 stored.xAssistantReplyClaimsV1={'/me':{'55':{status:'unknown',module:'notifications',runId:'r2'}}};
 await autoReview({now:()=>SUBMIT+2*MIN,readback:async args=>{assert.equal(args.kind,'reply');return {status:'found',id:'900'};}});
 assert.equal(stored.xAssistantNotificationRepliesV1['/me'].records['55'].status,'confirmed');
 assert.equal(stored.xAssistantNotificationRepliesV1['/me'].records['56'].status,'confirmed');
 assert.equal(stored.xAssistantReplyClaimsV1['/me']['55'].status,'confirmed');
 assert.equal(stored.xAssistantNotificationsRuntimeV1.phase,'stopped');
 // Not found twice: the comment becomes retryable and the claim is released.
 stored.xAssistantNotificationsRuntimeV1={active:false,phase:'unknown',account:'/me',runId:'r3',text:'再来',submittedAt:iso,revision:1};
 stored.xAssistantNotificationRepliesV1['/me'].records['57']={status:'unknown',text:'再来'};
 stored.xAssistantReplyClaimsV1['/me']['57']={status:'unknown',module:'notifications',runId:'r3'};
 await autoReview({now:()=>SUBMIT+2*MIN,readback:async()=>({status:'absent'})});
 await autoReview({now:()=>SUBMIT+10*MIN,readback:async()=>({status:'absent'})});
 assert.equal(stored.xAssistantNotificationRepliesV1['/me'].records['57'].status,'failed');
 assert.equal(stored.xAssistantReplyClaimsV1['/me']['57'].status,'released');
});

test('the readback tab is read-only, background, and always closed',async()=>{
 const calls=[],tabs={create:async opts=>{calls.push(['create',opts]);return {id:5};},remove:async id=>calls.push(['remove',id])};
 const samples=[{waiting:true},{rows:[{id:'1',author:'/me',at:SUBMIT+1000,text:'hello world'}],bottom:false}];
 const scripting={executeScript:async({target,func,args})=>{assert.equal(func.name,'sampleOwnCards');assert.deepEqual(args,['/me']);return [{result:samples.shift()}];}};
 const result=await readbackOwn({account:'/Me',kind:'reply',text:'hello world',since:SUBMIT,windowId:3},{tabs,scripting,wait:async()=>{}});
 assert.deepEqual(result,{status:'found',id:'1',url:'https://x.com/me/status/1'});
 assert.deepEqual(calls,[['create',{url:'https://x.com/me/with_replies',active:false,windowId:3}],['remove',5]]);
 const stop={executeScript:async()=>[{result:{stop:'当前登录账号与核对账号不一致'}}]};
 assert.equal((await readbackOwn({account:'/me',kind:'post',text:'x',since:SUBMIT},{tabs,scripting:stop,wait:async()=>{}})).status,'inconclusive');
 assert.deepEqual(calls.at(-1),['remove',5]);
});
