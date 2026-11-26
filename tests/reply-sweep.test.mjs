import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../reply-sweep.js',import.meta.url),'utf8');
const H=3600000,DAY=24*H,NOW=Date.parse('2026-11-23T12:00:00Z');

function fixture({posts,mentions={complete:true,stats:{}},thread=()=>({complete:true,stats:{}}),store={},now=NOW}={}){
  const calls={mentions:[],threads:[],opened:[],returned:0,shown:[]};
  let path='/home',y=0,clock=now;
  const article=i=>({isConnected:true,getBoundingClientRect:()=>({top:i*500-y,height:400})});
  const rows=()=>path==='/me'?posts.map((p,i)=>({id:p.id,author:p.author||'me',at:p.at,replyCount:p.count??null,article:article(i)})):[];
  const primary={contains:()=>true,querySelector:s=>s.includes('UserProfileHeader_Items')&&path==='/me'?{}:s.includes('emptyState')&&path==='/me'&&!posts.length?{}:null};
  const profileLink={getAttribute:()=>'/me',click:()=>{path='/me';}};
  const storage={data:structuredClone(store),get:async k=>({[k]:storage.data[k]}),set:async o=>{Object.assign(storage.data,structuredClone(o));}};
  const ctx={
    console,structuredClone,
    Date:class extends Date{static now(){return clock;}},
    innerHeight:800,
    window:{get scrollY(){return y;},scrollTo:({top})=>{y=top;},scrollBy:(x,d)=>{y+=d;}},
    location:{get pathname(){return path;}},
    document:{querySelector:s=>s==='[data-testid="primaryColumn"]'?primary:s.includes('AppTabBar_Profile_Link')?profileLink:null,querySelectorAll:()=>[]},
    XAssistantTasks:{check:()=>{},sleep:async()=>{},TaskError:class extends Error{constructor(code,m){super(m);this.code=code;}},
      waitForPage:async probe=>{for(let i=0;i<5;i++){const v=probe();if(v)return v;}return null;}},
    XAssistantDOM:{rows,account:()=>'/me',dialogs:()=>[],originalPost:(id)=>posts.some(p=>p.id===id&&(p.author||'me')==='me'&&!p.retweet)},
    XAssistantCore:{editorText:()=>''},
    XAssistantRuntime:{storage},
    XAssistantNotifications:{scan:async o=>{
      if(o.mentionsOnly){calls.mentions.push(o);return mentions;}
      calls.threads.push(o);return thread(o.rootId,calls.threads.filter(t=>t.rootId===o.rootId).length);
    }},
    XAssistantWorkspace:{check:()=>{},expectNavigation:()=>{},
      openOwnOriginal:async row=>{calls.opened.push(row.id);path='/me/status/'+row.id;return {returnToSource:async()=>{calls.returned++;path='/me';}};}}
  };
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  const S=ctx.XAssistantReplySweep;
  return {S,calls,storage,ctx,tick:ms=>{clock+=ms;},
    run:()=>S.scan({account:'/Me',runId:'r1',signal:{},show:m=>calls.shown.push(m)})};
}

test('one round: mentions first, then every own original of the last 7 days, never through the retired strict 48h route',async()=>{
  const posts=[
    {id:'900',at:NOW-40*DAY,count:9},           // pinned old post at the top: does not end the list
    {id:'105',at:NOW-1*H,count:2},
    {id:'104',at:NOW-50*H,count:5},             // older than 48h: still entered
    {id:'103',at:NOW-6*DAY,count:1},
    {id:'777',at:NOW-2*H,count:3,author:'other'},// someone else's card on the profile
    {id:'102',at:NOW-8*DAY,count:4},
    {id:'101',at:NOW-9*DAY,count:4}
  ];
  const f=fixture({posts});
  const result=await f.run();
  assert.equal(f.calls.mentions.length,1);
  assert.equal(f.calls.mentions[0].countWindow48,undefined);
  assert.deepEqual(f.calls.opened,['105','104','103'],'newest first, everything inside 7 days');
  for(const t of f.calls.threads){
    assert.equal(t.countWindow48,undefined);assert.equal(t.bootstrap72,undefined);
    assert.equal(t.threadPath,'/me/status/'+t.rootId);assert.equal(t.retryOriginal,true);
    assert.equal(t.readToBottom,true,'every visit reads the whole thread, not one screen');
  }
  assert.equal(f.calls.returned,3);
  assert.equal(result.reason,'profile_idle');assert.equal(result.complete,true);assert.equal(result.queuePending,false);assert.equal(result.stats.pending,0);
});

test('an unfinished thread or an unfinished mentions pass keeps the round pending and is retried next round',async()=>{
  const posts=[{id:'205',at:NOW-H,count:4},{id:'204',at:NOW-2*H,count:1}];
  const f=fixture({posts,thread:id=>id==='205'?{complete:false,stats:{eligible:2,confirmed:1}}:{complete:true,stats:{}}});
  const first=await f.run();
  assert.equal(first.reason,'profile_pending');assert.equal(first.complete,false);assert.ok(first.stats.pending>=1);
  assert.ok(first.nextWakeAt-NOW<=2*60000,'pending work comes back within a couple of minutes');
  f.tick(60000);
  await f.run();
  assert.deepEqual(f.calls.opened,['205','204','205'],'only the unfinished thread is entered again');
  const m=fixture({posts:[],mentions:{complete:false,stats:{}}});
  assert.equal((await m.run()).reason,'profile_pending');
});

test('a finished thread with an unchanged count is left alone for 30 minutes, re-entered when the count moves or the clock runs out',async()=>{
  const posts=[{id:'305',at:NOW-H,count:3}];
  const f=fixture({posts,thread:()=>({complete:true,finalCommentCount:3,stats:{}})});
  await f.run();assert.deepEqual(f.calls.opened,['305']);
  f.tick(5*60000);await f.run();
  assert.deepEqual(f.calls.opened,['305'],'quiet and complete: not re-entered within 30 minutes');
  posts[0].count=4;f.tick(60000);await f.run();
  assert.deepEqual(f.calls.opened,['305','305'],'a new comment moves the count: entered right away');
  f.tick(31*60000);await f.run();
  assert.equal(f.calls.opened.length,3,'even an unchanged count is fully re-read every 30 minutes');
});

test('X still paging a thread in: the sweep reads the same page again before leaving',async()=>{
  const f=fixture({posts:[{id:'405',at:NOW-H,count:40}],thread:(id,n)=>n<3?{complete:false,evidence:{retainView:true},stats:{}}:{complete:true,stats:{}}});
  const result=await f.run();
  assert.equal(f.calls.threads.length,3);assert.equal(f.calls.opened.length,1);assert.equal(f.calls.returned,1);
  assert.equal(result.reason,'profile_idle');
});

test('page change and trial samples are passed straight back to the driver',async()=>{
  const changed=fixture({posts:[{id:'1',at:NOW-H}],mentions:{reason:'page_changed'}});
  assert.equal((await changed.run()).reason,'page_changed');assert.equal(changed.calls.opened.length,0);
  const sample=fixture({posts:[{id:'1',at:NOW-H,count:1}],thread:()=>({reason:'trial_sample_confirmed',sample:true})});
  const r=await sample.run();assert.equal(r.sample,true);
});

test('due-thread policy is pure: window, count changes, revisit clock and zero-comment posts',()=>{
  const f=fixture({posts:[]});const S=f.S,state=S.normalizeState({version:2,posts:{
    a:{at:NOW-H,complete:true,visitedCount:2,lastVisitAt:NOW-5*60000},
    b:{at:NOW-H,complete:true,visitedCount:2,lastVisitAt:NOW-5*60000},
    c:{at:NOW-H,complete:false,visitedCount:null,lastVisitAt:NOW-60000},
    z:{at:NOW-H,complete:true,visitedCount:0,lastVisitAt:NOW-60000}
  }});
  // normalizeState only keeps numeric ids
  assert.deepEqual([...Object.keys(state.posts)],[]);
  const st=S.normalizeState({version:2,posts:{
    '1':{at:NOW-H,complete:true,visitedCount:2,lastVisitAt:NOW-5*60000},
    '2':{at:NOW-H,complete:true,visitedCount:2,lastVisitAt:NOW-5*60000},
    '3':{at:NOW-H,complete:false,lastVisitAt:NOW-60000},
    '4':{at:NOW-H,complete:true,visitedCount:0,lastVisitAt:NOW-60000},
    '5':{at:NOW-H,complete:true,visitedCount:2,lastVisitAt:NOW-31*60000}
  }});
  const due=S.dueThreads(st,[
    {id:'1',at:NOW-H,count:2},{id:'2',at:NOW-2*H,count:3},{id:'3',at:NOW-3*H,count:1},{id:'4',at:NOW-4*H,count:0},
    {id:'5',at:NOW-5*H,count:2},{id:'6',at:NOW-8*DAY,count:9},{id:'7',at:NOW-6*H,count:null}
  ],NOW).map(x=>x.id);const plain=[...due];
  assert.deepEqual(plain,['2','3','5','7']);
  assert.equal(S.POLICY.window,7*DAY);
});
