import test from 'node:test';import assert from 'node:assert/strict';
import {validatePostingCopies,normalizePostingCopies,postingCopyOperation,splitPostingPaste} from '../posting-copy.mjs';
const row=(id='a',text='第一行\n第二行')=>({id,text,enabled:true});
test('post-only rows preserve multiline body and empty initial state',()=>{
 assert.deepEqual(normalizePostingCopies(),{revision:0,rows:[]});
 assert.deepEqual(validatePostingCopies([row()]),[row()]);
 assert.equal(validatePostingCopies([row('spaced','  原文\n下一行  ')])[0].text,'  原文\n下一行  ');
 for(const input of [[row(),row()],[{...row(),enabled:'yes'}],[{...row(),text:'  '}],[{...row(),id:'bad/slash'}]])assert.throws(()=>validatePostingCopies(input));
});
test('batch paste uses explicit line or separator mode without silent slicing',()=>{
 assert.deepEqual(splitPostingPaste('第一条\n第二条\n\n第三条'),['第一条','第二条','第三条']);
 assert.deepEqual(splitPostingPaste('第一条\n内容\n---\n第二条\n内容','separator'),['第一条\n内容','第二条\n内容']);
 assert.deepEqual(splitPostingPaste('  '),[]);assert.throws(()=>splitPostingPaste('abc','bad'));
});
test('CAS editing, enabling, deleting and clearing never repopulate the old library',()=>{
 let s=postingCopyOperation(null,{action:'upsert',id:'a',expected:null,row:row(),expectedRevision:0});
 assert.deepEqual(s,{revision:1,rows:[row()]});
 assert.throws(()=>postingCopyOperation(s,{action:'clear',expectedRevision:0}),/已变化/);
 s=postingCopyOperation(s,{action:'upsert',id:'a',expected:row(),row:{...row(),enabled:false},expectedRevision:1});
 assert.deepEqual(s.rows,[{...row(),enabled:false}]);
 assert.throws(()=>postingCopyOperation(s,{action:'delete',id:'a',expected:row(),expectedRevision:2}),/其他窗口/);
 s=postingCopyOperation(s,{action:'delete',id:'a',expected:{...row(),enabled:false},expectedRevision:2});
 assert.deepEqual(s.rows,[]);
 assert.deepEqual(postingCopyOperation(s,{action:'clear',expectedRevision:3}).rows,[]);
});
