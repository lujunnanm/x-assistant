import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../profile-replies.js',import.meta.url),'utf8');
const NOW=1794279309177,DAY=86400000,KEY='xAssistantProfileCommentCountsV1',QUEUE='xAssistantProfileRetryBatchV1';
const post=(id,extra={})=>({id:String(id),author:'me',at:NOW-1000,replyCount:3,...extra});
const pending=(extra={})=>({postedAt:NOW-1000,observed:3,lastOutcome:'pending',nextCheckAt:0,...extra});
async function run({now=NOW,pages=[[post(1)]],prior={},queue=null,start='/home',header=true,account='/me',draft=false,renderDelay=500,
 noNative=false,missing=[],threadResult,returnError=null,singleRound=false,restoreDelay=0,scrollDelay=0,media=null,signal=new AbortController().signal}={}){
 let drawn=0,paintAt=0;
 let clock=now,y=0,readyAt=start==='/me'?now:Infinity,expected=null,opens=0;
 const events=[],calls=[],patches=[],storage={[KEY]:{'/me':structuredClone(prior)},[QUEUE]:{'/me':structuredClone(queue)}};
 const location={pathname:start,search:'',hash:'',assign(){throw Error('hard navigation forbidden');},reload(){throw Error('reload forbidden');}};
 const makePage=(list,n)=>list.map((r,i)=>({...r,time:String(r.at),text:'text '+r.id,url:'https://x.com/'+r.author+'/status/'+r.id,
  article:{id:r.id,isConnected:true,closest:()=>null,getBoundingClientRect:()=>({height:90,top:80+i*100,bottom:170+i*100})}}));
 const rendered=pages.map(makePage),page=()=>Math.min(Math.floor(y/640),rendered.length-1);
 const own=id=>rendered.flat().some(r=>r.id===id&&r.author==='me'&&r.original!==false);
 const shown=()=>{if(clock>=paintAt)drawn=page();return drawn;};
 const rows=()=>location.pathname==='/me'&&clock>=readyAt?rendered[shown()]:[];
 const primary={contains:a=>rows().some(r=>r.article===a),querySelector:s=>header&&clock>=readyAt&&s.includes('UserProfileHeader_Items')?{}:null,querySelectorAll:()=>[]};
 const link={getAttribute:()=>'/me',click(){assert.equal(expected,'/me');events.push('profile');location.pathname='/me';readyAt=clock+renderDelay;}};
 class TaskError extends Error{constructor(code,message){super(message);this.code=code;}}
 const guard=()=>{if(signal.aborted)throw new DOMException('stopped','AbortError');};
 const waitForPage=async(probe,{timeout=10000}={})=>{const end=clock+timeout;for(;;){guard();const value=probe();if(value)return value;if(clock>=end)return null;clock=Math.min(end,clock+100);}};
 const workspace={state:()=>({assignment:{singleRound}}),check:guard,expectNavigation:p=>expected=p,progress(){}};
 if(!noNative)workspace.openOwnOriginal=async row=>{
  guard();if(draft)throw Object.assign(Error('draft'),{code:'RESIDUAL_DRAFT',preserveDrafts:true});
  assert.equal(location.pathname,'/me');assert.ok(rows().includes(row));assert.equal(own(row.id),true);
  if(missing.includes(row.id))throw Object.assign(Error('native link missing'),{code:'TARGET_UPDATED'});
  const saved=y;opens++;events.push('open:'+row.id);location.pathname='/me/status/'+row.id;
  return {returnToSource:async()=>{if(returnError)throw Object.assign(Error(returnError),{code:returnError,preserveDrafts:true});
   events.push('back:'+row.id);location.pathname='/me';y=saved;readyAt=clock;}};
 };
 const ctx=vm.createContext({Date:{now:()=>clock},location,innerHeight:800,DOMException,
  window:{get scrollY(){return y;},scrollTo:({top})=>{const before=shown();events.push('scrollTo:'+top);y=Math.max(0,Math.min(top,640*(pages.length-1)));if(page()!==before)paintAt=clock+restoreDelay;},scrollBy:(_x,dy)=>{const before=shown();y=Math.min(y+dy,640*(pages.length-1));if(page()!==before)paintAt=clock+scrollDelay;events.push('scroll:'+page());}},
  document:{scrollingElement:{scrollHeight:800+640*(pages.length-1)},querySelector:s=>media&&media!=='file'&&s.includes(media)?{}:s.includes('AppTabBar_Profile_Link')?link:s.includes('primaryColumn')?primary:null,
   querySelectorAll:s=>media==='file'&&s==='input[type="file"]'?[{files:[{}]}]:draft&&s.includes('contenteditable')?[{text:'draft'}]:[]},
  chrome:{storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async values=>Object.assign(storage,structuredClone(values))}}},
  XAssistantCore:{editorText:e=>e.text||''},XAssistantWorkspace:workspace,
  XAssistantRuntime:{runtime:async(_m,_op,{patch})=>patches.push(patch)},
  XAssistantDOM:{account:()=>account,dialogs:()=>[],rows,originalPost:own},
  XAssistantTasks:{check:guard,waitForPage,sleep:async ms=>{guard();clock+=ms;},TaskError},
  XAssistantNotifications:{scan:async opts=>{
   calls.push(opts);
   if(!opts.rootId){location.pathname='/notifications/mentions';return {complete:true,stats:{}};}
   assert.equal(opts.retryOriginal,true);assert.equal(location.pathname,opts.threadPath);
   const result=typeof threadResult==='function'?await threadResult(opts,{clock,events,profileRows:rendered.flat()}):threadResult;
   if(result instanceof Error)throw result;
   return result||{complete:true,reason:'visible_exhausted',finalCommentCount:3,stats:{},evidence:{cursorAdvanced:false,resumePending:false}};
  }}});
 vm.runInContext(source,ctx);
 let result;try{result=await ctx.XAssistantProfileReplies.scan({account:'/me',runId:'r',until:now,signal});}catch(e){e.events=events;throw e;}
 return {result,events,calls,patches,get opens(){return opens;},get counts(){return storage[KEY]['/me'];},get queue(){return storage[QUEUE]['/me'];},get now(){return clock;},get path(){return location.pathname;},
  repeat:async({advance=30000,runId='r',path}={})=>{clock+=advance;if(path)location.pathname=path;return ctx.XAssistantProfileReplies.scan({account:'/me',runId,until:clock,signal});}};
}
const roots=f=>f.calls.filter(c=>c.rootId).map(c=>c.rootId);
test('originals use a live profile card and verified SPA return; normal work never assigns, reloads or fabricates history',async()=>{
 const f=await run({pages:[[post(1),post(2)]]});assert.deepEqual(roots(f),['1','2']);
 assert.deepEqual(f.events.filter(e=>/open:|back:/.test(e)),['open:1','back:1','open:2','back:2']);
 assert.equal(f.calls.at(-1).mentionsOnly,true);assert.doesNotMatch(source,/location\.(assign|replace|reload)|history\.pushState/);
});
test('cached pending is located on the real profile instead of opening its saved URL',async()=>{
 const f=await run({pages:[[post(9,{at:NOW-30*DAY})]],prior:{9:pending({postedAt:NOW-30*DAY})}});
 assert.deepEqual(roots(f),['9']);assert.ok(f.events.indexOf('profile')<f.events.indexOf('open:9'));
});
test('a missing old native card is retained and deferred, never hard opened',async()=>{
 const f=await run({prior:{9:pending({postedAt:NOW-30*DAY})},pages:[[post(1,{replyCount:0})]]});
 assert.deepEqual(roots(f),[]);assert.equal(f.counts['9'].lastOutcome,'pending');assert.equal(f.counts['9'].idlePasses,1);
 assert.ok(f.counts['9'].nextCheckAt>=NOW+300000);assert.equal(f.opens,0);
});
test('no native opener or a disappeared native link defers that item and leaves the rest usable',async()=>{
 for(const extra of [{noNative:true},{missing:['1']}]){
  const f=await run({pages:[[post(1),post(2)]],...extra});assert.ok(f.counts['1'].nextCheckAt>=NOW+300000);
  assert.equal(f.counts['1'].lastOutcome,'pending');if(!extra.noNative)assert.deepEqual(roots(f),['2']);
 }
});
test('pending with no new work backs off five, fifteen then thirty minutes and remains retryable',async()=>{
 let prior={1:pending()},now=NOW;
 for(const delay of [300000,900000,1800000,1800000]){
  const f=await run({now,prior,threadResult:{complete:false,reason:'THREAD_COMMENTS_PENDING',stats:{},evidence:{cursorAdvanced:false,resumePending:true}}});
  assert.deepEqual(roots(f),['1']);assert.equal(f.counts['1'].nextCheckAt-f.now,delay);assert.equal(f.counts['1'].lastOutcome,'pending');
  prior=f.counts;now=f.counts['1'].nextCheckAt;
 }
});
test('fresh candidates or a verified cursor advance reset idle backoff but wait sixty seconds',async()=>{
 for(const result of [{stats:{eligible:1}},{evidence:{cursorAdvanced:true,resumePending:true}},{stats:{confirmed:1}}]){
  const f=await run({prior:{1:pending({idlePasses:3})},threadResult:{complete:false,reason:'THREAD_COMMENTS_PENDING',...result}});
  assert.equal(f.counts['1'].idlePasses,0);assert.equal(f.counts['1'].lastProgressAt,f.now);assert.equal(f.counts['1'].nextCheckAt-f.now,60000);
 }
});
test('a future due time does not reopen a quiet root during discovery',async()=>{
 const f=await run({prior:{1:pending({nextCheckAt:NOW+900000})}});assert.deepEqual(roots(f),[]);assert.equal(f.counts['1'].nextCheckAt,NOW+900000);
});
test('count growth wakes a deferred root while unchanged counts do not suppress an overdue audit',async()=>{
 const woke=await run({prior:{1:pending({nextCheckAt:NOW+900000,observed:2})}});assert.deepEqual(roots(woke),['1']);assert.equal(woke.calls[0].recheckTop,true);
 const audit=await run({prior:{1:pending({lastOutcome:'completed',handled:3,observed:3,nextCheckAt:NOW-1})}});assert.deepEqual(roots(audit),['1']);
});
test('no due root and discovery not yet due performs no DOM navigation or scanner call',async()=>{
 const f=await run({prior:{1:pending({nextCheckAt:NOW+900000})},queue:{version:2,discoveryAt:NOW+300000,cursor:null}});
 assert.deepEqual(f.events,[]);assert.deepEqual(f.calls,[]);assert.equal(f.result.reason,'profile_idle');assert.equal(f.result.nextWakeAt,NOW+300000);
});
test('five roots form one bounded batch; the next batch waits at least fifteen seconds and does not reopen checked roots',async()=>{
 const pages=[[1,2,3,4,5,6,7].map(id=>post(id))],first=await run({pages});
 assert.deepEqual(roots(first),['1','2','3','4','5']);assert.equal(first.result.reason,'profile_batch');assert.equal(first.result.queuePending,true);
 assert.ok(first.result.nextWakeAt-first.now>=15000);
 const second=await run({now:first.result.nextWakeAt,pages,prior:first.counts,queue:first.queue});
 assert.deepEqual(roots(second),['6','7']);assert.equal(second.calls.at(-1).mentionsOnly,true);
});
test('overdue cold pending roots are processed before less-overdue hot roots',async()=>{
 const prior={};for(let id=1;id<=6;id++)prior[id]=pending({nextCheckAt:id===6?NOW-900000:NOW-1000,observed:id===6?1:100});
 const f=await run({prior,pages:[[1,2,3,4,5,6].map(id=>post(id,{replyCount:id===6?1:100}))]});
 assert.equal(roots(f)[0],'6');assert.equal(roots(f).length,5);
});
test('profile pagination has a persistent native anchor and advances rather than restarting every bounded pass',async()=>{
 const pages=Array.from({length:9},(_,i)=>[post(i+1,{replyCount:0,at:NOW-2*DAY})]);
 const prior={99:pending({postedAt:NOW-30*DAY})};
 const first=await run({pages,prior});assert.equal(first.result.reason,'profile_cursor');assert.equal(first.queue.cursor.id,'6');
 const second=await run({now:first.result.nextWakeAt,pages,prior:first.counts,queue:first.queue});
 assert.equal(second.events.includes('scrollTo:3200'),true);assert.equal(second.queue.cursor,null);assert.equal(second.counts['99'].lastOutcome,'pending');
});
test('a missing profile header stops the round before scanning all cached targets',async()=>{
 const f=await run({header:false,prior:{1:pending(),2:pending(),3:pending()}});assert.equal(f.result.reason,'PAGE_NOT_READY');assert.equal(f.calls.length,0);assert.equal(f.opens,0);
});
test('no-quote foreign and non-original profile rows never become owned reply targets',async()=>{
 const f=await run({pages:[[post(1,{author:'foreign'}),post(2,{original:false}),post(3,{replyCount:0})]]});assert.deepEqual(roots(f),[]);
 assert.equal(f.counts['1'],undefined);assert.equal(f.counts['2'],undefined);
});
test('a draft or a wrong account prevents any navigation',async()=>{
 await assert.rejects(run({draft:true}),{code:'RESIDUAL_DRAFT'});await assert.rejects(run({account:'/wrong'}),{code:'ACCOUNT_CHANGED'});
});
test('unknown sends and unverified returns preserve the target page rather than guessing a return',async()=>{
 const unknown=Object.assign(Error('unknown'),{code:'SEND_UNKNOWN',submitted:true,preserveDrafts:true});
 await assert.rejects(run({threadResult:unknown}),e=>e===unknown);
 await assert.rejects(run({returnError:'RETURN_UNVERIFIED'}),{code:'RETURN_UNVERIFIED',preserveDrafts:true});
});
test('a successful scan emits explicit coverage progress, not merely a waiting heartbeat',async()=>{
 const f=await run();assert.deepEqual(structuredClone(f.patches.find(p=>p.notificationScanProgress)?.notificationScanProgress),
  {completedAt:f.now,inspected:1,completedThreads:1,cursorAdvanced:false});
 const pending=await run({threadResult:{complete:false,stats:{},evidence:{cursorAdvanced:false}}});
 assert.equal(pending.patches.find(p=>p.notificationScanProgress).notificationScanProgress.completedThreads,0);
});
test('diagnostic sample returns after its single genuine target and retains the checkpoint',async()=>{
 const f=await run({singleRound:true,pages:[[post(1),post(2)]],threadResult:{sample:true,complete:false,reason:'trial_sample_confirmed',stats:{confirmed:1}}});
 assert.deepEqual(roots(f),['1']);assert.equal(f.result.sample,true);assert.equal(f.counts['1'].lastOutcome,'pending');
});
test('confirmed final counts are saved as hints while failed coverage never earns a completed checkpoint',async()=>{
 const f=await run({pages:[[post(1,{replyCount:7})]],threadResult:{complete:true,finalCommentCount:7,stats:{}}});assert.equal(f.counts['1'].handled,7);assert.equal(f.counts['1'].lastOutcome,'completed');
 const bad=await run({threadResult:{complete:true,finalCommentCount:7,stats:{failed:1}}});assert.equal(bad.counts['1'].lastOutcome,'pending');assert.equal(bad.counts['1'].handled,undefined);
});

test('a slow first batch cannot reacquire its expired hot roots ahead of unvisited originals',async()=>{
 const pages=[[1,2,3,4,5,6,7].map(id=>post(id))];
 const first=await run({pages,threadResult:{complete:false,stats:{eligible:1},evidence:{cursorAdvanced:true}}});
 const second=await run({now:first.now+180000,pages,prior:first.counts,queue:first.queue});
 assert.deepEqual(roots(second),['6','7']);assert.deepEqual(second.queue.visited,[]);
});

test('finishing a later profile segment does not relabel earlier checked roots as missing',async()=>{
 const pages=Array.from({length:9},(_,i)=>[post(i+1)]);
 const first=await run({pages,threadResult:{complete:false,stats:{eligible:1},evidence:{cursorAdvanced:true}}});
 const next=await run({now:first.now+180000,pages,prior:first.counts,queue:first.queue});
 assert.deepEqual(roots(first),['1','2','3','4','5']);assert.deepEqual(roots(next),['6','7','8','9']);
 assert.equal(next.counts['1'].idlePasses,0);assert.equal(next.counts['1'].lastProgressAt,first.counts['1'].lastProgressAt);
});

test('a bounded deep-seek hold keeps one native trip and continues the same detail without reopening it',async()=>{
 let calls=0;const f=await run({threadResult:()=>++calls===1?{complete:false,reason:'THREAD_COMMENTS_PENDING',stats:{},evidence:{retainView:true,seekAdvanced:true,cursorAdvanced:false,resumePending:true}}:
  {complete:true,finalCommentCount:3,stats:{},evidence:{topChecked:true}}});
 assert.equal(f.result.reason,'profile_seek');assert.equal(f.result.queuePending,true);assert.equal(f.counts['1'].recheckTop,undefined);assert.equal(f.path,'/me/status/1');assert.deepEqual(f.events.filter(e=>/open:|back:/.test(e)),['open:1']);
 assert.equal(f.result.nextWakeAt-f.now,30000);
 const resumed=await f.repeat();assert.equal(resumed.stats.resumed,1);assert.equal(resumed.stats.visited,0);assert.deepEqual(roots(f),['1','1']);assert.equal(f.opens,1);assert.deepEqual(f.events.filter(e=>/open:|back:/.test(e)),['open:1','back:1']);
});
test('a different run drops a held Back permit rather than navigating with the obsolete trip',async()=>{
 const f=await run({threadResult:{complete:false,stats:{},evidence:{retainView:true,seekAdvanced:true,cursorAdvanced:false}}});
 await f.repeat({runId:'replacement'});
 assert.equal(f.events.includes('back:1'),false);assert.ok(f.events.filter(e=>e==='profile').length>=2);
});
test('a retained seek that makes no more progress returns once and uses the normal pending backoff',async()=>{
 let calls=0;const f=await run({threadResult:()=>++calls===1?{complete:false,stats:{},evidence:{retainView:true,seekAdvanced:true}}:{complete:false,stats:{},evidence:{retainView:false,cursorAdvanced:false}}});
 await f.repeat();assert.equal(f.opens,1);assert.equal(f.events.filter(e=>e==='back:1').length,1);assert.equal(f.counts['1'].nextCheckAt-f.now,300000);
});
test('unknown diagnostic replies keep their exact SEND_UNKNOWN result and never try the root return',async()=>{
 await assert.rejects(run({singleRound:true,threadResult:{sample:true,complete:false,reason:'trial_sample_unknown',stats:{failed:1}}}),e=>
  e.code==='SEND_UNKNOWN'&&e.submitted&&e.preserveDrafts&&!e.events.some(x=>x.startsWith('back:')));
});
test('stable completed counts skip detail for six hours and schedule discovery rather than a fifteen-second busy loop',async()=>{
 const prior={1:{...pending({lastOutcome:'completed',nextCheckAt:NOW-1}),handledCount:3,completedAt:NOW-100000}};
 const f=await run({prior});assert.deepEqual(roots(f),[]);assert.equal(f.counts['1'].nextCheckAt,prior[1].completedAt+6*3600000);
 assert.ok(f.result.nextWakeAt-f.now>=300000);
 const audit=await run({now:NOW+6*3600000,prior:f.counts});assert.deepEqual(roots(audit),['1']);
});
test('both a decrease and an increase wake a stable completed root and request a top recheck',async()=>{
 for(const count of [2,4]){
  const f=await run({pages:[[post(1,{replyCount:count})]],prior:{1:{...pending({lastOutcome:'completed',nextCheckAt:NOW+3600000}),handledCount:3,completedAt:NOW}},
   threadResult:{complete:true,finalCommentCount:count,stats:{},evidence:{topChecked:true}}});
  assert.deepEqual(roots(f),['1']);assert.equal(f.calls[0].recheckTop,true);assert.equal(f.counts['1'].handledCount,count);
 }
});
test('a count change during the scan stays pending until a subsequent stable complete pass',async()=>{
 const f=await run({pages:[[post(1,{replyCount:13})]],threadResult:(_o,{profileRows})=>{profileRows[0].replyCount=15;return {complete:true,finalCommentCount:15,stats:{},evidence:{topChecked:true}};}});
 assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.counts['1'].handledCount,undefined);assert.equal(f.counts['1'].recheckTop,true);
 assert.equal(f.counts['1'].nextCheckAt-f.now,60000);
 await f.repeat({advance:60000});assert.equal(f.calls.filter(c=>c.rootId).at(-1).recheckTop,true);assert.equal(f.counts['1'].handledCount,15);
});
test('a virtualized root may use the uniquely reacquired native profile count after the proven Back',async()=>{
 const f=await run({threadResult:{complete:true,finalCommentCount:null,stats:{},evidence:{topChecked:true}}});
 assert.equal(f.counts['1'].handledCount,3);assert.equal(f.counts['1'].lastOutcome,'completed');
});
test('a replaced or duplicate source card cannot supply the final count baseline',async()=>{
 for(const changed of ['time','duplicate']){
  const f=await run({pages:changed==='duplicate'?[[post(1),post(1)]]:[[post(1)]],threadResult:(_o,{profileRows})=>{
   if(changed==='time')profileRows[0].at--;
   return {complete:true,finalCommentCount:null,stats:{}};
  }});
  assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.counts['1'].handledCount,undefined);assert.equal(f.counts['1'].nextCheckAt-f.now,60000);
 }
});

test('a delayed profile scroll yields once instead of scrolling again over stale cards',async()=>{
 const f=await run({pages:[[post(1)],[post(2)],[post(3)]],scrollDelay:2900});
 assert.deepEqual(roots(f),['1']);assert.equal(f.result.reason,'profile_cursor');assert.equal(f.events.filter(e=>e.startsWith('scroll:')).length,1);
 assert.equal(f.queue.cursor.waiting.y,640);
 await f.repeat();assert.deepEqual(roots(f),['1','2']);assert.equal(f.events.filter(e=>e.startsWith('scroll:')).length,2);
 await f.repeat();assert.deepEqual(roots(f),['1','2','3']);assert.equal(f.queue.cursor,null);
});
test('a clamped/stalled profile render is bounded and never turns unknown pending roots into completed ones',async()=>{
 const f=await run({pages:[[post(1)],[post(2)]],prior:{99:pending({postedAt:NOW-30*DAY})},scrollDelay:Infinity});
 assert.equal(f.result.reason,'profile_cursor');await f.repeat();const end=await f.repeat();
 assert.equal(end.reason,'profile_pending');assert.equal(f.queue.cursor,null);assert.equal(f.counts['99'].lastOutcome,'pending');
 assert.equal(f.events.filter(e=>e.startsWith('scroll:')).length,1);
});
test('attachment-only, poll-only and file-only drafts prevent the profile sidebar navigation',async()=>{
 for(const media of ['attachments','pollCreator','file'])await assert.rejects(run({media}),e=>
  e.code==='RESIDUAL_DRAFT'&&!e.events.includes('profile')&&!e.events.some(x=>x.startsWith('open:')));
});
test('an unknown initial count never earns a stable completed baseline from a later numeric count alone',async()=>{
 const f=await run({pages:[[post(1,{replyCount:null})]],threadResult:{complete:true,finalCommentCount:3,stats:{}}});
 assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.counts['1'].handledCount,undefined);assert.equal(f.counts['1'].nextCheckAt-f.now,60000);
});
