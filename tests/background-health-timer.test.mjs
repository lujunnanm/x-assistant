import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {beginState,patchState} from '../state.mjs';
const raw=fs.readFileSync(new URL('../runtime-client.js',import.meta.url),'utf8');
test('hidden work uses a worker wake even when native tab timer never runs',async()=>{
 const sent=[];const ctx=vm.createContext({crypto,DOMException,Date,document:{hidden:true},XAssistantWorkspace:{active:()=> 'interaction',check:()=>{}},chrome:{runtime:{id:'fixture',sendMessage:m=>{sent.push(m);return new Promise(resolve=>setTimeout(()=>resolve({ok:true}),m.ms));}}},setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(raw,ctx);await ctx.XAssistantRuntime.sleep(5,new AbortController().signal);assert.ok(sent.length);assert.ok(sent.every(k=>k.kind==='WORKER_WAKE'));
});
test('abort during hidden sleep rejects and a late wake cannot cause a second completion',async()=>{
 let release;const ctx=vm.createContext({crypto,DOMException,Date,document:{hidden:true},XAssistantWorkspace:{active:()=> 'notifications',check(){}},chrome:{runtime:{id:'fixture',sendMessage:()=>new Promise(r=>release=r)}},setTimeout:()=>1,clearTimeout(){}});vm.runInContext(raw,ctx);
 const c=new AbortController(),pending=ctx.XAssistantRuntime.sleep(500,c.signal);c.abort();await assert.rejects(pending,{name:'AbortError'});release({ok:true});
});
test('progress and per-target error survive ordinary activity and may not be written by a replaced run',()=>{
 const auth={owner:1,documentId:'doc',runId:'r'};let s=beginState({account:'/old',lastIssue:{message:'old account'},receipt:{kind:'confirmed'}},{},{owner:1,documentId:'doc',account:'/me',id:'r'});
 assert.equal(s.lastIssue,null);assert.equal(s.receipt,null);s=patchState(s,{lastIssue:{code:'EDITOR_NOT_READY',message:'回复输入框未就绪',targetId:'123'}},auth);
 const tick=patchState(s,{activity:{step:'检查下一目标'}},auth);assert.deepEqual(tick.lastIssue,s.lastIssue);assert.equal(tick.activity.step,'检查下一目标');
 assert.throws(()=>patchState(tick,{lastIssue:{message:'late'}},{...auth,runId:'old'}));
});
test('receipt-only wake remains bounded in a hidden tab after permission is revoked and grants no action',async()=>{
 const sent=[];const ctx=vm.createContext({crypto,DOMException,Date,document:{hidden:true},XAssistantWorkspace:{active:()=>'notifications',check(){throw Error('revoked');}},chrome:{runtime:{id:'fixture',sendMessage:m=>{sent.push(m.kind);return new Promise(r=>setTimeout(()=>r({ok:true}),m.ms));}}},setTimeout:()=>1,clearTimeout(){}});vm.runInContext(raw,ctx);
 await ctx.XAssistantRuntime.wakeReadOnly(5,new AbortController().signal);assert.deepEqual([...new Set(sent)],['WORKER_WAKE']);
 await assert.rejects(ctx.XAssistantRuntime.sleep(5,new AbortController().signal),/revoked/);
});
