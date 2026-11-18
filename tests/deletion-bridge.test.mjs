import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDeletionBridge} from '../deletion-bridge.mjs';

const id='123',owner='/owner',tabId=41;
const event=()=>{const a=new Set();return {addListener:f=>a.add(f),removeListener:f=>a.delete(f),fire:x=>[...a].forEach(f=>f(x)),size:()=>a.size};};
function fixture({altered=false,wrongDoc=false}={}){
 let url='https://x.com/owner',doc='before',clicks=0,connected=0;
 const getRow=()=>({id,account:owner,author:'owner',path:owner+'/status/'+id,text:'来交朋友。',owned:true,isReply:false,isQuote:false,isRepost:false});
 const onConnect=event(),locked=[],updated=[];
 const mkPort=name=>{
  let dead=false;
  const panel={name,onMessage:event(),onDisconnect:event(),sender:{id:'ext',frameId:0,tab:{id:tabId},url,documentId:wrongDoc?'foreign':doc}},
   content={name,onMessage:event(),onDisconnect:event()};
  for(const [a,b] of [[panel,content],[content,panel]]){
   a.postMessage=m=>{if(dead)throw Error('disconnected');queueMicrotask(()=>{if(!dead)b.onMessage.fire(structuredClone(m));});};
   a.disconnect=()=>{if(dead)return;dead=true;queueMicrotask(()=>{a.onDisconnect.fire();b.onDisconnect.fire();});};
  }
  connected++;queueMicrotask(()=>onConnect.fire(panel));return content;
 };
 const isolated={account:()=>owner,inspect:()=>getRow(),remove:async(_,o)=>{
  await o.beforeConfirm({...getRow(),...(altered?{text:'new'}:{})});
  if(o.signal.aborted)return {id,status:'skipped'};
  clicks++;return {id,status:'deleted'};
 }};
 const client={runtime:{id:'ext',onConnect},tabs:{update:async(t,v)=>{assert.equal(t,tabId);url=v.url;doc='current';updated.push(url);},get:async t=>({id:t,url})},scripting:{executeScript:async req=>{
  assert.equal(req.target.tabId,tabId);
  if(req.target.documentIds){locked.push(req.target.documentIds);if(req.target.documentIds[0]!==doc)throw Error('document changed');}
  const ctx=vm.createContext({location:new URL(url),chrome:{runtime:{connect:({name})=>mkPort(name)}},XAssistantDeletionDOM:isolated,AbortController,setTimeout,clearTimeout});
  const func=vm.runInContext('('+req.func.toString()+')',ctx),result=await func(...req.args);
  return [{frameId:0,documentId:doc,result}];
 }}};
 globalThis.chrome=client;
 return {bridge:createDeletionBridge({tabId,account:owner,assertLive:()=>true}),row:getRow(),clicks:()=>clicks,connected:()=>connected,locked,updated,onConnect,navAway:()=>{doc='changed';}};
}
test('inspect binds the canonical own post URL and remove calls the panel hook before the single document-bound click',async()=>{
 const f=fixture();assert.equal(await f.bridge.currentAccount(),owner);const row=await f.bridge.inspect(id);
 const seq=[];const r=await f.bridge.remove(row,{beforeConfirm:async actual=>{assert.equal(f.clicks(),0);assert.equal(actual.text,row.text);seq.push('authorized');}});
 assert.equal(r.status,'deleted');assert.deepEqual(seq,['authorized']);assert.equal(f.clicks(),1);assert.equal(f.onConnect.size(),0);
 assert.deepEqual(f.locked,[['current']]);assert.deepEqual(f.updated,['https://x.com/owner/status/123']);await assert.rejects(f.bridge.remove(row,{beforeConfirm(){}}),{code:'TARGET_CHANGED'});f.bridge.close();
});
test('changed document cannot receive a deletion command; changed body cannot arm',async()=>{
 for(const changed of ['document','body']){
  const f=fixture({altered:changed==='body'}),row=await f.bridge.inspect(id);
  if(changed==='document')f.navAway();let armed=0;await assert.rejects(f.bridge.remove(row,{beforeConfirm:()=>{armed++;}}));assert.equal(armed,0);assert.equal(f.clicks(),0);assert.equal(f.onConnect.size(),0);
 }
});
test('closing the panel while its final authorization is pending does not dispatch acknowledgement or click',async()=>{
 const f=fixture(),row=await f.bridge.inspect(id);let release,started;const reached=new Promise(r=>{started=r;});
 const action=f.bridge.remove(row,{beforeConfirm:()=>{started();return new Promise(r=>{release=r;});}});
 await reached;f.bridge.close();release();await assert.rejects(action,{code:'CANCELLED'});await new Promise(r=>setTimeout(r,0));assert.equal(f.clicks(),0);
});
test('a sender from a different document cannot get an ack, even with the same one-use port name',async()=>{
 const f=fixture({wrongDoc:true}),row=await f.bridge.inspect(id),ac=new AbortController();
 let armed=0;const action=f.bridge.remove(row,{signal:ac.signal,beforeConfirm(){armed++;}});
 await new Promise(r=>setTimeout(r,5));ac.abort();await assert.rejects(action,{code:'CANCELLED'});assert.equal(f.connected(),1);assert.equal(armed,0);assert.equal(f.clicks(),0);
});

// Advance the bridge's real poll paths with a virtual wall clock (no site / network).
async function withShell(mode,work){
 const prevNow=Date.now,prevTimer=globalThis.setTimeout,oldChrome=globalThis.chrome;
 let now=0,url='https://x.com'+owner,doc='profile',nreload=0,reads=0,tabUpdates=0,locked=[],sawRecover=false;
 Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{now+=ms;queueMicrotask(fn);};
 try{
  globalThis.chrome={tabs:{update:async(_id,{url:next})=>{url=next;doc='shell';tabUpdates++;},get:async()=>({id:tabId,url})},scripting:{executeScript:async({target,func,args})=>{
   const initial=doc==='profile',fresh=doc==='new',recover=args[1]===true;
   if(target.documentIds){locked.push(target.documentIds[0]);assert.equal(target.documentIds[0],doc);}
   const loc=new URL(url);loc.reload=()=>{nreload++;doc='new';};
   const snapshot=doc;let account=initial&&mode!=='initialBlank'||(fresh&&mode==='recover')?owner:null;
   if(fresh&&mode==='foreignAfter'||recover&&mode==='foreignBefore')account='/another';
   if(mode==='foreignNow'&&!initial)account='/another';
   const isLogin=mode==='wall'&&!initial||mode==='wallBefore'&&recover;
   const document={readyState:'complete',body:{innerText:mode==='nonempty'&&!initial?'Loading…':''},querySelector:q=>!initial&&(mode==='challengeShell'||mode==='challengeAtReload'&&recover)&&q.includes('/cdn-cgi/challenge-platform/')?{}:null,querySelectorAll:q=>isLogin&&q.includes('password')?[{}]:[]};
   const nav={name:url,responseStatus:mode==='403'&&!initial?403:mode==='statusMissing'&&!initial?0:200};
   const perf={getEntriesByType:()=>[nav]};let row=fresh&&account===owner?{account:owner,text:'post',id}:null;
   const ctx=vm.createContext({location:loc,document,performance:perf,XAssistantDeletionDOM:{account:()=>account,inspect:()=>row}});
   reads++;sawRecover||=recover;const result=vm.runInContext('('+func.toString()+')',ctx)(...args);
   return [{frameId:0,documentId:snapshot,result}];
  }}};
  const bridge=createDeletionBridge({tabId,account:owner,assertLive:()=>true});
  await work(bridge,()=>({nreload,reads,tabUpdates,locked,sawRecover}));bridge.close();
 }finally{Date.now=prevNow;globalThis.setTimeout=prevTimer;globalThis.chrome=oldChrome;}
}
test('a stable 200 blank detail gets one read-only reload of the same acquired document, and needs fresh matching account + row',async()=>{
 await withShell('recover',async(b,s)=>{assert.equal((await b.inspect(id)).id,id);assert.equal(s().nreload,1);assert.deepEqual(s().locked,['shell']);assert.equal(s().tabUpdates,1);});
 await withShell('remainsBlank',async(b,s)=>{await assert.rejects(b.inspect(id),{code:'ACCOUNT_UNAVAILABLE'});assert.equal(s().nreload,1);});
});
test('missing account is not reported as an account switch; currentAccount never reloads, nor do ambiguous or non-200 pages',async()=>{
 await withShell('initialBlank',async(b,s)=>{await assert.rejects(b.currentAccount(),{code:'ACCOUNT_UNAVAILABLE'});assert.equal(s().nreload,0);assert.equal(s().tabUpdates,0);});
 for(const [m,code] of [['statusMissing','ACCOUNT_UNAVAILABLE'],['nonempty','ACCOUNT_UNAVAILABLE'],['403','X_ACCESS_BLOCKED'],['wall','X_ACCESS_BLOCKED'],['challengeShell','X_ACCESS_BLOCKED']]){
  await withShell(m,async(b,s)=>{await assert.rejects(b.inspect(id),{code});assert.equal(s().nreload,0);assert.equal(s().sawRecover,false);});
 }
});
test('a detected access gate or foreign account stops before/after shell recovery',async()=>{
 for(const [m,code,n] of [['wallBefore','X_ACCESS_BLOCKED',0],['challengeAtReload','X_ACCESS_BLOCKED',0],['foreignBefore','ACCOUNT_CHANGED',0],['foreignNow','ACCOUNT_CHANGED',0],['foreignAfter','ACCOUNT_CHANGED',1]]){
  await withShell(m,async(b,s)=>{await assert.rejects(b.inspect(id),{code});assert.equal(s().nreload,n);});
 }
});
