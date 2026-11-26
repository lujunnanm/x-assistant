import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const script=readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8');
const origin='https://x.com',op=origin+'/i/api/graphql/aB_50-g/DeleteTweet',id='102';
const good={data:{delete_tweet:{tweet_results:{}}}};
class Node extends EventTarget{
 constructor(){super();this.attrs=new Map();}
 getAttribute(k){return this.attrs.get(k);}
 setAttribute(k,v){this.attrs.set(k,v);}
 attachShadow(){return this.shadow=new Node();}
 append(n){this.firstElementChild=n;}
 remove(){}
}
function fixture({method='POST',requestUrl=op,body=JSON.stringify({variables:{tweet_id:id,dark_request:false}}),url=op,status=200,json=good,at=22,finish=50,click=true,start=true}={}){
 let clock=10,reads=0,xhrSends=0;
 const win=new Node(),document=new Node(),btn=new Node(),validAccount=new Node(),tasks=[];validAccount.setAttribute('href','/me');
 document.createElement=()=>new Node();document.documentElement=new Node();document.querySelectorAll=()=>[btn];document.querySelector=()=>validAccount;
 win.postMessage=()=>{};const reply={url,status,clone:()=>({json:async()=>structuredClone(json)})};win.fetch=async()=>{reads++;return reply;};
 class XHR extends EventTarget{open(){} send(){xhrSends++;} finish(data=json){Object.assign(this,{status,responseURL:url,responseType:'json',response:data});this.dispatchEvent(new Event('load'));}}
 const world={window:win,document,location:{origin,pathname:'/me/status/102'},XMLHttpRequest:XHR,URL,performance:{now:()=>clock},setTimeout:fn=>{tasks.push(fn);return tasks.length;},clearTimeout(){}};
 vm.runInNewContext(script,world);
 document.dispatchEvent(new Event('sacred-delete-watch'));const port=document.documentElement.firstElementChild.shadow.firstElementChild;
 if(start)port.dispatchEvent(new Event('sacred-delete-arm'));
 if(click){const e=new Event('click');e.composedPath=()=>[btn];win.dispatchEvent(e);}
 clock=at;
 return {port,check:()=>port.getAttribute('data-confirmed')==='1',counts:()=>[reads,xhrSends],
 fetch:async()=>{const p=win.fetch(requestUrl,{method,body});clock=finish;assert.equal(await p,reply);await new Promise(r=>setImmediate(r));},
 xhr:(reuse=false)=>{const x=new XHR();x.open(method,requestUrl);x.send(body);clock=finish;if(reuse){x.open('POST',op);x.send(JSON.stringify({variables:{tweet_id:'103'}}));}x.finish();}};
}
for(const api of ['fetch','xhr'])test('only a native post-click, same-id DeleteTweet POST with affirmative JSON and timely status is accepted: '+api,async()=>{
 const f=fixture();assert.deepEqual(f.counts(),[0,0]);await f[api]();assert.equal(f.check(),true);assert.deepEqual(f.counts(),api==='fetch'?[1,0]:[0,1]);
 for(const invalid of [{start:false},{click:false},{at:3000},{finish:11000},{body:'{}'},{body:'not JSON'},{body:JSON.stringify({variables:{tweet_id:'103'}})},
  {body:JSON.stringify({variables:{tweet_id:id,dark_request:true}})},{body:JSON.stringify({variables:{tweet_id:id,tweet_ids:[id,'103']}})},
  {method:'GET'},{requestUrl:op.replace('x.com','evil.local')},{requestUrl:op+'/extra'},{url:op.replace('aB_50-g','other')},{status:404},
  {json:{...good,errors:[{code:1}]}},{json:{data:{delete_tweet:null}}},{json:{data:{delete_tweet:{tweet_results:null}}}},{json:{data:{delete_tweet:{tweet_results:{result:{rest_id:'103'}}}}}}]){
  const x=fixture(invalid);await x[api]();assert.equal(x.check(),false,JSON.stringify(invalid));
 }
});
test('reopening an XHR for another deletion cannot satisfy the earlier request',()=>{const f=fixture();f.xhr(true);assert.equal(f.check(),false);});
test('the isolated driver accepts native evidence only WITH the bound target gone; missing evidence falls back to toast',()=>{
 const s=readFileSync(new URL('../deletion-dom.js',import.meta.url),'utf8');
 assert.match(s,/const nativeOk=native\?\.seen\(\);if\(!fresh&&!nativeOk\)return false/);assert.match(s,/const gone=!first\.card\.isConnected/);assert.match(s,/return gone\?\(nativeOk\?'native_delete_receipt':'fresh_delete_receipt'\):false/);
});
