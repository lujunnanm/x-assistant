import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('observer forwards parsed thread identity and text without changing the response',async()=>{
 const messages=[],response={url:'https://x.com/i/api/graphql/hash/HomeTimeline',clone:()=>({json:async()=>({tweet:{rest_id:'12',legacy:{conversation_id_str:'10',in_reply_to_status_id_str:'10',full_text:'评论正文'},core:{user_results:{result:{legacy:{screen_name:'Friend'}}}}}})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 assert.equal(await window.fetch('/timeline'),response);
 await new Promise(r=>setImmediate(r));
 assert.equal(messages[0].records[0].root,'10');
 assert.equal(messages[0].records[0].parent,'10');
 assert.equal(messages[0].records[0].author,'Friend');
 assert.equal(messages[0].records[0].text,'评论正文');
});

test('observer binds native root media without quoted media, video thumbnails or expiring CDN video URLs',async()=>{
 const messages=[],tweet={rest_id:'10',legacy:{conversation_id_str:'10',full_text:'原帖',extended_entities:{media:[
  {type:'photo',media_url_https:'https://pbs.twimg.com/media/A.jpg'},
  {type:'video',media_url_https:'https://pbs.twimg.com/ext_tw_video_thumb/B.jpg',video_info:{variants:[{url:'https://video.twimg.com/expiring.mp4'}]}},
  {type:'photo',source_status_id_str:'99',media_url_https:'https://pbs.twimg.com/media/Foreign.jpg'},
  {type:'animated_gif',video_info:{variants:[{content_type:'video/mp4',url:'https://video.twimg.com/tweet_video/Own.gif.mp4'},{content_type:'video/mp4',url:'https://video.twimg.com/tweet_video/Own_1.mp4?tag=12'}]}},
  {type:'animated_gif',source_status_id_str:'99',video_info:{variants:[{content_type:'video/mp4',url:'https://video.twimg.com/tweet_video/Foreign.mp4'}]}}
 ]}},core:{user_results:{result:{legacy:{screen_name:'Root'}}}}};
 const response={url:'https://x.com/i/api/graphql/hash/TweetDetail',clone:()=>({json:async()=>({tweet})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 await window.fetch('/fixture');await new Promise(r=>setImmediate(r));
 const record=JSON.parse(JSON.stringify(messages[0].records[0]));
 assert.deepEqual(record.imageUrls,['https://pbs.twimg.com/media/A.jpg']);
 assert.deepEqual(record.videoUrls,['https://x.com/Root/status/10/video/2']);
 assert.deepEqual(record.gifUrls,['https://video.twimg.com/tweet_video/Own_1.mp4?tag=12']);
 assert.equal(record.missingGif,undefined);
 assert.doesNotMatch(JSON.stringify(record),/Foreign|thumb|expiring/);
});
