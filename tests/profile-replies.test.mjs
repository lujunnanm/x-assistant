import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const NOW=1794279309177, MISSED='2119815216850764251', MISSED_PATH='/me/status/'+MISSED;
async function run({now=NOW,prior={},count=3,finalCount=count,failure=false,secondPost=false,missingLink=false,noHeader=false,renderDelay=1500,foreignRow=false,sample=false,vanishAfterDiscovery=false,slowTop=false,many=false,singleRound=!!sample,noLoadedCards=false,overscan=[],virtualPages=false,restoreDelay=2900,reflow=0,returnAsNext=false,replacedIdentity=false,nativeRestore=false,alignFlow=false,initialProfileY=null,unmovedAfterTop=false,startPath='/home',fullNavigation=false,draft=false,threadResult}={}){
 const paths=[],calls=[],events=[],issues=[],storage={xAssistantProfileCommentCountsV1:{'/me':structuredClone(prior)}};
 const location={pathname:startPath,search:'',hash:'',assign(url){
   const u=new URL(url);assert.equal(u.origin,'https://x.com');assert.equal(expected,u.pathname);
   events.push('assign:'+u.pathname);
   assert.ok(storage.xAssistantProfileCommentCountsV1['/me'][u.pathname.split('/').at(-1)].retryOpenedAt,'retry must be durable before unloading');
   if(fullNavigation)throw Object.assign(Error('new document'),{name:'AbortError'});
   location.pathname=u.pathname;
 }};
 let returns=0;const jumps=[];
 let clock=now,readyAt=Infinity,expected=null,scrollResets=0,scrolls=0,y=0,topReady=0,restoreAt=0;
 const physicalY=()=>virtualPages&&clock<restoreAt?0:y;
 const row=(id,author,at,replyCount)=>({id,author,at,replyCount,article:{id,getBoundingClientRect(){
   const moved=returns>0?(alignFlow?1000-y:reflow):0;
   const top=returnAsNext&&id==='7'&&!returns||overscan.includes(id)||virtualPages&&id==='9'&&physicalY()===0?1000:70+(Number(id)||0)*20+moved;
   const visual=initialProfileY!==null?top-(unmovedAfterTop?initialProfileY:y):top;return {height:80,top:visual,bottom:visual+80};
 }}});
 const rows=[row('1','me',now-100,count),row('2','me',now-86400001,8),row('3','other',now-50,5)];
 if(secondPost)rows.push(row('6','me',now-500,1));
 if(many)for(const id of ['10','11','12','13'])rows.push(row(id,'me',now-Number(id)*100,1));
 if(slowTop||virtualPages)for(const id of ['old1','old2','old3'])rows.push(row(id,'me',now-86400002,1));
 if(virtualPages)rows.push(row('7','me',now-750,1),row('9','other',now-10,0));
 const foreign=row('9','me',now-1,7);
 if(initialProfileY!==null){location.pathname='/me';y=initialProfileY;readyAt=clock;}
 const mounted=()=>location.pathname==='/me'&&clock>=readyAt;
 const liveRows=()=>[...(mounted()?rows.filter(r=>{
    if(returnAsNext&&returns>0&&physicalY()>0&&physicalY()<1000)return r.id==='7'||r.id==='9';
    if(virtualPages)return (physicalY()===0?['1','2','9']:physicalY()<1000?['6','7','9']:['old1','old2','old3']).includes(r.id);
    if(slowTop)return (y>0||clock<topReady)===r.id.startsWith('old');
    return !vanishAfterDiscovery||scrolls<1||!(many?['1','10','11','12','13']:['1']).includes(r.id);
  }).map(r=>replacedIdentity&&returns&&['6','7'].includes(r.id)?{...r,at:r.at+1}:r):[]),...(foreignRow?[foreign]:[])];
 const primary={
  contains:a=>mounted()&&rows.some(r=>r.article===a),
  querySelector:s=>s.includes('UserProfileHeader_Items')&&mounted()&&!noHeader?{}:null,
  querySelectorAll:s=>s.includes('progressbar')&&!mounted()?[{closest:()=>null}]:[],
 };
 const profileLink={getAttribute:k=>k==='href'?'/me':null,click(){
  if(location.pathname.startsWith('/me/status/')){returns++;if(virtualPages&&!nativeRestore)y=0;}
  assert.equal(expected,'/me','declare exact owner route before native click');
  expected=null;events.push('native:profile');paths.push('/me');location.pathname='/me';readyAt=clock+renderDelay;
 }};
 class TaskError extends Error{constructor(code,message){super(message);this.code=code;}}
 // Delayed real-route fixtures: update pathname on an authorized native click;
 // the primary column, account header and its own rows arrive independently.
 const waitForPage=async(probe,{timeout=10000}={})=>{
  const end=clock+timeout;for(;;){const value=probe();if(value)return value;if(clock>=end)return null;clock=Math.min(clock+100,end);}
 };
 const c=vm.createContext({Date:{now:()=>clock},location,innerHeight:800,
   history:{pushState(){throw Error('profile navigation must use a real link');}},
   chrome:{storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async d=>Object.assign(storage,structuredClone(d))}}},
   window:{get scrollY(){return y;},scrollTo:({top})=>{jumps.push(top);scrollResets++;if(y>0&&top===0&&slowTop)topReady=clock+2600;
     if(virtualPages&&top>0&&y===0)restoreAt=clock+restoreDelay;y=top;},scrollBy:(_x,dy)=>{
     assert.ok(!virtualPages||clock>=restoreAt,'must not advance while stale rows are mounted at the reported scrollTop');y+=dy;scrolls++;
   }},document:{
    querySelector:s=>s.includes('AppTabBar_Profile_Link')?missingLink?null:profileLink:s.includes('primaryColumn')?primary:null,
    querySelectorAll:s=>draft&&s==='[contenteditable="true"]'?[{}]:[],
   },
   XAssistantCore:{editorText:()=>draft?'draft':''},
   XAssistantWorkspace:{state:()=>({assignment:{singleRound}}),check(){},expectNavigation:p=>{expected=p;events.push('expect:'+p);}},
   XAssistantRuntime:{runtime:async(_mod,_op,{patch})=>{if(patch.lastIssue)issues.push(patch.lastIssue);}},
   XAssistantDOM:{account:()=>'/me',dialogs:()=>[],rows:liveRows,
    originalPost:id=>liveRows().some(r=>r.id===id&&r.author==='me')},
   XAssistantTasks:{check:()=>{},sleep:async ms=>{clock+=ms;},waitForPage,TaskError},
   XAssistantNotifications:{scan:async o=>{
    calls.push(o);
    if(o.rootId){
      if(o.retryOriginal)assert.equal(location.pathname,o.threadPath,'retry scans only the selected canonical detail');
      else {
       assert.equal(mounted(),true,'pass a restored, rendered profile to each detail scan');
       assert.ok(liveRows().some(r=>r.id===o.rootId&&primary.contains(r.article)),'target must be mounted in the real profile primary column');
      }
      location.pathname=o.threadPath;events.push('detail:'+o.rootId);
    }else location.pathname='/notifications/mentions';
    if(o.rootId==='1'&&threadResult)return threadResult;
    if(noLoadedCards&&o.rootId)return {complete:false,reason:'THREAD_COMMENTS_PENDING',detail:'主栏卡 1，已核对同串评论卡 0，已加载直接子评论元数据 6',stats:{seen:0},evidence:{threadRows:0}};
    return sample&&o.rootId?{sample:true,complete:false,reason:sample,stats:{confirmed:sample==='trial_sample_confirmed'?1:0,failed:sample==='trial_sample_unknown'?1:0}}:
     {complete:true,reason:'exhausted',finalCommentCount:finalCount,stats:{confirmed:1,failed:failure&&o.rootId==='1'?1:0}};
   }}});
 vm.runInContext(readFileSync(new URL('../profile-replies.js',import.meta.url),'utf8'),c);
 let result;
 try{result=await c.XAssistantProfileReplies.scan({account:'/me',signal:new AbortController().signal,until:now});}
 catch(e){if(!fullNavigation||e.name!=='AbortError')throw e;}
 return {result,calls,paths,events,issues,scrolls,scrollResets,jumps,counts:storage.xAssistantProfileCommentCountsV1['/me']};
}
test('first scan handles recent originals then mentions and persists comment counts',async()=>{
 const f=await run();
 assert.equal(f.paths[0],'/me');assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].threadPath,'/me/status/1');assert.equal(f.calls[0].ignoreLikedBoundary,undefined);
 assert.equal(f.calls[1].mentionsOnly,true);assert.equal(f.counts['1'].handled,3);
});
test('unchanged comments skip detail but still process mentions',async()=>{
 const f=await run({prior:{'1':{handled:3,checkpointVersion:2}}});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].mentionsOnly,true);
});
test('increased count enters post before mentions',async()=>{
 const f=await run({prior:{'1':{handled:2}}});
 assert.equal(f.calls[0].rootId,'1');assert.equal(f.calls[1].mentionsOnly,true);
});
test('failed reply retains count checkpoint but still proceeds to mentions',async()=>{
 const f=await run({prior:{'1':{handled:2}},failure:true});
 assert.equal(f.counts['1'].handled,2);assert.equal(f.calls.length,2);assert.equal(f.calls[1].mentionsOnly,true);assert.equal(f.result.rest,true);
});
test('unreadable count scans conservatively and does not invent a checkpoint',async()=>{
 const f=await run({count:null});assert.equal(f.calls.length,2);assert.equal(f.counts['1'].handled,undefined);
});

test('checkpoint uses final detail count rather than stale profile count',async()=>{
 const f=await run({count:3,finalCount:5});
 assert.equal(f.counts['1'].handled,5);
});

test('per-post failure retains pending state rather than returning inside the queue',()=>{
 const source=readFileSync(new URL('../profile-replies.js',import.meta.url),'utf8');
 assert.match(source,/stats\.pending\+\+/);
 assert.match(source,/lastOutcome='pending'/);
 assert.match(source,/owner\+'\/status\/'\+post.id/);
 assert.match(source,/return;\s*}\s*counts\[post.id\].lastOutcome='completed'/);
});

test('a failed first post does not prevent the second post from being processed',async()=>{
 const f=await run({failure:true,secondPost:true});
 assert.deepEqual(f.calls.map(c=>c.rootId),['1','6',undefined]);
 assert.equal(f.calls[2].mentionsOnly,true);
 assert.equal(f.counts['1'].lastOutcome,'pending');
 assert.equal(f.counts['6'].lastOutcome,'completed');
 assert.equal(f.result.stats.visited,2);assert.equal(f.result.stats.pending,1);
});


test('profile queue retains page ownership between details and visits all discovered originals',async()=>{
 const f=await run({secondPost:true});
 assert.deepEqual(f.calls.map(c=>c.rootId),['1','6',undefined]);
 for(const call of f.calls.filter(c=>c.rootId))assert.equal(call.returnToHome,false);
 assert.equal(f.result.reason,'profile_complete');
});

test('unchanged counts cannot suppress a pending post from an incomplete pass',async()=>{
 const f=await run({prior:{'1':{handled:3,lastOutcome:'pending'}}});
 assert.equal(f.calls[0].rootId,'1');
 assert.equal(f.counts['1'].lastOutcome,'completed');
});

const MIN=60000;
const coverageGap=(reason='THREAD_COMMENTS_FOLDED',overrides={})=>({
 complete:false,reason,stats:{seen:2},evidence:{expectedDirect:3,seenDirect:2,metadataDirect:2,threadRows:2},...overrides
});
async function repeatedGap(threadResult=coverageGap()){
 const first=await run({threadResult,prior:{'1':{handled:1,checkpointVersion:2}}});
 assert.equal(first.counts['1'].coverageRetry.streak,1);
 assert.equal(first.counts['1'].coverageRetry.retryAt,null);
 return run({now:NOW+10*MIN,prior:first.counts,threadResult});
}
test('unchanged gaps persist a per-post backoff across runs without blocking other posts or mentions',async()=>{
 for(const reason of ['THREAD_COMMENTS_FOLDED','THREAD_COMMENTS_PENDING']){
  const threadResult=coverageGap(reason),second=await repeatedGap(threadResult);
  const c=second.counts['1'];
  assert.equal(c.coverageRetry.streak,2);assert.ok(c.coverageRetry.retryAt>=NOW+40*MIN);
  assert.equal(c.handled,1);assert.equal(c.lastOutcome,'pending');
  const early=await run({now:NOW+20*MIN,prior:second.counts,threadResult,secondPost:true});
  assert.deepEqual(early.calls.map(x=>x.rootId),['6',undefined]);assert.ok(!early.events.some(x=>x.startsWith('assign:')));
  assert.equal(early.result.reason,'profile_pending');assert.equal(early.result.stats.coverageDeferred,1);
  assert.deepEqual(early.counts['1'],c,'deferring does not rewrite the last-check time');
  const due=await run({now:c.coverageRetry.retryAt,prior:early.counts,threadResult});
  assert.equal(due.calls[0].rootId,'1');assert.equal(due.calls[0].retryOriginal,true);
  assert.equal(due.counts['1'].coverageRetry.streak,3);
  assert.ok(due.counts['1'].coverageRetry.retryAt>=c.coverageRetry.retryAt+60*MIN);
  let later=due;
  for(let i=0;i<2;i++){
   const next=await run({now:later.counts['1'].coverageRetry.retryAt,prior:later.counts,threadResult});
   assert.equal(next.counts['1'].coverageRetry.streak,4);
   assert.equal(next.counts['1'].coverageRetry.retryAt-next.counts['1'].checkedAt,120*MIN);
   later=next;
  }
 }
});
test('changed visible reply count bypasses a backoff and clears it on verified completion',async()=>{
 const pending=await repeatedGap();
 for(const count of [0,4]){
  const f=await run({now:NOW+20*MIN,prior:pending.counts,count});
  assert.equal(f.calls[0].rootId,'1');assert.equal(f.calls[0].retryOriginal,false);
  assert.equal(f.counts['1'].lastOutcome,'completed');assert.equal(f.counts['1'].handled,count);
  assert.equal(f.counts['1'].coverageRetry,undefined);
 }
});
test('an actual send or AI failure, unread count or evidence of unloaded cards is not put on coverage backoff',async()=>{
 for(const threadResult of [
  coverageGap('THREAD_COMMENTS_PENDING',{stats:{seen:2,failed:1}}),
  coverageGap('THREAD_COMMENTS_FOLDED',{stats:{seen:2,aiFailed:1}}),
  coverageGap('THREAD_COMMENTS_PENDING',{evidence:{expectedDirect:null,seenDirect:2,metadataDirect:2}}),
  coverageGap('THREAD_COMMENTS_PENDING',{evidence:{expectedDirect:3,seenDirect:2,metadataDirect:3}}),
  coverageGap('THREAD_COMMENTS_PENDING',{evidence:{expectedDirect:3,seenDirect:2,metadataDirect:1}})
 ]){
  const pending=await repeatedGap();
  const f=await run({now:pending.counts['1'].coverageRetry.retryAt,prior:pending.counts,threadResult});
  assert.equal(f.counts['1'].coverageRetry,undefined);assert.equal(f.counts['1'].lastOutcome,'pending');
  const next=await run({now:f.counts['1'].checkedAt+10*MIN,prior:f.counts});
  assert.equal(next.calls[0].rootId,'1');
 }
});


test('legacy completion counts get one audit instead of hiding previously missed replies',async()=>{
 const f=await run({prior:{'1':{handled:3,lastOutcome:'completed'}}});
 assert.equal(f.calls[0].rootId,'1');assert.equal(f.counts['1'].checkpointVersion,2);
});

test('two real profile visits reacquire the native link and mounted rows before scanning each detail',async()=>{
 const f=await run({secondPost:true,foreignRow:true,renderDelay:3100});
 assert.deepEqual(f.events,['expect:/me','native:profile','detail:1','expect:/me','native:profile','detail:6','expect:/me','native:profile']);
 assert.equal(f.counts['9'],undefined,'same-account posts outside the profile column are not scanned');
});
test('an unresolved native route or missing profile header cannot checkpoint or process mentions',async()=>{
 await assert.rejects(run({missingLink:true}),e=>e.code==='PROFILE_NAV_LINK');
 const f=await run({noHeader:true});assert.equal(f.result.reason,'PROFILE_NOT_READY');assert.equal(f.calls.length,0);
 assert.deepEqual(f.counts,{});assert.equal(f.issues[0].code,'PROFILE_NOT_READY');
});
test('a bounded diagnostic sample leaves its prior count resumable and does not process other posts',async()=>{
 for(const sample of ['trial_sample_confirmed','trial_sample_unknown']){
  const f=await run({prior:{'1':{handled:1}},secondPost:true,sample});
  assert.equal(f.result.sample,true);assert.equal(f.result.reason,sample);assert.deepEqual(f.calls.map(c=>c.rootId),['1']);
  assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.counts['1'].handled,1);assert.equal(f.counts['6'],undefined);
 }
});

test('a virtualized native original missing on revisit cannot earn a checkpoint or block later posts',async()=>{
 const f=await run({secondPost:true,vanishAfterDiscovery:true,overscan:['1']});
 assert.deepEqual(f.calls.map(c=>c.rootId),['6',undefined]);assert.equal(f.calls.at(-1).mentionsOnly,true);
 assert.equal(f.counts['1'].handled,undefined);assert.equal(f.counts['1'].checkpointVersion,undefined);
 assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.issues[0].code,'PROFILE_POST_LINK');
 assert.equal(f.counts['6'].lastOutcome,'completed');assert.equal(f.result.reason,'profile_pending');
});


test('single diagnostic starts on a native original in the first viewport without scrolling it away or pretending the queue is empty',async()=>{
 const f=await run({sample:'trial_sample_confirmed',secondPost:true,slowTop:true});
 assert.equal(f.scrolls,0);assert.equal(f.result.sample,true);assert.deepEqual(f.calls.map(x=>x.rootId),['1']);
 assert.equal(f.issues.length,0);assert.equal(f.counts['1'].handled,undefined);
});
test('normal queue waits for virtual cards to remount after a saved viewport jump; stale bottom rows cannot trigger an early lower-bound exit',async()=>{
 const f=await run({slowTop:true,overscan:['1']});
 assert.deepEqual(f.calls.map(x=>x.rootId),['1',undefined]);assert.equal(f.counts['1'].lastOutcome,'completed');
 assert.equal(f.issues.length,0);assert.equal(f.scrolls,1,'one discovery scroll, no speculative extra scroll before the target remounts');
});
test('three consecutive native link misses preserve all remaining checkpoints and still check mentions',async()=>{
 const f=await run({many:true,vanishAfterDiscovery:true,overscan:['1','10','11','12','13']});
 assert.equal(f.result.stats.visited,3);assert.equal(f.result.stats.pending,3);assert.deepEqual(f.calls.map(x=>x.rootId),[undefined]);
 assert.equal(f.issues.at(-1).code,'PROFILE_LINK_BATCH_PAUSED');assert.equal(f.counts['13'],undefined);assert.equal(f.result.reason,'profile_pending');
});


test('three empty detail timeouts switch to mentions with quantified evidence and retain the untouched profile checkpoints',async()=>{
 const f=await run({many:true,noLoadedCards:true});
 assert.equal(f.result.reason,'profile_pending');assert.equal(f.result.stats.visited,3);assert.equal(f.result.stats.pending,3);assert.equal(f.calls.at(-1).mentionsOnly,true);
 assert.equal(f.issues.at(-1).code,'PROFILE_LOAD_BATCH_PAUSED');assert.match(f.issues.at(-1).message,/元数据 6.*3 个详情.*转查提及/);
 assert.equal(f.counts['1'].handled,undefined);assert.equal(f.counts['13'],undefined);
});

test('normal run visits visible originals before pagination removes them; each is opened only once',async()=>{
 const f=await run({secondPost:true,vanishAfterDiscovery:true});
 assert.deepEqual(f.calls.map(c=>c.rootId),['1','6',undefined]);assert.equal(f.result.reason,'profile_complete');
 assert.deepEqual(f.issues,[]);assert.equal(f.counts['1'].handled,3);
});
test('normal run resumes a later viewport using visible cards, not the reported scrollTop or a shared overscan row',async()=>{
 const f=await run({secondPost:true,virtualPages:true,prior:{'1':{checkpointVersion:2,handled:3,lastOutcome:'completed'}}});
 assert.deepEqual(f.calls.map(c=>c.rootId),['6','7',undefined]);assert.equal(f.result.stats.skipped,1);
 assert.equal(f.scrolls,2);assert.equal(f.result.reason,'profile_complete');assert.deepEqual(f.issues,[]);
});
test('a viewport that never remounts is reported and hands off to mentions without checkpointing unvisited cards',async()=>{
 const f=await run({secondPost:true,virtualPages:true,restoreDelay:Infinity});
 assert.deepEqual(f.calls.map(c=>c.rootId),['1','6',undefined]);assert.equal(f.scrolls,1);assert.equal(f.counts['7'],undefined);
 assert.equal(f.result.reason,'profile_pending');assert.equal(f.issues.at(-1).code,'PROFILE_VIEWPORT_PENDING');
});

test('a real prior original remains a return anchor after media reflows by over 160px; native viewport is not reset',async()=>{
 const f=await run({virtualPages:true,secondPost:true,reflow:320,nativeRestore:true,restoreDelay:Infinity,overscan:['9'],
   prior:{'1':{checkpointVersion:2,handled:3,lastOutcome:'completed'}}});
 assert.deepEqual(f.calls.map(x=>x.rootId),['6','7',undefined]);assert.equal(f.scrolls,2);
 assert.deepEqual(f.jumps,[0]);assert.deepEqual(f.issues,[]);
});
test('when an old visible anchor unmounts, a newly visible previously discovered genuine original rescues discovery',async()=>{
 const f=await run({virtualPages:true,secondPost:true,returnAsNext:true,overscan:['9'],
  prior:{'1':{checkpointVersion:2,handled:3,lastOutcome:'completed'}}});
 assert.deepEqual(f.calls.map(x=>x.rootId),['6','7',undefined]);assert.equal(f.scrolls,2);assert.deepEqual(f.issues,[]);
});
test('the same logical scroll position with replaced identities cannot visit or advance past unverified originals',async()=>{
 const f=await run({virtualPages:true,secondPost:true,replacedIdentity:true,overscan:['9'],
  prior:{'1':{checkpointVersion:2,handled:3,lastOutcome:'completed'}}});
 assert.deepEqual(f.calls.map(x=>x.rootId),['6',undefined]);assert.equal(f.counts['7'],undefined);assert.equal(f.scrolls,1);
 assert.equal(f.issues.at(-1).code,'PROFILE_VIEWPORT_PENDING');
});
test('a mounted owned original moved offscreen can be aligned using its actual rectangle; item failures retain their checkpoints',async()=>{
 const f=await run({secondPost:true,alignFlow:true,failure:true,prior:{'1':{handled:2}}});
 assert.deepEqual(f.calls.map(x=>x.rootId),['1','6',undefined]);assert.ok(f.jumps.includes(1000));
 assert.equal(f.counts['1'].handled,2);assert.equal(f.counts['1'].lastOutcome,'pending');assert.equal(f.counts['6'].lastOutcome,'completed');
 assert.ok(!f.issues.some(i=>i.code==='PROFILE_VIEWPORT_PENDING'));
});

test('short owned profile retains the same mounted top original after scrolling home: verify its absolute layout, do not require a new ID',async()=>{
 const good=await run({initialProfileY:680,sample:'trial_sample_confirmed'});
 assert.equal(good.calls[0]?.rootId,'1');assert.equal(good.issues.length,0);
 const stale=await run({initialProfileY:680,unmovedAfterTop:true,sample:'trial_sample_confirmed'});
 assert.equal(stale.result.reason,'PROFILE_NOT_READY');assert.equal(stale.calls.length,0);
});

const missed=(extra={})=>({checkedAt:NOW-3600000,lastOutcome:'pending',lastReason:'个人资料中未重新找到原创帖的原生链接：'+MISSED,handled:2,observed:3,checkpointVersion:2,...extra});
test('retry legacy pending original absent from profile after a full document navigation, before discovering other posts',async()=>{
 const first=await run({prior:{[MISSED]:missed()},fullNavigation:true});
 assert.deepEqual(first.events,['expect:'+MISSED_PATH,'assign:'+MISSED_PATH]);
 assert.deepEqual(first.calls,[]);assert.equal(first.counts[MISSED].handled,2);
 const next=await run({prior:first.counts,startPath:MISSED_PATH,finalCount:8});
 assert.deepEqual(next.calls.map(c=>c.rootId),[MISSED,'1',undefined]);
 assert.equal(next.calls[0].retryOriginal,true);
 assert.equal(next.counts[MISSED].handled,8);
 const finished=await run({prior:next.counts});
 assert.equal(finished.calls.some(c=>c.rootId===MISSED),false);
});
test('recent failed handoff cannot reload again immediately and does not prevent normal discovery',async()=>{
 const f=await run({prior:{[MISSED]:missed({retryOpenedAt:NOW-100})}});
 assert.ok(!f.events.some(e=>e.startsWith('assign:')));
 assert.deepEqual(f.calls.map(c=>c.rootId),['1',undefined]);
 assert.equal(f.counts[MISSED].lastOutcome,'pending');
});
test('fresh retry refuses to leave a user draft in the source page',async()=>{
 await assert.rejects(run({prior:{[MISSED]:missed()},draft:true}),e=>e.code==='RESIDUAL_DRAFT');
});
test('expired, malformed or completed saved entries do not initiate recovery navigation',async()=>{
 const prior={'1000000000000000000':missed(),'2119815216850764251/other':missed(),
  [MISSED]:missed({lastOutcome:'completed'})};
 const f=await run({prior});assert.ok(!f.events.some(e=>e.startsWith('assign:')));
 assert.deepEqual(f.calls.map(c=>c.rootId),['1',undefined]);
});
