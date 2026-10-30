import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {postURL,prepareReview} from '../review.mjs';
const script=readFileSync(new URL('../timeline.js',import.meta.url),'utf8');
const run=({path='/home',label='为你推荐',dialog=false,articles=[]}={})=>vm.runInNewContext(script,{
 URL,location:{origin:'https://x.com',pathname:path},
 document:{querySelector:selector=>selector==='[role="dialog"]'?dialog?{}:null:{querySelectorAll:selector=>selector.startsWith('[role=')?[{textContent:label}]:articles}}
});
const article=(href,text='sample')=>({querySelectorAll:()=>[{href,querySelector:()=>({})}],querySelector:()=>({textContent:text})});
test('canonical post URL rejects external and non-post destinations',()=>{
 assert.equal(postURL('https://x.com/LivingRiver123/status/2115435349832778233?a=test'),'https://x.com/LivingRiver123/status/2115435349832778233');
 for(const value of ['https://evil.com/a/status/1','javascript:alert(1)','https://x.com/home','https://x.com/a/status/1/photo/1','https://a:b@x.com/a/status/1'])assert.throws(()=>postURL(value));
});
test('timeline requires home and selected For you and no dialog',()=>{
 assert.equal(run({path:'/a/status/1'}).ok,false);
 assert.equal(run({label:'正在关注'}).ok,false);
 assert.equal(run({dialog:true}).ok,false);
 assert.equal(run({label:'For you'}).ok,true);
});
test('timeline deduplicates post ids, rejects foreign links and caps candidates',()=>{
 const articles=[article('https://x.com/a/status/1?q=1'),article('https://x.com/a/status/1'),article('https://evil.com/a/status/2'),article('https://x.com/a/status/2/photo/1')];
 const result=run({articles});assert.equal(result.posts.length,1);assert.equal(result.posts[0].url,'https://x.com/a/status/1');
 assert.equal(run({articles:Array.from({length:40},(_,i)=>article(`https://x.com/a/status/${i}`))}).posts.length,30);
});

test('automatic preparation chooses enabled reply and candidate without sending',()=>{
 const posts=[{url:'https://x.com/a/status/1',text:'original'},{url:'https://x.com/b/status/2',text:'other'}];
 const rows=[{id:'off',type:'reply',enabled:false,text:'off'},{id:'ok',type:'reply',enabled:true,text:'draft'}];
 assert.deepEqual(prepareReview(posts,rows,()=>0),{url:'https://x.com/a/status/1',excerpt:'original',reply:'draft',id:'ok'});
 assert.throws(()=>prepareReview([],rows));assert.throws(()=>prepareReview(posts,[]));
});
