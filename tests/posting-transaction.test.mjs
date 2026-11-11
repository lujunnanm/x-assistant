import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../posting.js',import.meta.url),'utf8');
const actionSource=readFileSync(new URL('../action-client.js',import.meta.url),'utf8');
const tasksSource=readFileSync(new URL('../task-utils.js',import.meta.url),'utf8');
const uploadSource=source.slice(source.indexOf(' const attachmentSelector='),source.indexOf(' async function removeOwnedImage('));
const publishSource=source.slice(source.indexOf(' const postingFailure='),source.indexOf(' const renderRemote='));
const stopSource=source.slice(source.indexOf(' async function stopLoop('),source.indexOf(' async function countdown('));

function fixture({onReserve,onClick,onSleep,onReceipt,guard,receipt={kind:'confirmed'},image=false,images,text='expected',uploadedCount,localizedMedia=false,uploadPending=false,startAt=1000,actionAcquire,ackFailure=false,initial={},accept='image/*'}={}) {
  const state={account:'/owner',text:'',attachment:null,buttonCount:1,editorCount:1,context:false,
    clicks:0,closed:0,route:'/home',modal:false,buttonLabel:'发帖',foreign:false,phase:'waiting',phases:[],events:[],active:true,now:startAt,polls:0,...initial};
  class Clock extends Date{static now(){return state.now;}}
  const controller=new AbortController();
  const editor={isConnected:true,closest:()=>state.foreign?{}:null,get innerText(){return state.text;},scrollIntoView(){},focus(){},
    dispatchEvent(event){if(event.clipboardData)state.text=event.clipboardData.text;}};
  const button={isConnected:true,disabled:false,closest:()=>null,get innerText(){return state.buttonLabel;},getAttribute:()=>null,click(){state.clicks++;state.events.push('click');onClick?.({state,controller});}};
  const input={isConnected:true,accept,multiple:true,files:[],dispatchEvent(event){
    if(event.type!=='change')return;
    state.uploaded=this.files.map(file=>'post-images/'+file.name);
    state.uploadedTypes=this.files.map(file=>file.type);
    state.attachment={isConnected:true,querySelectorAll:s=>s==='[role="progressbar"]'&&state.uploadPending?[{}]:[]};
    state.uploadPending=uploadPending;
    state.preview=Array.from({length:uploadedCount??this.files.length},()=>({
      getAttribute:k=>k==='data-testid'&&!localizedMedia?'mediaRemoveButton':k==='aria-label'&&localizedMedia?'移除媒体':null
    }));
    this.files=[];
  }};
  const dialog={isConnected:true,contains:node=>node===editor||node===button||node===input,
    querySelector:selector=>selector.includes('tweetText')?(state.context?{}:null):selector.includes('attachments')?state.attachment:null,
    querySelectorAll:selector=>selector.includes('contenteditable')?Array(state.editorCount).fill(editor):selector.includes('tweetButton')?Array(state.buttonCount).fill(button):selector==='input[type="file"]'?Array(state.fileCount??1).fill(input):selector.includes('mediaRemoveButton')?(state.preview||[]).filter(n=>n.getAttribute('aria-label')!=='移除媒体'||selector.includes('aria-label="移除媒体"')):[]};
  editor.parentElement=dialog;
  const primary={isConnected:true,closest:()=>null,contains:n=>n===dialog,
    querySelectorAll:selector=>selector.includes('tweetTextarea_0')?Array(state.editorCount).fill(editor):selector.includes('tweetButtonInline')?Array(state.buttonCount).fill(button):[]};
  class Transfer {files=[];items={add:file=>this.files.push(file)};setData(_type,text){this.text=text;}}
  const context=vm.createContext({Date:Clock,Error,DOMException,DataTransfer:Transfer,
    XAssistantRuntime:{check:signal=>{if(signal?.aborted)throw new DOMException('stopped','AbortError');guard?.(state);},call:async message=>{if(message.kind==='ACTION_ACQUIRE')return actionAcquire?.(state)??{granted:true,leaseId:'lease',expiresAt:state.now+10000};state.actionSettles??=[];state.actionSettles.push(message);if(ackFailure&&message.outcome==='attempted')throw Error('ACK lost');return {};},sleep:async ms=>{state.now+=ms;onSleep?.(state);}},
    XAssistantWorkspace:{beginComposer:()=>()=>{},canCleanComposer:()=>true,check:()=>guard?.(state)},
    ClipboardEvent:class{constructor(_type,data){Object.assign(this,data);}},MutationObserver:class{},setTimeout,clearTimeout,setInterval,clearInterval,
    Event,File:class{constructor(_data,name,{type}){this.name=name;this.type=type;}},chrome:{runtime:{getURL:x=>x}},
    fetch:async path=>({ok:true,blob:async()=>({type:path.match(/^data:([^;]+);/)?.[1]||'image/png',size:10})}),
    createImageBitmap:async()=>({width:100,height:100,close(){}}),
    location:{origin:'https://x.com',get pathname(){return state.route;}},
    document:{hidden:true,querySelectorAll:s=>s.includes('primaryColumn')?[primary]:[],querySelector:s=>s.includes('AppTabBar_Profile_Link')?({getAttribute:()=>state.account}):state.modal?{}:null},
    core:{editorText:element=>element?.innerText||''},
    check:signal=>{if(signal.aborted)throw new DOMException('stopped','AbortError');guard?.(state);},
    patch:async patch=>{
      if(!state.active)throw Error('inactive runtime');
      state.phase=patch.phase;state.phases.push(patch.phase);state.events.push('patch:'+patch.phase);
      if(patch.phase==='submitting')await onReserve?.({state,editor,button,dialog,controller});
    },
    wait:async(fn,_signal,label)=>{const value=fn();if(!value)throw Error(label+'超时');return value;},
    sleep:async ms=>{state.now+=ms;onSleep?.(state);},show:()=>{},progress:()=>{},visible:()=>true,
    removeOwnedImage:async()=>false,
    read:async()=>({active:state.active,account:'/owner',runId:'run',completed:0}),clickNative:element=>element.click(),
    XAssistantPostingReceipt:{create:()=>{onReceipt?.(state);return {poll:()=>{state.polls++;return typeof receipt==='function'?receipt(state):receipt;},close(){state.closed++;}};}},
    control:controller,runId:'run',preSubmitTask:null,timer:null,start:{},stop:{},runPromise:Promise.resolve(),
    api:{runtime:async(_module,action)=>{if(action==='stop'){state.events.push('stop');state.active=false;}}},
  });
  vm.runInContext(tasksSource,context);
  const waitForPage=context.XAssistantTasks.waitForPage;
  context.XAssistantTasks={...context.XAssistantTasks,waitForPage:(fn,options)=>options.timeout===30000?Promise.resolve(fn()||null):waitForPage(fn,options)};
  vm.runInContext(actionSource,context);
  vm.runInContext(uploadSource+publishSource+stopSource+';globalThis.send=publish;globalThis.stopNow=stopLoop;',context);
  const send=()=>{
    const promise=context.send({id:'post_1',text,...(images?{images}:image?{image:'post-images/test.jpg'}:{})},controller.signal,'run');
    context.runPromise=promise.catch(()=>{});
    return promise;
  };
  return {state,send,probe:()=>context.XAssistantPostingProbe.inspect('/owner'),stop:()=>context.stopNow()};
}

test('original post observes and confirms one submission with unchanged composer',async()=>{
  const f=fixture();await f.send();
  assert.equal(f.state.clicks,1);assert.equal(f.state.closed,1);
  assert.deepEqual(f.state.phases,['opening','filling','submitting','confirmed']);
});

test('account or text change during reservation cannot send and clears false submitting state',async()=>{
  for(const mutate of [({state})=>state.account='/other',({state})=>state.text='unexpected']) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),error=>/提交前/.test(error.message)&&error.submitted===false);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('detached or ambiguous editor and changed original-post context block final click',async()=>{
  for(const mutate of [({dialog})=>dialog.isConnected=false,({editor})=>editor.isConnected=false,
    ({state})=>state.editorCount=2,({state})=>state.context=true]) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),error=>error.submitted===false);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('unexpected attachment, removed image and replaced image are not submitted',async()=>{
  for(const [image,mutate] of [[false,({state})=>state.attachment={}],[true,({state})=>state.attachment=null],
    [true,({state})=>state.attachment={replacement:true}]]) {
    const f=fixture({image,onReserve:mutate});
    await assert.rejects(f.send(),/配图发生变化/);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});
test('photo-only and multiple images are bound to a single transaction; partial media cannot submit',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 const f=fixture({images,text:''});await f.send();assert.equal(f.state.text,'');assert.deepEqual(f.state.uploaded,images);assert.equal(f.state.clicks,1);
 const partial=fixture({images,uploadedCount:1});await assert.rejects(partial.send(),/配图.*超时/);assert.equal(partial.state.clicks,0);
});
test('animated attachments use the matching native upload type and still require a ready preview',async()=>{
 for(const [data,type,ext] of [['data:video/mp4;base64,AAAA','video/mp4','mp4'],['data:image/gif;base64,AAAA','image/gif','gif']]){
  const f=fixture({images:[data],text:'',accept:'image/jpeg, '+type});await f.send();
  assert.deepEqual(f.state.uploaded,['post-images/post-image-1.'+ext]);assert.deepEqual(f.state.uploadedTypes,[type]);assert.equal(f.state.clicks,1);
  const rejected=fixture({images:[data],accept:'image/jpeg'});await assert.rejects(rejected.send(),/上传入口/);assert.equal(rejected.state.clicks,0);
  const pending=fixture({images:[data],accept:type,uploadPending:true});await assert.rejects(pending.send(),/就绪超时/);assert.equal(pending.state.clicks,0);
 }
});

test('two Chinese X remove buttons without test IDs count as attached media',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 const f=fixture({images,localizedMedia:true});await f.send();
 assert.deepEqual(f.state.uploaded,images);assert.equal(f.state.clicks,1);
});

test('visible upload progress, partial and excess Chinese media all stop before reservation',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 for(const options of [{uploadPending:true},{uploadedCount:1},{uploadedCount:3}]){
  const f=fixture({images,localizedMedia:true,...options});
  await assert.rejects(f.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.message.includes('未点击发送')&&!error.submitted);
  assert.equal(f.state.clicks,0);assert.ok(!f.state.phases.includes('submitting'));assert.ok(f.state.attachment);
 }
});

test('upload progress returning after reservation blocks the final click',async()=>{
 const f=fixture({image:true,localizedMedia:true,onReserve:({state})=>{state.uploadPending=true;}});
 await assert.rejects(f.send(),error=>/提交前配图发生变化/.test(error.message)&&!error.submitted);
 assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});

test('disabled, detached, missing or duplicate final submit button never clicks',async()=>{
  for(const mutate of [({button})=>button.disabled=true,({button})=>button.isConnected=false,
    ({state})=>state.buttonCount=0,({state})=>state.buttonCount=2]) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),/发帖按钮已变化/);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('aborting after reservation but before click restores waiting, not unknown',async()=>{
  const f=fixture({onReserve:({controller})=>controller.abort()});
  await assert.rejects(f.send(),error=>error.name==='AbortError'&&error.submitted===false);
  assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});

test('reservation persistence error is safely reset before any public action',async()=>{
  const f=fixture({onReserve:()=>{throw Error('response lost after reservation');}});
  await assert.rejects(f.send(),/response lost/);
  assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});

test('unknown receipt after click keeps submitting evidence and never retries',async()=>{
  const f=fixture({receipt:null});
  await assert.rejects(f.send(),error=>error.submitted===true);
  assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'submitting');assert.equal(f.state.closed,1);
});

test('stop during reservation waits for proven-unsent reset before stopping runtime',async()=>{
  let release,entered;
  const reserved=new Promise(resolve=>entered=resolve);
  const f=fixture({onReserve:()=>{entered();return new Promise(resolve=>release=resolve);}});
  const sending=f.send();await reserved;
  const stopping=f.stop();
  assert.equal(f.state.active,true);
  release();
  await assert.rejects(sending,error=>error.name==='AbortError');await stopping;
  assert.equal(f.state.clicks,0);
  assert.equal(f.state.phase,'waiting');
  assert.deepEqual(f.state.events.slice(-2),['patch:waiting','stop']);
});

test('stop after public click drains a delayed receipt before stopping this runtime',async()=>{
 let reached;
 const f=fixture({onClick:({state,controller})=>{controller.abort();reached=state.now;},receipt:state=>state.now-reached>=300?{kind:'confirmed'}:null});
 const send=f.send();await send;await f.stop();
 assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');assert.equal(f.state.closed,1);
 assert.deepEqual(f.state.events.slice(-2),['patch:confirmed','stop']);
});
test('stopped posting with no receipt keeps uncertainty and bounds readback to fifteen seconds',async()=>{
 let clickedAt;
 const f=fixture({onClick:({state,controller})=>{controller.abort();clickedAt=state.now;},receipt:null});
 await assert.rejects(f.send(),error=>error.code==='SEND_UNKNOWN'&&error.submitted&&!error.confirmed);
 assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'submitting');assert.equal(f.state.closed,1);
 assert.equal(f.state.now-clickedAt,15000);
});
test('Beijing midnight before the final click prevents submission and clears false reservation',async()=>{
 const midnight=Date.parse('2026-11-05T00:00:00+08:00');
 const f=fixture({startAt:midnight-10000,guard:state=>{if(state.now>=midnight)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},onReserve:({state})=>{state.now=midnight;}});
 await assert.rejects(f.send(),error=>error.code==='OUTSIDE_WINDOW'&&!error.submitted);
 assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});
test('Beijing midnight after the click cannot erase a subsequent successful receipt',async()=>{
 const midnight=Date.parse('2026-11-05T00:00:00+08:00');
 const f=fixture({startAt:midnight-10000,guard:state=>{if(state.now>=midnight)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},onClick:({state,controller})=>{state.now=midnight;controller.abort();},receipt:state=>state.now>=midnight+200?{kind:'confirmed'}:null});
 await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');assert.equal(f.state.closed,1);
});
test('posting observer setup crossing midnight is guarded again at the click edge',async()=>{
 const midnight=Date.parse('2026-11-05T00:00:00+08:00');
 const f=fixture({startAt:midnight-10000,guard:state=>{if(state.now>=midnight)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},onReceipt:state=>{state.now=midnight;}});
 await assert.rejects(f.send(),error=>error.code==='OUTSIDE_WINDOW'&&!error.submitted);
 assert.equal(f.state.clicks,0);assert.equal(f.state.closed,1);assert.equal(f.state.phase,'waiting');
});

test('posting waits for pacing before persisting submitting or observing a receipt',async()=>{
 let calls=0;
 const f=fixture({actionAcquire:state=>{calls++;assert.equal(state.phases.includes('submitting'),false);assert.equal(state.closed,0);return calls===1?{granted:false,retryAt:state.now+23000}:{granted:true,leaseId:'post-lease',expiresAt:state.now+10000};}});
 await f.send();assert.equal(calls,2);assert.equal(f.state.clicks,1);
});
test('lost action ACK still permits confirmed original-post receipt without replay',async()=>{
 const f=fixture({ackFailure:true});await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');
});
test('lost action ACK with no post receipt retains unknown evidence and never re-clicks',async()=>{
 const f=fixture({ackFailure:true,receipt:null});await assert.rejects(f.send(),error=>error.code==='SEND_UNKNOWN'&&error.submitted===true);assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'submitting');
});

test('read-only original probe in a hidden home works with no role=dialog, never opens a launcher, fills or sends',async()=>{
 const f=fixture();assert.deepEqual({...f.probe()},{route:'/home',reason:'ready',editors:1,buttons:1,files:1,hasDraft:false,hasMedia:false});
 assert.equal(f.state.text,'');assert.equal(f.state.clicks,0);await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');
});
test('reply editor, status route, draft, attachment or existing dialog cannot be reused as an original composer',async()=>{
 for(const initial of [{route:'/user/status/99'},{route:'/compose/post'},{fileCount:0},{fileCount:2},{buttonLabel:'回复'},{modal:true},{foreign:true},{text:'用户自己的文字'},{attachment:{user:true}}]){
  const f=fixture({initial});await assert.rejects(f.send(),e=>e.submitted===false);assert.equal(f.state.clicks,0);assert.equal(f.state.text,initial.text||'');assert.equal(f.state.attachment,initial.attachment||null);
 }
});
test('route change, unrelated dialog or reply label appearing during action reservation makes an original post fail closed',async()=>{
 for(const mutate of [s=>s.route='/owner/status/123',s=>s.modal=true,s=>s.buttonLabel='Reply']){
  const f=fixture({onReserve:({state})=>mutate(state)});await assert.rejects(f.send(),e=>e.submitted===false);assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
 }
});

test('changing the preview inside the same media wrapper before clicking is not a verified upload',async()=>{
 const f=fixture({image:true,onReserve:({state})=>state.preview=[{getAttribute:k=>k==='src'?'blob:unexpected':'mediaPreview'}]});
 await assert.rejects(f.send(),e=>/配图发生变化/.test(e.message)&&!e.submitted);assert.equal(f.state.clicks,0);
});
