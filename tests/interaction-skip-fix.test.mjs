import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const ctx=vm.createContext({URL});vm.runInContext(read('interaction-core.js'),ctx);const core=ctx.XAssistantCore;
const row={id:'1',author:'friend',text:'分享 AI 编程实践',views:5001};
const reason=(record,extra={})=>core.interactionSkipReason(row,{self:'self',record,now:1000,...extra});
test('legacy unsent failures and AI skips become eligible without clearing history',()=>{
 for(const reply of ['failed','skipped_ai','skipped_popup','skipped_issue','ai_error'])assert.equal(reason({reply}),null,reply);
});
test('confirmed, in-flight and unknown sends remain blocked regardless of retry timestamp',()=>{
 assert.equal(reason({reply:'verified',retryAt:0}),'confirmed');
 for(const reply of ['unknown','in_flight'])assert.equal(reason({reply,retryAt:0}),'uncertain');
});
test('author-blocked posts remain skipped instead of being retried',()=>{
 assert.equal(reason({reply:'blocked_author'}),'author_blocked');
});
test('temporary backoff expires at the exact deadline and never blacklists the author',()=>{
 assert.equal(reason({reply:'failed',retryAt:1001}),'retry_cooldown');
 assert.equal(reason({reply:'failed',retryAt:1000}),null);
 assert.equal(reason(null,{authors:new Set(['friend'])}),null);
 for(const reply of ['skipped_ai','failed'])assert.equal(core.interactionSkipReason({...row,id:'2'},{self:'self',record:{reply},authors:new Set(),now:1000}),null);
});
test('friendship helper remains compatible while the real interaction gate requires more than 5000 views',()=>{
 for(const text of ['来交朋友','帖子正文写交友也可以','欢迎回关认识一下','新人出摊，有关必回','蓝朋友早安，周三流量多多','蓝 朋友，来浇朋友','互浇互关','关注必回','有 关 必 回','蓝V新人报到','蓝V活人集合','蓝V浇友','蓝V涨粉','诚信互关','长期互关','互赞互评','回关必回','蓝V出来串门','出摊啦，蓝V来认识一下','#follow4follow','#f4f','Follow me, I follow back','Looking for active mutuals','New creators are welcome','Follow train starts here','#gainfollowers','#growtogether','相互フォロー','相互フォロー募集','フォロバします','フォローお願いします','繋がりたい','X友募集','맞팔']){
  for(const views of [null,0,499,500])assert.equal(core.friendshipCandidate(text,views),true,text);
 }
 for(const text of ['今天和朋友吃饭','蓝V认证价格介绍','周三早上好','饭馆出摊卖早餐','普通生活记录','新人入职第一天','最近想涨工资','朋友来家里串门','Follow the recipe carefully','Our train follows the coast','友達と映画を見ました','手順に従ってください'])assert.equal(core.friendshipCandidate(text,10000),false,text);
 for(const views of [null,NaN,undefined,0,4999,5000])assert.equal(core.interactionSkipReason({...row,views},{self:'self'}),'low_exposure');
 assert.equal(core.interactionSkipReason({...row,views:5001},{self:'self'}),null);
});
const driver=read('overlay.js');
async function run(outcomes,{autoFollow=false}={}){
 let now=0,index=0;const records={},authors=new Set(),events=[],waits=[];
 const context=vm.createContext({Date:{now:()=>now},Math,account:'/self',activeRun:'run',pauseRequested:false,replySubmitted:false,selected:null,sessionAuthors:authors,
  core:{interactionPage:()=>true},location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},requireSource:async()=>{},
  check:signal=>{if(signal.aborted)throw new DOMException('stop','AbortError');},publishDiagnostics:async()=>{},
  updateRuntime:async patch=>events.push(['patch',patch]),saveProcessed:async(info,record)=>{records[info.id]=structuredClone(record);},
  randomWait:async(min,max,signal,label)=>{assert.equal(min,max);waits.push({seconds:min,label});now+=min*1000;},
  XAssistantTime:{ms:()=>20000,arm:async()=>now+20000},status:()=>{},markSelected:()=>{},
  runtime:async()=>({active:index<outcomes.length,runId:'run',completed:0}),autoFollow:async()=>autoFollow,
  findCandidate:async()=>({id:String(index),author:'friend',text:outcomes[index]==='media'?'':'来交朋友',hasMedia:outcomes[index]==='media',views:805,
   followState:outcomes[index]?.startsWith('unfollowed')?'unfollowed':outcomes[index]?.startsWith('followed')?'followed':'unknown',
   followsYou:outcomes[index]==='unfollowed_reply'?true:['unfollowed_skip','followed_reply','followed_skip'].includes(outcomes[index])?false:null}),
  aiReply:async info=>{const type=outcomes[index++];return ['skip','unfollowed_skip','followed_skip'].includes(type)?{action:'skip',postId:info.id}:['ai_error','follower_error','content_length'].includes(type)?{action:'skip',postId:info.id,skippedGenerationError:true,reasonCode:type==='content_length'?'content_length':'network',reason:'生成失败'}:{action:'send_reply',postId:info.id,text:'欢迎来聊'};},
  XAssistantFallbackLibrary:{compose:(_text,followsYou)=>{assert.equal(followsYou,null);return '文案库问候';},appendFollowBack:text=>text+'，回关我交个朋友呀'},
  recordOutcome:(info,reason)=>events.push(['outcome',info.id,reason]),
  replyAndSend:async(info,text,signal,confirmed)=>{if(info.hasMedia)index++;const type=outcomes[index-1];if(type==='failed')throw Object.assign(Error('目标更新'),{code:'TARGET_UPDATED'});if(type==='unknown'){context.replySubmitted=true;throw Object.assign(Error('回执未知'),{submitted:true});}await confirmed();return 'verified';},
  followAuthor:async info=>{events.push(['follow',info.id]);assert.equal(records[info.id].reply,'verified');return 'verified';}
 });
 const helpers=driver.slice(driver.indexOf(' const fallbackReply='),driver.indexOf(' const reasonLabels='));
 const a=driver.indexOf(' const deferRecord='),b=driver.indexOf(' // A single owner',a);
 vm.runInContext(helpers+driver.slice(a,b)+'globalThis.run=runLoop;',context);
 await context.run(new AbortController().signal,'run','home');return{records,authors,events,waits};
}
test('generation failure waits, preserves its reason and allows a later post by the same author',async()=>{
 const f=await run(['ai_error','confirmed']);assert.equal(f.records['0'].retryAt,60000);assert.equal(f.records['1'].reply,'verified');
 assert.equal(f.waits.length,1);assert.ok(f.waits.every(w=>w.seconds===20));
 assert.deepEqual(f.events.filter(e=>e[0]==='outcome').map(e=>e[2]),['ai_error','confirmed']);
});
test('AI skip with unknown relationship uses the library without a suffix and rechecks outgoing follow after confirmation',async()=>{
 const f=await run(['skip'],{autoFollow:true});assert.equal(f.records['0'].reply,'verified');assert.equal(f.records['0'].replyText,'文案库问候');
 assert.deepEqual(f.events.filter(e=>e[0]==='outcome').map(e=>e[2]),['unknown_relation_library','confirmed']);
 assert.deepEqual(f.events.filter(e=>e[0]==='follow'),[['follow','0']]);
 assert.equal(f.records['0'].follow,'verified');
});
test('author who does not follow us gets a suffix even if we already follow them',async()=>{
 const f=await run(['followed_reply','followed_skip'],{autoFollow:true});
 assert.equal(f.records['0'].replyText,'欢迎来聊，回关我交个朋友呀');
 assert.equal(f.records['1'].replyText,'文案库问候，回关我交个朋友呀');
 assert.ok(!f.events.some(e=>e[0]==='follow'));
});
test('when neither account follows the other, a library reply adds the suffix and follows after confirmation',async()=>{
 const f=await run(['unfollowed_skip'],{autoFollow:true});
 assert.equal(f.records['0'].reply,'verified');
 assert.equal(f.records['0'].replyText,'文案库问候，回关我交个朋友呀');
 assert.equal(f.records['0'].follow,'verified');
});
test('an existing follower gets no suffix, but the missing outgoing follow is still executed',async()=>{
 const f=await run(['unfollowed_reply'],{autoFollow:true});
 assert.equal(f.records['0'].reply,'verified');
 assert.equal(f.records['0'].replyText,'欢迎来聊');
 assert.deepEqual(f.events.filter(e=>['follow','outcome'].includes(e[0])),[['outcome','0','confirmed'],['follow','0']]);
});
test('disabling auto-follow does not suppress the inbound non-follower suffix or authorize a follow',async()=>{
 const f=await run(['unfollowed_skip'],{autoFollow:false});
 assert.equal(f.records['0'].replyText,'文案库问候，回关我交个朋友呀');
 assert.ok(!f.events.some(e=>e[0]==='follow'));
});
test('long AI output and media-only posts use the library, without discarding eligible targets',async()=>{
 const f=await run(['content_length','media']);
 assert.deepEqual(f.events.filter(e=>e[0]==='outcome').map(e=>e[2]),['content_length_library','confirmed','media_library','confirmed']);
 assert.equal(f.records['0'].reply,'verified');assert.equal(f.records['1'].reply,'verified');
});
test('generation failure never sends even when the author is a confirmed follower',async()=>{
 const f=await run(['follower_error']);
 assert.equal(f.records['0'].reply,'ai_error');
 assert.deepEqual(f.events.filter(e=>e[0]==='outcome').map(e=>e[2]),['ai_error']);
 assert.equal(f.authors.size,0);
});
test('proven unsent errors retain the actual code, temporary backoff and normal cooldown',async()=>{
 const f=await run(['failed']);assert.equal(f.records['0'].reply,'failed');assert.equal(f.records['0'].reasonCode,'TARGET_UPDATED');assert.equal(f.records['0'].retryAt,60000);assert.equal(f.authors.size,0);assert.equal(f.waits.length,1);
});
test('unknown send keeps quarantine evidence and never acquires an automatic retry deadline',async()=>{
 const f=await run(['unknown']);assert.equal(f.records['0'].reply,'unknown');assert.equal(f.records['0'].retryAt,undefined);assert.equal(f.waits.length,1);assert.equal(f.authors.size,0);
});
test('per-post dedup is committed only inside the platform-confirmed callback',()=>{
 assert.doesNotMatch(driver,/sessionAuthors/);
 assert.match(driver,/await replyAndSend\(info, reply, signal, async \(\) => \{\s*record\.reply = 'verified'/);
});

test('skip diagnostics are persisted once per post/reason, with attempt outcomes counted separately',async()=>{
 const patches=[];const start=driver.indexOf(' const reasonLabels='),end=driver.indexOf(' const findCandidate=',start);
 const context=vm.createContext({Date,Set,core,updateRuntime:async patch=>patches.push(structuredClone(patch))});
 vm.runInContext(driver.slice(start,end)+'globalThis.recordCandidate=recordCandidate;globalThis.recordOutcome=recordOutcome;globalThis.publish=publishDiagnostics;globalThis.summary=skipSummary;',context);
 context.recordCandidate(row,'unrelated');context.recordCandidate(row,'unrelated');context.recordCandidate(row,null);context.recordOutcome(row,'ai_skip');context.recordOutcome(row,'ai_skip');await context.publish();
 assert.equal(patches[0].diagnostics.seen,1);assert.equal(patches[0].diagnostics.skips.unrelated,1);assert.equal(patches[0].diagnostics.outcomes.ai_skip,2);
 context.recordCandidate(row,'low_exposure');assert.match(context.summary(),/曝光不足或不可读/);
});

test('empty interaction scan ends the first diagnostic round without rotating while ordinary service continues to the next topic',async()=>{
 const loop=driver.slice(driver.indexOf('const runLoop ='),driver.indexOf(' // A single owner per module;'));
 for(const singleRound of [true,false]){
  const signal={aborted:false};let rotations=0,arms=0,scans=0;
  const c=vm.createContext({check:()=>{},requireSource:async()=>{},document:{querySelector:()=>null},core:{interactionPage:()=>true},location:{href:'https://x.com/search'},
   runtime:async()=>({active:true,runId:'r'}),autoFollow:async()=>true,status:()=>{},findCandidate:async()=>{assert.equal(++scans,1);return null;},
   XAssistantWorkspace:{state:()=>({assignment:{singleRound}})},XAssistantEntry:{nextFriendTopic:async()=>{rotations++;return true;},enter:async()=>{signal.aborted=true;}},
   waitAfterAttempt:async()=>{arms++;}});
  vm.runInContext(loop+';globalThis.go=runLoop;',c);await c.go(signal,'r','search');
  assert.equal(arms,singleRound?1:0);assert.equal(rotations,singleRound?0:1);
 }
});

test('首页和搜索用同一套选帖、回执和防重流程；AI 生成中切换来源不提交旧帖',async()=>{
 const gate=driver.slice(driver.indexOf(' const requireSource='),driver.indexOf('\n',driver.indexOf(' const requireSource=')));
 const loop=driver.slice(driver.indexOf('const runLoop ='),driver.indexOf(' // A single owner per module;'));
 for(const mode of ['home','search'])for(const switchAt of ['never','before','generation','presubmit','reserved','unknown','confirmed']){
  const path=mode==='home'?'/home':'/search?q=friends',signal=new AbortController();
  let pref=mode==='search',scans=0,sends=0,active=true;const ledger=[];
  if(switchAt==='before')pref=!pref;
  const c=vm.createContext({Date,Map,Set,account:'/self',selected:null,sessionAuthors:new Set(),replySubmitted:false,
   check:()=>{},document:{querySelector:()=>null},core:{interactionPage:()=>true},location:{href:'https://x.com'+path,pathname:path.split('?')[0],search:mode==='home'?'':'?q=friends'},
   XAssistantEntry:{searchEnabled:async()=>pref,targetFor:async()=>path,enter:async()=>assert.fail('来源不应跳转')},
   runtime:async()=>({active,runId:'run'}),autoFollow:async()=>false,status:text=>{if(switchAt==='presubmit'&&text.startsWith('正在评价'))pref=!pref;},markSelected:()=>{},
   findCandidate:async()=>{scans++;return{id:'1',author:'friend',text:'来交朋友',followState:'unrestricted',followsYou:null};},
   aiReply:async()=>{if(switchAt==='generation')pref=!pref;return {action:'send_reply',postId:'1',text:'hi'};},recordOutcome:()=>{},
   replyAndSend:async(info,reply,sig,onConfirmed,onBeforeSubmit)=>{
    assert.equal(info.id,'1');await onBeforeSubmit();
    if(switchAt==='reserved')throw Object.assign(Error('切换来源'),{code:'SOURCE_CHANGED',submitted:false});
    sends++;
    if(switchAt==='unknown'){c.replySubmitted=true;throw Object.assign(Error('发送未确认'),{code:'SEND_UNKNOWN',submitted:true,stopTargetVisit:true});}
    await onConfirmed();if(switchAt==='confirmed')throw Object.assign(Error('回到来源页时来源切换'),{code:'SOURCE_CHANGED',submitted:true,confirmed:true});
    return'verified';
   },saveProcessed:async(info,record)=>{ledger.push(record.reply);},updateRuntime:async()=>{},waitAfterAttempt:async()=>{active=false;}
  });
  vm.runInContext(gate+'\n'+loop+';globalThis.go=runLoop;',c);
  const run=c.go(signal.signal,'run',mode);
  if(switchAt==='never'){await run;assert.equal(scans,1);assert.equal(sends,1);assert.equal(ledger.at(-1),'verified');}
  else if(switchAt==='unknown'||switchAt==='confirmed'){
   await assert.rejects(run,{code:switchAt==='unknown'?'SEND_UNKNOWN':'SOURCE_CHANGED',submitted:true});
   assert.equal(sends,1);assert.equal(ledger.at(-1),switchAt==='unknown'?'unknown':'verified');
  }else{
   await assert.rejects(run,{code:'SOURCE_CHANGED'});assert.equal(scans,switchAt==='before'?0:1);assert.equal(sends,0);
   assert.deepEqual(ledger,switchAt==='reserved'?['in_flight','skipped_unsent']:[]);
  }
 }
});
test('首页无目标时保留时间线，不轮换或进入搜索话题',async()=>{
 const loop=driver.slice(driver.indexOf('const runLoop ='),driver.indexOf(' // A single owner per module;'));
 let cooldown=0;const signal={aborted:false};
 const c=vm.createContext({Date,Map,check:()=>{},requireSource:async mode=>assert.equal(mode,'home'),document:{querySelector:()=>null},
  core:{interactionPage:()=>true},location:{href:'https://x.com/home',pathname:'/home',search:''},XAssistantEntry:{targetFor:async()=>'/home',nextFriendTopic:async()=>assert.fail('时间线不能轮换话题'),enter:async()=>assert.fail('不能进入搜索页')},
  runtime:async()=>({active:true,runId:'run'}),autoFollow:async()=>false,status:()=>{},findCandidate:async()=>null,
  waitAfterAttempt:async()=>{cooldown++;signal.aborted=true;},window:{scrollTo:()=>assert.fail('首页无目标不回滚至顶部')},sleep:async()=>assert.fail('不应等待搜索页回滚')});
 vm.runInContext(loop+';globalThis.go=runLoop;',c);await c.go(signal,'run','home');assert.equal(cooldown,1);
});
