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
test('generation outage waits without permanently marking candidate processed',()=>{assert.match(compactSource,/if\(generated.skippedGenerationError\).*?randomWait\(followEnabled\?60:5,followEnabled\?90:10.*?continue;/);assert.ok(source.includes('点赞未成功确认'));});
test('proactive replies delegate to the guarded shared reply transaction',()=>{assert.match(source,/XAssistantReplyEngine\.send\(\{\s*row:info,text,account,signal,patch:updateRuntime/);});
test('all between-post waits in disabled-follow mode stay at 5–10 seconds',()=>{
 const cases=[['followEnabled?60:5','followEnabled?90:10'],['followEnabled?10:5','followEnabled?20:10'],['5','followEnabled?20:10'],['followEnabled?40:5','followEnabled?60:10']];
 for(const [min,max] of cases){assert.ok(compactSource.includes('randomWait('+min+','+max+',signal,'));assert.equal(vm.runInNewContext(min,{followEnabled:false}),5);assert.equal(vm.runInNewContext(max,{followEnabled:false}),10);}
 assert.ok(compactSource.includes('randomWait(followEnabled?5:3,followEnabled?10:5,signal,'));
});
test('confirmed reply is never downgraded when redundant processed-state save fails',async()=>{
 const writes=[];let cleaned=0,likes=0;
 const target={id:'123',author:'Writer',views:6000};
 const context=vm.createContext({Error,Set,pauseRequested:false,selected:null,replySubmitted:false,
  document:{querySelector:()=>null},location:{href:'https://x.com/home'},
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
