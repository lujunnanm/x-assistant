import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createActionGate} from '../action-gate.mjs';
import {readFileSync} from 'node:fs';

// Observe real scan ordering with a fake wall clock; button clicks never leave the fixture.
const scripts=['interaction-core.js','task-utils.js','action-client.js','notification-policy.js','notifications.js'].map(n=>readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const key='xAssistantNotificationRepliesV1',source='/me/status/900',base=1700000000000;
function timeline({random=0,replyGap=23000,alreadyLiked=false,cancel=false,child=false,mentions=false}={}){
 let now=base,pendingCancel=false;
 const events=[],storage={},liked=new Set(alreadyLiked?['11','12']:[]),controller=new AbortController(),location={pathname:mentions?'/notifications/mentions':source};
 let storedGate,seq=0;
 const gate=createActionGate({read:async()=>structuredClone(storedGate),write:async s=>{storedGate=structuredClone(s);},now:()=>now,random:()=>random,uuid:()=>String(++seq)});
 const root={id:'900',author:'me',at:base-1000,article:{},replyCount:2};
 const rows=['11','12'].map((id,i)=>({id,at:base-100-i,author:'person'+id,text:'comment',addressed:true,directComment:true,ownOriginalComment:true,
  article:{querySelectorAll(s){if(s==='[data-testid="unlike"]')return liked.has(id)?[{}]:[];
   return s==='[data-testid="like"]'&&!liked.has(id)?[{click(){events.push(['like',id,now]);liked.add(id);}}]:[];}}}));
 const column={contains:()=>true,querySelectorAll:()=>[],querySelector:s=>mentions&&s.includes('aria-selected')?{getAttribute:()=>'/notifications/mentions'}:null},math=Object.create(Math);math.random=()=>random;
 const ctx=vm.createContext({Error,DOMException,setTimeout,clearTimeout,Math:math,
  Date:class extends Date{static now(){return now;}},crypto:{getRandomValues:a=>{a[0]=Math.floor(random*2**32);return a;}},
  innerHeight:900,location,document:{querySelector:s=>s.includes('primaryColumn')?column:null,querySelectorAll:()=>[]},window:{scrollBy(){},scrollTo(){}},
  XAssistantDOM:{account:()=>'/me',rows:()=>mentions?rows:[root,...rows],inThread:id=>id!=='900',directChildOf:id=>id!=='900',directOnOwnOriginal:id=>id!=='900',
   dialogs:()=>[],beginDetailRead:()=>()=>{},detailReply:()=>true,relocate:r=>rows.find(x=>x.id===r.id)},
  XAssistantWorkspace:{check(){},openStatusTarget:async r=>{location.pathname='/'+r.author+'/status/'+r.id;return {returnToSource:async()=>{location.pathname=source;}};}},
  XAssistantRuntime:{storage:{get:async k=>({[k]:structuredClone(storage[k])}),set:async data=>Object.assign(storage,structuredClone(data))},
   call:async msg=>{
    if(msg.kind==='AI_NOTIFICATION_REPLY')return {postId:msg.post.id,action:'send_reply',text:'reply'};
    const binding={...msg,module:msg.module,kind:msg.actionKind,owner:1,documentId:'doc'};
    if(msg.kind==='ACTION_ACQUIRE'||msg.kind==='ACTION_SETTLE'){
     assert.notEqual(msg.actionKind,'like','回帖模块不得申请或结算点赞动作');
     return msg.kind==='ACTION_ACQUIRE'?gate.acquire(binding):gate.settle(binding);
    }
    throw Error('unexpected: '+msg.kind);
   },runtime:async()=>({}),check:signal=>ctx.XAssistantTasks.check(signal),
   sleep:async ms=>{now+=ms;if(pendingCancel){pendingCancel=false;controller.abort();}}},
  XAssistantTime:{ms:()=>replyGap},
  XAssistantReplyEngine:{send:async opts=>{if(child)await opts.prepareTarget();await ctx.XAssistantActions.click({module:'notifications',account:opts.account,runId:opts.runId,kind:'reply',signal:opts.signal,beforeClick:opts.onBeforeSubmit,click:()=>{}});await opts.onConfirmed({kind:'confirmed'});
   events.push(['reply',opts.row.id,now]);pendingCancel=cancel;}}
 });
 scripts.forEach(s=>vm.runInContext(s,ctx));
 return {events,storage,scan:()=>ctx.XAssistantNotifications.scan({account:'/me',runId:'r',signal:controller.signal,...(mentions?{}:{threadPath:source,rootId:'900'}),ignoreLikedBoundary:true})};
}
for(const [random,mode] of [[0,'source'],[1-2**-32,'child']])test('confirmed notification replies use only configured cooldown and never like ('+mode+')',async()=>{
 const f=timeline({random,replyGap:31000,child:mode==='child'});await f.scan();
 assert.deepEqual(f.events.map(([kind,id])=>[kind,id]),[['reply','11'],['reply','12']]);
 assert.equal(f.events[1][2]-f.events[0][2],31000);
});
test('pre-existing likes do not create work or phantom 3–5 second waits',async()=>{
 const f=timeline({alreadyLiked:true});await f.scan();
 assert.deepEqual(f.events.map(e=>e[0]),['reply','reply']);assert.equal(f.events[1][2]-f.events[0][2],23000);
});
test('cancelling reply cooldown preserves the confirmed reply without a like reservation or click',async()=>{
 const f=timeline({cancel:true});await assert.rejects(f.scan(),e=>e.name==='AbortError');
 assert.deepEqual(f.events.map(e=>e[0]),['reply']);const record=f.storage[key]['/me'].records['11'];
 assert.equal(record.status,'confirmed');assert.equal(record.like,undefined);
});

test('a configured 10-second reply timer still obeys the 23-second send gate without a like pause',async()=>{
 const f=timeline({replyGap:10000});await f.scan();
 assert.deepEqual(f.events.map(e=>e[0]),['reply','reply']);
 assert.equal(f.events[1][2]-f.events[0][2],23000);
});

test('a fresh mentions scan never likes before its first reply',async()=>{
 const f=timeline({mentions:true});await f.scan();
 assert.deepEqual(f.events.map(([kind,id])=>[kind,id]),[['reply','11'],['reply','12']]);
 assert.equal(f.events[1][2]-f.events[0][2],23000);
});

function pacing(){
 let state,t=base,seq=0;
 const make=()=>createActionGate({read:async()=>structuredClone(state),write:async v=>{state=structuredClone(v);},now:()=>t,uuid:()=>String(++seq),random:()=>0.5});
 let gate=make();
 const bind=(kind,extra)=>({module:'notifications',account:'/me',documentId:'doc',owner:1,runId:'r',kind,...extra});
 const probe=(kind,extra={})=>gate.acquire(bind(kind,extra));
 const commit=async(kind,extra={})=>{const binding=bind(kind,extra),v=await gate.acquire(binding);assert.ok(v.granted);await gate.settle({...binding,leaseId:v.leaseId,outcome:'attempted'});};
 return {commit,probe,settle:(kind,leaseId,outcome,extra={})=>gate.settle({...bind(kind,extra),leaseId,outcome}),set:ms=>{t=base+ms;},restart:()=>{gate=make();}};
}
test('the reply-to-like deadline is stable across repeated probes and a service worker restart',async()=>{
 const p=pacing();await p.commit('reply');const v=await p.probe('like',{afterReply:true});
 assert.equal(v.granted,false);const delay=v.retryAt-base;assert.ok(delay>=3000&&delay<=5000);
 p.set(delay-1);p.restart();assert.equal((await p.probe('like',{afterReply:true})).retryAt,v.retryAt);assert.equal((await p.probe('like',{afterReply:true})).retryAt,v.retryAt);
 p.set(delay);await p.commit('like',{afterReply:true});p.restart();
 assert.equal((await p.probe('reply')).retryAt,base+delay+23000);
});
test('an own-comment like extends only the notification reply, not the existing global send cooldown for posting or interaction',async()=>{
 for(const [module,kind] of [['posting','post'],['interaction','reply']]){
  const p=pacing();await p.commit('reply');const l=await p.probe('like',{afterReply:true});assert.equal(l.granted,false);
  p.set(l.retryAt-base);await p.commit('like',{afterReply:true});p.set(23000);
  assert.equal((await p.probe('reply')).granted,false);assert.equal((await p.probe(kind,{module})).granted,true);
 }
});

test('a historical, unpaired notification like does not restart the full reply cooldown',async()=>{
 const p=pacing();await p.commit('reply');p.set(60000);await p.commit('like');p.restart();
 const next=await p.probe('reply');assert.equal(next.granted,false);assert.ok(next.retryAt>=base+63000&&next.retryAt<=base+65000);
 p.set(next.retryAt-base);await p.commit('reply');
});
test('an expired after-reply like lease protects the possible click; a late release cannot restart the interval',async()=>{
 const p=pacing();await p.commit('reply');const pending=await p.probe('like',{afterReply:true});
 p.set(pending.retryAt-base);const like=await p.probe('like',{afterReply:true});assert.equal(like.granted,true);
 p.set(like.expiresAt-base);
 const settle=await p.settle('like',like.leaseId,'released',{afterReply:true});assert.equal(settle.consumed,true);
 const first=await p.probe('reply');assert.equal(first.granted,false);assert.equal(first.retryAt,like.expiresAt+23000);
 p.set(like.expiresAt-base+500);p.restart();
 assert.equal((await p.settle('like',like.leaseId,'released',{afterReply:true})).idempotent,true);
 assert.equal((await p.probe('reply')).retryAt,first.retryAt);p.set(first.retryAt-base);await p.commit('reply');
});
