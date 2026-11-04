import test from 'node:test';
import assert from 'node:assert/strict';
import {generateNotificationReply,generateReply} from '../ai-client.mjs';
const post={id:'123',text:'评论内容'};
const response=text=>async()=>({ok:true,json:async()=>({action:'send_reply',text})});
test('notification removes follow-back footer while proactive interaction preserves it',async()=>{
 const notificationText='先把第一步缩小一点。\n交个朋友呀\n请回关我';
 const interactionText='来交个朋友，方便的话回关一下。';
 assert.equal((await generateNotificationReply(post,response(notificationText))).text,'先把第一步缩小一点。');
 assert.equal((await generateReply(post,response(interactionText))).text,interactionText);
});
test('notification replies preserve natural body and skip; footer alone cannot send',async()=>{
 assert.equal((await generateNotificationReply(post,response('这个思路很实用。'))).text,'这个思路很实用。');
 assert.equal((await generateNotificationReply(post,async()=>({ok:true,json:async()=>({action:'skip'})}))).action,'skip');
 await assert.rejects(generateNotificationReply(post,response('交个朋友呀\n请回关我')));
});
test('proactive interaction converts model skip into a social fallback',async()=>{
 const result=await generateReply(post,async()=>({ok:true,json:async()=>({action:'skip'})}));
 assert.equal(result.action,'send_reply');
 assert.match(result.text,/交个朋友/);
});
