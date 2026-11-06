import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
function fixture(data){
 let now=200000;
 const c=vm.createContext({account:'/me',Date:{now:()=>now},getLocal:async key=>data[key]});
 vm.runInContext(source.slice(source.indexOf(' const followCooldownActive='),source.indexOf(' const followAuthor='))+';globalThis.cooling=followCooldownActive;',c);
 return {c,setNow:value=>{now=value;},cooling:()=>c.cooling()};
}
test('follow selection respects persistent actual-click cooldown across accounts',async()=>{
 const f=fixture({xAssistantActionGateV1:{version:1,accounts:{'/me':{lastFollowAt:200000}}}});
 assert.equal(await f.cooling(),true);f.setNow(319999);assert.equal(await f.cooling(),true);
 f.setNow(320000);assert.equal(await f.cooling(),false);f.setNow(200000);f.c.account='/other';assert.equal(await f.cooling(),false);
});
test('follow selection treats unacknowledged leases conservatively and imports legacy cooldowns',async()=>{
 const f=fixture({xAssistantActionGateV1:{version:1,holder:{kind:'follow',account:'/me',expiresAt:210000}}});
 f.setNow(329999);assert.equal(await f.cooling(),true);f.setNow(330000);assert.equal(await f.cooling(),false);
 const legacy=fixture({xAssistantFollowCooldownV1:{'/me':{nextAt:250000}}});assert.equal(await legacy.cooling(),true);legacy.setNow(250000);assert.equal(await legacy.cooling(),false);
});
test('follow actual clicks require backend lease and final menu/account/setting validation',()=>{
 const follow=source.slice(source.indexOf(' const followAuthor='),source.indexOf(' const markSelected='));
 assert.match(follow,/XAssistantActions.click/);assert.match(follow,/kind:'follow'/);assert.match(follow,/validate:\(\)=>/);
 assert.match(follow,/check\(signal\);relocatePost\(info\)/);assert.match(follow,/!followToggle.checked/);assert.match(follow,/document.contains\(menu\)/);
 assert.doesNotMatch(follow,/reserveFollowCooldown|clickNative\(matches/);
});
