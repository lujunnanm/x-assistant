import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../overlay.js',import.meta.url),'utf8');

test('exposure and eligibility gates run before relationship inspection',()=>{
 const gate=source.indexOf('core.interactionSkipReason(info,');
 const inspect=source.indexOf('await inspectFollowState(info,signal,',gate);
 assert.ok(gate>0);assert.ok(inspect>gate);
 assert.doesNotMatch(source,/desiredAuthorType|nextCycleIndex|state===desired/);
 assert.match(source,/followState:canFollow\?relation\.state:followEnabled\?'unknown':'unrestricted',followsYou:relation\.followsYou/);
 assert.match(source,/const shouldFollow=followEnabled&&info\.followState!=='followed'&&await autoFollow\(\)/);
 assert.doesNotMatch(source,/desired === '(?:followed|unfollowed)'/);
 assert.match(source,/正在从选定首页时间线找帖/);assert.match(source,/正在从搜索结果找帖/);
 assert.match(source,/low_exposure:'曝光不足或不可读'/);
});

// Run the actual candidate function, not a duplicate policy implementation.
test('auto-follow accepts consecutive unfollowed candidates without quotas',async()=>{
 const {default:vm}=await import('node:vm');
 const start=source.indexOf(' const findCandidate=');
 const end=source.indexOf(' const aiReply=',start);
 const snippet=source.slice(start,end)+'globalThis.selectCandidate=findCandidate;';
 for(const state of ['unfollowed']){
  let posts=[];
  const context=vm.createContext({document:{querySelector:()=>null},check:()=>{},pauseRequested:false,
   getLocal:async()=>({}),followCooldownActive:async()=>false,account:'/self',XAssistantDOM:{relocate:r=>r},processed:async()=>({posts:{}}),selfHandle:()=> 'self',visiblePosts:()=>posts,sessionAuthors:new Set(),
   core:{interactionSkipReason:()=>null},recordCandidate:()=>{},publishDiagnostics:async()=>{},
   inspectFollowState:async()=>({state,followsYou:state==='unfollowed'})});
  vm.runInContext(snippet,context);
  for(let i=0;i<8;i++){
   posts=[{id:String(i),author:'friend'+i,text:'交友',views:1000}];
   const selected=await context.selectCandidate(new AbortController().signal,true);
   assert.equal(selected.id,String(i));assert.equal(selected.followState,state);assert.equal(selected.followsYou,state==='unfollowed');
  }
 }
});

test('relationship inspection recognizes only explicit follower signals',()=>{
 assert.match(source,/\^\(回关\|Follow back\)/);
 assert.match(source,/关注了你\|关注你\|Follows you/);
 assert.doesNotMatch(source,/state==='followed'.*followsYou:true/);
});

test('one safely rejected unchanged search card is not revisited; a changed row and another ID remain eligible',async()=>{
 const {default:vm}=await import('node:vm');
 const snippet=source.slice(source.indexOf(' const findCandidate='),source.indexOf(' const aiReply='))+'globalThis.pick=findCandidate;';
 const old={id:'123',author:'friend',time:'10:00',text:'交友'},next={...old,id:'456'},ledger=new Map([[old.id,{author:old.author,time:old.time,text:old.text}]]),events=[];
 let rows=[];
 const cx=vm.createContext({document:{querySelector:()=>null},check(){},processed:async()=>({posts:{}}),selfHandle:()=> 'self',followCooldownActive:async()=>false,visiblePosts:()=>rows,sessionAuthors:new Set(),core:{interactionSkipReason:()=>null},recordCandidate:(r,s)=>events.push([r.id,s]),publishDiagnostics:async()=>{},inspectFollowState:async r=>{events.push(['inspect',r.id]);return {state:'unfollowed'};}});
 vm.runInContext(snippet,cx);
 rows=[{...old},next];assert.equal((await cx.pick({},true,ledger)).id,next.id);assert.deepEqual(events.slice(0,3),[['123','unchanged_mismatch'],['456',null],['inspect','456']]);
 for(const changed of [{...old,text:'交友（已补全文字）'},{...old,time:'10:01'},{...old,author:'other'}]){
  rows=[changed];assert.equal((await cx.pick({},true,ledger)).id,old.id);
 }
 // Another round with no cache can re-check. Quarantines always take precedence.
 rows=[old,next];assert.equal((await cx.pick({},true,new Map())).id,old.id);
 cx.core.interactionSkipReason=r=>r.id===old.id?'uncertain':null;events.length=0;
 assert.equal((await cx.pick({},true,ledger)).id,next.id);assert.equal(events[0][1],'uncertain');
});
