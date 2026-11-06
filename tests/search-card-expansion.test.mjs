import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const driver=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const snippet=(a,b)=>driver.slice(driver.indexOf(a),driver.indexOf(b,driver.indexOf(a)+a.length));
const text='看的是这座岛 #浇朋友',full=text+' #TravelChina';
function controls(opts={}){
 const path=opts.home?'/home':'/search',href='https://x.com'+path+(opts.home?'':'?q=1'),location={href,pathname:path},navigation={currentEntry:{key:opts.noKey?null:'K'}};
 let touched=false,owner='me',clicks=0,hasDraft=opts.draft;
 const t={getAttribute:()=> '2026-11-05T00:34:07.000Z'};
 const timestamp={href:'https://x.com/writer/status/123',querySelector:()=>t},parent={};
 const body={parentElement:parent,textContent:text};
 const button={parentElement:opts.wrongParent?{}:parent,disabled:opts.disabled,matches:()=>!opts.notButton,closest:q=>q==='article'?article:opts.inLink?{}:null,
  click(){clicks++;touched=true;body.textContent=opts.sameText?text:full;if(opts.otherTime)t.getAttribute=()=> 'changed';
   if(opts.navChange)navigation.currentEntry.key='next';if(opts.routeChange)location.href=href+'2';if(opts.accountChange)owner='other';if(opts.newDraft)hasDraft=true;}};
 const article={isConnected:true,querySelectorAll:q=>q==='a[href]'?[timestamp]:q.includes('show-more')?(opts.duplicate?[button,button]:[button]):[],
  querySelector:q=>q.includes('tweetText')?body:q==='time'?t:q.includes('show-more')?(touched&&!opts.stillClipped?null:button):null};
 const ctx={URL,location,navigation,account:'/me',check(){if(owner!=='me')throw Object.assign(Error(),{code:'ACCOUNT_CHANGED'});},
  core:{parseViews:()=>null,editorText:e=>e.text},XAssistantDOM:{relocate:(r)=>opts.duplicateRow?null:r.text===body.textContent?{article}:null},
  document:{querySelector:()=>null,querySelectorAll:q=>hasDraft&&q.includes('contenteditable')?[{text:'my draft'}]:[]},
  waitFor:async probe=>probe()};
 vm.runInNewContext(snippet(' const moreSelector=',' const selfHandle=')+snippet(' const expandSearchCard=',' const closeMenu=')+';this.begin=()=>expandSearchCard(postInfo(article),{});',Object.assign(ctx,{article}));
 return {run:ctx.begin,clicks:()=>clicks};
}
test('native sibling Show more produces a complete new source row; selection uses full text, never the preview',async()=>{
 const f=controls();const row=await f.run();assert.equal(row.text,full);assert.equal(row.previewText,text);assert.equal(row.clipped,false);assert.equal(f.clicks(),1);
});
test('首页时间线完整展开正文，不能对残缺预览直接互动',async()=>{
 const f=controls({home:true}),row=await f.run();assert.equal(row.text,full);assert.equal(f.clicks(),1);
 const stale=controls({home:true,routeChange:true});await assert.rejects(stale.run(),{code:'PAGE_CHANGED'});
});
for(const [name,opt,clicks] of [
 ['missing history key',{noKey:true},0],['control in anchor',{inLink:true},0],['not the native button',{notButton:true},0],
 ['different body sibling',{wrongParent:true},0],['duplicate buttons',{duplicate:true},0],['duplicate source rows',{duplicateRow:true},0],
 ['unchanged body',{sameText:true},1],['still marked as incomplete',{stillClipped:true},1],['changed timestamp',{otherTime:true},1]
])test('not usable as a full-body source: '+name,async()=>{const f=controls(opt);assert.equal(await f.run(),null);assert.equal(f.clicks(),clicks);});
for(const [name,opt,code,clicks] of [['existing draft',{draft:true},'RESIDUAL_DRAFT',0],['new draft',{newDraft:true},'RESIDUAL_DRAFT',1],
 ['different route',{routeChange:true},'PAGE_CHANGED',1],['replaced history entry',{navChange:true},'PAGE_CHANGED',1],['different account',{accountChange:true},'ACCOUNT_CHANGED',1]]
)test('expansion stops instead of selecting a target on '+name,async()=>{const f=controls(opt);await assert.rejects(f.run(),{code});assert.equal(f.clicks(),clicks);});
test('search selector cannot spend AI or inspect following status on a truncated or quarantined source',async()=>{
 const clip={id:'1',author:'a',time:'date',text:'原文交友',clipped:true},other={id:'3',author:'b',time:'t',text:'完整交友'};let proof=null,calls=[],held=false;
 const ctx={document:{querySelector:()=>null},check(){},processed:async()=>({posts:{}}),selfHandle:()=> 'self',followCooldownActive:async()=>false,visiblePosts:()=>[clip,other],sessionAuthors:new Set(),
  core:{interactionSkipReason:i=>held&&i.id==='1'?'uncertain':null},recordCandidate(){},publishDiagnostics:async()=>{},
  inspectFollowState:async i=>{calls.push('menu:'+i.id);return {state:'unfollowed'};},expandSearchCard:async i=>{calls.push('more:'+i.id);return proof;}};
 vm.runInNewContext(snippet(' const findCandidate=',' const aiReply=')+';this.pick=()=>findCandidate({},true);',ctx);
 assert.equal((await ctx.pick()).id,'3');assert.deepEqual(calls,['more:1','menu:3']);
 calls=[];proof={...clip,text:full,clipped:false};assert.equal((await ctx.pick()).text,full);assert.deepEqual(calls,['more:1','menu:1']);
 calls=[];held=true;assert.equal((await ctx.pick()).id,'3');assert.deepEqual(calls,['menu:3']);
});
test('following after Back never opens a menu if re-expanded full text drifted, or the exact preview disappeared',async()=>{
 const info={id:'1',author:'friend',time:'stamp',text:full,previewText:text};
 for(const mode of ['changed','missing','unchanged']){
  const events=[],ctx={account:'/owner',check(){},autoFollow:async()=>true,followCooldownActive:async()=>false,
   XAssistantDOM:{relocate:r=>{events.push(['locate',r.text]);return r.text===text&&mode!=='missing'?{...r,article:{}}:null;}},
   expandSearchCard:async()=>{events.push('expand');return {text:mode==='changed'?full+' edited':full};},
   relocatePost:r=>{assert.equal(r.text,full);events.push('exact full recheck');throw Error('past safety checks');}};
  vm.runInNewContext(snippet(' const followAuthor=',' const markSelected=')+';this.follow=followAuthor;',ctx);
  if(mode==='unchanged'){await assert.rejects(ctx.follow(info,{}),/past safety checks/);assert.deepEqual(events.slice(-2),['expand','exact full recheck']);}
  else {assert.equal(await ctx.follow(info,{}),'skipped_changed');assert.equal(events.includes('exact full recheck'),false);assert.equal(events.includes('expand'),mode==='changed');}
 }
});
