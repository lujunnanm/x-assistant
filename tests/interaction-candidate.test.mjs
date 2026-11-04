import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../overlay.js',import.meta.url),'utf8');

test('friendship and 500-view gate runs before follow-state inspection in every mode',()=>{
 const gate=source.indexOf('core.interactionSkipReason(info,');
 const disabled=source.indexOf("if(!followEnabled)return{...info,followState:'unrestricted'};",gate);
 const inspect=source.indexOf('const state=await inspectFollowState(info,signal);',gate);
 assert.ok(gate>0);assert.ok(disabled>gate);assert.ok(inspect>disabled);
 assert.doesNotMatch(source,/desiredAuthorType|nextCycleIndex|state===desired/);
 assert.match(source,/return\{\.\.\.info,followState:state\};/);
 assert.match(source,/followEnabled && info\.followState === 'unfollowed'/);
 assert.doesNotMatch(source,/desired === '(?:followed|unfollowed)'/);
 assert.match(source,/正在寻找交友帖 · 曝光≥500/);
 assert.doesNotMatch(source,/正在寻找曝光高于 5000 的帖子/);
});

// Run the actual candidate function, not a duplicate policy implementation.
test('auto-follow accepts consecutive followed and unfollowed candidates without quotas',async()=>{
 const {default:vm}=await import('node:vm');
 const start=source.indexOf(' const findCandidate=');
 const end=source.indexOf(' const aiReply=',start);
 const snippet=source.slice(start,end)+'globalThis.selectCandidate=findCandidate;';
 for(const state of ['followed','unfollowed','unknown']){
  let posts=[];
  const context=vm.createContext({document:{querySelector:()=>null},check:()=>{},pauseRequested:false,
   processed:async()=>({posts:{}}),selfHandle:()=> 'self',visiblePosts:()=>posts,sessionAuthors:new Set(),
   core:{interactionSkipReason:()=>null},recordCandidate:()=>{},publishDiagnostics:async()=>{},
   inspectFollowState:async()=>state});
  vm.runInContext(snippet,context);
  for(let i=0;i<8;i++){
   posts=[{id:String(i),author:'friend'+i,text:'交友',views:500}];
   const selected=await context.selectCandidate(new AbortController().signal,true);
   assert.equal(selected.id,String(i));assert.equal(selected.followState,state);
  }
 }
});
