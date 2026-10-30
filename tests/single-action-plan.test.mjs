import test from 'node:test';import assert from 'node:assert/strict';import {singleActionPlan} from '../single-action-plan.mjs';
test('single action skips existing and blocks uncertain reply',()=>{
 assert.deepEqual(singleActionPlan({liked:true,following:true,replyStatus:'unknown'}),{like:'skip',follow:'skip',reply:'manual_check'});
 assert.deepEqual(singleActionPlan({liked:false,following:false,replyStatus:'present'}),{like:'execute',follow:'execute',reply:'skip'});
 assert.throws(()=>singleActionPlan({liked:null,following:false,replyStatus:'unknown'}));
});
import {classifyVisibleReply} from '../single-action-plan.mjs';
test('visible replies can prove presence but not absence',()=>{
 assert.equal(classifyVisibleReply([{author:'Alice',text:'hello'}],'alice','hello'),'present');
 assert.equal(classifyVisibleReply([],'alice','hello'),'unknown');
 assert.equal(classifyVisibleReply([{author:'Bob',text:'hello'}],'alice','hello'),'unknown');
});
