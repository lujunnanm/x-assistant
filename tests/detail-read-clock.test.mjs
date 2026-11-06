import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
function fixture(){
 let now=1000,next=0,owner='/me',popup=false,host=null,assigned=true,active='notifications',nativeCalls=0;
 const path='/me/status/123', pending=new Map(),timers=new Map(),waits=[],roots=new WeakMap();
 class N extends EventTarget{
  attrs=new Map();children=[];setAttribute(k,v){this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}
  append(n){this.children.push(n);this.firstElementChild=this.children[0];if(this===doc.documentElement)host=n;}
  attachShadow({mode}){assert.equal(mode,'closed');const root=new N();roots.set(this,root);return root;}
  remove(){if(this===host)host=null;}
 }
 const doc=Object.assign(new N(),{hidden:true,documentElement:new N(),createElement:()=>new N(),
   querySelector:s=>s.includes('AppTabBar')?{getAttribute:()=>owner}:s.includes('data-sacred-detail-clock')?host:s.includes('dialog')&&popup?{}:null,
   querySelectorAll:s=>s.includes('dialog')&&popup?[{querySelector:()=>null}]:[]});
 const win={fetch:async()=>({}),addEventListener(){},postMessage(){},requestAnimationFrame:cb=>{nativeCalls++;const id=++next;pending.set(id,cb);return id;},cancelAnimationFrame:id=>pending.delete(id)};
 const loc={origin:'https://x.com',pathname:path},base={Error,URL,Date:{now:()=>now},performance:{now:()=>now},location:loc,window:win,document:doc,Event,AbortController,
  setTimeout:(f,ms)=>{const k=++next;timers.set(k,{f,ms});return k;},clearTimeout:k=>timers.delete(k)};
 vm.runInNewContext(source('thread-ownership.js'),base);
 const iso=vm.createContext({...base,chrome:{dom:{openOrClosedShadowRoot:e=>roots.get(e)}},
   XAssistantWorkspace:{state:()=>({assignment:{module:'notifications',account:assigned?'/me':'/other'}}),active:()=>active,check(){}},
   XAssistantRuntime:{sleep:(_ms,signal)=>new Promise(resolve=>{waits.push(resolve);signal.addEventListener('abort',resolve,{once:true});})}});
 vm.runInContext(source('x-dom.js'),iso);
 const native=id=>{const cb=pending.get(id);if(cb){pending.delete(id);cb(now);}};
 const acquire=()=>iso.XAssistantDOM.beginDetailRead({id:'123',path,runId:'run',signal:new AbortController().signal});
 const tick=async(ms=250)=>{now+=ms;const w=waits.shift();if(w)w();await new Promise(r=>setImmediate(r));};
 return {doc,win,loc,acquire,tick,native,pending,roots,get host(){return host;},setOwner:v=>owner=v,setPopup:v=>popup=v,setAssigned:v=>assigned=v,setActive:v=>active=v,get nativeCalls(){return nativeCalls;}};
}
test('ordinary/visible/mismatched workspaces do not tick, create DOM or focus a page',async()=>{
 for(const mutate of [x=>x.doc.hidden=false,x=>x.setOwner('/other'),x=>x.setAssigned(false),x=>x.setActive('interaction'),x=>x.setPopup(true),x=>x.loc.pathname='/home']){
  const f=fixture();mutate(f);let calls=0;const id=f.win.requestAnimationFrame(()=>calls++),end=f.acquire();await f.tick();
  assert.equal(f.host,null);assert.equal(calls,0);assert.equal(end.stats().ticks,0);f.native(id);assert.equal(calls,1);
 }
});
test('pending pre-lease hidden native frames race each private pulse at most once; cancellation suppresses and recursion waits',async()=>{
 const f=fixture(),fired=[];
 const a=f.win.requestAnimationFrame(()=>fired.push('native'));
 const b=f.win.requestAnimationFrame(()=>{fired.push('fallback');f.win.requestAnimationFrame(()=>fired.push('next-frame'));});
 const cancelled=f.win.requestAnimationFrame(()=>fired.push('cancelled'));f.win.cancelAnimationFrame(cancelled);f.native(a);
 const deliveryAlreadyCaptured=f.pending.get(b);
 const release=f.acquire();assert.equal(f.host.hidden,true);assert.equal(f.host.shadowRoot,undefined);assert.deepEqual(fired,['native','fallback']);assert.equal(release.stats().frames,1);
 assert.equal(f.pending.has(b),false);deliveryAlreadyCaptured(1000);f.native(b);assert.deepEqual(fired,['native','fallback']);
 await f.tick();assert.deepEqual(fired,['native','fallback','next-frame']);
 release();assert.equal(f.host,null);const z=f.win.requestAnimationFrame(()=>fired.push('post-release'));await f.tick();assert.equal(f.pending.has(z),true);f.native(z);assert.equal(fired.at(-1),'post-release');
});
test('focused tab, changed URL/account, an open dialog or expired deadline drops fallback without cancelling genuine callbacks',async()=>{
 for(const [change,delay] of [[f=>{f.doc.hidden=false;},250],[f=>{f.loc.pathname='/me/status/999';},250],[f=>f.setOwner('/other'),250],[f=>f.setPopup(true),250],[()=>{},13000]]){
  const f=fixture();let calls=0;const end=f.acquire(),id=f.win.requestAnimationFrame(()=>calls++);change(f);await f.tick(delay);
  assert.equal(f.host,null);assert.equal(calls,0);assert.equal(f.pending.has(id),true);f.native(id);assert.equal(calls,1);end();
 }
});
