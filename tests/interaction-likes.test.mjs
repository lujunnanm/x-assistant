import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({URL});vm.runInContext(readFileSync(new URL('../interaction-core.js',import.meta.url),'utf8'),c);
const core=c.XAssistantCore;

test('native likes labels parse localized counts and preserve unreadable versus zero',()=>{
 for(const [label,count] of [['100 喜欢次数。喜欢',100],['0 Likes. Like',0],['1,234 Likes. Unlike',1234],['1.2K Likes',1200],['1.5万 喜欢',15000],['10 個喜歡',10],['100 次喜欢。喜欢',100],['20 喜歡',20],['Like',null],['',null],[null,null]])assert.equal(core.parseLikes(label),count,label);
});

test('only outer native like or unlike count is used, never quotes or nested cards',()=>{
 let buttons=[];const article={querySelectorAll:selector=>{assert.match(selector,/unlike/);return buttons;}};
 const button=(label,{nested=false,quoted=false}={})=>({closest:s=>s==='article'?(nested?{}:article):(quoted?{}:null),getAttribute:()=>label});
 buttons=[button('120 Likes'),button('900 Likes',{quoted:true}),button('800 Likes',{nested:true})];assert.equal(core.postLikes(article),120);
 buttons=[button('120 Likes'),button('130 Likes')];assert.equal(core.postLikes(article),null);
 buttons=[button('Unlike')];assert.equal(core.postLikes(article),null);
 buttons=[];assert.equal(core.postLikes(article),null);
});

test('selected metric is exclusive and uses strictly greater thresholds',()=>{
 const post={author:'other',text:'正文',likes:101,views:null},options={self:'me',metric:'likes',minLikes:100,minViews:10000};
 assert.equal(core.interactionSkipReason(post,options),null);
 for(const likes of [null,undefined,99,100])assert.equal(core.interactionSkipReason({...post,likes,views:20000},options),'low_likes');
 assert.equal(core.interactionSkipReason({...post,likes:1001},{...options,minLikes:1000}),null);
 assert.equal(core.interactionSkipReason({...post,likes:1000},{...options,minLikes:1000}),'low_likes');
 assert.equal(core.interactionSkipReason({...post,views:10001,likes:null},{...options,metric:'views'}),null);
 assert.equal(core.interactionSkipReason({...post,views:10000},{...options,metric:'views'}),'low_exposure');
 assert.equal(core.interactionSkipReason(post,{...options,record:{reply:'verified'}}),'confirmed');
 assert.equal(core.interactionSkipReason(post,{...options,record:{reply:'unknown'}}),'uncertain');
});
