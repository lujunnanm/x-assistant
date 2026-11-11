import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {interactionFollowPage} from '../interaction-follow-page.mjs';
function fixture(){
 const row={id:'job',account:'/me',author:'ann',postId:'123',url:'https://x.com/ann/status/123'};
 let shown=false,clicks=0,draft=false,owner='/me',loaded=true;
 const values={xAssistantAutoFollowV1:true,xAssistantManagedServiceV1:{enabled:true,selected:{interaction:true},account:'/me',workers:{interaction:{tabId:4}}},
  xAssistantRuntimeV1:{active:true,owner:4,account:'/me'},xAssistantActionGateV1:{holder:{leaseId:'permit',module:'interaction',kind:'follow',account:'/me',runId:'job',documentId:'doc',expiresAt:10000}}};
 const button={textContent:'Follow @ann',testId:'12-follow',getAttribute:k=>k==='data-testid'?button.testId:null,
  click(){clicks++;button.textContent='Unfollow @ann';button.testId='12-unfollow';}};
 const menu={querySelectorAll:()=>[button]},caret={click(){shown=!shown;}},article={querySelector:()=>caret};
 const context=vm.createContext({Date:{now:()=>1000},RegExp,Error,setTimeout:fn=>{queueMicrotask(fn);},location:{href:row.url},
  document:{querySelector:s=>s==='[data-testid="AppTabBar_Profile_Link"]'?{getAttribute:()=>owner}:s==='[role="menu"]'?shown?menu:null:draft?{}:null,
   querySelectorAll:s=>s.includes('article')?(loaded?[article]:[]):[]},
  XAssistantDOM:{post:()=>({id:'123',author:'ann',article})},chrome:{storage:{local:{get:async()=>values}}}});
 vm.runInContext('globalThis.act='+interactionFollowPage.toString(),context);
 const permit={leaseId:'permit',targetId:'12',documentId:'doc'};
 return {row,values,button,context,permit,clicks:()=>clicks,run:mode=>context.act(row,mode,permit),draft:()=>{draft=true;},owner:x=>{owner=x;},unload:()=>{loaded=false;}};
}
test('queue page binds exact original and author and confirms only an observed unfollow action',async()=>{
 const f=fixture();assert.equal((await f.run('prepare')).state,'unfollowed');
 const r=await f.run('click');assert.equal(r.state,'followed');assert.equal(r.clicked,true);assert.equal(f.clicks(),1);
});
test('same-menu prefix-similar handle or numeric ID replacement never clicks',async()=>{
 for(const change of [f=>{f.button.textContent='Follow @anna';},f=>{f.button.testId='13-follow';}]){
  const f=fixture();await f.run('prepare');change(f);assert.equal((await f.run('click')).clicked,false);assert.equal(f.clicks(),0);
 }
});
test('disabled, stopped, swapped account, wrong route, draft, expired lease and foreign reservation do not click',async()=>{
 const changes=[f=>{f.values.xAssistantAutoFollowV1=false;},f=>{f.values.xAssistantManagedServiceV1.enabled=false;},f=>{f.values.xAssistantRuntimeV1.active=false;},
  f=>f.owner('/other'),f=>{f.context.location.href='https://x.com/home';},f=>f.draft(),f=>{f.values.xAssistantActionGateV1.holder.expiresAt=1000;},
  f=>{f.values.xAssistantFollowbackLedgerV1={'/me':{'@renamed':{targetId:'12'}}};}];
 for(const change of changes){const f=fixture();await f.run('prepare');change(f);assert.equal((await f.run('click')).clicked,false);assert.equal(f.clicks(),0);}
});
test('already-followed target never clicks Unfollow',async()=>{
 const f=fixture();await f.run('prepare');f.button.textContent='Unfollow @ann';f.button.testId='12-unfollow';
 assert.equal((await f.run('click')).clicked,false);assert.equal(f.clicks(),0);
});
test('same-tab navigation preflight preserves drafts and account identity',async()=>{
 const f=fixture();assert.equal((await f.run('canNavigate')).safe,true);f.draft();assert.equal((await f.run('canNavigate')).safe,false);
});
test('missing target remains loading without clicking',async()=>{
 const f=fixture();f.unload();assert.equal((await f.run('prepare')).state,'loading');assert.equal(f.clicks(),0);
});

test('native author menu without a numeric test ID still follows the exact bound author',async()=>{
 const f=fixture();f.button.testId=null;f.permit.targetId=null;
 f.button.click=()=>{f.button.textContent='Unfollow @ann';};
 const prepared=await f.run('prepare');assert.equal(prepared.state,'unfollowed');assert.equal(prepared.targetId,null);
 const result=await f.run('click');assert.equal(result.clicked,true);assert.equal(result.state,'followed');
});
