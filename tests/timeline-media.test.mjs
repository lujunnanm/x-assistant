import test from 'node:test';
import assert from 'node:assert/strict';
import {appendTimelineRewrite,validateTimelinePostingSource,timelinePostingImageUrls,normalizePostingCopies,postingCopyOperation,parsePostingPackage} from '../posting-copy.mjs';
import {generateTimelineRewrite} from '../ai-client.mjs';
const photo=n=>'https://pbs.twimg.com/media/Photo'+n+'?format=jpg&name=small';
const image='post-images/post-image-01.jpg';
const root={id:'100',author:'Root',text:'原帖文字',url:'https://x.com/Root/status/100'};
const comment={id:'101',author:'Friend',text:'评论观点',url:'https://x.com/Friend/status/101'};
const video=post=>post.url+'/video/1';

test('comment keeps root images first, deduplicates shared photos, and defaults enabled',()=>{
 const source={...comment,imageUrls:[photo(2)],rootPost:{...root,imageUrls:[photo(1),photo(2)]}};
 const normalized=validateTimelinePostingSource(source);
 assert.deepEqual(timelinePostingImageUrls(normalized),[1,2].map(n=>photo(n).replace('small','large')));
 const saved=appendTimelineRewrite(null,source,'融合后的完整观点。',undefined,[image,image]);
 assert.equal(saved.row.enabled,true);assert.deepEqual(saved.row.images,[image,image]);
 assert.deepEqual(saved.row.sourceUrls,[comment.url,root.url]);
 assert.throws(()=>appendTimelineRewrite(null,source,'融合观点',undefined,[image]),/未全部读取/);
 assert.throws(()=>validateTimelinePostingSource({...source,imageUrls:[photo(3),photo(4),photo(5)]}),/合计超过 4/);
});
test('all newly created or imported image copies default on; manual off survives edits and reload',()=>{
 const row={id:'timeline_ai_100',text:'',image,enabled:false};
 assert.equal(parsePostingPackage([row])[0].enabled,true);
 for(const action of ['merge','replace','upsert']){
  const s=postingCopyOperation(null,{action,expectedRevision:0,rows:[row],row,id:row.id,expected:null});
  assert.equal(s.rows[0].enabled,true);
 }
 let s=appendTimelineRewrite(null,{...root,imageUrls:[photo(1)]},'新写法',undefined,[image]).library;
 const old=s.rows[0];s=postingCopyOperation(s,{action:'upsert',expectedRevision:s.revision,id:old.id,expected:old,row:{...old,enabled:false}});
 assert.equal(normalizePostingCopies(s).rows[0].enabled,false);
});
test('video permalink is appended after formatting and survives storage normalization/import/edit',()=>{
 const source={...root,videoUrls:[video(root),video(root)]};
 const saved=appendTimelineRewrite(null,source,'第一句话。第二句话。',undefined,[],'reaction');
 const expected='第一句话。\n\n第二句话。\n\n'+video(root);
 assert.equal(saved.row.text,expected);assert.equal(saved.row.enabled,true);
 assert.equal(normalizePostingCopies(saved.library).rows[0].text,expected);
 assert.equal(parsePostingPackage([saved.row])[0].text,expected);
 const edit=postingCopyOperation(saved.library,{action:'upsert',expectedRevision:1,id:saved.row.id,expected:saved.row,row:{...saved.row,enabled:false}});
 assert.equal(edit.rows[0].text,expected);
});
test('comment appends root and own video links; textless video saves without AI output',()=>{
 const source={...comment,videoUrls:[video(comment)],rootPost:{...root,videoUrls:[video(root)]}};
 const saved=appendTimelineRewrite(null,source,'同一个人的融合观点。');
 assert.equal(saved.row.text,'同一个人的融合观点。\n\n'+video(root)+'\n\n'+video(comment));
 assert.equal(appendTimelineRewrite(null,{...root,text:'',videoUrls:[video(root)]},'').row.text,video(root));
});
test('rejects foreign, expired/direct, credentialed, queried, or malformed video links before storing',()=>{
 for(const url of ['https://evil.test/video/1',video(comment),root.url+'/video/5',root.url,video(root)+'?s=20',video(root)+'#x',video(root).replace('https://','https://u:p@'),'https://video.twimg.com/example.mp4']){
  assert.throws(()=>validateTimelinePostingSource({...root,videoUrls:[url]}),/视频链接/);
  assert.throws(()=>validateTimelinePostingSource({...comment,rootPost:{...root,videoUrls:[url]}}),/视频链接/);
 }
 for(const urls of [null,'bad',Array(5).fill(video(root))])assert.throws(()=>validateTimelinePostingSource({...root,videoUrls:urls}));
});
test('textless photo/video root is valid; AI rewrites comment only without inventing image content',async()=>{
 for(const media of [{imageUrls:[photo(1)]},{videoUrls:[video(root)]}]){
  const source=validateTimelinePostingSource({...comment,rootPost:{...root,text:'',...media}});let received;
  const rewritten=await generateTimelineRewrite(source,async (mode,options)=>{received={mode,...JSON.parse(options.body)};return {ok:true,json:async()=>({action:'save_copy',text:'把评论换一种表达。'})};});
  assert.equal(rewritten.text,'把评论换一种表达。');
  assert.equal(received.mode,'/timeline-rewrite');assert.equal(received.rootText,undefined);
  assert.doesNotMatch(JSON.stringify(received),/pbs\.twimg|\/video\//);
 }
});
