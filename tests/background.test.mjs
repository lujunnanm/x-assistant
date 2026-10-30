import test from 'node:test';
import assert from 'node:assert/strict';
const events={};let stored={},alarm=null,probeResult={ok:true,message:'located'};
const event=name=>({addListener(fn){events[name]=fn;}});
globalThis.chrome={
 storage:{local:{get:async()=>structuredClone(stored),set:async data=>{stored=structuredClone(data);}}},
 alarms:{create:async(name,info)=>{alarm={name,...info};},clear:async()=>{alarm=null;},onAlarm:event('alarm')},
 action:{onClicked:event('action')},
 tabs:{query:async()=>[{id:7,url:'https://x.com/home',active:false}],get:async()=>({url:'https://x.com/example/status/123'}),sendMessage:async()=>probeResult},
 scripting:{executeScript:async()=>[]},
 runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed'),openOptionsPage:async()=>{}}
};
await import('../background.js');
const send=(kind,extra={})=>new Promise(resolve=>events.message({kind,...extra},{id:'test',url:'chrome-extension://test/panel.html',tab:{id:99,windowId:1}},resolve));
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('start / loop / stop / update / restart',async()=>{
 events.action({id:7,url:'https://x.com/example/status/123'});await tick();
 assert.equal((await send('START')).ok,false,'empty library must not start');
 await send('ROWS',{rows:[{id:'one',type:'reply',text:'test entry',enabled:true}]});
 await send('CONFIG',{config:{min:30,max:30,type:'reply'}});
 let r=await send('START');assert.equal(r.state.running,true);assert.ok(alarm);const generation=r.state.generation;
 r=await send('START');assert.equal(r.state.generation,generation,'duplicate start must not create run');
 stored.app.nextAt=Date.now()-10;events.alarm({name:'x-assistant-loop'});await tick();
 assert.equal(stored.app.current.id,'one');assert.equal(stored.app.running,true);assert.ok(alarm);
 r=await send('STOP');assert.equal(r.state.running,false);assert.equal(alarm,null);
 const old=stored.app.current.at;events.alarm({name:'x-assistant-loop'});await tick();assert.equal(stored.app.current.at,old);
 await send('START');probeResult={ok:false,message:'ambiguous'};stored.app.nextAt=Date.now()-10;events.alarm({name:'x-assistant-loop'});await tick();assert.equal(stored.app.running,false);
 probeResult={ok:true,message:'located'};await send('START');events.startup();await tick();assert.equal(stored.app.running,false);assert.equal(stored.app.rows.length,1);
});
test('stop during outstanding probe does not reschedule',async()=>{
 let resolveProbe;await send('START');
 chrome.tabs.sendMessage=()=>new Promise(resolve=>{resolveProbe=resolve;});
 stored.app.nextAt=Date.now()-10;events.alarm({name:'x-assistant-loop'});await tick();
 await send('STOP');resolveProbe({ok:true,message:'late result'});await tick();
 assert.equal(stored.app.running,false);assert.equal(stored.app.nextAt,null);assert.equal(alarm,null);
});
test('bundled library migrates once and preserves existing edits',async()=>{
 stored={app:{rows:[{id:'post_001',type:'post',text:'my edit',enabled:false},{id:'custom',type:'post',text:'custom',enabled:true}],config:{min:30,max:30,type:'reply'},running:true,generation:0,bag:[],last:null,nextAt:1,tabId:7,logs:[],current:null}};
 events.installed();await tick();assert.equal(stored.app.rows.length,201);assert.equal(stored.app.rows.find(r=>r.id==='post_001').text,'my edit');assert.equal(stored.app.rows.find(r=>r.type==='reply')!==undefined,true);assert.equal(stored.app.running,false);
 assert.equal(stored.app.rows.filter(r=>r.type==='reply').every(r=>r.text.endsWith('\n尽快回关')),true);
 assert.equal(stored.app.replySuffixV2Applied,true);
 stored.app.rows=stored.app.rows.filter(r=>r.id!=='post_002');events.installed();await tick();assert.equal(stored.app.rows.some(r=>r.id==='post_002'),false,'deleted defaults must not be re-added');
});

test('reject content scripts and foreign senders',()=>{
 for(const sender of [{id:'test',url:'https://x.com/home',tab:{id:7}},{id:'other',url:'chrome-extension://test/panel.html'}]) {
 let called=false;const keep=events.message({kind:'START'},sender,()=>{called=true;});assert.equal(keep,undefined);assert.equal(called,false);
 }
});

test('draft flow validates inputs and persists original target',async()=>{
 chrome.tabs.update=async()=>{};stored.app.selectionTabId=stored.app.tabId;
 chrome.scripting.executeScript=async()=>[{result:{message:'draft verified'}}];
 assert.equal((await send('FILL_DRAFT',{url:'https://evil.com/a/status/1',text:'hello'})).ok,false);
 assert.equal((await send('FILL_DRAFT',{url:'https://x.com/a/status/1',text:''})).ok,false);
 assert.equal((await send('FILL_DRAFT',{url:'https://x.com/a/status/1',text:'hello'})).ok,true);
 assert.equal(stored.app.lastDraft.url,'https://x.com/a/status/1');
 chrome.scripting.executeScript=async()=>[{result:{dialog:true}}];
 assert.equal((await send('OPEN_ORIGINAL')).ok,false);
 chrome.scripting.executeScript=async()=>[{result:{dialog:false}}];
 assert.equal((await send('OPEN_ORIGINAL')).ok,true);
 stored.app.running=true;
 assert.equal((await send('LOCATE_FOLLOW')).ok,false);
 stored.app.running=false;
});

test('auto resolves unique home and rejects ambiguous windows',async()=>{
 stored.app.running=false;chrome.tabs.get=async()=>({url:'https://x.com/home'});
 chrome.scripting.executeScript=async()=>[{result:{ok:true,posts:[],message:'ok'}}];
 chrome.tabs.query=async()=>[{id:17,url:'https://x.com/home',active:false}];
 let r=await send('TIMELINE');assert.equal(r.ok,true);assert.equal(r.state.selectionTabId,17);
 chrome.tabs.query=async()=>[{id:17,url:'https://x.com/home'},{id:18,url:'https://x.com/home'}];
 assert.equal((await send('TIMELINE')).ok,false);
 chrome.tabs.query=async()=>[];assert.equal((await send('TIMELINE')).ok,false);
});

test('single reply executes once and records verified state',async()=>{
 stored.app.running=false;stored.app.singleLedger=null;stored.app.lastDraft={url:'https://x.com/a/status/1',tabId:17};
 let calls=0;chrome.scripting.executeScript=async()=>{calls++;return [{result:{status:'verified',clicked:true,message:'reply verified'}}];};
 let r=await send('EXECUTE_SINGLE',{action:'reply',url:'https://x.com/a/status/1',text:'hello'});
 assert.equal(r.ok,true);assert.equal(r.state.singleLedger.steps.reply,'verified');assert.equal(calls,1);
 r=await send('EXECUTE_SINGLE',{action:'reply',url:'https://x.com/a/status/1',text:'hello'});
 assert.equal(r.ok,true);assert.equal(calls,1,'verified action must not repeat');
 stored.app.singleLedger=null;delete stored.app.lastDraft;
 r=await send('EXECUTE_SINGLE',{action:'reply',url:'https://x.com/a/status/1',text:'hello'});
 assert.equal(r.ok,false);assert.equal(stored.app.singleLedger,null,'precondition failure must not lock the action');
});
