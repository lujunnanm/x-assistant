import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx=vm.createContext({URL});vm.runInContext(readFileSync(new URL('../service-policy.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('../workspace-policy.js',import.meta.url),'utf8'),ctx);
const P=ctx.XAssistantWorkspacePolicy;
test('idle page maps only to its relevant module',()=>{
 for(const [url,expected] of [['/home','posting'],['/search?q=hi','interaction'],['/Owner','notifications'],['/notifications/mentions','notifications'],['/someone',null],['/owner/status/123',null],['/messages',null]])assert.equal(P.moduleFor(url,'/owner'),expected);
 assert.equal(P.moduleFor('/home','/owner',{homeInteraction:true}),'interaction');
 assert.equal(P.moduleFor('/other','/other'),'notifications');
});
test('controlled navigation retains module ownership but manual route changes fail closed',()=>{
 const g=P.createGuard({module:'notifications',url:'/owner',self:'/OWNER'});
 g.expectNavigation('/owner/status/123','/owner','/owner');g.check('/owner','/owner');g.check('/owner/status/123','/owner');
 assert.equal(g.module,'notifications');
 assert.throws(()=>g.check('/search?q=else','/owner'),e=>e.code==='PAGE_CHANGED');
 g.expectNavigation('/notifications/mentions','/owner/status/123','/owner');g.check('/notifications/mentions','/owner');
 assert.throws(()=>g.check('/owner','/different'),e=>e.code==='ACCOUNT_CHANGED');
});
test('a stale navigation allowance cannot authorize a later user navigation',()=>{
 let now=0;const g=P.createGuard({module:'interaction',url:'/search?q=a',self:'/owner',now:()=>now});
 g.expectNavigation('/search?q=b','/search?q=a','/owner');now=15001;
 assert.throws(()=>g.check('/search?q=b','/owner'),e=>e.code==='PAGE_CHANGED');
});
test('composer lease permits only composer and original work page, never arbitrary pages',()=>{
 const g=P.createGuard({module:'posting',url:'/home',self:'/owner'});const release=g.beginComposer();
 g.check('/compose/post','/owner');g.check('/compose/tweet?reply_to=123','/owner');g.check('/home','/owner');
 assert.throws(()=>g.check('/someone/status/123','/owner'),e=>e.code==='PAGE_CHANGED');
 release();release();assert.throws(()=>g.check('/compose/post','/owner'),e=>e.code==='PAGE_CHANGED');
});
test('external routes and invalid module identities are never accepted',()=>{
 assert.throws(()=>P.normalize('https://example.com/home'));
 assert.throws(()=>P.createGuard({module:'other',url:'/home',self:'/owner'}));
 assert.throws(()=>P.createGuard({module:'posting',url:'/home',self:'/'}));
});

test('unknown X receipt retains evidence and forbids all work on the exact owned composer, without mislabelling it a manual navigation',()=>{
 const g=P.createGuard({module:'notifications',url:'/owner/status/123',self:'/owner'}),release=g.beginComposer();
 g.check('/compose/post','/owner');
 release({submitted:true,confirmed:false,reason:'X 返回错误，请再试一次'});
 assert.throws(()=>g.check('/compose/post','/owner'),e=>e.code==='SEND_UNKNOWN'&&e.submitted===true&&e.preserveDrafts&&/X 返回错误/.test(e.message));
 assert.throws(()=>g.check('/compose/post','/other'),e=>e.code==='ACCOUNT_CHANGED');
 g.check('/owner/status/123','/owner');
 assert.throws(()=>g.check('/compose/post','/owner'),e=>e.code==='PAGE_CHANGED');
});
test('confirmed compose lag is distinct from unknown; a fresh or unrelated composer never receives a stale result',()=>{
 const g=P.createGuard({module:'notifications',url:'/owner/status/123',self:'/owner'}),release=g.beginComposer();
 g.check('/compose/post','/owner');release({submitted:true,confirmed:true});release();
 assert.throws(()=>g.check('/compose/post','/owner'),e=>e.code==='CONFIRMED_COMPOSER_OPEN'&&e.confirmed===true&&e.submitted);
 assert.throws(()=>g.check('/compose/tweet','/owner'),e=>e.code==='PAGE_CHANGED');
 const other=P.createGuard({module:'interaction',url:'/search',self:'/owner'});other.beginComposer()({submitted:true});
 assert.throws(()=>other.check('/compose/post','/owner'),e=>e.code==='PAGE_CHANGED');
});

test('followback is confined to the signed-in owner verified followers page even across a navigation allowance',()=>{
 assert.equal(P.moduleFor('/Me/verified_followers','/me'),'followback');
 const g=P.createGuard({module:'followback',url:'/me/verified_followers',self:'/me'});g.check('/me/verified_followers','/ME');
 g.expectNavigation('/me/followers','/me/verified_followers','/me');
 for(const url of ['/other/verified_followers','/me/followers','/me/following','/me/verified_followers?q=x','/me/verified_followers#x','https://example.com/me/verified_followers']){
  assert.notEqual(P.moduleFor(url,'/me'),'followback');assert.throws(()=>g.check(url,'/me'),{code:'PAGE_CHANGED'});
 }
 assert.throws(()=>g.check('/me/verified_followers','/other'),{code:'ACCOUNT_CHANGED'});
});
