import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const core=await readFile(new URL('../scheduler-core.js',import.meta.url),'utf8'),source=await readFile(new URL('../scheduler.js',import.meta.url),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,25));
async function fixture({workMs=0,scanComplete=false,scanRest=false,postError=false,entryError=false}={}){
 let now=0,working=false,scans=0,postRunning=false;const storage={},calls=[],runtimes={posting:{active:false},interaction:{active:false},notifications:{active:false}};
 const node=()=>({dataset:{},textContent:'',setAttribute(){},after(){},replaceWith(){}});
 const button=node(),summary=node(),header=node(),sections={};for(const n of ['posting','interaction','notifications'])sections[n]={querySelector:()=>node()};
 const root={querySelector:s=>s==='header'?header:sections[/data-module="(.*?)"/.exec(s)?.[1]]||node(),insertBefore(){}};
 const document={getElementById:()=>root,createElement:()=>({...node(),querySelector:s=>s==='button'?button:summary})};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},2);function abort(){clearTimeout(timer);reject(new DOMException('stop','AbortError'));}if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
 const runtime=async(n,action,extra={})=>{const s=runtimes[n];if(action==='get'||action==='prepare')return {...s};if(action==='begin'){Object.assign(s,{active:true,runId:n,phase:'waiting',error:null});return {...s};}if(action==='patch'){Object.assign(s,extra.patch);return {...s};}if(action==='stop'){s.active=false;calls.push('stop:'+n);return {...s};}};
 const ctx=vm.createContext({document,Date:{now:()=>now},AbortController,DOMException,Promise,setTimeout,clearTimeout,window:{addEventListener(){}},navigator:{locks:{request:async(name,options,fn)=>fn({name})}},chrome:{storage:{local:{get:async k=>({[k]:storage[k]}),set:async o=>Object.assign(storage,o)}}},XAssistantRuntime:{call:async()=>({ready:true}),runtime,review:async()=>true,sleep,check:s=>{if(s.aborted)throw new DOMException('stop','AbortError');}},XAssistantEntry:{account:()=>'/me',enter:async()=>{if(entryError)throw Error('navigation failed');}},XAssistantInteractionDriver:{isRunning:()=>working,start:async()=>{working=true;runtimes.interaction.active=true;calls.push('interaction:start');},pause:async()=>{working=false;calls.push('interaction:pause');},stop:async()=>{working=false;runtimes.interaction.active=false;}},XAssistantPostingDriver:{start:async()=>{postRunning=true;Object.assign(runtimes.posting,{active:true,phase:'waiting',nextAt:9999999,error:postError?'generation failed':null});},stop:async()=>{postRunning=false;runtimes.posting.active=false;}},XAssistantNotifications:{scan:async options=>{scans++;calls.push('scan');assert.equal(working,false);assert.equal(options.yieldAt,Math.min(storage.xAssistantSchedulerV3.restUntil,runtimes.posting.nextAt)-30000);return{complete:scanComplete,rest:scanRest};}}});
 vm.runInContext(core,ctx);const orig=ctx.XAssistantSchedulerCore.fresh;ctx.XAssistantSchedulerCore.fresh=t=>({...orig(t),workMs});vm.runInContext(source,ctx);await wait();
 return {ctx,storage,calls,runtimes,button,summary,advance:async t=>{now=t;await wait();},start:async()=>{await ctx.XAssistantScheduler.start();await wait();},stop:()=>ctx.XAssistantScheduler.stop(),working:()=>working,scans:()=>scans,postRunning:()=>postRunning};
}
test('actual controller: work → post pause → resume → rest/replies → exhausted idle → work',async()=>{
 const f=await fixture({workMs:3599000,scanComplete:true});try{
  await f.start();assert.equal(f.working(),true);assert.equal(f.postRunning(),true);
  await f.advance(500);await f.ctx.XAssistantScheduler.beforePost();assert.equal(f.working(),false);
  await f.advance(100000);assert.equal(f.storage.xAssistantSchedulerV3.workMs,3599500);
  await f.ctx.XAssistantScheduler.afterPost();await wait();assert.equal(f.working(),true);
  await f.advance(100500);assert.equal(f.storage.xAssistantSchedulerV3.mode,'replies');assert.equal(f.working(),false);assert.equal(f.scans(),1);
  await f.advance(400500);assert.equal(f.scans(),1);
  await f.advance(1900500);assert.equal(f.working(),true);assert.equal(f.storage.xAssistantSchedulerV3.mode,'interaction');
 }finally{await f.stop();}assert.equal(f.postRunning(),false);assert.equal(f.storage.xAssistantSchedulerV3.active,false);
});
test('actual controller: posting error shuts down all modules instead of silently restarting',async()=>{
 const f=await fixture({postError:true});await f.start();await wait();assert.equal(f.postRunning(),false);assert.equal(f.working(),false);assert.equal(f.storage.xAssistantSchedulerV3.active,false);assert.match(f.summary.textContent,/generation failed/);
});
test('actual controller: failed navigation never starts a module',async()=>{
 const f=await fixture({entryError:true});await f.start();await wait();assert.equal(f.postRunning(),false);assert.equal(f.working(),false);assert.match(f.summary.textContent,/navigation failed/);
});

test('notification scan-limit rest keeps posting alive without repeated scanning',async()=>{
 const f=await fixture({workMs:3599000,scanRest:true});
 try{await f.start();await f.advance(1500);assert.equal(f.scans(),1);assert.equal(f.postRunning(),true);assert.equal(f.storage.xAssistantSchedulerV3.active,true);await f.advance(300000);assert.equal(f.scans(),1);assert.equal(f.postRunning(),true);}finally{await f.stop();}
});
