import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOwnLinks} from '../deletion-links.mjs';
const url=id=>'https://x.com/me/status/'+id;
function fixture(){
 let tick=0,next=10;const tabs=new Map([[1,{id:1,url:'https://x.com/home'}]]),log=[],seen=new Set(),subs=new Set();
 const f={tabs,log,probe:null,peak:0};
 const api={tabs:{onUpdated:{addListener:x=>subs.add(x),removeListener:x=>subs.delete(x)},
  create:async({url,active})=>{assert.equal(active,false);const id=next++,t={id,url};tabs.set(id,t);seen.add(id);log.push(['create',id,url]);f.peak=Math.max(f.peak,tabs.size-1);return {...t};},
  get:async id=>({...tabs.get(id)}),update:async(id,{url})=>{assert.ok(seen.has(id));tabs.get(id).url=url;for(const s of subs)s(id,{url});log.push(['navigate',id,url]);return {...tabs.get(id)};},
  remove:async id=>{assert.ok(seen.has(id));tabs.delete(id);log.push(['close',id]);}},
  scripting:{executeScript:async d=>{assert.deepEqual(d.target.frameIds,[0]);const [owner,id]=d.args,row={account:owner,id,author:'me',owned:true,original:true,isReply:false,isQuote:false,isRepost:false,text:'原文 '+id,url:url(id),path:'/me/status/'+id};
   return [{frameId:0,result:f.probe?f.probe(d.target.tabId,id,row):{account:owner,row}}];}}};
 f.leave=(id,other)=>{tabs.get(id).url=other;for(const fn of subs)fn(id,{url:other});};
 f.run=(args)=>verifyOwnLinks({account:'/me',...args},{chrome:api,now:()=>tick,wait:async ms=>{tick+=ms;}});
 return f;
}
test('strict own HTTPS allowlist and 500 unique cap validate before opening any tab',async()=>{
 for(const x of ['https://evil.example/me/status/1','https://x.com/other/status/1','https://x.com/me/status/1?next=https://evil.example','https://x.com/me/status/1#x','https://x.com:444/me/status/1','https://x.com@evil.example/me/status/1','https://x.com/me/status/0','https://x.com/me/status/1\nhttps://evil.example','https://x.com/me/../me/status/1']){
  const f=fixture();await assert.rejects(f.run({urls:[url(1),x]}));assert.deepEqual(f.log,[]);
 }
 const f=fixture();await assert.rejects(f.run({urls:Array.from({length:501},(_,i)=>url(i+1))}),/500/);assert.equal(f.log.length,0);
});
test('canonicalizes own exact links, uses ≤3 private background tabs, keeps order, and closes only its own',async()=>{
 const f=fixture(),progress=[];const r=await f.run({urls:[url(1),'https://x.com/ME/status/1/',...Array.from({length:7},(_,i)=>url(i+2))],onProgress:p=>progress.push(p)});
 assert.equal(r.complete,true);assert.deepEqual(r.rows.map(x=>x.id),Array.from({length:8},(_,i)=>String(i+1)));assert.equal(r.unverified.length,0);
 assert.ok(f.peak<=3);assert.equal(f.log.filter(x=>x[0]==='create').length,3);assert.deepEqual([...f.tabs.keys()],[1]);assert.deepEqual(progress.at(-1),{total:8,done:8,verified:8,unverified:0});
});
test('foreign/edited/quoted/reply/unavailable or incomplete evidence is never promoted',async()=>{
 for(const edit of [{original:false},{isQuote:true},{isReply:true},{isRepost:true},{owned:false},{account:'/other'},{author:'other'},{id:'2'},{url:url(2)},{text:'  '}]){
  const f=fixture();f.probe=(_tab,_id,row)=>({account:'/me',row:{...row,...edit}});const r=await f.run({urls:[url(1)]});assert.equal(r.complete,false);assert.equal(r.rows.length,0);assert.equal(r.unverified[0].id,'1');assert.ok(r.unverified[0].reason);
 }
 const f=fixture();f.probe=()=>({unavailable:true});assert.match((await f.run({urls:[url(1)]})).unverified[0].reason,/不可访问/);
});
test('if user navigates a diagnostic tab away, never overwrite it or close it even after returning to the old URL',async()=>{
 const f=fixture();let hijacked;
 f.probe=(tab,id,row)=>{if(id==='1'){hijacked=tab;f.leave(tab,'https://x.com/home');f.leave(tab,url(1));}return {account:'/me',row};};
 const r=await f.run({urls:[url(1)]});assert.equal(r.rows.length,0);assert.ok(f.tabs.has(hijacked));assert.equal(f.log.filter(x=>x[0]==='close').length,0);assert.equal(f.log.filter(x=>x[0]==='navigate').length,0);
});
test('lost login / rate limit or cancellation stop scheduling remaining work, with per-link partial results',async()=>{
 for(const flag of ['wrongAccount','limited']){
  const f=fixture();f.probe=()=>({[flag]:true});const r=await f.run({urls:Array.from({length:9},(_,i)=>url(i+1))});assert.equal(r.rows.length,0);assert.equal(r.unverified.length,9);assert.ok(f.peak<=3);assert.equal(f.log.filter(x=>x[0]==='navigate').length,0);
 }
 const f=fixture(),controller=new AbortController();controller.abort();const r=await f.run({urls:[url(1)],signal:controller.signal});assert.equal(r.unverified.length,1);assert.match(r.coverage,/取消/);assert.equal(f.log.length,0);
});
