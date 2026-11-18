import test from 'node:test';
import assert from 'node:assert/strict';
import {scanOwnTimeline} from '../deletion-scan.mjs';
const item=(id,text='文'+id)=>({id,text,account:'/me',author:'me',owned:true,original:true,isReply:false,isQuote:false,isRepost:false});
const base={bottom:true,rows:[],unverified:[],busy:false,y:100,h:200,sign:'111',empty:false,cardCount:1};
function scenario(sources,{advance=1,onProgress,signal}={}){
 let t=0,n=0;
 return scanOwnTimeline({tabId:1,account:'/Me',onProgress,signal},{
  now:()=>t,wait:async ms=>{t+=ms*advance;},sample:async(tab,owner,first)=>{
   assert.equal(tab,1);assert.equal(owner,'/me');const p=sources[Math.min(n++,sources.length-1)];return typeof p==='function'?p(first,n):p;
  }
 });
}
test('deduplicates and promotes only positively verified rows; a raw clue carries no authority and stays separate',async()=>{
 const r=await scenario([{waiting:true},{...base,bottom:false,unverified:[{id:'10',text:'片段'},{id:'20',text:'待查'}]}, {...base,rows:[item('10'),{...item('20'),isReply:true}]}]);
 assert.equal(r.complete,true);assert.match(r.coverage,/不代表完整/);assert.deepEqual(r.rows,[item('10')]);assert.deepEqual(r.unverified,[{id:'20',text:'待查'}]);
});
test('a temporary quiet bottom followed by new virtualized rows is not treated as the end',async()=>{
 const pages=Array.from({length:5},()=>({...base,rows:[item('10')]}));pages.push({...base,y:200,h:300,sign:'20',rows:[item('20')]});
 assert.deepEqual((await scenario(pages)).rows.map(r=>r.id),['10','20']);
});
test('changed verified text demotes identity to a clue and errors return limited coverage',async()=>{
 const r=await scenario([{...base,rows:[item('1')]},{...base,rows:[item('1','新正文')]},{stop:'资料页加载错误'}]);
 assert.equal(r.complete,false);assert.deepEqual(r.rows,[]);assert.deepEqual(r.unverified,[{id:'1',text:'新正文'}]);assert.match(r.coverage,/错误/);
});
test('loading, scrolling stall, scan budget or canceled attempts never claim completeness',async()=>{
 const ctrl=new AbortController();
 const r=await scenario([{...base,rows:[item('1')]}],{signal:ctrl.signal,onProgress:()=>ctrl.abort()});assert.equal(r.complete,false);assert.equal(r.rows.length,1);
 for(const [page,options,cause] of [[{waiting:true},{},/超时/],[{...base,busy:true},{},/超时/],[{...base,bottom:false},{},/未继续滚动/],[base,{advance:2000},/上限/]]){
  const s=await scenario([page],options);assert.equal(s.complete,false);assert.match(s.coverage,cause);
 }
});
test('empty flags need a stable bottom too and missing script result stays incomplete',async()=>{
 assert.equal((await scenario([{...base,empty:true,cardCount:0}])).complete,true);
 assert.equal((await scenario([undefined])).complete,false);
});
test('scan never accepts other owners, replies, quotes or reposts as verified rows',async()=>{
 const r=await scenario([{...base,rows:[{...item('1'),author:'other'},{...item('2'),isReply:true},{...item('3'),isQuote:true},{...item('4'),isRepost:true},{...item('5'),owned:false},{...item('6'),original:false}]}]);
 assert.equal(r.rows.length,0);
});
