import test from 'node:test';
import assert from 'node:assert/strict';
import {appendTimelineRewrite,normalizePostingCopies,parsePostingPackage,postingCopyOperation,timelinePostingAttachmentUrls,validateTimelinePostingSource,validatePostingImage} from '../posting-copy.mjs';
import {fetchTimelineImages} from '../timeline-images.mjs';

const gifUrl='https://video.twimg.com/tweet_video/Anim_01.mp4';
const gifImage='https://pbs.twimg.com/media/Anim_02?format=gif&name=large';
const photo='https://pbs.twimg.com/media/Photo.jpg';
const png='post-images/photo.png';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const box=(type,payload)=>{const header=Buffer.alloc(8);header.writeUInt32BE(8+payload.length);header.write(type,4);return Buffer.concat([header,Buffer.from(payload)]);};
const mp4=Buffer.concat([box('ftyp','isom\0\0\0\0isom'),box('moov','track'),box('mdat','frames')]);
const url=(mime,bytes)=>'data:'+mime+';base64,'+bytes.toString('base64');
const motion=url('video/mp4',mp4),imageGif=url('image/gif',gif);
const root={id:'100',author:'Writer',url:'https://x.com/Writer/status/100',text:''};
const comment={id:'101',author:'Reader',url:'https://x.com/Reader/status/101',text:'评论原文'};

test('pure native GIF is stored byte-for-byte as an enabled motion attachment with no video link',()=>{
 const post={...root,gifUrls:[gifUrl+'?tag=12',gifUrl]};
 const saved=appendTimelineRewrite(null,post,'',undefined,[motion]);
 assert.equal(saved.row.text,'');assert.equal(saved.row.image,motion);assert.equal(saved.row.enabled,true);
 assert.equal(normalizePostingCopies(saved.library).rows[0].image,motion);
 assert.equal(parsePostingPackage([saved.row])[0].image,motion);
 const old=saved.row,edited=postingCopyOperation(saved.library,{action:'upsert',id:old.id,expectedRevision:1,expected:old,row:{...old,enabled:false}});
 assert.deepEqual(edited.rows,[{...old,enabled:false}]);
});
test('comment keeps native original GIF and still photo, with regular video only in text',()=>{
 const post={...comment,rootPost:{...root,gifUrls:[gifUrl]},gifUrls:[gifUrl+'?tag=3'],imageUrls:[photo],videoUrls:[comment.url+'/video/3']};
 const parsed=validateTimelinePostingSource(post);
 assert.deepEqual(timelinePostingAttachmentUrls(parsed),['https://pbs.twimg.com/media/Photo?format=jpg&name=large',gifUrl]);
 const {row}=appendTimelineRewrite(null,post,'换一种表达。',undefined,[png,motion]);
 assert.deepEqual(row.images,[png,motion]);assert.equal(row.text,'换一种表达。\n\n'+comment.url+'/video/3');
 assert.throws(()=>appendTimelineRewrite(null,post,'换一种表达。',undefined,[png]),/未全部读取/);
 assert.throws(()=>appendTimelineRewrite(null,post,'换一种表达。',undefined,[png,png]),/动图格式/);
});
test('animated image/gif is not converted to a static image',()=>{
 const post={...root,imageUrls:['https://pbs.twimg.com/media/Anim_02.gif']};
 assert.deepEqual(timelinePostingAttachmentUrls(validateTimelinePostingSource(post)),[gifImage]);
 assert.equal(appendTimelineRewrite(null,post,'',undefined,[imageGif]).row.image,imageGif);
 assert.throws(()=>appendTimelineRewrite(null,post,'',undefined,[png]),/动图格式/);
 assert.throws(()=>validatePostingImage(url('image/gif',mp4)),/媒体类型/);
 assert.throws(()=>validatePostingImage(url('video/mp4',gif)),/媒体类型/);
});
test('native GIFs share the four attachment limit; non-GIF, foreign and credentialed URLs are rejected',()=>{
 for(const bad of [gifUrl.replace('video.twimg.com','untrusted.example'),gifUrl.replace('://','://u:p@'),gifUrl+'?redirect=x',gifUrl+'#x',gifUrl.replace('/tweet_video/','/ext_tw_video/'),gifUrl.replace('.mp4','.m3u8')]){
  assert.throws(()=>validateTimelinePostingSource({...root,gifUrls:[bad]}),/动图链接/);
 }
 assert.throws(()=>validateTimelinePostingSource({...root,gifUrls:[gifUrl],imageUrls:[1,2,3,4].map(n=>photo.replace('Photo','Photo'+n))}),/合计超过 4/);
});
test('CDN retrieval preserves original GIF and MP4 bytes, omits credentials, and rejects redirects',async()=>{
 const data=await fetchTimelineImages([gifImage,gifUrl],async (source,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
  return source===gifUrl?new Response(mp4,{headers:{'content-type':'video/mp4'}}):new Response(gif,{headers:{'content-type':'image/gif'}});
 },async blob=>{assert.equal(blob.type,'image/gif');return {width:1,height:1,close(){}};});
 assert.deepEqual(data,[imageGif,motion]);
});
test('reject oversized, truncated, or mismatched animated downloads without partial results',async()=>{
 for(const [data,mime,length] of [[mp4.subarray(0,-1),'video/mp4',mp4.length-1],[mp4,'video/mp4',5*1024*1024+1],[gif,'image/gif',gif.length],[gif,'video/mp4',gif.length]]){
  await assert.rejects(fetchTimelineImages([gifUrl],async()=>new Response(data,{headers:{'content-type':mime,'content-length':length}})),/未加入文案库/);
 }
});
