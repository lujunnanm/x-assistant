import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {collectFollowing} from '../following.mjs';
test('panel removes legacy sections and exposes following library',async()=>{const html=await readFile(new URL('../panel.html',import.meta.url),'utf8');for(const title of ['选帖与人工审阅','作者与帖子审阅','单帖执行','当前抽取','循环控制'])assert.ok(!html.includes(title));assert.ok(html.includes('following-read'));});
test('collector merges observed followed users without clicking',async()=>{
 let data={xAssistantFollowingScanV1:{active:true,scanId:'test'},xAssistantFollowedV1:{handles:{old:{handle:'@Old'}}}};
 globalThis.chrome={storage:{local:{get:async k=>({[k]:structuredClone(data[k])}),set:async x=>Object.assign(data,structuredClone(x))}}};
 globalThis.location={pathname:'/owner/following'};globalThis.scrollY=0;
 const cell={innerText:'Alice\n@Alice',querySelector:()=>({}),querySelectorAll:()=>[{href:'https://x.com/Alice'},{href:'https://x.com/Alice'}]};
 globalThis.document={querySelectorAll:()=>[cell],documentElement:{scrollHeight:100}};globalThis.window={scrollTo:()=>{}};
 const original=globalThis.setTimeout;globalThis.setTimeout=fn=>original(fn,0);
 try{await collectFollowing('/owner','test');assert.equal(Object.keys(data.xAssistantFollowedV1.handles).length,2);assert.equal(data.xAssistantFollowingScanV1.observed,1);assert.equal(data.xAssistantFollowingScanV1.active,false);}finally{globalThis.setTimeout=original;}
});
