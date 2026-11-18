import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({URL});vm.runInContext(readFileSync(new URL('../interaction-core.js',import.meta.url),'utf8'),c);
const core=c.XAssistantCore;

test('comment labels support native reply counts, units and missing values',()=>{
 for(const [label,n] of [['10 回复。回复',10],['20 則回覆',20],['20 回覆',20],['30 条评论',30],['30 评论',30],['0 Replies. Reply',0],['1 Reply. Reply',1],['1,234 replies',1234],['1.2K Replies',1200],['1.5万 回复',15000],['20 件の返信',20],['Reply',null],['',null],[null,null]])assert.equal(core.parseComments(label),n,label);
});

test('comment count reads only the source reply button and excludes nested, quoted or hidden buttons',()=>{
 let buttons=[];const article={querySelectorAll:s=>{assert.equal(s,'[data-testid="reply"]');return buttons;}};
 const button=(label,{nested=false,excluded=false}={})=>({closest:s=>s==='article'?(nested?{}:article):(excluded?{}:null),getAttribute:()=>label});
 buttons=[button('120 Replies'),button('900 Replies',{excluded:true}),button('800 Replies',{nested:true})];assert.equal(core.postComments(article),120);
 buttons=[button('120 Replies'),button('130 Replies')];assert.equal(core.postComments(article),null);
 buttons=[button('Reply')];assert.equal(core.postComments(article),null);
 buttons=[];assert.equal(core.postComments(article),null);
});

test('comment threshold is exclusive, strictly greater, and keeps receipt guards',()=>{
 const post={author:'other',text:'正文',comments:101,likes:null,views:null},options={self:'me',metric:'comments',minComments:100,minLikes:1000,minViews:10000};
 assert.equal(core.interactionSkipReason(post,options),null);
 for(const comments of [null,undefined,99,100])assert.equal(core.interactionSkipReason({...post,comments,likes:2000,views:20000},options),'low_comments');
 for(const [comments,threshold,reason] of [[500,500,'low_comments'],[501,500,null],[0,0,'low_comments'],[1,0,null]])assert.equal(core.interactionSkipReason({...post,comments},{...options,minComments:threshold}),reason);
 assert.equal(core.interactionSkipReason({...post,views:10001,comments:null},{...options,metric:'views'}),null);
 assert.equal(core.interactionSkipReason({...post,likes:1001,comments:null},{...options,metric:'likes'}),null);
 assert.equal(core.interactionSkipReason(post,{...options,record:{reply:'verified'}}),'confirmed');
 assert.equal(core.interactionSkipReason(post,{...options,record:{reply:'unknown'}}),'uncertain');
});
