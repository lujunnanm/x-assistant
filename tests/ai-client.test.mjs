import test from 'node:test';import assert from 'node:assert/strict';import {validateReply,generateReply} from '../ai-client.mjs';
test('AI output only permits bound reply or skip',()=>{assert.equal(validateReply({action:'send_reply',text:'可以从短篇读起。'},'123').postId,'123');assert.equal(validateReply({action:'skip'},'123').action,'skip');for(const v of [{action:'delete',text:'x'},{action:'send_reply',text:''},{action:'send_reply',text:'我最近在读一本书'},{action:'send_reply',text:'http://evil.test'}])assert.throws(()=>validateReply(v,'123'));});
test('direct-adapter request only sends post text; invalid and failed output cannot send',async()=>{let body;const result=await generateReply({id:'123',text:'读书推荐'},async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({action:'send_reply',text:'试试短篇小说。'})};});assert.deepEqual(body,{text:'读书推荐'});assert.equal(result.postId,'123');await assert.rejects(generateReply({id:'bad',text:'x'}));await assert.rejects(generateReply({id:'123',text:'x'},async()=>({ok:false,status:401})));});
test('raw provider error bodies are not exposed and invalid JSON gets format classification',async()=>{
 await assert.rejects(generateReply({id:'123',text:'内容'},async()=>({ok:false,status:500,json:async()=>({error:'secret text'})})),e=>e.code==='http'&&e.status===500&&!e.message.includes('secret'));
 await assert.rejects(generateReply({id:'123',text:'内容'},async()=>({ok:true,json:async()=>{throw Error('untrusted raw payload');}})),e=>e.code==='format');
});
test('reply weighted bound blocks Chinese overflow before the public sender',()=>{
 assert.throws(()=>validateReply({action:'send_reply',text:'字'.repeat(141)},'123'),e=>e.code==='content_length');
 assert.doesNotThrow(()=>validateReply({action:'send_reply',text:'a'.repeat(180)},'123'));
});
test('unknown commands and footer-only content never produce send instructions',()=>{
 for(const v of [{action:'follow',text:'hello'},{action:'send_reply',text:'交个朋友呀\n请回关我'},{action:'send_reply',text:'尽快回关'}])assert.throws(()=>validateReply(v,'123'));
});
