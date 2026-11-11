import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const context=vm.createContext({});vm.runInContext(await readFile(new URL('../coordination.js',import.meta.url),'utf8'),context);
test('pause waits for interaction to finish before returning and resumes only prior running state',async()=>{
 let running=true,finish,started=0,finished=false;
 const gate=context.createInteractionGate({isRunning:()=>running,stop:()=>new Promise(r=>{finish=()=>{running=false;r();};}),start:async()=>{running=true;started++;}});
 const pending=gate.pause().then(t=>{finished=true;return t;});await Promise.resolve();assert.equal(finished,false);finish();const token=await pending;assert.equal(running,false);await gate.resume(token);assert.equal(started,1);
 running=false;await gate.resume(await gate.pause());assert.equal(started,1);
});
test('manual stop cancels automatic resume',async()=>{let running=true,started=false;const gate=context.createInteractionGate({isRunning:()=>running,stop:async()=>{running=false;},start:async()=>{started=true;}});const token=await gate.pause();gate.cancel();assert.equal(await gate.resume(token),false);assert.equal(started,false);});
