import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
function fixture({replacement,afterClickError=false,disable=false,ledger=()=>null,stableId}={}){
 let clicks=0,followed=false;
 const button={textContent:'Follow @ann',disabled:false,getAttribute:()=>stableId&&stableId+'-follow'},menu={querySelectorAll:()=>[button]},caret={};
 const context=vm.createContext({Error,RegExp,account:'/me',activeRun:'run',getLocal:ledger,followToggle:{checked:true},check:()=>{},autoFollow:async()=>true,followCooldownActive:async()=>false,relocatePost:x=>x,
  document:{querySelector:()=>menu,contains:()=>true},clickNative:async()=>{},sleep:async()=>{},closeMenu:async()=>{},addFollowed:async()=>{followed=true;},
  clickNow:()=>{clicks++;button.textContent='Unfollow @ann';},waitFor:async probe=>{if(clicks&&afterClickError)throw Error('page changed after click');return probe();},
  XAssistantActions:{click:async opts=>{await opts.beforeClick();if(replacement)button.textContent='Follow @'+replacement;if(disable)context.followToggle.checked=false;opts.validate();return opts.click();}}
 });
 vm.runInContext(source.slice(source.indexOf(' const followAuthor='),source.indexOf(' const markSelected='))+';globalThis.follow=followAuthor;',context);
 return {run:()=>context.follow({author:'ann',article:{querySelector:()=>caret}},{aborted:false}),clicks:()=>clicks,followed:()=>followed};
}
test('follow final check rejects a same-menu replacement with a prefix-similar handle',async()=>{
 const f=fixture({replacement:'anna'});await assert.rejects(f.run(),/唯一关注项/);assert.equal(f.clicks(),0);
});
test('follow setting disabled during permit wait prevents the click',async()=>{
 const f=fixture({disable:true});await assert.rejects(f.run(),{code:'FOLLOW_DISABLED'});assert.equal(f.clicks(),0);
});
test('after-click follow verification errors retain submitted evidence',async()=>{
 const f=fixture({afterClickError:true});await assert.rejects(f.run(),e=>e.submitted===true&&/page changed/.test(e.message));assert.equal(f.clicks(),1);
});
test('follow saves completion only after observing exact-account unfollow state',async()=>{
 const f=fixture();assert.equal(await f.run(),'verified');assert.equal(f.clicks(),1);assert.equal(f.followed(),true);
});

test('interaction never follows a target already held by the verified-followback worker',async()=>{
 for(const status of ['confirmed','in_flight','unknown']){
  const f=fixture({ledger:async()=>({'/me':{'@ann':{status,targetId:'123'}}})});
  assert.equal(await f.run(),'skipped_followback_ledger');assert.equal(f.clicks(),0);
 }
 let reads=0;
 const f=fixture({stableId:'555',ledger:async()=>++reads>1?{'/me':{'@oldname':{targetId:'555',status:'unknown'}}}:{}});
 assert.equal(await f.run(),'skipped_followback_ledger');assert.equal(f.clicks(),0,'recheck under lease matches stable ID even after rename');
 const foreign=fixture({ledger:async()=>({'/other':{'@ann':{status:'unknown',targetId:'123'}}})});
 assert.equal(await foreign.run(),'verified');
});
