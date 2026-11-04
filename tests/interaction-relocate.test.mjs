import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const compactSource=source.replace(/\s+/g,'');
const code=source.slice(source.indexOf(' const relocatePost='),source.indexOf(' const followAuthor='));
function fixture(rows){
 let clicks=0;
 const context=vm.createContext({account:'/owner',XAssistantDOM:{relocate:target=>{const matches=rows.filter(row=>row.article.isConnected&&row.id===target.id&&row.author===target.author&&row.time===target.time&&row.text===target.text);return matches.length===1?matches[0]:null;}},check:()=>{},clickNative:b=>{clicks++;b.click();},waitFor:async f=>f()});
 vm.runInContext(code+';globalThis.like=likePost;',context);
 return {like:context.like,clicks:()=>clicks};
}
function row(){let liked=false;return{id:'123',author:'Test',time:'now',text:'hello',article:{isConnected:true,querySelectorAll:s=>s.includes('"unlike"')?(liked?[{}]:[]):liked?[]:[{disabled:false,click:()=>liked=true}]}};}
test('replaces detached article with current matching post before liking',async()=>{const current=row(),old={...current,article:{isConnected:false}};const f=fixture([current]);assert.equal(await f.like(old,{}),'verified');assert.equal(f.clicks(),1);});
test('missing or changed target never clicks',async()=>{const target=row();for(const rows of [[],[{...row(),text:'changed'}],[row(),row()]]){const f=fixture(rows);await assert.rejects(f.like(target,{}),/目标帖子已更新/);assert.equal(f.clicks(),0);}});
test('already liked post is not toggled off',async()=>{const r=row(),f=fixture([r]);await f.like(r,{});assert.equal(await f.like(r,{}),'skipped');assert.equal(f.clicks(),1);});
test('proactive replies delegate to the guarded shared reply transaction',()=>{assert.match(source,/XAssistantReplyEngine\.send\(\{\s*row:info,text,account,signal,patch:updateRuntime/);});
test('confirmed reply is never downgraded when redundant processed-state save fails',async()=>{
 const writes=[];let cleaned=0,likes=0;
 const target={id:'123',author:'Writer',views:6000};
 const context=vm.createContext({Error,Set,pauseRequested:false,selected:null,replySubmitted:false,
  document:{querySelector:()=>null},location:{href:'https://x.com/home'},
  recordOutcome:()=>{},deferRecord:async(row,record)=>{writes.push(JSON.parse(JSON.stringify({...record,retryAt:60000})));},
  core:{interactionPage:()=>true},runtime:async()=>({active:true,runId:'run'}),
  autoFollow:async()=>false,status:()=>{},findCandidate:async()=>target,sessionAuthors:new Set(),
  markSelected:()=>{},check:()=>{},aiReply:async()=>({postId:'123',action:'send_reply',text:'hello'}),
  saveProcessed:async(_row,record)=>{writes.push({...record});if(writes.length===3)throw Error('redundant save failed');},
  replyAndSend:async(_row,_text,_signal,onConfirmed)=>{await onConfirmed();return'verified';},
  cleanupDialog:async()=>{cleaned++;return true;},likePost:async()=>{likes++;return'verified';},
  randomWait:async()=>{throw Error('must stop before another action');},
 });
 const loop=source.slice(source.search(/\bconst runLoop\s*=/),source.indexOf(' // A single owner per module;'));
 vm.runInContext(loop+';globalThis.run=runLoop;',context);
 await assert.rejects(context.run({aborted:false},'run'),/redundant save failed/);
 assert.deepEqual(writes.map(record=>record.reply),['in_flight','verified','verified','verified']);
 assert.equal(cleaned,0);assert.equal(likes,0);
});
test('cleanup failure persists the original cause without continuing to like or follow',async()=>{
 const writes=[];const target={id:'123',author:'Writer',views:6000};
 const failure=Object.assign(new Error('回复草稿或弹窗无法安全取消'),{code:'CLEANUP_FAILED',cause:Object.assign(new Error('回复输入框未就绪'),{code:'EDITOR_NOT_READY'})});
 const context=vm.createContext({Error,Set,pauseRequested:false,selected:null,replySubmitted:false,
  document:{querySelector:()=>null},location:{href:'https://x.com/home'},
  recordOutcome:()=>{},deferRecord:async(row,record)=>{writes.push(JSON.parse(JSON.stringify({...record,retryAt:60000})));},
  core:{interactionPage:()=>true},runtime:async()=>({active:true,runId:'run'}),
  autoFollow:async()=>false,status:()=>{},findCandidate:async()=>target,sessionAuthors:new Set(),
  markSelected:()=>{},check:()=>{},aiReply:async()=>({postId:'123',action:'send_reply',text:'hello'}),
  saveProcessed:async(_row,record)=>writes.push(JSON.parse(JSON.stringify(record))),
  replyAndSend:async()=>{throw failure;},cleanupDialog:async()=>false,
  likePost:async()=>assert.fail('must not like'),followAuthor:async()=>assert.fail('must not follow'),
  randomWait:async()=>assert.fail('must stop'),
 });
 const loop=source.slice(source.search(/\bconst runLoop\s*=/),source.indexOf(' // A single owner per module;'));
 vm.runInContext(loop+';globalThis.run=runLoop;',context);
 await assert.rejects(context.run({aborted:false},'run'),/回复草稿无法安全清理/);
 assert.equal(writes.at(-1).reasonCode,'CLEANUP_FAILED');
 assert.deepEqual(writes.at(-1).cause,{code:'EDITOR_NOT_READY',message:'回复输入框未就绪'});
});
test('protected shutdown does not dismiss a draft owned by another module or the user',async()=>{
 let cleaned=0,aborted=0,stopped=0;
 const context=vm.createContext({controller:{abort:()=>aborted++},api:{runtime:async()=>stopped++},runPromise:Promise.resolve(),
  cleanupDialog:async()=>cleaned++,selected:null,status:()=>{},setButtons:()=>{}});
 const stop=source.slice(source.indexOf(' const stop='),source.indexOf(' const pauseAfterCurrent='));
 vm.runInContext(stop+';globalThis.stopInteraction=stop;',context);
 await context.stopInteraction({preserveDrafts:true});assert.equal(cleaned,0);assert.equal(aborted,1);assert.equal(stopped,1);
 await context.stopInteraction();assert.equal(cleaned,1);assert.equal(stopped,2);
});

test('AI skip explicitly waits using the shared cooldown',()=>{const branch=source.slice(source.indexOf("if (generated.action === 'skip')"),source.indexOf("if (generated.action !== 'send_reply')"));assert.ok(branch.includes('continue;'));assert.ok(branch.includes('await waitAfterAttempt('));});
