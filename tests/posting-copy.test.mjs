import test from 'node:test';import assert from 'node:assert/strict';
import {validatePostingCopies,normalizePostingCopies,postingCopyOperation,appendTimelineRewrite,formatTimelineRewriteText,validateTimelinePostingSource,timelineRewriteSourceId,splitPostingPaste} from '../posting-copy.mjs';
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
test('new copy defaults on even when an old producer sends enabled false; manual off still persists',()=>{
 let s=postingCopyOperation(null,{action:'upsert',id:'a',expected:null,row:{...row(),enabled:false},expectedRevision:0});
 assert.equal(s.rows[0].enabled,true);
 s=postingCopyOperation(s,{action:'upsert',id:'a',expected:s.rows[0],row:{...s.rows[0],enabled:false},expectedRevision:s.revision});
 assert.equal(normalizePostingCopies(s).rows[0].enabled,false);
 s=postingCopyOperation(s,{action:'upsert',id:'a',expected:s.rows[0],row:{...s.rows[0],text:'手动停用后编辑'},expectedRevision:s.revision});
 assert.equal(s.rows[0].enabled,false);
});
test('replace enables only new IDs, preserving existing manual stops and terminal evidence',()=>{
 const existing={...row('a'),enabled:false};
 const next=postingCopyOperation({revision:1,rows:[existing]},{action:'replace',expectedRevision:1,rows:[existing,{...row('b'),enabled:false},{...row('c'),status:'unknown'},{...row('d'),status:'published'}]});
 assert.deepEqual(next.rows.map(row=>row.enabled),[false,true,false,false]);
});
test('new terminal copies stay disabled and an invalid enabled type is still rejected',()=>{
 for(const status of ['published','unknown']){
  const s=postingCopyOperation(null,{action:'upsert',id:'a',expected:null,row:{...row(),status},expectedRevision:0});
  assert.equal(s.rows[0].enabled,false);
 }
 assert.throws(()=>postingCopyOperation(null,{action:'upsert',id:'a',expected:null,row:{...row(),enabled:'false'},expectedRevision:0}),/无效/);
});
test('home timeline rewrite appends the DeepSeek text once with a canonical source',()=>{
 const post={id:'1234567890',author:'Writer',text:'第一行\n第二行',url:'https://x.com/Writer/status/1234567890'},at='2026-11-08T12:00:00.000Z';
 const rewritten='换一种表达\n保留核心意思',first=appendTimelineRewrite(null,post,rewritten,at);
 assert.equal(first.added,true);assert.deepEqual(first.row,{id:'timeline_ai_1234567890',text:rewritten,enabled:true,sourceUrls:[post.url],createdAt:at});
 const again=appendTimelineRewrite(first.library,post,'第二次不同改写','2026-11-08T13:00:00.000Z');
 assert.equal(again.added,false);assert.equal(again.library.revision,1);assert.equal(again.library.rows.length,1);
});
test('home timeline rewrite rejects empty, unchanged, mismatched and non-X post identities',()=>{
 const post={id:'123',author:'Writer',text:'正文',url:'https://x.com/Writer/status/123'};
 for(const invalid of [{...post,text:' '},{...post,id:'124'},{...post,author:'Other'},{...post,url:'https://example.com/Writer/status/123'},{...post,url:post.url+'?s=20'}])
  assert.throws(()=>validateTimelinePostingSource(invalid));
 assert.throws(()=>appendTimelineRewrite(null,post,'正文'));
 assert.throws(()=>appendTimelineRewrite(null,post,'正，文！'));
 assert.throws(()=>appendTimelineRewrite(null,post,' '));
});
test('comment fusion validates and preserves both canonical sources',()=>{
 const rootPost={id:'100',author:'Root',text:'所属帖子观点',url:'https://x.com/Root/status/100'};
 const comment={id:'101',author:'Commenter',text:'评论观点',url:'https://x.com/Commenter/status/101',rootPost};
 const at='2026-11-08T12:00:00.000Z',result=appendTimelineRewrite(null,comment,'把两个观点融合成新的表达。',at);
 assert.deepEqual(result.row.sourceUrls,[comment.url,rootPost.url]);
 assert.throws(()=>appendTimelineRewrite(null,comment,rootPost.text),/未融合评论观点/);
 assert.throws(()=>validateTimelinePostingSource({...comment,rootPost:{...rootPost,id:'101',url:'https://x.com/Root/status/101'}}));
});
test('a source already present in the rewrite library cannot be added under another row id',()=>{
 const post={id:'123',author:'Writer',text:'原帖',url:'https://x.com/Writer/status/123'};
 const library={revision:4,rows:[{id:'imported-copy',text:'已有改写稿',enabled:true,sourceUrls:[post.url]}]};
 const result=appendTimelineRewrite(library,post,'新的改写稿');
 assert.equal(result.added,false);assert.equal(result.row.id,'imported-copy');assert.equal(result.library.revision,4);
 assert.equal(timelineRewriteSourceId(result.row),'123');
});
test('timeline rewrite formatting puts every sentence on one line without blank rows',()=>{
 assert.equal(formatTimelineRewriteText('第一句。第二句！\n\n第三句？ 😂😂😂'),'第一句。\n第二句！\n第三句？ 😂😂😂');
 assert.equal(formatTimelineRewriteText('买账号！配代理！装 Magpie！'),'买账号！\n配代理！\n装 Magpie！');
});
