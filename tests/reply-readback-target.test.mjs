import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../bg/reply-readback.mjs',import.meta.url),'utf8');
const logic=src.slice(src.indexOf('const handle='),src.indexOf('export async function checkLiveReply')).replaceAll('export ','');
const q={account:'/me',author:'them',root:'500',parent:'550',text:'确定是这一条。',since:Date.now()-400,path:'/them/status/550'};
const child={id:'600',author:'Me',time:'now',at:q.since,text:q.text,article:{isConnected:true}};
function ctx({parent='550',body=child.text,author='Me',at=q.since,clipped=false}={}){
 const c=vm.createContext({Date,location:{pathname:q.path,origin:'https://x.com'},document:{querySelector:()=>({contains:()=>true})},
  XAssistantDOM:{account:()=>q.account,threadIdentity:id=>({author:id==='550'?'them':author.toLowerCase(),root:'500'}),originalPost:()=>true,
   directChildOf:(_,p)=>p===parent,rows:()=>[{id:'550',author:'them',article:{isConnected:true}},{...child,text:body,author,at,clipped}]}});
 vm.runInContext(logic,c);return c;
}
test('public reply readback requires exact parent, owner, body and non-truncated fresh reply; unrelated or old text never proves failure',()=>{
 assert.equal(ctx().sampleTargetReply(q).postId,'600');
 for(const bad of [{parent:'900'},{body:'确定是另一条。'},{author:'other'},{at:q.since-10000},{clipped:true}])assert.equal(ctx(bad).sampleTargetReply(q),null);
});
test('new background page absent is inconclusive, cannot resubmit; a tab taken over by a user is not closed',async()=>{
 const c=ctx(),events=[],tabs={create:async o=>{events.push(['create',o]);return {id:90};},get:async()=>({url:'https://x.com'+q.path,active:false}),remove:async id=>events.push(['remove',id])},scripting={executeScript:async()=>[{result:null}]};
 assert.equal(await c.readTargetReply(q,{tabs,scripting,wait:async()=>{}}),null);
 assert.equal(events[0][1].active,false);assert.deepEqual(events.at(-1),['remove',90]);
 tabs.get=async()=>({url:'https://x.com'+q.path,active:true});events.length=0;await c.readTargetReply(q,{tabs,scripting,wait:async()=>{}});assert.equal(events.length,1);
});
test('a hidden-tab native reply can prove delivery; two matches or contradictory mounted body do not',()=>{
 const c=ctx({body:'other'}),D=c.XAssistantDOM;D.receiptChildren=()=>[{id:'600',text:q.text,at:q.since}];
 assert.equal(c.sampleTargetReply(q),null);const row=D.rows()[0];D.rows=()=>[row];assert.equal(c.sampleTargetReply(q).postId,'600');
 D.receiptChildren=()=>[{id:'600',text:q.text,at:q.since},{id:'601',text:q.text,at:q.since}];assert.equal(c.sampleTargetReply(q),null);
});
test('new inactive tab may paint about:blank before the verified reply loads',async()=>{
 let reads=0,closed=false;const c=ctx(),url='https://x.com'+q.path;
 const tabs={create:async()=>({id:90}),get:async()=>({url:reads++?'https://x.com'+q.path:'about:blank',active:false}),remove:async()=>{closed=true;}};
 const result={kind:'confirmed',parentId:'550',postId:'600',url:'https://x.com/me/status/600'};
 assert.equal((await c.readTargetReply(q,{tabs,scripting:{executeScript:async()=>[{result}]},wait:async()=>{}})).postId,'600');
 assert.equal(closed,true);
});
