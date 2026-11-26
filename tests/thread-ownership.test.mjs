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

test('observer supplies deduplicated own photo, video and GIF text URLs without stripping source text',async()=>{
 const text='带图正文 https://t.co/Photo1',messages=[];
 const tweet={rest_id:'10',legacy:{conversation_id_str:'10',full_text:text,extended_entities:{media:[
  {type:'photo',url:'https://t.co/Photo1',media_url_https:'https://pbs.twimg.com/media/A.jpg'},
  {type:'photo',url:'https://t.co/Photo1',source_status_id_str:'10'},
  {type:'video',url:'https://t.co/Video2'},
  {type:'animated_gif',url:'https://t.co/Gif3'},
  {type:'photo',url:'https://t.co/Foreign4',source_status_id_str:'99'},
  {type:'other',url:'https://t.co/Unknown5'},
  {type:'photo',url:'https://t.co.evil.test/NotMedia'},
  {type:'photo',url:'https://example.com/not-media'}
 ]}},core:{user_results:{result:{legacy:{screen_name:'Root'}}}}};
 const response={url:'https://x.com/i/api/graphql/hash/TweetDetail',clone:()=>({json:async()=>({tweet})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 assert.equal(await window.fetch('/fixture'),response);await new Promise(r=>setImmediate(r));
 const record=JSON.parse(JSON.stringify(messages[0].records[0]));
 assert.deepEqual(record.mediaTextUrls,['https://t.co/Photo1','https://t.co/Video2','https://t.co/Gif3']);
 assert.equal(record.text,text);
});

test('observer supports legacy media entities but never treats ordinary URL entities as media',async()=>{
 const messages=[],tweets=[
  {rest_id:'10',legacy:{conversation_id_str:'10',full_text:'legacy https://t.co/Photo1',entities:{media:[{type:'photo',url:'https://t.co/Photo1'}]}}},
  {rest_id:'11',legacy:{conversation_id_str:'11',full_text:'link https://t.co/News2',entities:{urls:[{url:'https://t.co/News2'}]}}}
 ].map(tweet=>({...tweet,core:{user_results:{result:{legacy:{screen_name:'Root'}}}}}));
 const response={url:'https://x.com/i/api/graphql/hash/TweetDetail',clone:()=>({json:async()=>({tweets})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 await window.fetch('/fixture');await new Promise(r=>setImmediate(r));
 const records=JSON.parse(JSON.stringify(messages[0].records));
 assert.deepEqual(records[0].mediaTextUrls,['https://t.co/Photo1']);assert.equal(records[1].mediaTextUrls,undefined);
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

test('posting clip evidence binds an exact video index to native MP4 variants from an existing X response',async()=>{
 const src='https://video.twimg.com/amplify_video/456/vid/avc1/720x1280/clip.mp4?tag=29',messages=[];
 const media=[{type:'photo'},{type:'video',video_info:{variants:[
  {content_type:'video/mp4',url:src},{content_type:'video/mp4',url:src},
  {content_type:'application/x-mpegURL',url:'https://video.twimg.com/amplify_video/456/playlist.m3u8'},
  {content_type:'video/mp4',url:src.replace('video.twimg.com','evil.example')},
  {content_type:'video/mp4',url:src+'&token=secret'}
 ]}},{type:'video',source_status_id_str:'99',video_info:{variants:[{content_type:'video/mp4',url:src.replace('clip','foreign')}]}}];
 const tweet={rest_id:'10',legacy:{conversation_id_str:'10',full_text:'source',extended_entities:{media}},core:{user_results:{result:{legacy:{screen_name:'Writer'}}}}};
 const response={url:'https://x.com/i/api/graphql/hash/TweetResultByRestId',clone:()=>({json:async()=>({tweet})})};
 let fetches=0;const window={fetch:async()=>{fetches++;return response;},postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 assert.equal(await window.fetch('/native-request'),response);await new Promise(r=>setImmediate(r));assert.equal(fetches,1);
 const record=JSON.parse(JSON.stringify(messages[0].records[0]));
 assert.deepEqual(record.videoSources,[{url:'https://x.com/Writer/status/10/video/2',urls:[src]}]);
 const context=vm.createContext({URL,location:{pathname:'/home'},document:{querySelector:()=>null,querySelectorAll:()=>[]}});
 vm.runInContext(readFileSync(new URL('../x-dom.js',import.meta.url),'utf8'),context);
 context.XAssistantDOM.ingestThreadRecords([record]);
 assert.deepEqual(Array.from(context.XAssistantDOM.postingVideoSources('https://x.com/writer/status/10/video/2')),[src]);
 assert.deepEqual(Array.from(context.XAssistantDOM.postingVideoSources('https://x.com/writer/status/10/video/1')),[]);
});

async function observedReply(override={},noteText){
 const messages=[],text='@Owner @Friend hello',legacy={conversation_id_str:'100',in_reply_to_status_id_str:'100',full_text:text,
  display_text_range:[15,text.length],entities:{user_mentions:[{screen_name:'Owner',indices:[0,6]},{screen_name:'Friend',indices:[7,14]}]},...override};
 const tweet={rest_id:'123',legacy,core:{user_results:{result:{legacy:{screen_name:'Writer'}}}},...(noteText?{note_tweet:{note_tweet_results:{result:{text:noteText}}}}:{})};
 const response={url:'https://x.com/i/api/graphql/fixture/TweetDetail',clone:()=>({json:async()=>({tweet})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 await window.fetch('/fixture');await new Promise(r=>setImmediate(r));return messages[0].records[0];
}
test('observer proves hidden reply recipients from display range and exact mention entities, preserving raw text',async()=>{
 const r=await observedReply();assert.equal(r.text,'@Owner @Friend hello');assert.equal(r.replyTextPrefix,'@Owner @Friend ');
 const emoji=await observedReply({full_text:'@Owner @Friend 👋 hello',display_text_range:[15,22]});assert.equal(emoji.replyTextPrefix,'@Owner @Friend ');
});
test('observer never removes arbitrary mentions, visible prose, invalid ranges or unproven prefixes',async()=>{
 for(const override of [
  {in_reply_to_status_id_str:null},{display_text_range:undefined},{display_text_range:[0,20]},
  {display_text_range:[15,999]},{display_text_range:[15,14]},{display_text_range:[15.5,20]},
  {entities:{}},{entities:{user_mentions:[{screen_name:'Owner',indices:[0,6]}]}},
  {entities:{user_mentions:[{screen_name:'Other',indices:[0,6]},{screen_name:'Friend',indices:[7,14]}]}},
  {full_text:'I disagree:    hello'},{display_text_range:[14,20]}
 ])assert.equal((await observedReply(override)).replyTextPrefix,undefined,JSON.stringify(override));
});
test('legacy display offsets cannot be applied to a different long-note body',async()=>{
 assert.equal((await observedReply({},'@Owner @Friend long note body')).replyTextPrefix,undefined);
 assert.equal((await observedReply({},'@Owner @Friend hello')).replyTextPrefix,'@Owner @Friend ');
});
