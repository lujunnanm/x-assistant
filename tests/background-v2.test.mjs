import test from 'node:test';import assert from 'node:assert/strict';
const events={};let stored={};const evt=n=>({addListener:f=>events[n]=f});
globalThis.chrome={storage:{local:{get:async key=>({[key]:structuredClone(stored[key])}),set:async data=>{Object.assign(stored,structuredClone(data));}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:evt('message'),onInstalled:evt('install'),onStartup:evt('startup'),openOptionsPage:async()=>{}},tabs:{get:async id=>({id,url:'https://x.com/search?q=fixture'}),onRemoved:evt('removed')},action:{onClicked:evt('click')},alarms:{clear:async()=>{}}};
const realNow=Date.now;Date.now=()=>Date.parse('2026-11-04T04:00:00Z');
await import('../background.js');Date.now=realNow;
// Legacy behavior fixtures now explicitly provision supervisor-owned workers.
function provision(msg,who){
 if(!who.tab||!/^https:\/\/x\.com\//.test(who.url||''))return;
 const module=msg.kind==='AI_CHECK'?msg.module:msg.kind==='RUNTIME'&&['begin','prepare'].includes(msg.action)?msg.module:null;
 if(!['posting','interaction','notifications'].includes(module))return;
 const service=stored.xAssistantManagedServiceV1||{account:'/me',selected:{posting:true,interaction:true,notifications:true},workers:{},revision:1};
 service.enabled=true;service.account='/me';service.selected={posting:true,interaction:true,notifications:true};service.workers[module]={tabId:who.tab.id,token:'fixture-'+module,status:'stopped'};stored.xAssistantManagedServiceV1=service;
}
const sender={id:'test',url:'https://x.com/home',tab:{id:1}},panel={id:'test',url:'chrome-extension://test/panel.html'};
const rawSend=(msg,who)=>new Promise(resolve=>events.message(msg,who,resolve));
const send=async(msg,who=sender)=>{provision(msg,who);if(who.tab&&/^https:\/\/x\.com\//.test(who.url)){who={...who,documentId:who.documentId||'doc-'+who.tab.id};msg={instanceId:'instance-'+who.tab.id,...msg};if(msg.kind!=='PING'&&msg.kind!=='WORKSPACE_HELLO')await rawSend({kind:'WORKSPACE_HELLO',instanceId:msg.instanceId},who);}return rawSend(msg,who);};
const rt=(action,extra={})=>send({kind:'RUNTIME',module:'posting',action,...(action==='stop'?{runId:stored.xAssistantPostingV1?.runId}:{}),...extra});
const tick=()=>new Promise(r=>setTimeout(r,20));
test('integration: legacy backup, new posting copy edits, start, stop, stale completion, restart',async()=>{
 stored.app={rows:[{id:'custom',type:'post',text:'mine',enabled:true}],logs:[]};events.install();await tick();
 assert.deepEqual(stored.app.rows,[]);assert.equal(stored.app.postingCopyMigratedV1,true);
 assert.equal(stored.xAssistantLegacyCopyBackupV1.rows[0].text,'mine');
 const a=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:'a',row:{id:'a',text:'a',enabled:true},expected:null,expectedRevision:0}},panel);
 const b=await send({kind:'POST_COPIES_OP',op:{action:'upsert',id:'b',row:{id:'b',text:'b',enabled:true},expected:null,expectedRevision:1}},panel);
 assert.equal(a.ok,true,a.error);assert.equal(b.ok,true,b.error);
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(r=>r.text),['a','b']);
 const started=await rt('begin',{account:'/me'});assert.equal(started.ok,true);const runId=started.state.runId;
 assert.equal((await send({kind:'RUNTIME',module:'interaction',action:'begin',account:'/me',sourceMode:'search'},{...sender,tab:{id:2}})).ok,true);
 assert.equal((await send({kind:'RUNTIME',module:'cleanup',action:'begin',account:'/me'})).ok,false);
 await rt('patch',{runId,patch:{phase:'submitting',text:'proof'}});await rt('stop');assert.equal(stored.xAssistantPostingV1.phase,'unknown');
 assert.equal((await rt('patch',{runId,patch:{phase:'confirmed'}})).ok,false);assert.equal((await rt('begin',{account:'/me'})).ok,false);
 events.startup();await tick();assert.equal(stored.xAssistantPostingV1.phase,'unknown');assert.deepEqual(stored.app.rows,[]);
});
test('untrusted page cannot mutate new posting copy bank, unknown command fails',async()=>{assert.equal((await send({kind:'POST_COPIES_OP',op:{action:'clear',expectedRevision:0}})).ok,false);assert.equal((await send({kind:'RUNTIME',module:'evil',action:'begin'})).ok,false);});
test('ordinary X pages can rewrite posts and fuse comments without workspace ownership',async()=>{
 stored.xAssistantPostingCopiesV1={revision:0,rows:[]};stored.xAssistantDeepSeekKeyV1='fixture-key';
 const post={id:'987654321',author:'Writer',text:'时间线原文',url:'https://x.com/Writer/status/987654321'};
 const who={...sender,documentId:'ordinary-home',documentLifecycle:'active'},originalFetch=globalThis.fetch;let providerCalls=0,releaseConcurrent,markConcurrent;
 const concurrentEntered=new Promise(resolve=>markConcurrent=resolve);
 globalThis.fetch=async(url,opts)=>{
  if(url.startsWith('chrome-extension://test/bridge/'))return{ok:true,text:async()=>'fixture rewrite rules'};
  if(url==='https://api.deepseek.com/chat/completions'){
   providerCalls++;const input=JSON.parse(JSON.parse(opts.body).messages[1].content),source=input.reference_text||input.comment_text;
   if(source==='失败原文')return{ok:false,status:503};
   if(source==='并发原文'){markConcurrent();await new Promise(resolve=>releaseConcurrent=resolve);}
   const text=input.comment_text?'评论与所属帖子融合改写文案':source==='并发原文'?'并发改写文案':'DeepSeek 改写文案';
   return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'save_copy',text})}}]})};
  }
  throw Error('unexpected fixture URL');
 };
 try{
  const added=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},who);assert.equal(added.ok,true,added.error);assert.equal(added.state.added,true);
  assert.equal(stored.xAssistantPostingCopiesV1.rows[0].text,'DeepSeek 改写文案');assert.notEqual(stored.xAssistantPostingCopiesV1.rows[0].text,post.text);
  const status=await rawSend({kind:'TIMELINE_REWRITE_STATUS',ids:[post.id,'111']},who);assert.equal(status.ok,true,status.error);assert.deepEqual(status.state.existing,[post.id]);
  const duplicate=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},who);assert.equal(duplicate.ok,true,duplicate.error);assert.equal(duplicate.state.added,false);assert.equal(stored.xAssistantPostingCopiesV1.revision,1);assert.equal(providerCalls,1);
  const allowed=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},{...who,url:'https://x.com/search?q=ai'});assert.equal(allowed.ok,true);assert.equal(allowed.state.added,false);
  const denied=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},{...who,url:'https://example.com/search?q=ai'});assert.equal(denied.ok,false);
  const failedPost={id:'987654322',author:'Writer',text:'失败原文',url:'https://x.com/Writer/status/987654322'};
  const failed=await rawSend({kind:'TIMELINE_REWRITE_ADD',post:failedPost},who);assert.equal(failed.ok,false);assert.equal(stored.xAssistantPostingCopiesV1.rows.length,1);assert.equal(stored.xAssistantPostingCopiesV1.revision,1);
  const concurrentPost={id:'987654323',author:'Writer',text:'并发原文',url:'https://x.com/Writer/status/987654323'},before=providerCalls;
  const first=rawSend({kind:'TIMELINE_REWRITE_ADD',post:concurrentPost},who),second=rawSend({kind:'TIMELINE_REWRITE_ADD',post:concurrentPost},who);
  await concurrentEntered;releaseConcurrent();const results=await Promise.all([first,second]);
  assert.equal(providerCalls,before+1);assert.deepEqual(results.map(result=>result.state.added).sort(),[false,true]);assert.equal(stored.xAssistantPostingCopiesV1.rows.at(-1).text,'并发改写文案');
  const rootPost={id:'900',author:'Root',text:'所属帖子观点',url:'https://x.com/Root/status/900'};
  const comment={id:'901',author:'Commenter',text:'评论观点',url:'https://x.com/Commenter/status/901',rootPost};
  const fused=await rawSend({kind:'TIMELINE_REWRITE_ADD',post:comment},{...who,url:'https://x.com/Root/status/900'});
  assert.equal(fused.ok,true,fused.error);assert.equal(fused.state.added,true);assert.equal(stored.xAssistantPostingCopiesV1.rows.at(-1).text,'评论与所属帖子融合改写文案');
  assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.at(-1).sourceUrls,[comment.url,rootPost.url]);
  assert.equal((await rawSend({kind:'TIMELINE_COPY_ADD',post},who)).ok,false,'obsolete exact-copy endpoint stays closed');
 }finally{globalThis.fetch=originalFetch;}
});
test('plus saves photo bytes with rewritten text or by themselves, enabled by default without leaking images to DeepSeek or starting modules',async()=>{
 stored.xAssistantPostingCopiesV1={revision:0,rows:[]};stored.xAssistantDeepSeekKeyV1='fixture-key';
 const photo=n=>'https://pbs.twimg.com/media/'+n+'?format=png&name=medium';
 const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==','base64');
 const input=(id,text,imageUrls)=>({id,author:'Writer',url:'https://x.com/Writer/status/'+id,text,imageUrls});
 const add=post=>rawSend({kind:'TIMELINE_REWRITE_ADD',post},sender);
 const oldFetch=globalThis.fetch,oldDecode=globalThis.createImageBitmap,calls=[];let ai=0;
 globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 globalThis.fetch=async(url,opts)=>{
  if(url.startsWith('chrome-extension://test/bridge/'))return{ok:true,text:async()=>'fixture rewrite rules'};
  if(url==='https://api.deepseek.com/chat/completions'){
   ai++;assert.doesNotMatch(opts.body,/pbs\.twimg|base64|imageUrls/);
   return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"save_copy","text":"这是配图贴的新写法。"}'}}]})};
  }
  assert.match(url,/^https:\/\/pbs\.twimg\.com\/media\/\w+\?format=png&name=large$/);
  assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');calls.push(url);
  return new Response(pixels,{status:url.includes('/broken?')?404:200,headers:{'Content-Type':'image/png'}});
 };
 try{
  const first=input('700','正文',[photo('one'),photo('two')]);
  assert.equal((await add(first)).ok,true);
  let rows=stored.xAssistantPostingCopiesV1.rows;
  assert.equal(rows[0].enabled,true);assert.equal(rows[0].images.length,2);assert.match(rows[0].images[0],/^data:image\/png;base64,/);assert.match(rows[0].text,/新写法/);
  assert.equal((await add(first)).state.added,false);assert.equal(calls.length,2);assert.equal(ai,1);
  assert.equal((await add(input('701','',[photo('one')]))).ok,true);assert.equal(ai,1);
  rows=stored.xAssistantPostingCopiesV1.rows;assert.equal(rows[1].text,'');assert.ok(rows[1].image);assert.equal(rows[1].enabled,true);
  const rev=stored.xAssistantPostingCopiesV1.revision;
  assert.equal((await add(input('702','',[photo('one'),photo('broken')]))).ok,false);
  assert.equal((await add(input('703','',['https://evil.test/media/one?format=png']))).ok,false);
  assert.equal(stored.xAssistantPostingCopiesV1.revision,rev);assert.equal(stored.xAssistantPostingCopiesV1.rows.length,2);
 }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldDecode;}
});
test('plus stores original native GIF bytes via a restricted CDN request, never starts a module or silently drops failed media',async()=>{
 stored={xAssistantPostingCopiesV1:{revision:0,rows:[]}};
 const bytes=Buffer.from('000000146674797069736f6d0000000069736f6d0000000c6d6f6f76000000000000000c6d64617400000000','hex');
 const gif='https://video.twimg.com/tweet_video/OwnAnimation.mp4',oldFetch=globalThis.fetch,calls=[];
 const add=(id,gifUrls)=>rawSend({kind:'TIMELINE_REWRITE_ADD',post:{id,author:'Writer',url:'https://x.com/Writer/status/'+id,text:'',gifUrls}},sender);
 globalThis.fetch=async(url,opts)=>{
  calls.push(url);assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.equal(opts.referrerPolicy,'no-referrer');
  return new Response(bytes,{status:url.includes('Broken')?404:200,headers:{'Content-Type':'video/mp4'}});
 };
 try{
  const saved=await add('731',[gif+'?tag=12']);assert.equal(saved.ok,true,saved.error);
  const copy=stored.xAssistantPostingCopiesV1.rows[0];
  assert.equal(copy.text,'');assert.equal(copy.image,'data:video/mp4;base64,'+bytes.toString('base64'));assert.equal(copy.enabled,true);
  assert.equal((await add('731',[gif])).state.added,false);
  assert.equal((await add('732',[gif,gif.replace('OwnAnimation','Broken')])).ok,false);
  assert.equal((await add('733',['https://evil.test/tweet_video/Any.mp4'])).ok,false);
  assert.deepEqual(calls,[gif,gif,gif.replace('OwnAnimation','Broken')]);
  assert.equal(stored.xAssistantPostingCopiesV1.revision,1);assert.equal(stored.xAssistantManagedServiceV1,undefined);
 }finally{globalThis.fetch=oldFetch;}
});
test('plus carries rewrite style from the provider to the saved formatting without storing style or starting a module',async()=>{
 stored={xAssistantPostingCopiesV1:{revision:0,rows:[]},xAssistantDeepSeekKeyV1:'fixture-key'};
 const sources=[
  {style:'standard',input:'Pro 额度和领取步骤',lines:['Pro 每月有额度。','登录订阅账号。','进入福利页选账单账号。']},
  {style:'reaction',input:'一个月回本又稳又翻十倍',lines:['等下？？？','回本快还没风险？','财神爷听了都得摘工牌。']},
  {style:'verify',input:'确认了再问来历',rootText:'有来源的涉枪消息仍待核实',lines:['当地警方确认用枪了吗？','如果确认了，有没有披露枪从哪儿来？','有通报的话想看原文。']},
 ];
 const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,opts)=>{
  if(url.startsWith('chrome-extension://test/bridge/'))return{ok:true,text:async()=>'fixture rewrite rules'};
  assert.equal(url,'https://api.deepseek.com/chat/completions');calls++;
  const {messages}=JSON.parse(opts.body),{reference_text,comment_text,reference_post_text}=JSON.parse(messages[1].content);
  const fixture=sources.find(s=>s.input===(reference_text??comment_text));assert.ok(fixture);assert.equal(reference_post_text,fixture.rootText);
  assert.match(messages[0].content,/【风格分流】/);
  const content=JSON.stringify({action:'save_copy',style:fixture.style,text:fixture.lines.join('\n')});
  return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}]})};
 };
 try{
  for(const [i,{style,input,rootText,lines}] of sources.entries()){
   const id=String(i+1),post={id,author:'Writer',url:'https://x.com/Writer/status/'+id,text:input};
   if(rootText)post.rootPost={id:'900',author:'Root',text:rootText,url:'https://x.com/Root/status/900'};
   const result=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},sender);assert.equal(result.ok,true,result.error);
   const row=stored.xAssistantPostingCopiesV1.rows.at(-1);
   assert.equal(row.text,lines.join(style==='standard'?'\n':'\n\n'));
   assert.equal(Object.hasOwn(row,'style'),false);
  }
  assert.equal(calls,3);
  assert.deepEqual(Object.keys(stored).sort(),['xAssistantDeepSeekKeyV1','xAssistantPostingCopiesV1']);
 }finally{globalThis.fetch=oldFetch;}
});
test('stopped unknown runtime can be archived as skipped before the next item',async()=>{
 stored.xAssistantPostingV1={active:false,phase:'unknown',account:'/me',runId:'stale',rowId:'row-1',text:'maybe sent'};
 const result=await rt('abandon',{runId:'stale',account:'/me',reason:'next_item'});
 assert.equal(result.ok,true);assert.equal(result.state.phase,'stopped');assert.equal(result.state.resolution.disposition,'skipped');assert.equal(result.state.resolution.rowId,'row-1');
});
test('closing owner tab stops countdown',async()=>{stored.xAssistantPostingV1={active:true,owner:1,phase:'waiting'};events.removed(1);await tick();assert.equal(stored.xAssistantPostingV1.active,false);});
test('module prepare validates ownership and conflicts without creating a run',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantCleanupV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 const before=structuredClone(stored.xAssistantNotificationsRuntimeV1);
 const r=await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'});
 assert.equal(r.ok,true);assert.deepEqual(stored.xAssistantNotificationsRuntimeV1,before);
 stored.xAssistantPostingV1={active:true,owner:2,phase:'waiting'};
 assert.equal((await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'})).ok,true);
 stored.xAssistantPostingV1.owner=1;assert.equal((await send({kind:'RUNTIME',module:'notifications',action:'prepare',account:'/me'})).ok,false);
});
test('posting confirmation and schedule persist atomically through stop, restart and new run',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantCleanupV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 stored.xAssistantPostingCopiesV1={revision:1,rows:[{id:'a',text:'a',enabled:true},{id:'b',text:'b',enabled:true}]};
 stored.xAssistantPostSchedulesV1={};
 const s=await rt('begin',{account:'/me'}),runId=s.state.runId;
 await rt('patch',{runId,patch:{phase:'submitting',rowId:'a',text:'a',submittedAt:new Date().toISOString()}});
 const confirmed=await rt('patch',{runId,patch:{phase:'confirmed',receipt:{kind:'confirmed'},completed:1}});
 assert.deepEqual(stored.xAssistantPostingCopiesV1.rows.map(row=>row.id),['b']);
 const next=confirmed.state.nextPostAt,last=confirmed.state.lastPostedAt;
 assert.ok(next-last>=1200000&&next-last<=1800000);
 await rt('stop');assert.equal(stored.xAssistantPostingV1.nextPostAt,next);
 events.startup();await tick();
 const again=await rt('begin',{account:'/me'});assert.equal(again.state.nextAt,next);assert.equal(again.state.lastPostedAt,last);
 await rt('stop');
});

test('heartbeat bypasses a busy mutation queue but still validates sender',async()=>{
 const get=chrome.storage.local.get;let release,started;
 const waiting=new Promise(r=>{started=r;});
 chrome.storage.local.get=async key=>{if(key==='app'){started();await new Promise(r=>{release=r;});}return get(key);};
 const pending=send({kind:'GET'},panel);await waiting;
 try{
  const pong=await Promise.race([send({kind:'PING'}),new Promise(r=>setTimeout(()=>r('timeout'),30))]);
  assert.notEqual(pong,'timeout');assert.equal(pong.ok,true);
  assert.equal((await send({kind:'PING'},{...sender,url:'https://other.example/'})).ok,false);
 }finally{chrome.storage.local.get=get;release();await pending;}
});

test('timing API accepts only panel saves and preserves storage on invalid input',async()=>{
 assert.equal((await send({kind:'TIME_SAVE',config:{posting:{min:9,max:9}}})).ok,false);
 const result=await send({kind:'TIME_SAVE',config:{posting:{min:42,max:42},interaction:{min:4,max:4}}},panel);assert.equal(result.ok,true);assert.equal(result.state.posting.min,42);
 const before=structuredClone(stored.xAssistantTimingV1);
 assert.equal((await send({kind:'TIME_SAVE',config:{posting:{min:10,max:2}}},panel)).ok,false);assert.deepEqual(stored.xAssistantTimingV1,before);
 assert.deepEqual((await send({kind:'TIME_GET'},panel)).state,before);
});
test('interaction timer binds owner, run and account, records persistent deadline',async()=>{
 stored.xAssistantRuntimeV1={active:true,owner:1,runId:'i',account:'/me',phase:'waiting'};
 const request={kind:'TIME_ARM',name:'interaction',runId:'i',account:'/me'};
 for(const message of [{...request,runId:'stale'},{...request,account:'/other'},{...request,name:'posting'}])assert.equal((await send(message)).ok,false);
 assert.equal((await send(request,{...sender,tab:{id:2}})).ok,false);
 const before=Date.now(),result=await send(request);assert.equal(result.ok,true);assert.ok(result.state>=before+4000);assert.equal(stored.xAssistantCooldownsV1['/me'].interaction,result.state);
 assert.equal(stored.xAssistantRuntimeV1.nextAt,result.state);
 await send({kind:'RUNTIME',module:'interaction',action:'stop',runId:'i'});assert.equal(stored.xAssistantCooldownsV1['/me'].interaction,result.state);
});
test('AI interaction startup does not require unused reply-library rows',async()=>{
 for(const key of ['xAssistantPostingV1','xAssistantRuntimeV1','xAssistantNotificationsRuntimeV1'])stored[key]={active:false,phase:'stopped'};
 stored.app.rows=[{id:'only-post',type:'post',text:'post',enabled:true}];
 assert.equal((await send({kind:'RUNTIME',module:'interaction',action:'prepare',account:'/me'})).ok,true);
});

test('comment plus downloads root photos atomically, appends video link and never starts service',async()=>{
 stored={xAssistantPostingCopiesV1:{revision:0,rows:[]},xAssistantDeepSeekKeyV1:'fixture-key'};
 const root={id:'800',author:'Root',text:'原帖观点',url:'https://x.com/Root/status/800',imageUrls:['https://pbs.twimg.com/media/Root.png'],videoUrls:['https://x.com/Root/status/800/video/2']};
 const post={id:'801',author:'Commenter',text:'评论观点',url:'https://x.com/Commenter/status/801',rootPost:root};
 const oldFetch=globalThis.fetch,oldDecode=globalThis.createImageBitmap;let broken=false,ai=0;const photos=[];
 globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 globalThis.fetch=async(url,opts)=>{
  if(url.startsWith('chrome-extension://test/bridge/'))return{ok:true,text:async()=>'fixture rules'};
  if(url==='https://api.deepseek.com/chat/completions'){
   ai++;assert.doesNotMatch(opts.body,/pbs\.twimg|\/video\/|base64/);
   const input=JSON.parse(JSON.parse(opts.body).messages[1].content);assert.equal(input.reference_post_text,'原帖观点');assert.equal(input.comment_text,'评论观点');
   return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"save_copy","text":"融合后的一份观点。"}'}}]})};
  }
  assert.equal(url,'https://pbs.twimg.com/media/Root?format=png&name=large');photos.push(url);
  return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==','base64'),{status:broken?404:200,headers:{'content-type':'image/png'}});
 };
 try{
  const result=await rawSend({kind:'TIMELINE_REWRITE_ADD',post},sender);assert.equal(result.ok,true,result.error);
  const row=stored.xAssistantPostingCopiesV1.rows[0];assert.equal(row.text,'融合后的一份观点。\n\n'+root.videoUrls[0]);assert.equal(row.enabled,true);assert.match(row.image,/^data:image\/png;base64,/);
  assert.equal(stored.xAssistantManagedServiceV1,undefined);assert.equal(stored.xAssistantPostingV1,undefined);
  assert.equal((await rawSend({kind:'TIMELINE_REWRITE_ADD',post},sender)).state.added,false);assert.equal(ai,1);assert.equal(photos.length,1);
  broken=true;const fail=await rawSend({kind:'TIMELINE_REWRITE_ADD',post:{...post,id:'802',url:'https://x.com/Commenter/status/802'}},sender);assert.equal(fail.ok,false);assert.equal(stored.xAssistantPostingCopiesV1.rows.length,1);
  delete stored.xAssistantDeepSeekKeyV1;
  const videoOnly={id:'803',author:'Root',text:'',url:'https://x.com/Root/status/803',videoUrls:['https://x.com/Root/status/803/video/1']};
  const saved=await rawSend({kind:'TIMELINE_REWRITE_ADD',post:videoOnly},sender);assert.equal(saved.ok,true,saved.error);assert.equal(stored.xAssistantPostingCopiesV1.rows.at(-1).text,videoOnly.videoUrls[0]);assert.equal(ai,2);
 }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldDecode;}
});
