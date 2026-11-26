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
test('comment mixed media is fully identified but cannot be silently reduced or appended',()=>{
 const post={...comment,rootPost:{...root,gifUrls:[gifUrl]},gifUrls:[gifUrl+'?tag=3'],imageUrls:[photo],videoUrls:[comment.url+'/video/3'],videoSources:[{url:comment.url+'/video/3',urls:['https://video.twimg.com/ext_tw_video/123/vid/avc1/clip.mp4']}]};
 const parsed=validateTimelinePostingSource(post);
 assert.deepEqual(timelinePostingAttachmentUrls(parsed),['https://pbs.twimg.com/media/Photo?format=jpg&name=large',gifUrl,'https://video.twimg.com/ext_tw_video/123/vid/avc1/clip.mp4']);
 const library={revision:1,rows:[{id:'old',text:'保留原稿',enabled:true}]},before=structuredClone(library);
 assert.throws(()=>appendTimelineRewrite(library,post,'换一种表达。',undefined,[png,motion,motion]),{code:'POST_MEDIA_COMBINATION'});
 assert.deepEqual(library,before);
 assert.throws(()=>appendTimelineRewrite(null,post,'换一种表达。',undefined,[png]),/未全部读取/);
 assert.throws(()=>appendTimelineRewrite(null,post,'换一种表达。',undefined,[png,png,motion]),/动图格式/);
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

test('ordinary MP4 downloads as exact bytes, with no image decoder and no source link in saved text',async()=>{
 const clip='https://video.twimg.com/amplify_video/123/vid/avc1/720x1280/clip.mp4?tag=12';
 const post={...root,videoUrls:[root.url+'/video/1'],videoSources:[{url:root.url+'/video/1',urls:[clip]}]};
 const urls=timelinePostingAttachmentUrls(validateTimelinePostingSource(post));assert.deepEqual(urls,[clip]);
 const downloaded=await fetchTimelineImages(urls,async(url,opts)=>{assert.equal(url,clip);assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');return new Response(mp4,{headers:{'content-type':'video/mp4'}});},()=>assert.fail('MP4 is not an image'));
 assert.equal(downloaded[0],motion);
 const saved=appendTimelineRewrite(null,post,'',undefined,downloaded);assert.equal(saved.row.image,motion);assert.equal(saved.row.text,'');
 for(const bytes of [mp4.subarray(0,-1),gif])await assert.rejects(fetchTimelineImages(urls,async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})),/未加入文案库/);
 await assert.rejects(fetchTimelineImages(urls,async()=>new Response(mp4,{headers:{'content-type':'video/mp4','content-length':20*1024*1024+1}})),/未加入文案库/);
});
test('MP4 between 5 and 20 MB is accepted while wrong identity or non-CDN file addresses are rejected',async()=>{
 const large=Buffer.concat([box('ftyp','isom0000'),box('moov','track'),box('mdat',Buffer.alloc(5*1024*1024))]);
 const clip='https://video.twimg.com/ext_tw_video/123/vid/avc1/clip.mp4';
 const data=await fetchTimelineImages([clip],async()=>new Response(large,{headers:{'content-type':'video/mp4'}}));
 assert.equal(Buffer.from(data[0].split(',')[1],'base64').length,large.length);
 for(const bad of [{url:comment.url+'/video/1',urls:[clip]},{url:root.url+'/video/1',urls:['https://evil.test/clip.mp4']},{url:root.url+'/video/1',urls:[clip+'#x']}])assert.throws(()=>validateTimelinePostingSource({...root,videoUrls:[root.url+'/video/1'],videoSources:[bad]}),/视频文件来源/);
});
