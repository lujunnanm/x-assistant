import test from 'node:test';
import assert from 'node:assert/strict';
import {createFollowQueue} from '../interaction-follow-queue.mjs';
import {createActionGate} from '../action-gate.mjs';
function fixture(options={}){
 let store={},time=200000,enabled=true,gateState={version:1,lastActionAt:200000,accounts:{'/me':{lastFollowAt:200000}}};
 const tabs=new Map(),events=[],scheduled=[],receipts=[];let ids=0,creates=0;
 const gate=createActionGate({read:async()=>structuredClone(gateState),write:async s=>{gateState=structuredClone(s);},now:()=>time,uuid:()=> 'permit-'+(++ids)});
 const args={read:async()=>structuredClone(store),write:async s=>{store=structuredClone(s);},now:()=>time,uuid:()=> 'job-'+(++ids),gate,
  allowed:async a=>enabled&&(options.allowed?options.allowed(a):a==='/me'),reserved:async()=>!!options.reserved,
  schedule:at=>scheduled.push(at),notify:async r=>receipts.push(structuredClone(r)),
  tabs:{create:async o=>{events.push(['create',o]);const t={id:++creates,...o};tabs.set(t.id,t);return t;},get:async id=>{if(!tabs.has(id))throw Error('No tab with id: '+id);return tabs.get(id);},update:async(id,o)=>{events.push(['update',id,o]);Object.assign(tabs.get(id),o);}},
  page:async(id,row,mode,permit)=>{
   events.push([mode,row.author]);if(options.page)return options.page({id,row,mode,permit});
   return {documentId:'doc',result:mode==='canNavigate'?{safe:true}:mode==='prepare'?{state:options.followed?'followed':'unfollowed',targetId:'12'}:{state:'followed',clicked:true}};
  }};
 const make=()=>createFollowQueue(args);let q=make();
 return {get q(){return q;},restart:()=>{q=make();},events,scheduled,receipts,tabs,
  enqueue:(author='ann',postId='123',account='/me')=>q.enqueue({author,postId,account,windowId:7}),
  data:()=>store,gate:()=>gateState,time:n=>{time=n;},disable:()=>{enabled=false;},enable:()=>{enabled=true;},set:s=>{store=s;}};
}
test('enqueue persists without opening a tab, acquiring a lease or waiting for cooldown',async()=>{
 const f=fixture();assert.equal(await f.enqueue(),'queued');assert.deepEqual(f.events,[]);assert.equal(f.gate().holder,undefined);
});
test('waiting follow does not block enqueueing the next reply author; duplicate authors coalesce',async()=>{
 const f=fixture();await f.enqueue();await f.q.pump();assert.equal(f.data().rows['/me@ann'].status,'queued');
 assert.equal(await f.enqueue('bob','456'),'queued');await f.enqueue('ANN','789');
 assert.equal(Object.keys(f.data().rows).length,2);assert.deepEqual(f.data().rows['/me@ann'].postIds,['123','789']);
 assert.equal(f.events.filter(e=>e[0]==='click').length,0);
 f.time(320000);await f.q.pump();assert.equal(f.data().rows['/me@ann'].status,'verified');
 await f.q.pump();assert.equal(f.data().rows['/me@bob'].status,'queued');
 f.time(440000);await f.q.pump();assert.equal(f.data().rows['/me@bob'].status,'verified');
 assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(f.events.filter(e=>e[0]==='click').length,2);
 assert.deepEqual(f.events.find(e=>e[0]==='create')[1],{url:'https://x.com/ann/status/123',windowId:7,active:false});
 assert.equal(f.events.find(e=>e[0]==='update')[1],1);
});
test('slow page work does not hold the enqueue mutation lock',async()=>{
 let release,entered;const waiting=new Promise(r=>entered=r);
 const f=fixture({page:async()=>{entered();return new Promise(r=>release=r);}});
 await f.enqueue();const pump=f.q.pump();await waiting;
 assert.equal(await f.enqueue('bob','456'),'queued');
 release({documentId:'doc',result:{state:'loading'}});await pump;
 assert.equal(Object.keys(f.data().rows).length,2);
});
test('off switch pauses the queue and enabling resumes without duplicate click',async()=>{
 const f=fixture();await f.enqueue();f.disable();await f.q.pump();assert.equal(f.events.length,0);
 f.enable();f.time(320000);await f.q.pump();assert.equal(f.receipts[0].status,'verified');
 await f.q.pump();assert.equal(f.events.filter(e=>e[0]==='click').length,1);
});
test('already followed and followback reservations never request a follow click',async()=>{
 for(const [options,status] of [[{followed:true},'skipped'],[{reserved:true},'skipped_followback_ledger']]){
  const f=fixture(options);await f.enqueue();f.time(320000);await f.q.pump();
  assert.equal(f.receipts[0].status,status);assert.ok(!f.events.some(e=>e[0]==='click'));
 }
});
test('script loss after durable intent records unknown and never retries on restart',async()=>{
 const f=fixture({page:async({mode})=>{if(mode==='click')throw Error('script lost');return {documentId:'doc',result:{state:'unfollowed',targetId:'12'}};}});
 await f.enqueue();f.time(320000);await f.q.pump();assert.equal(f.receipts[0].status,'unknown');
 assert.equal(f.gate().accounts['/me'].lastFollowAt,320000);
 f.restart();await f.q.pump();assert.equal(f.events.filter(e=>e[0]==='click').length,1);
});
test('restart recovers pending items but quarantines an interrupted in-flight item',async()=>{
 const f=fixture();await f.enqueue();await f.enqueue('bob','456');
 const s=structuredClone(f.data());s.rows['/me@ann'].status='in_flight';f.set(s);f.restart();f.time(320000);await f.q.pump();
 assert.equal(f.data().rows['/me@ann'].status,'unknown');assert.equal(f.data().rows['/me@bob'].status,'verified');
});
test('closed queue tab blocks without creating replacement until explicit resume',async()=>{
 const f=fixture();await f.enqueue();await f.q.pump();f.tabs.clear();f.time(205000);await f.q.pump();
 assert.ok(f.data().blocked);assert.equal(f.events.filter(e=>e[0]==='create').length,1);
 await f.q.resume();f.time(320000);await f.q.pump();assert.equal(f.receipts.at(-1).status,'verified');
 assert.equal(f.events.filter(e=>e[0]==='create').length,2);
});
test('manual navigation and draft prevent queue navigation in the original tab',async()=>{
 const f=fixture();await f.enqueue();await f.q.pump();f.tabs.get(1).url='https://x.com/home';f.time(205000);await f.q.pump();
 assert.ok(f.data().blocked);assert.ok(!f.events.some(e=>e[0]==='update'||e[0]==='click'));
 const d=fixture({followed:true,page:async({mode})=>({documentId:'doc',result:mode==='canNavigate'?{safe:false}:{state:'followed'}})});
 await d.enqueue();await d.q.pump();await d.enqueue('bob','456');await d.q.pump();assert.ok(d.data().blocked);assert.ok(!d.events.some(e=>e[0]==='update'));
});
test('queued authors from an inactive account do not block the active account',async()=>{
 const f=fixture();await f.enqueue('previous','111','/old');await f.enqueue();f.time(320000);await f.q.pump();
 assert.equal(f.data().rows['/old@previous'].status,'queued');assert.equal(f.data().rows['/me@ann'].status,'verified');
});
