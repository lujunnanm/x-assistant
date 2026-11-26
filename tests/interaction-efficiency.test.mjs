import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const helper=src.slice(src.indexOf(' const waitAfterAttempt='),src.indexOf(' const recoverDelayedComposer='));
const loop=src.slice(src.indexOf('  const runLoop ='),src.indexOf(' // A single owner per module;'));
function fixture({generation=4000,stopDuringWait=false,singleRound=false,images=false}={}){
 let now=0,deadline=0,completed=0,scans=0;
 const events=[],signal={aborted:false};
 const ctx=vm.createContext({Date:{now:()=>now},Map,Set,Math,Number,DOMException,
  replySubmitted:false,deferRecord:async()=>{},account:'/self',activeRun:'run',homeSource:null,selected:null,sessionAuthors:new Set(),
  location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},
  core:{interactionPage:()=>true},XAssistantWorkspace:{check(){},state:()=>({assignment:{singleRound}})},
  XAssistantTime:{arm:async()=>{deadline=now+30000;events.push(['arm',now,deadline]);return deadline;}},
  check:()=>{if(signal.aborted)throw new DOMException('stop','AbortError');},
  requireSource:async()=>{},publishDiagnostics:async()=>{},status(){},markSelected(){},recordOutcome(){},
  runtime:async()=>({active:completed<2,runId:'run',nextAt:deadline,completed}),
  updateRuntime:async p=>{if(p.completed!==undefined)completed=p.completed;},saveProcessed:async()=>{},
  autoFollow:async()=>false,
  findCandidate:async()=>{events.push(['scan',now]);now+=2000;return {id:String(++scans),author:'user'+scans,text:'AI tools',followState:'unrestricted',followsYou:null,...(images?{imageUrls:['https://pbs.twimg.com/media/A.jpg']}:{})};},
  aiReply:async(info,signal,_filters,notBefore)=>{ctx.current=info;return ctx.XAssistantReplyPreparation.generate({row:info,account:'/self',module:'interaction',runId:'run',signal,notBefore});},
  XAssistantDOM:{account:()=>'/self',replyHasVideo:()=>false,replyHasImages:()=>images,replyContext:()=>{const info=ctx.current,target={id:info.id,author:info.author,text:info.text,parentId:null,...(images?{imageUrls:info.imageUrls}:{})};return {version:1,root:target,history:[],target};}},
  XAssistantTasks:{check:()=>{if(signal.aborted)throw new DOMException('stop','AbortError');},waitForPage:async probe=>probe(),bounded:async work=>work(),sleep:async ms=>{events.push(['prepared-wait',now,ms]);now+=ms;if(stopDuringWait)signal.aborted=true;}},
  XAssistantRuntime:{call:async msg=>{events.push(['generate',now]);now+=generation;return {postId:msg.post.id,action:'send_reply',text:'reply'};}},
  randomWait:async(min,max)=>{assert.equal(min,max);events.push(['wait',now,min*1000]);now+=min*1000;if(stopDuringWait)signal.aborted=true;},
  replyAndSend:async(info,prepare,s,confirmed)=>{await prepare();events.push(['send',now]);await confirmed();return 'verified';}
 });
 vm.runInContext(readFileSync(new URL('../reply-preparation.js',import.meta.url),'utf8')+helper+loop+';globalThis.run=runLoop;',ctx);
 return {events,run:()=>ctx.run(signal,'run','home')};
}
test('next scan overlaps cooldown; fresh detail generation runs after the interval',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',6000],['send',40000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='wait'),[['wait',8000,28000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='scan'),[['scan',0],['scan',6000]]);
});
test('slow detail generation never creates a catch-up send',async()=>{
 const f=fixture({generation:40000});await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',42000],['send',112000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='wait'),[['wait',44000,28000]]);
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

test('image preparation starts in the previous interaction cooldown and sends no earlier than its deadline',async()=>{
 const f=fixture({images:true});await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='generate'),[['generate',2000],['generate',8000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',6000],['send',36000]]);
 assert.equal(f.events.filter(e=>e[0]==='generate').length,2);
});
test('slow image preparation overlaps instead of adding the interaction cooldown',async()=>{
 const f=fixture({images:true,generation:40000});await f.run();
 assert.deepEqual(f.events.filter(e=>e[0]==='generate'),[['generate',2000],['generate',44000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',42000],['send',84000]]);
});
test('cancelling a ready image reply during cooldown never enters editor/send',async()=>{
 const f=fixture({images:true,stopDuringWait:true});await assert.rejects(f.run(),{name:'AbortError'});
 assert.deepEqual(f.events.filter(e=>e[0]==='send'),[['send',6000]]);
 assert.equal(f.events.filter(e=>e[0]==='generate').length,2);
});
