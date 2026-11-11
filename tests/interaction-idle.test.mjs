import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf(' const findCandidate='),source.indexOf(' const aiReply='));
function fixture({rows,badge=false,skip=()=>null,advance}={}){
 let scrolls=0,inspections=0,gates=0;
 const cx=vm.createContext({document:{querySelector:()=>null},check(){},processed:async()=>({posts:{}}),selfHandle:()=> 'self',
  visiblePosts:()=>rows,sessionAuthors:new Set(),core:{interactionSkipReason:skip},recordCandidate(){},publishDiagnostics:async()=>{},
  followsYouBadge:()=>badge,followCooldownActive:async()=>{gates++;return false;},
  inspectFollowState:async()=>{inspections++;return {state:'followed',followsYou:null};},
  window:{scrollBy:()=>{scrolls++;if(advance)rows=advance(scrolls);}},innerHeight:900,sleep:async()=>{},status(){},skipSummary:()=>''});
 vm.runInContext(snippet+';globalThis.pick=findCandidate;',cx);
 return {pick:cx.pick,counts:()=>({scrolls,inspections,gates})};
}
test('reply-only mode keeps 33 followed authors eligible; only an unresolved inbound relation needs a menu read',async()=>{
 const rows=Array.from({length:33},(_,i)=>({id:String(i),author:'writer'+i,text:'AI tools'}));
 for(const badge of [false,true]){
  const f=fixture({rows,badge});const row=await f.pick({},false);
  assert.equal(row.id,'0');assert.equal(row.followState,'unrestricted');assert.equal(row.followsYou,badge?true:null);
  assert.deepEqual(f.counts(),{scrolls:0,inspections:badge?0:1,gates:0});
 }
});
test('reply-only mode still applies every send quarantine before selecting',async()=>{
 for(const reason of ['self','confirmed','uncertain','retry_cooldown','author_confirmed','unrelated','author_blocked']){
  const f=fixture({rows:[{id:'blocked'},{id:'eligible'}],skip:r=>r.id==='blocked'?reason:null});
  assert.equal((await f.pick({},false)).id,'eligible');
 }
});
test('stalled viewport is bounded without reopening menus on ineligible posts',async()=>{
 const f=fixture({rows:[{id:'1',author:'writer'}],skip:()=> 'low_exposure'});
 assert.equal(await f.pick({},true),null);assert.equal(f.pick.stalled,true);
 assert.deepEqual(f.counts(),{scrolls:2,inspections:0,gates:0});
});
test('empty viewport is bounded rather than repeatedly scanning six empty screens',async()=>{
 const f=fixture({rows:[]});assert.equal(await f.pick({},false),null);
 assert.equal(f.pick.stalled,true);assert.equal(f.counts().scrolls,2);
});
test('a newly loaded candidate after one unchanged viewport remains eligible',async()=>{
 const bad={id:'bad'},good={id:'good'};
 const f=fixture({rows:[bad],skip:r=>r.id==='bad'?'unrelated':null,advance:n=>n===1?[bad]:[good]});
 assert.equal((await f.pick({},false)).id,'good');assert.equal(f.pick.stalled,false);
});
test('home end-of-feed recovery returns to the same timeline top after waiting and stops cleanly',async()=>{
 const events=[],signal={aborted:false};let rounds=0;
 const pick=async()=>null;pick.stalled=true;
 const cx=vm.createContext({Map,homeSource:null,location:{href:'https://x.com/home',pathname:'/home',search:''},
  document:{querySelector:()=>null},check:()=>{if(signal.aborted)throw new DOMException('stop','AbortError');},requireSource:async()=>{},
  core:{interactionPage:()=>true},runtime:async()=>({active:++rounds===1,runId:'r'}),autoFollow:async()=>false,status(){},findCandidate:pick,
  waitAfterAttempt:async()=>events.push('wait'),window:{scrollTo:o=>events.push(['top',o.top])},sleep:async()=>events.push('settle')});
 vm.runInContext(source.slice(source.indexOf('  const runLoop ='),source.indexOf(' // A single owner per module;'))+';globalThis.run=runLoop;',cx);
 await cx.run(signal,'r','home');assert.deepEqual(events,['wait',['top',0],'settle']);
 rounds=0;events.length=0;cx.waitAfterAttempt=async()=>{signal.aborted=true;};
 await assert.rejects(cx.run(signal,'r','home'),{name:'AbortError'});assert.deepEqual(events,[]);
});
