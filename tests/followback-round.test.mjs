import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../followback.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(' async function loop('),source.indexOf(' function announce('))+';globalThis.run=loop;';
const target=n=>({target:'@user'+n,targetId:String(n)});
function fixture(steps,outcomes=[],options={}){
 let now=1000,scans=0,sends=0,waits=0;const events=[],stop=Object.assign(Error('end'),{code:'TEST_END'});
 const ctx=vm.createContext({Number,Set,Date:{now:()=>now},MODULE:'followback',SWEEP:'xAssistantFollowbackSweepV1',check(){},fail:(code,message,props)=>Object.assign(Error(message),{code,...props}),
  XAssistantWorkspace:{ready:Promise.resolve()},XAssistantDOM:{account:()=>'/self'},tell:(s,text)=>events.push(['progress',text]),patch:async(s,p)=>events.push(['patch',p]),
  api:{storage:{get:async()=>({xAssistantFollowbackSweepV1:options.sweep===true})},runtime:async()=>({runId:'run',nextAt:options.initial??56000}),call:async msg=>{if(msg.kind==='FOLLOWBACK_SWEEP_DONE'){events.push(['sweep-done']);return{};}assert.equal(msg.kind,'FOLLOWBACK_WAIT');waits++;events.push(['schedule']);return {nextAt:now+55000};},sleep:async ms=>{events.push(['sleep',ms]);if(events.filter(x=>x[0]==='sleep').length>1)throw stop;now+=ms;}},
  scan:async s=>{scans++;events.push(['scan']);const item=steps.shift();if(!item)throw stop;if(item.cost)now+=item.cost;if(item.error)throw item.error;if(item.exhausted)s.forwardScan=null;else if(item.partial||item.target)s.forwardScan??={fromTop:false};return item.target||null;},
  transact:async(s,t)=>{sends++;events.push(['target',t.target]);const result=outcomes.shift();if(result instanceof Error)throw result;return {status:'confirmed',nextAt:now+70000,...result};}
 });vm.runInContext(code,ctx);const s={signal:{aborted:false}};
 return {ctx,s,events,get scans(){return scans;},get sends(){return sends;},get waits(){return waits;},run:()=>ctx.run(s,()=>{})};
}
test('partial scan batches continue in the same round until one confirmed follow; no extra cooldown between batches',async()=>{
 const f=fixture([{partial:true},{partial:true},{partial:true},{target:target(1)},{target:target(1)}]);
 await assert.rejects(f.run(),{code:'TEST_END'});
 assert.equal(f.scans,6);assert.equal(f.sends,1);assert.equal(f.waits,0);
 assert.equal(f.s.forwardScan.confirmed,true);
 assert.deepEqual(f.events.filter(e=>e[0]==='sleep').map(e=>e[1]),[55000]);
});
test('proven unsent stale target is skipped, not counted as a completed round',async()=>{
 const f=fixture([{target:target(1)},{target:target(1)},{target:target(2)}],[{status:'skipped_unsent'},{status:'confirmed'}]);
 await assert.rejects(f.run(),{code:'TEST_END'});assert.equal(f.sends,2);assert.equal(f.waits,0);
 assert.ok(f.events.filter(e=>e[0]==='target').length===2);
 assert.deepEqual(f.events.filter(e=>e[0]==='sleep').map(e=>e[1]),[55000]);
 assert.ok(f.events.some(e=>e[0]==='patch'&&e[1].phase==='followback_scan'&&e[1].nextAt===null));
});
test('only exhausted full traversal schedules an idle check, without a follow attempt',async()=>{
 const f=fixture([{partial:true},{partial:true},{exhausted:true}]);
 await assert.rejects(f.run(),{code:'TEST_END'});assert.equal(f.scans,4);assert.equal(f.sends,0);assert.equal(f.waits,1);
});
for(const code of ['SEND_UNKNOWN','FOLLOW_LIMIT','FOLLOWBACK_SETTLE_FAILED'])test(code+' stops the round instead of trying another account',async()=>{
 const error=Object.assign(Error(code),{code,submitted:code!=='FOLLOW_LIMIT'});
 const f=fixture([{target:target(1)},{target:target(1)},{target:target(2)}],[error]);
 await assert.rejects(f.run(),{code});assert.equal(f.sends,1);assert.equal(f.scans,2);assert.equal(f.waits,0);
});
test('loading failure is not treated as an empty list or a completed round',async()=>{
 const f=fixture([{partial:true},{error:Object.assign(Error('loading'),{code:'FOLLOWBACK_LOADING'})}]);
 await assert.rejects(f.run(),{code:'FOLLOWBACK_LOADING'});assert.equal(f.waits,0);assert.equal(f.sends,0);
});
test('invalid confirmed deadline stops with confirmation evidence rather than selecting a second account',async()=>{
 const f=fixture([{target:target(1)},{target:target(1)},{target:target(2)}],[{nextAt:null}]);
 await assert.rejects(f.run(),{code:'FOLLOWBACK_SCHEDULE',submitted:true,confirmed:true});assert.equal(f.sends,1);
});
test('expired startup deadline requests a fresh persisted delay',async()=>{
 const f=fixture([{target:target(1)},{target:target(1)}],[],{initial:500});
 await assert.rejects(f.run(),{code:'TEST_END'});assert.equal(f.waits,1);
});

test('read-only discovery overlaps the original cooldown, with fresh selection before the click',async()=>{
 const f=fixture([{partial:true,cost:18000},{target:target(1),cost:12000},{target:target(2)}]);
 await assert.rejects(f.run(),{code:'TEST_END'});
 assert.deepEqual(f.events.filter(e=>e[0]==='sleep'),[['sleep',25000]]);
 assert.deepEqual(f.events.filter(e=>e[0]==='target'),[['target','@user2']]);
 assert.ok(f.events.findIndex(e=>e[0]==='scan')<f.events.findIndex(e=>e[0]==='sleep'));
});
test('long discovery uses the same round beyond deadline without adding another follow cooldown',async()=>{
 const f=fixture([{partial:true,cost:60000},{target:target(1)}]);
 await assert.rejects(f.run(),{code:'TEST_END'});
 assert.equal(f.sends,1);assert.deepEqual(f.events.filter(e=>e[0]==='sleep'),[]);
});
test('完整遍历利用冷却继续刷列表，到达末尾后只完成一次并结束',async()=>{
 const f=fixture([{target:target(1)},{target:target(1)},{partial:true},{exhausted:true}],[],{sweep:true});
 await f.run();assert.equal(f.sends,1);assert.equal(f.waits,0);assert.ok(f.events.some(e=>e[0]==='sweep-done'));
 const sleep=f.events.findIndex(e=>e[0]==='sleep'),firstScan=f.events.findIndex(e=>e[0]==='scan');assert.ok(firstScan>=0&&firstScan<sleep,'冷却结束前先刷列表');
});
