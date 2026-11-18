import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const main=readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8');
const isolated=readFileSync(new URL('../posting-native.js',import.meta.url),'utf8');
const origin='https://x.com',endpoint=origin+'/i/api/graphql/aa50-g/CreateTweet',text='正文\n@grok';
const epoch=1700000000000,snowflake=time=>String(BigInt(time-1288834974657)<<22n);
const postId=snowflake(epoch+100);
const response=({author='owner',id=postId,legacy={conversation_id_str:id},extra={}}={})=>({data:{create_tweet:{tweet_results:{result:{
 __typename:'Tweet',rest_id:id,legacy,core:{user_results:{result:{core:{screen_name:author}}}},...extra,
}}}}});
const body=(vars={})=>JSON.stringify({variables:{tweet_text:text,dark_request:false,media:{media_entities:[],possibly_sensitive:false},
 semantic_annotation_ids:[],disallowed_reply_options:null,...vars},features:{irrelevant:true}});

function fixture(opts={}){
 let clock=0,requests=0,sends=0,seq=0,finishFetch;
 const headerKeys=[];
 const timers=new Map(),roots=new WeakMap();
 const later=(fn,ms=0)=>{timers.set(++seq,{fn,due:clock+ms});return seq;};
 const at=t=>{clock=t;while(true){const next=[...timers].sort((a,b)=>a[1].due-b[1].due).find(([,v])=>v.due<=clock);if(!next)break;timers.delete(next[0]);next[1].fn();}};
 class Node extends EventTarget{
  constructor(){super();this.attrs=new Map();this.children=[];this.isConnected=true;}
  getAttribute(n){return this.attrs.get(n)??null;}
  setAttribute(n,v){this.attrs.set(n,String(v));}
  removeAttribute(n){this.attrs.delete(n);}
  append(n){n.parentElement=this;n.isConnected=true;this.children.push(n);}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
  attachShadow(){const root=new Node();roots.set(this,root);return root;}
  get firstElementChild(){return this.children[0];}
  closest(){return null;}
  contains(n){return this===n||this.children.some(c=>c.contains(n));}
  querySelector(){return null;}
  querySelectorAll(){return [];}
 }
 const win=new Node(),document=new Node(),primary=new Node(),form=new Node(),ed=new Node(),btn=new Node(),account=new Node(),other=new Node();
 account.setAttribute('href',opts.pageAccount||'/owner');ed.innerText=opts.editorText??text;btn.setAttribute('data-testid','tweetButtonInline');
 form.append(ed);form.append(btn);primary.append(form);
 primary.querySelectorAll=s=>s.includes('tweetButtonInline')?[btn]:s.includes('tweetTextarea_0')?[ed]:[];
 document.createElement=()=>new Node();document.documentElement=new Node();document.defaultView=win;
 document.querySelectorAll=s=>s.includes('primaryColumn')?[primary]:[];
 document.querySelector=s=>s.includes('Profile_Link')?account:null;
 document.documentElement.querySelectorAll=()=>document.documentElement.children.filter(n=>n.getAttribute('data-sacred-post-watch')!==null);
 const replies=[{url:endpoint,status:200,data:response(),...opts.response},{url:endpoint,status:200,data:response(),...opts.second}];
 win.postMessage=()=>{};
 win.fetch=async(...args)=>{
  const r=replies[Math.min(requests++,replies.length-1)];
  if(opts.fail)throw Error('network failure');
  if(opts.hold)await new Promise(resolve=>{finishFetch=resolve;});
  return {url:r.url,status:r.status,original:true,headers:{get:k=>{headerKeys.push(k);return r.headers?.[k]??null;}},
   clone:()=>({json:async()=>structuredClone(r.data)})};
 };
 class XHR extends EventTarget{
  open(){}
  send(){sends++;}
  finish(i=0){const r=replies[i];Object.assign(this,{status:r.status,responseURL:r.url,responseType:'json',response:r.data,
   getResponseHeader:k=>{headerKeys.push(k);return r.headers?.[k]??null;}});this.dispatchEvent(new Event('load'));}
 }
 const location={origin,pathname:opts.path||'/home'},DateClock=class extends Date{static now(){return epoch+clock;}};
 win.location=location;other.setAttribute('data-testid','tweetButtonInline');
 vm.runInNewContext(main,{window:win,document,location,URL,Date:DateClock,XMLHttpRequest:XHR,performance:{now:()=>clock},setTimeout:later,clearTimeout:id=>timers.delete(id)});
 const scope={chrome:{dom:{openOrClosedShadowRoot:n=>roots.get(n)}},Event};
 vm.runInNewContext(isolated,scope);
 if(opts.fakeHost){const h=new Node();h.setAttribute('data-sacred-post-watch','');h.setAttribute('data-result',JSON.stringify({kind:'confirmed',evidence:'x_create_result',postId,url:origin+'/owner/status/'+postId}));document.documentElement.append(h);}
 const watch=scope.XAssistantPostingNative.create({document,button:opts.wrongBinding?other:btn,account:opts.owner||'/owner',text,mediaCount:opts.mediaCount||0,timeout:15000});
 const click=()=>{const e=new Event('click');e.composedPath=()=>[opts.wrongClick?other:btn];win.dispatchEvent(e);};
 if(opts.click!==false){at(10);click();}
 const fetch=(params={})=>win.fetch(params.url||endpoint,{method:params.method||'POST',body:params.body??body()});
 const xhr=(params={})=>{const x=new XHR();x.open(params.method||'POST',params.url||endpoint);x.send(params.body??body());return x;};
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 return {watch,at,click,fetch,xhr,settle,location,account,document,headerKeys,finishFetch:()=>finishFetch(),counts:()=>({requests,sends})};
}

for(const api of ['fetch','xhr'])test('passive '+api+' readback confirms only the exact, fresh original post',async()=>{
 const f=fixture({fakeHost:true});assert.ok(f.watch);assert.deepEqual(f.counts(),{requests:0,sends:0});f.at(100);
 if(api==='fetch')assert.equal((await f.fetch()).original,true);else f.xhr().finish();
 await f.settle();
 assert.deepEqual({...f.watch.poll()},{kind:'confirmed',evidence:'x_create_result',postId,url:origin+'/owner/status/'+postId});
 assert.deepEqual(f.counts(),api==='fetch'?{requests:1,sends:0}:{requests:0,sends:1});
 f.watch.close();assert.equal(f.watch.poll(),null);
});

test('wrong account, draft, button, timing, operation, HTTP failure or response binding cannot supply a receipt',async()=>{
 for(const opts of [
  {click:false},{wrongClick:true},{wrongBinding:true},{owner:'/other'},{editorText:'别人的稿件'},{path:'/compose/post'},
  {startAt:3000},{url:origin+'/i/api/graphql/aa50-g/CreateNoteTweet'},{url:origin+'/i/api/graphql/aa50-g/CreateTweet?external=1'},
  {url:'https://other.example/i/api/graphql/aa50-g/CreateTweet'},{method:'GET'},{response:{url:endpoint.replace('aa50-g','other')}},
  {response:{status:503}},{response:{data:response({author:'other'})}},
  {response:{data:response({id:snowflake(epoch-9000)})}},
  {response:{data:response({legacy:{conversation_id_str:'2',in_reply_to_status_id_str:'2'}})}},
  {response:{data:{...response(),errors:[{code:88}]}}},{response:{data:{data:{create_tweet:{tweet_results:{}}}}}},
  {body:body({tweet_text:'正文和本人相似但不同'})},{body:body({reply:{in_reply_to_tweet_id:'13'}})},
  {body:body({quote_tweet_id:'13'})},{body:body({thread:{}})},{body:body({scheduled_at:123})},
 ]){
  const f=fixture(opts);f.at(opts.startAt||100);await f.fetch(opts);await f.settle();
  assert.equal(f.watch?.poll()??null,null,JSON.stringify(opts));
 }
});

test('a media post keeps the exact original text and unique sent attachment count binding',async()=>{
 for(const [items,ok] of [[[{media_id:'123',tagged_users:[]}],true],[[],false],[[{media_id:'123'},{media_id:'123'}],false]]){
  const f=fixture({mediaCount:1});f.at(200);
  await f.fetch({body:body({media:{media_entities:items,possibly_sensitive:false}})});await f.settle();
  assert.equal(f.watch.poll()?.kind==='confirmed',ok);
 }
});

test('a rate rejection must contain the explicit result code and no written ID, and cannot become success',async()=>{
 for(const [raw,expected] of [
  [{status:429,data:{errors:[{code:88}]}},'not_sent'],
  [{status:200,data:{data:{create_tweet:null},errors:[{code:88}]}},'not_sent'],
  [{status:429,data:{errors:[{message:'generic 429'}]}},null],
  [{status:503,data:{errors:[{code:88}]}},null],
  [{status:200,data:{errors:[{code:130}]}},null],
  [{status:200,data:{...response(),errors:[{code:88}]}},null],
 ]){
   const f=fixture({response:raw});f.at(50);f.xhr().finish();
   assert.equal(f.watch.poll(),null);f.at(3000);
   assert.equal(f.watch.poll()?.kind??null,expected);
   if(expected)assert.deepEqual({...f.watch.poll()},{kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88});
 }
});

test('a second native request, account change or expired response invalidates settlement',async()=>{
 const f=fixture({response:{status:429,data:{errors:[{code:88}]}}});f.at(100);f.xhr().finish();
 f.at(1000);f.xhr().finish(1);f.at(3000);assert.equal(f.watch.poll(),null);
 for(const change of [f=>f.at(18000),f=>f.account.setAttribute('href','/other'),f=>{f.location.pathname='/search';}]){
  const g=fixture({hold:true});g.at(100);const pending=g.fetch();change(g);g.finishFetch();await pending;await g.settle();assert.equal(g.watch.poll(),null);
 }
 const g=fixture({fail:true});g.at(100);await assert.rejects(g.fetch(),/network failure/);assert.equal(g.watch.poll(),null);
});

test('an automatic native retry started late in the receipt window revokes the tentative rejection',async()=>{
 for(const response of [{status:429,data:{errors:[{code:88}]}},{status:503,data:{data:{create_tweet:null},errors:[{code:130,message:'Over capacity'}]}}]){
  const f=fixture({response});f.at(100);await f.fetch();await f.settle();f.at(3000);assert.equal(f.watch.poll()?.kind,'not_sent');
  f.at(10000);await f.fetch();await f.settle();f.at(14900);
  assert.equal(f.watch.poll(),null);
 }
});

test('only a null CreateTweet result with a single explicit Over capacity code qualifies for temporary retry',async()=>{
 const error={code:130,message:'Over capacity.'},data={create_tweet:null};
 for(const [api,status] of [['fetch',200],['xhr',503]]){
  const f=fixture({response:{status,data:{data,errors:[error]},headers:{'retry-after':'60','x-rate-limit-reset':String((epoch+3600000)/1000)}}});f.at(100);
  if(api==='fetch')await f.fetch();else f.xhr().finish();
  await f.settle();assert.equal(f.watch.poll(),null);f.at(3000);
  assert.deepEqual({...f.watch.poll()},{kind:'not_sent',evidence:'x_create_result',reason:'temporary_rejection',code:130,retryAt:epoch+60100});
  assert.deepEqual(f.headerKeys,['retry-after']);
 }
 for(const response of [
  {status:503,data:{errors:[error]}},{status:503,data:{data:null,errors:[error]}},{status:503,data:{data,errors:[{code:130}]}},
  {status:503,data:{data,errors:[{...error,message:'Something went wrong'}]}},{status:503,data:{data,errors:[{...error,message:'not Over capacity'}]}},
  {status:429,data:{data,errors:[error]}},{status:500,data:{data,errors:[error]}},
  {status:503,data:{data,errors:[{...error,code:185}]}},{status:503,data:{data,errors:[error,{code:88}]}},
  {status:503,data:{data:{...data,other:{id:postId}},errors:[error]}},
  {status:503,data:{data:{create_tweet:{tweet_results:{result:{rest_id:postId}}}},errors:[error]}},
 ]){
  const f=fixture({response});f.at(100);f.xhr().finish();f.at(3000);
  assert.equal(f.watch.poll(),null,JSON.stringify(response));
 }
});

test('only specific response rate-limit deadlines are read from a proven unexecuted request',async()=>{
 const reset=epoch+3600000;
 for(const api of ['fetch','xhr']){
  const f=fixture({response:{status:429,data:{errors:[{code:88}]},headers:{'retry-after':'1800','x-rate-limit-reset':String(reset/1000),authorization:'untouched'}}});
  f.at(100);if(api==='fetch')await f.fetch();else f.xhr().finish();await f.settle();f.at(3000);
  assert.equal(f.watch.poll()?.retryAt,reset);
  assert.deepEqual(f.headerKeys,['retry-after','x-rate-limit-reset']);
 }
 const g=fixture();g.at(100);await g.fetch();await g.settle();
 assert.equal(g.watch.poll()?.kind,'confirmed');assert.deepEqual(g.headerKeys,[]);
});

test('preexisting or public receipt claims never count as private native evidence',()=>{
 const f=fixture({fakeHost:true,click:false});assert.ok(f.watch);
 const own=f.document.documentElement.children.at(-1);own.setAttribute('data-result',JSON.stringify({kind:'confirmed',evidence:'x_create_result',postId,url:origin+'/owner/status/'+postId}));
 assert.equal(f.watch.poll(),null);
});
