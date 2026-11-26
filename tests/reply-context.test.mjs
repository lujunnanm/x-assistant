import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {normalizeReplyContext,confirmedReplyHistory} from '../reply-context.mjs';
import {generateReply} from '../ai-client.mjs';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
import {withContext,fixtureImageBase64,fixtureImageResponse} from './reply-test-fixtures.mjs';
const root={id:'1',author:'writer',text:'原帖完整正文',parentId:null};
const first={id:'2',author:'me',text:'上一轮我说的',parentId:'1'};
const target={id:'3',author:'other',text:'That is not what I meant.',parentId:'2'};
const thread=()=>({version:1,root:{...root},history:[{...first}],target:{...target}});
test('branch context keeps root, ordered ancestors and actual target distinct; extra fields are discarded',()=>{
 const input=thread();input.apiKey='secret';input.root.instructions='override';
 assert.deepEqual(normalizeReplyContext(input,target),thread());
 assert.deepEqual(normalizeReplyContext(withContext({id:'1',text:'original'}).context,{id:'1',text:'original'}).history,[]);
});
test('missing roots, siblings, cycles, mismatched bodies and unbounded histories cannot become context',()=>{
 for(const change of [c=>{c.root=null;},c=>{c.target.parentId='1';},c=>{c.history[0].id='3';},c=>{c.target.text='changed';},c=>{c.root.parentId='9';},c=>{c.history=Array(33).fill(first);},c=>{c.root.text='x'.repeat(16001);}]){
  const c=thread();change(c);assert.throws(()=>normalizeReplyContext(c,target),{code:'invalid_input'});
 }
});
test('missing context is rejected before any AI provider request',async()=>{
 let calls=0;await assert.rejects(generateReply({id:'3',text:target.text},()=>{calls++;}),{code:'invalid_input'});assert.equal(calls,0);
});
test('only account-bound confirmed replies on this branch join history, not drafts, unknown sends or siblings',()=>{
 const processed={1:{account:'/me',reply:'verified',replyText:'已确认'},2:{account:'/other',reply:'verified',replyText:'其他账号'},3:{account:'/me',reply:'unknown',replyText:'未确认'},9:{account:'/me',reply:'verified',replyText:'别的分支'}};
 const notifications={1:{status:'confirmed',text:'已确认'},2:{status:'confirmed',text:first.text},3:{status:'in_flight',text:'草稿'}};
 assert.deepEqual(confirmedReplyHistory(thread(),'/me',processed,notifications),[{toPostId:'1',text:'已确认'}]);
 assert.deepEqual(confirmedReplyHistory(thread(),'/me',{1:{reply:'verified',replyText:'legacy'}},{},{1:{status:'confirmed'}}),[{toPostId:'1',text:'legacy'}]);
 assert.deepEqual(confirmedReplyHistory(thread(),'/me',{1:{reply:'verified',replyText:'legacy'}}),[]);
});
test('both modes send structured context as quoted user data, and target language remains authoritative',async()=>{
 for(const url of ['/reply','/notification-reply']){
  let payload;const context=thread(),selfReplies=[{toPostId:'1',text:'上一条已确认回复'}];
  await directGenerate(url,{body:JSON.stringify({text:target.text,context,selfReplies})},{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:p=>'extension://'+p,fetcher:async(u,o)=>{
   if(u.startsWith('extension://'))return {ok:true,text:async()=>readFileSync(new URL('../bridge/'+u.slice('extension://bridge/'.length),import.meta.url),'utf8')};
   payload=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text:'Fair point.'})}}]})};
  }});
  const data=JSON.parse(payload.messages[1].content);
  assert.deepEqual(data,{post_text:target.text,original_post:root,conversation_history:[first],reply_target:target,confirmed_own_replies:selfReplies});
  assert.match(payload.messages[0].content,/严格跟随 reply_target/);
  assert.ok(!payload.messages[0].content.includes(root.text));
 }
});
const prep=readFileSync(new URL('../reply-preparation.js',import.meta.url),'utf8');
function fixture({context=thread(),after=()=>{},account='/me',video=false,videoOnly=false,videoOnRead=false}={}){
 let calls=0,checks=0;const state={context,video,videoOnly},controller=new AbortController();
 class TaskError extends Error{constructor(code,message){super(message);this.code=code;}}
 const cx=vm.createContext({JSON,Error,XAssistantTasks:{TaskError,check:s=>s.throwIfAborted(),waitForPage:async p=>p(),bounded:async fn=>fn()},XAssistantDOM:{account:()=>account,replyHasVideo:()=>state.video,replyVideoOnly:()=>state.videoOnly,replyContext:()=>{if(videoOnRead)state.video=true;return state.context;}},XAssistantWorkspace:{check:()=>checks++},XAssistantRuntime:{call:async msg=>{calls++;assert.equal(msg.post.context.target.id,'3');after(state,controller);return {action:'send_reply',postId:'3',text:'Reply'};}}});
 vm.runInContext(prep,cx);
 return {state,controller,run:module=>cx.XAssistantReplyPreparation.generate({row:target,account:'/me',module,runId:'run',signal:controller.signal}),counts:()=>({calls,checks})};
}
test('each module rereads the conversation on every round, never reuses a last-round prompt',async()=>{
 for(const module of ['interaction','notifications']){const f=fixture();assert.equal((await f.run(module)).sourceText,target.text);f.state.context=thread();f.state.context.root.text='new root';await f.run(module);assert.equal(f.counts().calls,2);}
});
test('unavailable context skips without generating or falling back to greetings',async()=>{
 const f=fixture({context:null});assert.equal((await f.run('interaction')).skipReason,'context_unavailable');assert.equal(f.counts().calls,0);
});
test('interaction still skips video while notifications use readable comment text',async()=>{
 for(const options of [{video:true},{videoOnRead:true}]){
  const interaction=fixture(options);assert.equal((await interaction.run('interaction')).skipReason,'video_post');assert.equal(interaction.counts().calls,0);
  const notification=fixture(options);assert.equal((await notification.run('notifications')).action,'send_reply');assert.equal(notification.counts().calls,1);
 }
 const only=fixture({video:true,videoOnly:true});assert.equal((await only.run('notifications')).skipReason,'video_post');assert.equal(only.counts().calls,0);
});
test('late video blocks interaction and video-only notifications but not readable notification text',async()=>{
 const interaction=fixture({after:s=>{s.video=true;}});assert.equal((await interaction.run('interaction')).skipReason,'video_post');
 const readable=fixture({after:s=>{s.video=true;}});assert.equal((await readable.run('notifications')).action,'send_reply');
 const only=fixture({after:s=>{s.video=true;s.videoOnly=true;}});assert.equal((await only.run('notifications')).skipReason,'video_post');
 for(const f of [interaction,readable,only])assert.equal(f.counts().calls,1);
});
test('edited ancestors, changed target, account changes and cancellation cannot submit stale output',async()=>{
 for(const after of [s=>{s.context.root.text='edited';},s=>{s.context.target.text='edited';},(_s,c)=>c.abort()]){
  const f=fixture({after});await assert.rejects(f.run('notifications'));assert.equal(f.counts().calls,1);
 }
 const wrong=fixture({account:'/someone'});await assert.rejects(wrong.run('interaction'),{code:'ACCOUNT_CHANGED'});assert.equal(wrong.counts().calls,0);
});

test('normalization keeps owned branch images and canonicalizes only native X photo URLs',()=>{
 const c=thread();c.root.imageUrls=['https://pbs.twimg.com/media/Root.jpg'];c.history[0].imageUrls=['https://pbs.twimg.com/media/History?format=png&name=small'];c.target.imageUrls=['https://pbs.twimg.com/media/Target.webp','https://pbs.twimg.com/media/Target.webp'];
 const clean=normalizeReplyContext(c,target);
 assert.deepEqual(clean.root.imageUrls,['https://pbs.twimg.com/media/Root?format=jpg&name=large']);
 assert.deepEqual(clean.history[0].imageUrls,['https://pbs.twimg.com/media/History?format=png&name=large']);
 assert.deepEqual(clean.target.imageUrls,['https://pbs.twimg.com/media/Target?format=webp&name=large']);
 assert.deepEqual(normalizeReplyContext(clean,target),clean);
});
test('image-only targets and unavailable-video ancestors keep bounded explicit context',async()=>{
 const picture=thread();picture.target.text='';picture.target.imageUrls=['https://pbs.twimg.com/media/Only.jpg'];
 const post={id:target.id,text:'',context:picture};let body;
 const result=await generateReply(post,async(_url,options)=>{body=JSON.parse(options.body);return{ok:true,json:async()=>({action:'send_reply',text:'这张图也太离谱了。'})};},true);
 assert.equal(result.action,'send_reply');assert.equal(body.text,'');assert.deepEqual(body.context.target.imageUrls,['https://pbs.twimg.com/media/Only?format=jpg&name=large']);
 const video=thread();video.root.text='';video.root.videoUnavailable=true;
 assert.deepEqual(normalizeReplyContext(video,target).root,{id:'1',author:'writer',text:'',parentId:null,videoUnavailable:true});
 const empty=thread();empty.target.text='';assert.throws(()=>normalizeReplyContext(empty,{...target,text:''}),{code:'invalid_input'});
});
test('malformed or foreign image attachments never silently degrade to text-only context',()=>{
 for(const images of ['not-array',Array(5).fill('https://pbs.twimg.com/media/A.jpg'),[null],['https://evil.test/media/A.jpg'],['https://pbs.twimg.com.evil.test/media/A.jpg'],['https://pbs.twimg.com/profile_images/A.jpg'],['https://pbs.twimg.com/media/A.jpg#fragment'],['https://name@pbs.twimg.com/media/A.jpg'],['data:image/png;base64,AAAA'],['https://video.twimg.com/tweet_video/A.mp4']]){
  const c=thread();c.root.imageUrls=images;assert.throws(()=>normalizeReplyContext(c,target),{code:'invalid_input'});
 }
});
test('both reply routes send root, ancestor and target images as attributed user image blocks',async()=>{
 for(const notification of [false,true]){
  const context=thread();for(const [row,name] of [[context.root,'Root'],[context.history[0],'History'],[context.target,'Target']])row.imageUrls=[`https://pbs.twimg.com/media/${name}.jpg`];
  let payload,requests=0;
  const result=await generateReply({id:target.id,text:target.text,context},(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:p=>'extension://'+p,fetcher:async(u,o)=>{
   if(u.startsWith('extension://'))return{ok:true,text:async()=>'fixture JSON rules'};
   if(u.startsWith('https://pbs.twimg.com/'))return fixtureImageResponse();
   requests++;payload=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"send_reply","text":"看着就饿了。"}'}}]})};
  }}),notification);
  assert.equal(requests,1);assert.equal(result.text,'看着就饿了。');
  const parts=payload.messages[1].content;assert.ok(Array.isArray(parts));assert.equal(parts.length,7);
  assert.deepEqual(JSON.parse(parts[0].text).original_post.imageUrls,['https://pbs.twimg.com/media/Root?format=jpg&name=large']);
  for(const [i,id] of ['1','2','3'].entries()){
   assert.deepEqual(JSON.parse(parts[1+i*2].text),{image_of_post:id,image_index:1});
   assert.deepEqual(parts[2+i*2],{type:'image_url',image_url:{url:'data:image/png;base64,'+fixtureImageBase64,detail:'auto'}});
  }
  assert.equal(typeof payload.messages[0].content,'string');assert.equal(payload.model,'deepseek-flash');
 }
});
test('replying to an original post sends its photo once, not twice for root and target',async()=>{
 const post=withContext({id:'1',text:'兄弟们这算A8早餐吗，打几分？'});post.context.root.imageUrls=['https://pbs.twimg.com/media/Breakfast.jpg'];post.context.target.imageUrls=[...post.context.root.imageUrls];
 let payload;await generateReply(post,(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:p=>'extension://'+p,fetcher:async(u,o)=>{
  if(u.startsWith('extension://'))return{ok:true,text:async()=>'fixture rules'};
  if(u.startsWith('https://pbs.twimg.com/'))return fixtureImageResponse();
  payload=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"skip","text":""}'}}]})};
 }}));
 assert.ok(Array.isArray(payload.messages[1].content));assert.equal(payload.messages[1].content.filter(p=>p.type==='image_url').length,1);
 assert.match(payload.messages[1].content[0].text,/A8早餐/);
});
test('image replies get 90 seconds on both routes; text replies keep the 25-second limit',async t=>{
 const timeouts=[];t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return new AbortController().signal;});
 for(const notification of [false,true])for(const images of [false,true]){
  const context=thread();if(images)context.root.imageUrls=['https://pbs.twimg.com/media/Root.jpg'];
  await generateReply({id:target.id,text:target.text,context},async()=>({ok:true,json:async()=>({action:'skip'})}),notification);
 }
 assert.deepEqual(timeouts,[25000,90000,25000,90000]);
});
test('photo changes during generation invalidate the draft on either route',async()=>{
 for(const module of ['interaction','notifications']){
  const c=thread();c.root.imageUrls=['https://pbs.twimg.com/media/Before.jpg'];
  const f=fixture({context:c,after:s=>{s.context.root.imageUrls=['https://pbs.twimg.com/media/After.jpg'];}});
  await assert.rejects(f.run(module),{code:'TARGET_UPDATED'});assert.equal(f.counts().calls,1);
 }
});
test('a failed vision request is not retried as a blind text-only reply',async()=>{
 const c=thread();c.root.imageUrls=['https://pbs.twimg.com/media/Unavailable.jpg'];let requests=0;
 await assert.rejects(generateReply({id:target.id,text:target.text,context:c},(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:p=>'extension://'+p,fetcher:async(u,o)=>{
  if(u.startsWith('extension://'))return{ok:true,text:async()=>'fixture rules'};
  if(u.startsWith('https://pbs.twimg.com/'))return fixtureImageResponse();
  requests++;assert.ok(Array.isArray(JSON.parse(o.body).messages[1].content));return{ok:false,status:400};
 }})),{code:'http',status:400});assert.equal(requests,1);
});

test('a vision reply arriving at 60 seconds survives the old 25-second cutoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('timeout','TimeoutError')),ms);return controller.signal;});
 const pending=[];let completed=0;
 for(const notification of [false,true]){
  const c=thread();c.root.imageUrls=['https://pbs.twimg.com/media/Breakfast.jpg'];
  pending.push(generateReply({id:target.id,text:target.text,context:c},(_url,options)=>new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
   setTimeout(()=>resolve({ok:true,json:async()=>({action:'send_reply',text:'看着就饿了。'})}),60000);
  }),notification).then(value=>{completed++;return value;}));
 }
 t.mock.timers.tick(25001);await Promise.resolve();assert.equal(completed,0);
 t.mock.timers.tick(34999);
 for(const result of await Promise.all(pending))assert.equal(result.text,'看着就饿了。');
 assert.equal(completed,2);
});
test('vision requests still terminate at 90 seconds rather than waiting indefinitely',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('timeout','TimeoutError')),ms);return controller.signal;});
 const c=thread();c.root.imageUrls=['https://pbs.twimg.com/media/Breakfast.jpg'];
 const pending=generateReply({id:target.id,text:target.text,context:c},(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
 const rejected=assert.rejects(pending,{code:'network'});t.mock.timers.tick(90000);await rejected;
});
