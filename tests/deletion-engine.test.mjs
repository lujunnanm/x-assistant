import test from 'node:test';
import assert from 'node:assert/strict';
import {runDeletionPlan} from '../deletion-engine.mjs';
const p=id=>({id,text:'交朋友 '+id});
const row=id=>({...p(id),author:'me',owned:true,isReply:false,isQuote:false,isRepost:false});
function fixture(...ids){
 const f={time:100000,ledger:null,account:'@Me',calls:[],signal:new AbortController(),plan:{id:'preview-1',account:'/me',posts:ids.map(p)}};
 f.adapter={now:()=>f.time,sleep:async ms=>{f.calls.push(['sleep',ms]);f.time+=ms;},currentAccount:async()=>f.account,
  inspect:async id=>row(id),readLedger:async a=>{assert.equal(a,'/me');return structuredClone(f.ledger);},
  writeLedger:async(a,v)=>{assert.equal(a,'/me');f.ledger=structuredClone(v);},
  remove:async(v,{beforeConfirm})=>{await beforeConfirm(v);assert.equal(f.ledger.records[v.id].status,'in_flight');f.calls.push(['click',v.id,f.time]);return {status:'deleted',id:v.id};}};
 f.run=(confirm=f.plan.id)=>runDeletionPlan({plan:f.plan,adapter:f.adapter,signal:f.signal.signal,confirmedPlanId:confirm});
 return f;
}
test('requires the exact confirmed preview and strict string IDs; mutable caller changes cannot expand it',async()=>{
 const f=fixture('10');await assert.rejects(f.run('another'),{code:'PLAN_UNCONFIRMED'});
 const malformed=fixture('10','10');await assert.rejects(malformed.run(),{code:'PLAN_INVALID'});
 const n=fixture(999);await assert.rejects(n.run(),{code:'PLAN_INVALID'});
 f.adapter.inspect=async id=>{f.plan.posts[0].text='new';f.plan.posts.push(p('11'));return row(id);};
 const r=await f.run();assert.equal(r.deleted,1);assert.deepEqual(f.calls,[['click','10',100000]]);
});
test('owned exact originals only: missing type, quote, repost, reply, changed text/author or foreign ID skip without reserving',async()=>{
 for(const changed of [{isReply:null},{isReply:true},{isQuote:true},{isRepost:true},{text:'交个朋友'},{text:'交朋友 10\u200b'},{author:'other'},{owned:false},{id:'20'}]){
  const f=fixture('10');f.adapter.inspect=async id=>({...row(id),...changed});const r=await f.run();assert.equal(r.skipped,1);assert.deepEqual(f.calls,[]);assert.equal(f.ledger,null);
 }
});
test('account switch after inspection stops before menu/confirmation work',async()=>{
 const f=fixture('10','20');f.adapter.inspect=async id=>{f.account='/other';return row(id);};
 const r=await f.run();assert.equal(r.reason,'ACCOUNT_CHANGED');assert.deepEqual(f.calls,[]);assert.equal(f.ledger,null);
});
test('revalidate freshly resolved row before writing intent and never issue two irreversible clicks',async()=>{
 const f=fixture('10');f.adapter.remove=async(v,{beforeConfirm})=>{await beforeConfirm({...v,isQuote:true});throw Error('unreachable');};
 assert.equal((await f.run()).skipped,1);assert.equal(f.ledger,null);
 f.adapter.remove=async(v,{beforeConfirm})=>{await beforeConfirm(v);await assert.rejects(beforeConfirm(v),{code:'DUPLICATE_CONFIRM'});return {id:v.id,status:'deleted'};};
 assert.equal((await f.run()).deleted,1);
});
test('clicks have at least 5s deletion-only spacing, including across runs, unknown and deleted IDs are never retried',async()=>{
 const f=fixture('10','20');const r=await f.run();assert.equal(r.deleted,2);assert.deepEqual(f.calls,[['click','10',100000],['sleep',5000],['click','20',105000]]);
 f.plan.posts=[p('10'),p('20'),p('30')];f.plan.id='preview-2';const s=await f.run();assert.equal(s.deleted,1);assert.equal(s.skipped,2);assert.equal(f.calls.at(-1)[2],110000);
});
test('missing or mismatched receipt after submission stops and quarantines the ID across previews',async()=>{
 for(const receipt of [null,{status:'skipped'},{status:'deleted',id:'20'},{status:'unknown',id:'10'}]){
  const f=fixture('10','20');f.adapter.remove=async(v,{beforeConfirm})=>{await beforeConfirm(v);return receipt;};
  const r=await f.run();assert.equal(r.unknown,1);assert.equal(r.deleted,0);assert.equal(r.stopped,true);assert.equal(f.ledger.records['10'].status,'unknown');
  f.plan.posts=[p('10')];assert.equal((await f.run()).items[0].reason,'prior_unknown');
 }
});
test('pre-click cancellation never creates a delete; after intention, cancellation is conservative',async()=>{
 const f=fixture('10','20');f.signal.abort();assert.equal((await f.run()).reason,'CANCELLED');assert.deepEqual(f.calls,[]);
 const g=fixture('10');g.adapter.remove=async(v,{beforeConfirm})=>{await beforeConfirm(v);g.signal.abort();throw Error('unknown');};
 assert.equal((await g.run()).unknown,1);assert.equal(g.ledger.records['10'].status,'unknown');
});
test('failed initial persistence prevents clicks and failed final persistence leaves in_flight quarantine',async()=>{
 const f=fixture('10');f.adapter.writeLedger=async()=>{throw Error('full');};const r=await f.run();assert.equal(r.stopped,true);assert.deepEqual(f.calls,[]);
 const g=fixture('10');const save=g.adapter.writeLedger;g.adapter.writeLedger=async(a,v)=>{if(v.records['10'].status!=='in_flight')throw Error('full');return save(a,v);};
 assert.equal((await g.run()).unknown,1);assert.equal(g.ledger.records['10'].status,'in_flight');assert.equal((await g.run()).items[0].reason,'prior_unknown');
});
test('concurrent runners for the same account cannot race a deletion; malformed durable ledger is not replaced',async()=>{
 const f=fixture('10');let enter,release;const entered=new Promise(r=>enter=r),go=new Promise(r=>release=r);f.adapter.inspect=async id=>{enter();await go;return row(id);};
 const first=f.run();await entered;await assert.rejects(f.run(),{code:'DELETE_BUSY'});release();assert.equal((await first).deleted,1);
 f.ledger={};await assert.rejects(f.run(),{code:'LEDGER_INVALID'});assert.deepEqual(f.ledger,{});
});
