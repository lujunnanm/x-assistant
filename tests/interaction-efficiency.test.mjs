import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const helper=src.slice(src.indexOf(' const waitAfterAttempt='),src.indexOf(' const recoverDelayedComposer='));
const loop=src.slice(src.indexOf('  const runLoop ='),src.indexOf(' // A single owner per module;'));
function fixture({generation=4000,stopDuringWait=false,singleRound=false}={}){
 let now=0,deadline=0,completed=0,scans=0;
 const events=[],signal={aborted:false};
 const ctx=vm.createContext({Date:{now:()=>now},Map,Set,Math,Number,DOMException,
  replySubmitted:false,deferRecord:async()=>{},account:'/self',activeRun:'run',homeSource:null,selected:null,sessionAuthors:new Set(),
  location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},
  core:{interactionPage:()=>true},XAssistantWorkspace:{state:()=>({assignment:{singleRound}})},
  XAssistantTime:{arm:async()=>{deadline=now+30000;events.push(['arm',now,deadline]);return deadline;}},
  check:()=>{if(signal.aborted)throw new DOMException('stop','AbortError');},
  requireSource:async()=>{},publishDiagnostics:async()=>{},status(){},markSelected(){},recordOutcome(){},
  runtime:async()=>({active:completed<2,runId:'run',nextAt:deadline,completed}),
  updateRuntime:async p=>{if(p.completed!==undefined)completed=p.completed;},saveProcessed:async()=>{},
  autoFollow:async()=>false,
  findCandidate:async()=>{events.push(['scan',now]);now+=2000;return {id:String(++scans),author:'user'+scans,text:'AI tools',followState:'unrestricted',followsYou:null};},
  aiReply:async info=>{events.push(['generate',now]);now+=generation;return {postId:info.id,action:'send_reply',text:'reply'};},
  randomWait:async(min,max)=>{assert.equal(min,max);events.push(['wait',now,min*1000]);now+=min*1000;if(stopDuringWait)signal.aborted=true;},
  replyAndSend:async(info,text,s,confirmed)=>{events.push(['send',now]);await confirmed();return 'verified';}
 });
 vm.runInContext(helper+loop+';globalThis.run=runLoop;',ctx);
 return {events,run:()=>ctx.run(signal,'run','home')};
}
test('next scan and AI generation overlap the saved 30s interval; no early reply or added preparation delay',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',6000],['send',36000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='wait'),[['wait',12000,24000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='scan'),[['scan',0],['scan',6000]]);
});
test('slow generation consumes cooldown naturally without a second wait or catch-up send',async()=>{
 const f=fixture({generation:40000});await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',42000],['send',84000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='wait'),[]);
});
test('stop while the prepared reply waits cannot enter its reply transaction',async()=>{
 const f=fixture({stopDuringWait:true});
 await assert.rejects(f.run(),{name:'AbortError'});
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',6000]]);
});
test('single-round mode retains its full post-attempt wait instead of preparing ahead',async()=>{
 const f=fixture({singleRound:true});await f.run();
 assert.equal(f.events.find(e=>e[0]==='wait')[2],30000);
 assert.equal(f.events.filter(e=>e[0]==='scan')[1][1],36000);
});
test('a committed search URL does not enter candidate scanning until the new result list is proven',async()=>{
 const events=[];let pending=true,checks=0;
 const path='/search?q=manual&f=live';
 const c=vm.createContext({Map,homeSource:null,location:{href:'https://x.com'+path,pathname:'/search',search:'?q=manual&f=live'},
  check(){},requireSource:async()=>{},core:{interactionPage:()=>true},document:{querySelector:()=>null},
  XAssistantEntry:{filtersFor:async()=>({path,validate(){}}),waitingForList:()=>pending,enter:async()=>{
   events.push('verify');if(++checks===1)throw Object.assign(Error('等待新结果'),{code:'SEARCH_RESULTS_WAIT'});pending=false;
  }},status:()=>{},sleep:async ms=>{events.push(ms);},runtime:async()=>{assert.equal(pending,false);events.push('ready');return {active:false};},
  findCandidate:()=>assert.fail('no candidate before a new list is ready')});
 vm.runInContext(loop+';globalThis.run=runLoop;',c);
 await c.run({aborted:false},'run','search');assert.deepEqual(events,['verify',2000,'verify','ready']);
});
test('follow cooldown can resolve inbound relation without authorizing an outgoing follow',async()=>{
 const pick=src.slice(src.indexOf(' const findCandidate='),src.indexOf(' const aiReply='));
 for(const badge of [true,false]){
  let inspected=0;
  const c=vm.createContext({document:{querySelector:()=>null},check(){},processed:async()=>({posts:{}}),selfHandle:()=> 'self',visiblePosts:()=>[{id:'1',author:'writer',text:'AI tools'}],core:{interactionSkipReason:()=>null},sessionAuthors:new Set(),recordCandidate(){},publishDiagnostics:async()=>{},followCooldownActive:async()=>true,followsYouBadge:()=>badge,inspectFollowState:async(_row,_signal,_validate,observe)=>{assert.equal(observe,false);inspected++;return {state:'unfollowed',followsYou:false};}});
  vm.runInContext(pick+';globalThis.pick=findCandidate;',c);
  const r=await c.pick({},true);
  assert.equal(r.followState,'unknown');assert.equal(r.followsYou,badge?true:false);assert.equal(inspected,badge?0:1);
 }
});
