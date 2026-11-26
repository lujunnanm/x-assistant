import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Exercise the shipped scan/selection functions against virtualized pages,
// not a second implementation of forward ordering.
const source=readFileSync(new URL('../followback.js',import.meta.url),'utf8');
const start=source.indexOf(' function next('),end=source.indexOf(' async function transact(',start);
assert.ok(start>=0&&end>start);
const code=source.slice(start,end)+';globalThis.forwardTest={next,scan};';
const row=n=>({target:'@user'+n,targetId:String(n),followed:false});

function fixture(input,options={}){
 const pages=input.map(items=>items.map(item=>typeof item==='number'?row(item):item));
 const controller=new AbortController(),records={},events=[],progress=[];
 let y=options.initialY??0,now=1000,sleeps=0,valid=true,loading=false,retry=false;
 const pageHeight=1000,viewport=1000;
 const maxY=()=>Math.max(0,pages.length*pageHeight-viewport);
 const index=()=>Math.min(pages.length-1,Math.max(0,Math.floor(y/pageHeight)));
 const current=()=>pages[index()]||[];
 const cells=()=>current().map((r,i)=>{
  const cell={isConnected:true,textContent:r.target,dataset:{testid:'UserCell'},
   getAttribute:name=>name==='data-testid'?'UserCell':null,
   getBoundingClientRect:()=>({top:i*120,bottom:i*120+100}),
   compareDocumentPosition:()=>index()*pageHeight+i*120<options.boundaryY?4:2,
   querySelectorAll:selector=>selector.includes('UserAvatar')?[{getAttribute:()=> 'UserAvatar-Container-'+r.target.slice(1)}]:selector.includes('button')?[{getAttribute:()=>r.targetId+(r.followed?'-unfollow':'-follow')}]:[],
   closest:()=>null};
  cell.querySelector=selector=>cell.querySelectorAll(selector)[0]||null;
  return cell;
 });
 const query=selector=>selector.includes('progressbar')||selector.includes('progressindicator')||selector.includes('aria-busy')?loading?[{isConnected:true,closest:()=>null,getBoundingClientRect:()=>({top:0,bottom:20})}]:[]:selector.includes('UserCell')?cells():selector==='button'&&retry?[{isConnected:true,textContent:'Retry',closest:()=>null}]:[];
 const surface={querySelectorAll:query,querySelector:selector=>query(selector)[0]||null,
  getBoundingClientRect:()=>({top:-y,bottom:pages.length*pageHeight-y}),closest:()=>surface};
 const scroller={get scrollHeight(){return pages.length*pageHeight;},get clientHeight(){return viewport;},get scrollTop(){return y;},set scrollTop(v){y=Math.max(0,Math.min(maxY(),v));}};
 const scroll=(next,type)=>{const from=y;y=Math.max(0,Math.min(maxY(),next));events.push({type,from,to:y,index:index()});};
 const win={get scrollY(){return y;},get pageYOffset(){return y;},innerHeight:viewport,
  scrollBy(x,dy){scroll(y+(typeof x==='object'?x.top:dy),'by');},scrollTo(x,top){scroll(typeof x==='object'?x.top:top,'to');}};
 const document={scrollingElement:scroller,documentElement:scroller,body:scroller,querySelectorAll:query,querySelector:selector=>query(selector)[0]||null};
 const check=s=>{if(s.signal.aborted)throw new DOMException('stopped','AbortError');};
 const api={storage:{get:async()=>({xAssistantFollowbackLedgerV1:{'/self':records}})},
  sleep:async(ms,signal)=>{check({signal});now+=ms;sleeps++;await options.onSleep?.(f,{ms,sleeps});check({signal});},
  call:()=>assert.fail('read-only scanning must not request a follow action'),runtime:()=>assert.fail('scan should not change module state')};
 const context=vm.createContext({window:win,document,Date:{now:()=>now},Math,Map,Set,Number,JSON,Array,DOMException,
  LEDGER:'xAssistantFollowbackLedgerV1',cellSel:'[data-testid="UserCell"]',api,
  T:{waitForPage:async probe=>probe()},check,fail:(code,message)=>Object.assign(Error(message),{code}),
  list:()=>valid?surface:null,rows:()=>pages.slice(index(),index()+(options.overscan?2:1)).flatMap((items,offset)=>items.flatMap((r,i)=>{
   const top=(index()+offset)*pageHeight+i*120;
   return Number.isFinite(options.boundaryY)&&top>=options.boundaryY?[]:[{...r,cell:{getBoundingClientRect:()=>({top:top-y})}}];
  })),recommendation:()=>Number.isFinite(options.boundaryY)?{getBoundingClientRect:()=>({top:options.boundaryY-y})}:null,
  all:(root,selector)=>Array.from(root.querySelectorAll(selector)),live:e=>!!e?.isConnected,
  clean:value=>String(value||'').trim().replace(/\s+/g,' '),
  XAssistantWorkspace:{progress:(step,extra)=>progress.push({step,extra,at:now})}});
 vm.runInContext(code,context);
 const f={pages,records,events,progress,controller,context,s:{account:'/self',runId:'run',signal:controller.signal},
  get y(){return y;},get sleeps(){return sleeps;},get now(){return now;},get atBottom(){return y===maxY();},
  set loading(value){loading=value;},set valid(value){valid=value;},set retry(value){retry=value;},advance:ms=>{now+=ms;},scan:()=>context.forwardTest.scan(f.s),next:context.forwardTest.next};
 return f;
}
async function find(f,max=100){
 for(let i=0;i<max;i++){const selected=await f.scan();if(selected)return selected;}
 assert.fail('no candidate after bounded scan continuations');
}

test('forward selection returns the first eligible row, skipping followed, duplicate, self and ledger matches',()=>{
 const f=fixture([[1,2,3]]),items=[row(1),row(2),row(3)];
 assert.equal(f.next(items,{},'/self').target,'@user1');
 assert.deepEqual(items.map(r=>r.target),['@user1','@user2','@user3']);
 for(const status of ['confirmed','unknown','in_flight']){
  assert.equal(f.next(items,{'@oldname':{status,targetId:'1'}},'/self').target,'@user2');
  assert.equal(f.next(items,{'@user1':{status}},'/self').target,'@user2');
 }
 assert.equal(f.next([...items,{...row(1),target:'@duplicate'}],{},'/self').target,'@user2');
 assert.equal(f.next([...items,{...row(1),target:'@duplicate'}],{},'/self',r=>r.target!=='@duplicate').target,'@user2');
 assert.equal(f.next([{...row(1),followed:true},{target:'@self',targetId:'4',followed:false},...items.slice(1)],{},'/self').target,'@user2');
});

test('an eligible first row is selected without scrolling or waiting for the end',async()=>{
 for(const pages of [[[1,2]],[[1,2],[3,4],[5,6]]]){
  const f=fixture(pages);
  assert.equal((await f.scan()).target,'@user1');
  assert.equal(f.sleeps,0);
  assert.deepEqual(f.events,[]);
 }
});

test('a restored scrolled page starts at the top before selecting a target',async()=>{
 const f=fixture([[1,2],[3,4],[5,6]],{initialY:2000});
 assert.equal((await f.scan()).target,'@user1');
 assert.deepEqual(f.events.map(e=>[e.type,e.from,e.to]),[['to',2000,0]]);
});

test('after each confirmation, scans continue forward across virtualized pages',async()=>{
 const f=fixture([[1,2],[3,4],[5,6]]),picked=[];
 for(let i=0;i<6;i++){
  const target=await find(f);picked.push(target.target);
  f.records[target.target]={status:'confirmed',targetId:target.targetId};
  f.advance(i%2?55000:70000);
 }
 assert.deepEqual(picked,['@user1','@user2','@user3','@user4','@user5','@user6']);
 assert.ok(f.events.every(e=>e.type==='by'&&e.to>e.from));
 assert.equal(f.atBottom,true);
});

test('a late pagination append is consumed before declaring an exhausted list',async()=>{
 let extended=false;
 const f=fixture([[{...row(1),followed:true}]],{onSleep(f){if(f.now-1000>=3000&&!extended){extended=true;f.pages.push([row(2),row(3)]);}}});
 assert.equal((await f.scan()).target,'@user2');
 assert.equal(extended,true);
});

test('a brief no-spinner gap is not an exhausted empty list',async()=>{
 const f=fixture([[]]);
 assert.equal(await f.scan(),null);
 assert.equal(f.now-1000,4500);
 assert.equal(f.s.forwardScan,null);
});

test('an active list loader does not yield a row until the list is stable enough to read',async()=>{
 const f=fixture([[1,2]]);f.loading=true;
 assert.equal(await f.scan(),null);
 f.loading=false;
 assert.equal((await f.scan()).target,'@user1');
});

test('a prefetched recommendation heading does not end scanning early and recommendations are never picked',async()=>{
 const f=fixture([[{...row(1),followed:true}],[{...row(2),followed:true}],[3],[4]],{boundaryY:3000});
 const picked=await f.scan();assert.equal(picked.target,'@user3');
 f.records[picked.target]={status:'confirmed',targetId:picked.targetId};
 assert.equal(await f.scan(),null);
 assert.ok(f.y>=2000&&f.y<3000,'stay above the recommendation section');
});

test('a persistent loader eventually raises a visible loading error, never pretending to reach the end',async()=>{
 const f=fixture([[1,2]]);f.loading=true;
 assert.equal(await f.scan(),null);
 await assert.rejects(f.scan(),{code:'FOLLOWBACK_LOADING'});
});

test('the native list Retry state is rejected instead of being treated as a completed short list',async()=>{
 const f=fixture([[1,2]]);f.retry=true;
 await assert.rejects(f.scan(),{code:'FOLLOWBACK_LOADING'});
});

test('exhaustion resets the cursor so the next round starts at the top and sees new arrivals',async()=>{
 const f=fixture([[{...row(1),followed:true}],[{...row(2),followed:true}]]);
 assert.equal(await f.scan(),null);
 assert.equal(f.atBottom,true);
 f.pages[0].unshift(row(3));
 assert.equal((await f.scan()).target,'@user3');
 assert.equal(f.y,0);
});

async function exhaust(f){
 for(let i=0;i<20;i++){
  assert.equal(await f.scan(),null,'round is empty');
  if(!f.s.forwardScan)return;
 }
 assert.fail('round did not end');
}
const alreadyFollowed=n=>({...row(n),followed:true});

test('a full zero-follow traversal caps subsequent rounds at the first six screens, including the top',async()=>{
 const f=fixture(Array.from({length:20},(_,i)=>[alreadyFollowed(i+1)]),{overscan:true});
 await exhaust(f);assert.equal(f.atBottom,true);
 f.pages[6].unshift(row(101)); // mounted by virtualized overscan on the sixth screen
 f.events.length=0;
 await exhaust(f);
 assert.deepEqual(f.events.map(e=>[e.type,e.to]),[['to',0],['by',1000],['by',2000],['by',3000],['by',4000],['by',5000]]);
 f.pages[5].unshift(row(102));
 assert.equal((await f.scan()).target,'@user102','the sixth screen is still eligible');
 f.records['@user102']={status:'confirmed',targetId:'102'};
 f.s.forwardScan.confirmed=true;
 await exhaust(f);assert.equal(f.y,5000,'a later success does not re-enable full scanning');
});

test('exhausting a traversal with a confirmed follow does not yet cap the next traversal',async()=>{
 const f=fixture([[1],...Array.from({length:12},(_,i)=>[alreadyFollowed(i+2)])]);
 const target=await f.scan();assert.equal(target.target,'@user1');
 f.records[target.target]={status:'confirmed',targetId:target.targetId};f.s.forwardScan.confirmed=true;
 await exhaust(f);
 f.pages[8].unshift(row(102));
 assert.equal((await find(f)).target,'@user102','still reads beyond six screens until an empty full traversal');
});

test('the capped scan waits for the sixth screen to finish loading before concluding it is empty',async()=>{
 let limited=false,loadingTicks=0;
 const f=fixture(Array.from({length:20},(_,i)=>[alreadyFollowed(i+1)]),{onSleep(f){
  if(limited&&f.y===5000){
   f.loading=++loadingTicks<3;
   if(loadingTicks===3)f.pages[5].unshift(row(103));
  }
 }});
 await exhaust(f);limited=true;
 assert.equal((await f.scan()).target,'@user103');
 assert.equal(f.y,5000);assert.equal(loadingTicks,3);
});

test('long empty stretches advance in bounded batches without revisiting the top',async()=>{
 const f=fixture(Array.from({length:100},(_,i)=>[{...row(i+1),followed:i<99}]));
 assert.equal(await f.scan(),null);const firstY=f.y;
 assert.ok(firstY>0&&firstY<99000,'first scan is bounded');
 assert.equal(await f.scan(),null);assert.ok(f.y>firstY);
 assert.equal((await find(f)).target,'@user100');
 assert.ok(f.events.every(e=>e.type==='by'&&e.to>=e.from));
});

test('Stop during discovery aborts before selecting or acting',async()=>{
 const f=fixture([[{...row(1),followed:true}],[2]],{onSleep(f){f.controller.abort();}});
 await assert.rejects(f.scan(),{name:'AbortError'});assert.equal(f.sleeps,1);
});

test('loss of the verified list during traversal stops instead of selecting a stale row',async()=>{
 const f=fixture([[{...row(1),followed:true}],[2]],{onSleep(f){f.valid=false;}});
 await assert.rejects(f.scan(),{code:'FOLLOWBACK_LIST'});
});
