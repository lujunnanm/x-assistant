import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const scripts=['task-utils.js','reply-preparation.js'].map(name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
function fixture({images=true,generation=4000,mutate,action='send_reply',video=false}={}){
 let now=1000,account='/me';const events=[],controller=new AbortController();
 const target={id:'1',author:'writer',text:'早餐打几分？',parentId:null,...(images?{imageUrls:['https://pbs.twimg.com/media/A.jpg']}:{})};
 const context={version:1,root:target,history:[],target};
 const state={context,video};class Clock extends Date{static now(){return now;}}
 const cx=vm.createContext({Date:Clock,Error,DOMException,setTimeout,clearTimeout,
  XAssistantDOM:{account:()=>account,replyHasVideo:()=>state.video,replyContext:()=>state.context},
  XAssistantWorkspace:{check(){},progress:message=>events.push(['progress',now,message])},
  XAssistantRuntime:{check:()=>controller.signal.throwIfAborted(),sleep:async ms=>{events.push(['sleep',now,ms]);now+=ms;mutate?.({state,controller,setAccount:value=>account=value});},call:async msg=>{events.push(['generate',now,msg.kind]);now+=generation;return{action,postId:'1',text:action==='skip'?'':'看着就饿了。'};}}
 });scripts.forEach(s=>vm.runInContext(s,cx));
 return {state,events,now:()=>now,run:(module='interaction')=>cx.XAssistantReplyPreparation.generate({row:target,account:'/me',module,runId:'r',signal:controller.signal,notBefore:31000})};
}
test('both image reply routes generate during cooldown and return only when the send time arrives',async()=>{
 for(const module of ['interaction','notifications']){
  const f=fixture();const result=await f.run(module);
  assert.equal(f.events.find(e=>e[0]==='generate')[1],1000);assert.equal(f.now(),31000);assert.equal(result.action,'send_reply');
 }
});
test('slow vision already consumes the remaining cooldown without adding another full delay',async()=>{
 const f=fixture({generation:45000});await f.run();assert.equal(f.now(),46000);assert.equal(f.events.filter(e=>e[0]==='sleep').length,0);
});
test('text-only replies keep generation after the original cooldown',async()=>{
 for(const module of ['interaction','notifications']){
  const f=fixture({images:false});await f.run(module);assert.equal(f.events.find(e=>e[0]==='generate')[1],31000);assert.equal(f.now(),35000);
 }
});
test('a skipped image response still consumes the remaining cooldown instead of starting a speculative batch',async()=>{
 const f=fixture({action:'skip'});assert.equal((await f.run()).action,'skip');assert.equal(f.now(),31000);assert.equal(f.events.filter(e=>e[0]==='generate').length,1);
});
test('stop, account changes and edits invalidate a prepared image reply while waiting',async()=>{
 for(const mutate of [({controller})=>controller.abort(),({setAccount})=>setAccount('/other'),({state})=>{state.context.root.text='edited';}]){
  const f=fixture({mutate});await assert.rejects(f.run());assert.equal(f.events.filter(e=>e[0]==='generate').length,1);
 }
});
test('late video discovery ends a cooldown wait immediately without a second model request',async()=>{
 const f=fixture({mutate:({state})=>{state.video=true;}});assert.equal((await f.run()).skipReason,'video_post');assert.ok(f.now()<31000);assert.equal(f.events.filter(e=>e[0]==='generate').length,1);
 const known=fixture({video:true});assert.equal((await known.run()).skipReason,'video_post');assert.equal(known.events.filter(e=>['generate','sleep'].includes(e[0])).length,0);
});
test('prepared context can be checked again after cooldown and before editor or submit actions',async()=>{
 const f=fixture();const result=await f.run();assert.equal(typeof result.validatePrepared,'function');assert.doesNotThrow(()=>result.validatePrepared());
 f.state.context.root.imageUrls=['https://pbs.twimg.com/media/Changed.jpg'];assert.throws(()=>result.validatePrepared(),{code:'TARGET_UPDATED'});
});

test('interaction ends after three own replies in a branch; 灯神 2 回帖 has no cap and lets the model decide',async()=>{
 const chain=(turns)=>{
  const root={id:'1',author:'me',text:'我的帖子',parentId:null},rows=[];let parent='1';
  for(let i=0;i<turns;i++){
   for(const author of ['fan','me']){const id=String(10+rows.length);rows.push({id,author,text:author==='me'?'回'+i:'评'+i,parentId:parent});parent=id;}
  }
  const target={id:'99',author:'fan',text:'哈哈好的',parentId:parent};
  return {version:1,root,history:rows,target};
 };
 const ended=fixture({images:false});ended.state.context=chain(3);
 const result=await ended.run('interaction');
 assert.equal(result.action,'skip');assert.equal(result.skipReason,'conversation_ended');
 assert.equal(ended.events.some(e=>e[0]==='generate'),false); // The model is not called.
 const ongoing=fixture({images:false});ongoing.state.context=chain(2);
 assert.equal((await ongoing.run('interaction')).action,'send_reply'); // The third reply is still allowed.
 for(const turns of [3,8]){
  const long=fixture({images:false});long.state.context=chain(turns);
  assert.equal((await long.run('notifications')).action,'send_reply','回帖 still asks the model after '+turns+' own replies');
  assert.equal(long.events.some(e=>e[0]==='generate'),true);
 }
});
