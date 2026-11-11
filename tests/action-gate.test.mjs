import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionGate,ACTION_GATE_KEY,ACTION_INTERVAL,FOLLOW_INTERVAL,ACTION_LEASE} from '../action-gate.mjs';
const base={account:'/owner',module:'interaction',owner:1,documentId:'doc',runId:'run',kind:'reply'};
function fixture(initial={},start=100000){
 const data={now:start,state:structuredClone(initial),writes:0,nextId:0,random:0.5};
 const make=()=>createActionGate({read:async()=>structuredClone(data.state),write:async value=>{data.writes++;data.state=structuredClone(value);},now:()=>data.now,uuid:()=>`lease-${++data.nextId}`,random:()=>data.random});
 const gate=make();
 return {data,gate,restart:make,acquire:(extra={})=>gate.acquire({...base,...extra}),settle:(permit,outcome='attempted',extra={})=>gate.settle({...base,...extra,leaseId:permit.leaseId,outcome})};
}
test('fixed mandatory intervals and versioned storage key are exposed',()=>{
 assert.equal(ACTION_GATE_KEY,'xAssistantActionGateV1');assert.equal(ACTION_INTERVAL,23000);assert.equal(FOLLOW_INTERVAL,120000);assert.equal(ACTION_LEASE,10000);
});
test('23 seconds is measured from actual click acknowledgement, never lease acquisition',async()=>{
 const f=fixture(),permit=await f.acquire();f.data.now+=9000;await f.settle(permit);
 f.data.now+=22999;assert.deepEqual(await f.acquire(),{granted:false,retryAt:132000});
 f.data.now++;assert.equal((await f.acquire()).granted,true);
});
test('different modules and accounts cannot bypass the shared non-like interval',async()=>{
 const f=fixture(),permit=await f.acquire();await f.settle(permit);
 for(const kind of ['post','reply','follow'])assert.equal((await f.acquire({account:'/another',module:'posting',kind})).granted,false);
});
test('concurrent requests obtain exactly one lease including duplicate same-run requests',async()=>{
 const f=fixture(),results=await Promise.all(Array.from({length:12},()=>f.acquire()));
 assert.equal(results.filter(x=>x.granted).length,1);assert.equal(f.data.state.holder.leaseId,results[0].leaseId);
});
test('follow interval is two minutes per account in addition to global non-like spacing',async()=>{
 const f=fixture(),permit=await f.acquire({kind:'follow'});f.data.now+=500;await f.settle(permit,'attempted',{kind:'follow'});
 f.data.now+=23000;assert.equal((await f.acquire({kind:'follow'})).retryAt,220500);
 const other=await f.acquire({kind:'follow',account:'/other'});assert.equal(other.granted,true);await f.settle(other,'released',{kind:'follow',account:'/other'});
 f.data.now=220499;assert.equal((await f.acquire({kind:'follow'})).granted,false);
 f.data.now++;assert.equal((await f.acquire({kind:'follow'})).granted,true);
});
test('persistent state survives a new gate instance and wall-clock rollback fails closed',async()=>{
 const f=fixture(),permit=await f.acquire({kind:'follow'});await f.settle(permit,'attempted',{kind:'follow'});
 const restarted=f.restart();f.data.now=99999;const blocked=await restarted.acquire({...base,kind:'follow'});
 assert.equal(blocked.granted,false);assert.equal(blocked.retryAt,220000);
});
test('explicit pre-click release consumes nothing and cannot roll back prior timestamps',async()=>{
 const f=fixture({version:1,lastActionAt:50000,accounts:{'/owner':{lastActionAt:50000,lastFollowAt:0}}});
 const permit=await f.acquire();await f.settle(permit,'released');assert.equal(f.data.state.lastActionAt,50000);assert.equal((await f.acquire()).granted,true);
});
test('expired and lost leases conservatively consume at expiry plus 23 seconds',async()=>{
 const f=fixture(),permit=await f.acquire();f.data.now=permit.expiresAt;
 assert.equal((await f.acquire()).retryAt,133000);assert.equal(f.data.state.lastActionAt,110000);
 f.data.now=132999;assert.equal((await f.acquire()).granted,false);f.data.now++;assert.equal((await f.acquire()).granted,true);
});
test('expired follow lease conservatively consumes both clocks across restart',async()=>{
 const f=fixture(),permit=await f.acquire({kind:'follow'});f.data.now=permit.expiresAt;
 const restarted=f.restart();assert.equal((await restarted.acquire({...base,kind:'follow'})).retryAt,230000);
 assert.equal((await restarted.acquire({...base,kind:'reply'})).retryAt,133000);
});
test('late release is not evidence that an expired lease was unused',async()=>{
 const f=fixture(),permit=await f.acquire();f.data.now=permit.expiresAt+1;
 assert.equal((await f.settle(permit,'released')).consumed,true);assert.equal(f.data.state.lastActionAt,permit.expiresAt);
 assert.equal((await f.acquire()).retryAt,133000);
});
test('mismatched ownership and stale settlement cannot clear a newer lease',async()=>{
 const f=fixture(),first=await f.acquire();await assert.rejects(f.settle(first,'released',{documentId:'new-doc'}),{code:'ACTION_LEASE_CHANGED'});
 f.data.now=first.expiresAt+23000;const second=await f.acquire();assert.equal(second.granted,true);
 await assert.rejects(f.settle(first),{code:'ACTION_LEASE_CHANGED'});assert.equal(f.data.state.holder.leaseId,second.leaseId);
});
test('duplicate ACK is idempotent and never moves the actual action time forward',async()=>{
 const f=fixture(),permit=await f.acquire();await f.settle(permit);f.data.now+=1000;
 assert.equal((await f.settle(permit)).idempotent,true);assert.equal(f.data.state.lastActionAt,100000);
});
test('migration preserves old follow nextAt and recent runtime submission evidence once',async()=>{
 const f=fixture({legacyFollowCooldown:{'/OWNER':{nextAt:180000}},runtimes:{posting:{account:'/owner',submittedAt:new Date(99000).toISOString()}}});
 assert.equal((await f.acquire({kind:'follow'})).retryAt,180000);assert.equal(f.data.state.accounts['/owner'].lastFollowAt,60000);
 assert.equal(f.data.state.lastActionAt,114000);
 f.data.state.runtimes={posting:{account:'/owner',submittedAt:new Date(999999).toISOString()}};
 f.data.now=180000;assert.equal((await f.acquire({kind:'follow'})).granted,true);
});
test('unpersisted permits are never returned and invalid bindings cannot create a lease',async()=>{
 const gate=createActionGate({read:async()=>({}),write:async()=>{throw Error('storage down');},now:()=>1000,uuid:()=> 'lease'});
 await assert.rejects(gate.acquire(base),/storage down/);
 for(const extra of [{account:'owner'},{documentId:''},{runId:''},{owner:null},{kind:'scan'},{module:'cleanup'}])await assert.rejects(gate.acquire({...base,...extra}),{code:'ACTION_BINDING'});
});
test('likes use independent ACK-time random 1–3 second pacing, not 23 seconds',async()=>{
 for(const [random,interval] of [[0,1000],[0.5,2000],[1,3000]]){
  const f=fixture();f.data.random=random;const like=await f.acquire({kind:'like'});f.data.now+=500;await f.settle(like,'attempted',{kind:'like'});
  assert.equal(f.data.state.lastActionAt,null);assert.equal(f.data.state.nextLikeAt,100500+interval);
  f.data.now=100500+interval-1;assert.equal((await f.acquire({kind:'like'})).granted,false);
  f.data.now++;assert.equal((await f.acquire({kind:'like'})).granted,true);
 }
});
test('like and non-like cooldown lanes are independent while their live lease is exclusive',async()=>{
 const f=fixture(),post=await f.acquire();await f.settle(post);
 const like=await f.acquire({kind:'like'});assert.equal(like.granted,true);await f.settle(like,'attempted',{kind:'like'});
 f.data.now+=2000;const like2=await f.acquire({kind:'like'});assert.equal(like2.granted,true);
 assert.equal((await f.acquire({kind:'post'})).granted,false);await f.settle(like2,'released',{kind:'like'});
 f.data.now=123000;assert.equal((await f.acquire({kind:'post'})).granted,true);
});
test('unknown like consumes only like pacing and does not start the 23 second clock',async()=>{
 const f=fixture(),like=await f.acquire({kind:'like'});f.data.now=like.expiresAt;
 assert.equal((await f.acquire({kind:'like'})).retryAt,112000);assert.equal(f.data.state.lastActionAt,null);
 assert.equal((await f.acquire({kind:'reply'})).granted,true);
});
test('sleeping through a like interval grants one fresh action, never a catch-up burst',async()=>{
 const f=fixture(),like=await f.acquire({kind:'like'});await f.settle(like,'attempted',{kind:'like'});f.data.now+=3600000;
 const woke=await f.restart().acquire({...base,kind:'like'});await f.settle(woke,'attempted',{kind:'like'});
 assert.equal((await f.acquire({kind:'like'})).granted,false);assert.equal(f.data.state.nextLikeAt,f.data.now+2000);
});
test('only live-lease contention requests fast rechecks; acknowledged pacing does not poll',async()=>{
 const f=fixture(),lease=await f.acquire({kind:'like'});
 assert.equal((await f.acquire({kind:'like'})).waitForLease,true);
 await f.settle(lease,'attempted',{kind:'like'});
 const pacing=await f.acquire({kind:'like'});assert.equal(pacing.waitForLease,undefined);assert.equal(pacing.retryAt,102000);
});

test('follow-back pairs use their sampled 55–70s, mixed or legacy follow pairs use 120s',async()=>{
 for(const [previous,module,gap] of [['followback','followback',62500],['interaction','followback',120000],['followback','interaction',120000],['interaction','interaction',120000]]){
  const f=fixture(),p=await f.acquire({kind:'follow',module:previous});await f.settle(p,'attempted',{kind:'follow',module:previous});
  const ackTime=f.data.now;f.data.now+=gap-1;
  const waiting=await f.restart().acquire({...base,kind:'follow',module});
  assert.equal(waiting.granted,false);assert.equal(waiting.retryAt,ackTime+gap);
  assert.equal(waiting.waitForIntent,module==='interaction'?true:undefined);
  ++f.data.now;assert.ok((await f.restart().acquire({...base,kind:'follow',module})).granted);
 }
 const f=fixture({version:1,lastActionAt:40000,accounts:{'/owner':{lastFollowAt:40000}}});
 assert.equal((await f.acquire({kind:'follow',module:'followback'})).retryAt,160000);
});
test('an expired follow-back permit conservatively consumes both clocks, not when released before click',async()=>{
 const f=fixture(),args={kind:'follow',module:'followback'};
 const release=await f.acquire(args);await f.settle(release,'released',args);
 const reserve=await f.acquire(args);assert.ok(reserve.granted);
 f.data.now=reserve.expiresAt;
 assert.equal((await f.acquire(args)).retryAt,reserve.expiresAt+62500);
 assert.equal((await f.acquire({kind:'follow'})).retryAt,reserve.expiresAt+120000);
 assert.equal((await f.acquire({kind:'reply'})).retryAt,reserve.expiresAt+23000);
});

test('one bounded follow-back interval is sampled per grant and reused after ACK and restarts',async()=>{
 for(const [sample,delta] of [[0,55000],[1,70000]]){
  const f=fixture(),args={module:'followback',kind:'follow'};f.data.random=sample;
  const permit=await f.acquire(args);
  assert.equal(f.data.state.holder.followbackGap,delta);
  f.data.random=1-sample;f.data.now+=2000;await f.settle(permit,'attempted',args);
  const next=f.data.now+delta;assert.equal(f.data.state.accounts['/owner'].followbackNotBefore,next);
  f.data.now=next-1;assert.equal((await f.restart().acquire({...base,...args})).retryAt,next);
  f.data.now=next;assert.equal((await f.restart().acquire({...base,...args})).granted,true);
 }
});

test('a renewable interaction-follow intent prevents continuous follow-back starvation',async()=>{
 const f=fixture(),followback={module:'followback',kind:'follow'};
 const first=await f.acquire(followback);await f.settle(first,'attempted',followback);
 f.data.now+=55000;
 const waiting=await f.acquire({kind:'follow'});
 assert.equal(waiting.granted,false);assert.equal(waiting.waitForIntent,true);
 assert.equal(f.data.state.accounts['/owner'].interactionFollowIntentUntil,f.data.now+15000);
 const yielded=await f.acquire(followback);
 assert.equal(yielded.granted,false);assert.equal(yielded.retryAt,f.data.now+15000);
 f.data.now=220000;
 const interaction=await f.acquire({kind:'follow'});
 assert.equal(interaction.granted,true);assert.equal(f.data.state.accounts['/owner'].interactionFollowIntentUntil,null);
});

test('an abandoned interaction-follow intent expires and follow-back resumes',async()=>{
 const f=fixture(),followback={module:'followback',kind:'follow'};
 const first=await f.acquire(followback);await f.settle(first,'attempted',followback);
 f.data.now+=55000;await f.acquire({kind:'follow'});
 f.data.now+=14999;assert.equal((await f.acquire(followback)).granted,false);
 f.data.now++;assert.equal((await f.acquire(followback)).granted,true);
});
