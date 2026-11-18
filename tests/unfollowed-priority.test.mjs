import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
async function choose(states,enabled=true,cooling=false){
 const rows=states.map((state,i)=>({id:String(i),author:'user'+i,state}));
 const ctx=vm.createContext({window:{scrollBy:()=>{}},innerHeight:900,sleep:async()=>{},status:()=>{},skipSummary:()=>'',document:{querySelector:()=>null},check:()=>{},pauseRequested:false,processed:async()=>({posts:{}}),selfHandle:()=>'me',visiblePosts:()=>rows,core:{interactionSkipReason:()=>null},sessionAuthors:new Set(),recordCandidate:()=>{},publishDiagnostics:async()=>{},inspectFollowState:async r=>({state:r.state,followsYou:true}),followsYouBadge:()=>true,followCooldownActive:async()=>cooling,getLocal:async()=>cooling?{'/me':{nextAt:Date.now()+120000}}:{},account:'/me',XAssistantDOM:{relocate:r=>r}});
 vm.runInContext(source.slice(source.indexOf(' const findCandidate='),source.indexOf(' const aiReply='))+';globalThis.choose=findCandidate;',ctx);
 return ctx.choose(null,enabled);
}
test('auto-follow does not prefer unfollowed authors over earlier qualified posts',async()=>{
 assert.equal((await choose(['followed','unknown','unfollowed'])).id,'0');
});
test('reply-only mode accepts followed authors without a relationship restriction',async()=>{
 const row=await choose(['followed','unfollowed'],false);
 assert.equal(row.id,'0');assert.equal(row.followState,'unrestricted');assert.equal(row.followsYou,true);
});
test('followed and unknown authors both qualify without any unfollowed authors present',async()=>{
 for(const state of ['unknown','followed'])assert.equal((await choose([state])).followState,state);
});
test('blue-V follower and exposure discussions match without broad unrelated metric matches',()=>{
 const ctx=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../interaction-core.js',import.meta.url),'utf8'),ctx);
 const match=ctx.XAssistantCore.friendshipRelated;
 assert.equal(match('蓝V曝光已经进入90天滚动期'),true);
 assert.equal(match('蓝V开通两天达到500粉丝'),true);
 assert.equal(match('广告曝光转化和粉丝增长报告'),false);
});

test('follow cooldown does not change candidate eligibility',async()=>{
 assert.equal((await choose(['followed','unfollowed'],true,true)).id,'0');
 assert.equal((await choose(['unknown','followed'],true,true)).id,'0');
 for(const enabled of [true,false])for(const state of ['followed','unfollowed','unknown'])assert.equal((await choose([state],enabled,true)).id,'0');
 assert.equal((await choose(['followed','unfollowed'],true,false)).id,'0');
});
