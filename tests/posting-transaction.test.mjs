import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../posting.js',import.meta.url),'utf8');
const actionSource=readFileSync(new URL('../action-client.js',import.meta.url),'utf8');
const tasksSource=readFileSync(new URL('../task-utils.js',import.meta.url),'utf8');
const waitSource=source.slice(source.indexOf(' const wait='),source.indexOf(' const clickNative='));
const uploadSource=source.slice(source.indexOf(' const attachmentSelector='),source.indexOf(' const waitAccount='));
const publishSource=source.slice(source.indexOf(' const postingFailure='),source.indexOf(' const renderRemote='));
const stopSource=source.slice(source.indexOf(' async function stopLoop('),source.indexOf(' async function countdown('));
const emitSource=source.slice(source.indexOf(' const emitState='),source.indexOf(' async function launch('));

const videoLink='https://x.com/Writer/status/123/video/1',videoSrc='https://video.twimg.com/ext_tw_video/456/vid/avc1/720x1280/clip.mp4?tag=12';
function fixture({allowCleanup=false,onReserve,onClick,onSleep,onReceipt,guard,receipt={kind:'confirmed'},image=false,images,text='expected',uploadedCount,localizedMedia=false,uploadPending=false,externalProgress=false,imagePreview=true,videoPresent=true,startAt=1000,actionAcquire,ackFailure=false,settlementAckFailure=false,initial={},accept='image/*',embeddedVideo=false,videoSource=videoSrc,videoMetadata=true,videoReady=4,videoError=null,videoText,extraContext=false,hiddenVideoSource=true,nativeProof=false,proofAuthor='Writer',proofTime,proofPoster,onVideoWait,onUploadWait}={}) {
  const state={account:'/owner',text:'',attachment:null,buttonCount:1,editorCount:1,context:false,
    clicks:0,closed:0,route:'/home',modal:false,buttonLabel:'发帖',foreign:false,phase:'waiting',phases:[],events:[],sleeps:[],active:true,now:startAt,polls:0,removed:0,mediaItems:[],videoReady,videoError,...initial};
  class Clock extends Date{static now(){return state.now;}}
  const controller=new AbortController();
  const editor={isConnected:true,closest:()=>state.foreign?{}:null,get innerText(){return state.text;},scrollIntoView(){},focus(){},
    dispatchEvent(event){if(event.clipboardData){state.text=event.clipboardData.text;if(embeddedVideo){
      state.text=videoText??state.text.replace(videoLink,'').replace(/\n+$/,'');
      const hidden={contains:n=>n===slot,querySelectorAll:s=>s.includes('UserAvatar')?[{getAttribute:()=> 'UserAvatar-Container-'+state.proofAuthor}]:[{getAttribute:()=>state.proofTime}]};
      const slot={closest:()=>nativeProof?hidden:null};
      state.proofAuthor=proofAuthor;state.proofTime=proofTime??new Date(Number((123n>>22n)+1288834974657n)).toISOString();
      state.proofPoster=proofPoster??'https://pbs.twimg.com/ext_tw_video_thumb/456/img/preview.jpg';
      const body={closest:s=>s.includes('attachments')?state.attachment:s.includes('aria-hidden')&&hiddenVideoSource?hidden:null};
      const video={getAttribute:k=>k==='src'?state.videoSrc:k==='poster'?state.proofPoster:null,get readyState(){return state.videoReady;},get error(){return state.videoError;}};
      const remove={getAttribute:k=>k==='data-testid'?'postVideoRemove':null};
      state.videoSrc=videoSource;state.videoReady=videoReady;state.videoError=videoError;
      state.videoBody=body;state.videoSlot=slot;state.videoNode=video;state.videoRemove=remove;
      state.attachment={isConnected:true,contains:n=>[body,slot,video,remove,hidden].includes(n),querySelectorAll:s=>s==='video'?[video]:s.includes('quoteVideoSlot')?[slot]:s.includes('postVideoRemove')?[remove]:s.includes('tweetText')?[body]:[]};
      state.preview=[video,remove];state.context=extraContext;
    }}}};
  const button={isConnected:true,disabled:false,closest:()=>null,get innerText(){return state.buttonLabel;},getAttribute:()=>null,click(){state.clicks++;state.events.push('click');onClick?.({state,controller});}};
  const syncMedia=()=>{
    state.preview=state.mediaItems.map(item=>item.remove);
    state.imagePreviews=state.mediaItems.map(item=>item.image).filter(Boolean);
    state.videoPreviews=state.mediaItems.map(item=>item.video).filter(Boolean);
    if(!state.mediaItems.length)state.attachment=null;
  };
  const makeRemove=item=>({isConnected:true,scrollIntoView(){},focus(){},getAttribute:k=>k==='data-testid'?(item.type==='video/mp4'?'postVideoRemove':localizedMedia?null:'mediaRemoveButton'):k==='aria-label'&&localizedMedia?'移除媒体':null,
    click(){const index=state.mediaItems.indexOf(item);if(index<0)return;this.isConnected=false;state.mediaItems.splice(index,1);state.removed++;syncMedia();}});
  const makeItem=(type,index)=>{const item={type};
    if(type==='video/mp4'&&videoPresent)item.video={isConnected:true,get readyState(){return state.videoReady;},get error(){return state.videoError;},getAttribute:k=>k==='src'?'blob:video-'+index:null};
    else if(type!=='video/mp4'&&imagePreview)item.image={isConnected:true,complete:true,naturalWidth:100,naturalHeight:80,getAttribute:k=>k==='src'?'blob:image-'+index:null};
    item.remove=makeRemove(item);return item;};
  const replaceFirstMedia=()=>{const item=state.mediaItems[0];if(!item)return;item.remove.isConnected=false;item.remove=makeRemove(item);syncMedia();};
  state.replaceFirstMedia=replaceFirstMedia;
  const input={isConnected:true,accept,multiple:true,files:[],dispatchEvent(event){
    if(event.type!=='change')return;
    state.uploaded=this.files.map(file=>'post-images/'+file.name);
    state.uploadedTypes=this.files.map(file=>file.type);
    state.attachment={isConnected:true,querySelectorAll:s=>s==='[role="progressbar"]'&&state.uploadPending?[state.progress]:[]};
    state.uploadPending=uploadPending;
    state.progress={isConnected:true,getAttribute:k=>k==='aria-label'?'加载图片':null};
    const count=uploadedCount??this.files.length;
    state.mediaItems=Array.from({length:count},(_,i)=>makeItem(this.files[i]?.type||this.files.at(-1)?.type||'image/png',i));
    syncMedia();
    this.files=[];
  }};
  const dialog={isConnected:true,contains:node=>node===editor||node===button||node===input,
    querySelector:selector=>selector.includes('inline_reply_offscreen')||selector.includes('pollOptions')?(state.context?{}:null):selector.includes('tweetText')?(state.context?{}:state.videoBody||null):selector.includes('attachments')?state.attachment:null,
    querySelectorAll:selector=>selector==='[data-testid="attachments"]'||selector==='[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="mediaPreview"]'?state.attachment?[state.attachment]:[]:selector==='[data-testid="tweetText"]'?state.videoBody?[state.videoBody]:state.context?[{}]:[]:selector==='[role="progressbar"]'?[...(state.uploadPending&&state.attachment?[state.progress]:[]),...(externalProgress?[{kind:'character-count'}]:[])]:selector==='[data-testid="attachments"] img,[data-testid="tweetPhoto"] img,[data-testid="mediaPreview"] img'?(state.imagePreviews||[]):selector==='[data-testid="attachments"] video,[data-testid="videoPlayer"] video,[data-testid="mediaPreview"] video'?(state.videoPreviews||[]):selector.startsWith('[data-testid="attachments"] img')?[...(state.imagePreviews||[]),...(state.videoPreviews||[]),...(state.preview||[])]:selector.includes('contenteditable')?Array(state.editorCount).fill(editor):selector.includes('tweetButton')?Array(state.buttonCount).fill(button):selector==='input[type="file"]'?Array(state.fileCount??1).fill(input):selector.includes('mediaRemoveButton')||selector.includes('postVideoRemove')?(state.preview||[]).filter(n=>n.getAttribute('aria-label')!=='移除媒体'||selector.includes('aria-label="移除媒体"')):[]};
  editor.parentElement=dialog;
  const primary={isConnected:true,closest:()=>null,contains:n=>n===dialog,
    querySelectorAll:selector=>selector.includes('tweetTextarea_0')?Array(state.editorCount).fill(editor):selector.includes('tweetButtonInline')?Array(state.buttonCount).fill(button):[]};
  class Transfer {files=[];items={add:file=>this.files.push(file)};setData(_type,text){this.text=text;}}
  const context=vm.createContext({Date:Clock,Error,DOMException,DataTransfer:Transfer,
    URL,navigator:{get onLine(){return state.online!==false;}},XAssistantDOM:{postingVideoSources:url=>videoMetadata&&url===videoLink?[videoSrc]:[]},
    XAssistantRuntime:{check:signal=>{if(signal?.aborted)throw new DOMException('stopped','AbortError');guard?.(state);},call:async message=>{if(message.kind==='ACTION_ACQUIRE')return actionAcquire?.(state)??{granted:true,leaseId:'lease',expiresAt:state.now+10000};state.actionSettles??=[];state.actionSettles.push(message);if(ackFailure&&message.outcome==='attempted')throw Error('ACK lost');return {};},sleep:async ms=>{state.sleeps.push(ms);state.now+=ms;onSleep?.(state);}},
    XAssistantWorkspace:{beginComposer:()=>()=>{},canCleanComposer:()=>true,check:()=>guard?.(state)},
    ClipboardEvent:class{constructor(_type,data){Object.assign(this,data);}},MutationObserver:class{},setTimeout,clearTimeout,setInterval,clearInterval,
    Event,File:class{constructor(_data,name,{type}){this.name=name;this.type=type;}},chrome:{runtime:{getURL:x=>x}},
    fetch:async path=>({ok:true,blob:async()=>({type:path.match(/^data:([^;]+);/)?.[1]||'image/png',size:10})}),
    createImageBitmap:async()=>({width:100,height:100,close(){}}),
    location:{origin:'https://x.com',get pathname(){return state.route;}},
    document:{hidden:true,querySelectorAll:s=>s.includes('primaryColumn')?[primary]:[],querySelector:s=>s.includes('AppTabBar_Profile_Link')?({getAttribute:()=>state.account}):state.modal?{}:null},
    core:{editorText:element=>String(element?.innerText||'').replace(/\n+$/,'')},
    check:signal=>{if(signal.aborted)throw new DOMException('stopped','AbortError');guard?.(state);},
    patch:async patch=>{
      if(!state.active)throw Error('inactive runtime');
      state.phase=patch.phase;state.phases.push(patch.phase);state.events.push('patch:'+patch.phase);
      if(patch.phase==='unknown')state.unknownReceipt=patch.receipt;
      if(patch.phase==='submitting')state.attemptSubmittedAt=patch.submittedAt;
      if(patch.phase==='not_sent'||patch.phase==='confirmed'){
       state.settlement=patch;
       state.nextPostAt=state.now+(patch.receipt?.reason==='temporary_rejection'?2000:1800000);
       if(settlementAckFailure)throw Error('local write committed; ACK lost');
      }
      if(patch.phase==='submitting')await onReserve?.({state,editor,button,dialog,controller});
      return patch.phase==='not_sent'?{nextAt:state.nextPostAt}:undefined;
    },
    wait:async(fn,_signal,label)=>{const value=fn();if(!value)throw Error(label+'超时');return value;},
    sleep:async ms=>{state.sleeps.push(ms);state.now+=ms;onSleep?.(state);},show:()=>{},progress:()=>{},visible:()=>true,
    read:async()=>({active:state.active,account:'/owner',runId:'run',completed:0,phase:state.phase,rowId:'post_1',submittedAt:state.attemptSubmittedAt,receipt:state.settlement?.receipt,nextPostAt:state.nextPostAt}),clickNative:element=>element.click(),
    XAssistantPostingReceipt:{create:()=>{onReceipt?.(state);return {poll:()=>{state.polls++;return receipt?.kind==='not_sent'?null:typeof receipt==='function'?receipt(state):receipt;},atDeadline:()=>receipt?.kind==='not_sent'?receipt:null,close(){state.closed++;},get hint(){return state.receiptHint;}};}},
    control:controller,runId:'run',preSubmitTask:null,timer:null,start:{},stop:{},runPromise:Promise.resolve(),
    api:{runtime:async(_module,action)=>{if(action==='stop'){state.events.push('stop');state.active=false;}}},
  });
  if(allowCleanup){
    editor.focus=()=>{context.document.activeElement=editor;};
    context.document.createRange=()=>({selectNodeContents(){}});
    context.getSelection=()=>({removeAllRanges(){},addRange(){}});
    context.document.execCommand=command=>{assert.equal(command,'delete');state.text='';};
    context.InputEvent=Event;
  }
  vm.runInContext(tasksSource,context);
  const waitForPage=context.XAssistantTasks.waitForPage;
  context.XAssistantTasks={...context.XAssistantTasks,waitForPage:(fn,options)=>{
    if(options.timeout===90000||options.timeout===30000){if(options.timeout===90000)state.videoWait=options.timeout;let value=null;for(let i=0;i<3&&!value;i++){value=fn();(options.timeout===90000?onVideoWait:onUploadWait)?.(state,i);}return Promise.resolve(value||null);}
    return waitForPage(fn,options);
  }};
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
  for(const [mutate,code] of [[({state})=>state.account='/other','ACCOUNT_CHANGED'],[({state})=>state.text='unexpected','RESIDUAL_DRAFT']]) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),error=>/提交前/.test(error.message)&&error.submitted===false&&(!code||error.code===code));
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});
test('account readiness timeout is retryable structured state, while the module event preserves send evidence',async()=>{
 const waiting=vm.createContext({Error,XAssistantTasks:{waitForPage:async()=>null}});
 vm.runInContext(waitSource+';globalThis.waitTest=wait;',waiting);
 await assert.rejects(waiting.waitTest(()=>null,new AbortController().signal,'核对当前账号',1,'POST_ACCOUNT_NOT_READY'),error=>error.code==='POST_ACCOUNT_NOT_READY'&&!/登录/.test(error.message));
 let detail;
 const events=vm.createContext({String,window:{dispatchEvent:event=>{detail=event.detail;}},CustomEvent:class{constructor(_type,init){this.detail=init.detail;}}});
 vm.runInContext(emitSource+';globalThis.emitTest=emitState;',events);
 const failure=Object.assign(Error('媒体未就绪'),{code:'POST_MEDIA_NOT_READY',submitted:false,confirmed:false,preserveDrafts:true,status:429,retryAt:12345});
 events.emitTest(false,failure);
 assert.equal(detail.error,failure);assert.deepEqual({...detail,error:undefined},{module:'posting',running:false,error:undefined,message:'媒体未就绪',code:'POST_MEDIA_NOT_READY',submitted:false,confirmed:false,preserveDrafts:true,status:429,retryAt:12345});
});
test('an exact text draft is cleared before retry, while failed deletion or changed binding blocks automatic recovery',async()=>{
 const cleaned=fixture({allowCleanup:true,onReserve:()=>{throw Object.assign(Error('network'),{code:'NETWORK'});}});
 await assert.rejects(cleaned.send(),error=>error.code==='NETWORK'&&error.submitted===false);assert.equal(cleaned.state.text,'');
 const failed=fixture({onReserve:()=>{throw Object.assign(Error('network'),{code:'NETWORK'});}});
 await assert.rejects(failed.send(),error=>error.code==='CLEANUP_FAILED'&&error.submitted===false);assert.equal(failed.state.text,'expected');
 const changed=fixture({allowCleanup:true,onReserve:({state})=>{state.route='/other';}});
 await assert.rejects(changed.send(),error=>error.code==='RESIDUAL_DRAFT'&&error.submitted===false);assert.equal(changed.state.text,'expected');
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
    await assert.rejects(f.send(),/附件发生变化/);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});
test('photo-only and multiple images are bound to a single transaction; partial media cannot submit',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 const f=fixture({images,text:''});await f.send();assert.equal(f.state.text,'');assert.deepEqual(f.state.uploaded,images);assert.equal(f.state.clicks,1);
 const partial=fixture({images,uploadedCount:1});await assert.rejects(partial.send(),/配图.*超时/);assert.equal(partial.state.clicks,0);
});
test('one owned photo stuck at 1/1 with a visible progressbar is removed with its exact draft and keeps the retryable media error',async()=>{
 const f=fixture({image:true,uploadPending:true,allowCleanup:true});
 await assert.rejects(f.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.submitted===false);
 assert.equal(f.state.clicks,0);assert.equal(f.state.removed,1);assert.equal(f.state.attachment,null);assert.equal(f.state.text,'');
});
test('four owned photos are removed one by one before the exact draft is cleared',async()=>{
 const images=['post-images/one.jpg','post-images/two.png','post-images/three.webp','post-images/four.jpg'];
 const f=fixture({images,uploadPending:true,allowCleanup:true});
 await assert.rejects(f.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.submitted===false);
 assert.equal(f.state.clicks,0);assert.equal(f.state.removed,4);assert.equal(f.state.attachment,null);assert.equal(f.state.text,'');
});
test('a user text or media change during a failed upload is preserved and requires draft review',async()=>{
 const textChanged=fixture({image:true,uploadPending:true,allowCleanup:true,onUploadWait:state=>{state.text='user edit';}});
 await assert.rejects(textChanged.send(),error=>error.code==='RESIDUAL_DRAFT'&&error.submitted===false);
 assert.equal(textChanged.state.removed,0);assert.equal(textChanged.state.text,'user edit');assert.ok(textChanged.state.attachment);
 const mediaChanged=fixture({image:true,uploadPending:true,allowCleanup:true,onUploadWait:(state,i)=>{if(i===0)state.replaceFirstMedia();}});
 await assert.rejects(mediaChanged.send(),error=>error.code==='RESIDUAL_DRAFT'&&error.submitted===false);
 assert.equal(mediaChanged.state.removed,0);assert.equal(mediaChanged.state.text,'expected');assert.ok(mediaChanged.state.attachment);
});
test('animated attachments use the matching native upload type and still require a ready preview',async()=>{
 for(const [data,type,ext] of [['data:video/mp4;base64,AAAA','video/mp4','mp4'],['data:image/gif;base64,AAAA','image/gif','gif']]){
  const f=fixture({images:[data],text:'',accept:'image/jpeg, '+type});await f.send();
  assert.deepEqual(f.state.uploaded,['post-images/post-image-1.'+ext]);assert.deepEqual(f.state.uploadedTypes,[type]);assert.equal(f.state.clicks,1);
  const rejected=fixture({images:[data],accept:'image/jpeg'});await assert.rejects(rejected.send(),/上传入口/);assert.equal(rejected.state.clicks,0);
  const pending=fixture({images:[data],accept:type,uploadPending:true});await assert.rejects(pending.send(),/就绪超时/);assert.equal(pending.state.clicks,0);
 }
});

test('MP4 video waits fifteen seconds after its preview is ready while still images keep three seconds',async()=>{
 const video=fixture({images:['data:video/mp4;base64,AAAA'],text:'',accept:'video/mp4'});await video.send();
 assert.ok(video.state.sleeps.includes(15000));assert.equal(video.state.clicks,1);
 const photo=fixture({image:true,text:''});await photo.send();
 assert.ok(photo.state.sleeps.includes(3000));assert.equal(photo.state.sleeps.includes(15000),false);assert.equal(photo.state.clicks,1);
});
test('MP4 requires a real error-free readyState 2 video preview and uses the native video remove control',async()=>{
 for(const options of [{videoPresent:false},{videoReady:0},{videoError:{code:3}}]){
  const f=fixture({images:['data:video/mp4;base64,AAAA'],text:'',accept:'video/mp4',...options});
  await assert.rejects(f.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.submitted===false);
  assert.equal(f.state.clicks,0);assert.equal(f.state.removed,1);assert.equal(f.state.attachment,null);
 }
 const ready=fixture({images:['data:video/mp4;base64,AAAA'],text:'',accept:'video/mp4',videoReady:2});await ready.send();
 assert.ok(ready.state.sleeps.includes(15000));assert.equal(ready.state.clicks,1);
 assert.equal(ready.state.preview[0].getAttribute('data-testid'),'postVideoRemove');
});
test('a static photo or GIF needs a decoded native preview even when X already shows a remove control',async()=>{
 for(const [images,accept] of [[['post-images/one.jpg'],'image/*'],[['data:image/gif;base64,AAAA'],'image/gif']]){
  const f=fixture({images,text:'',accept,imagePreview:false});
  await assert.rejects(f.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.submitted===false);
  assert.equal(f.state.removed,1);assert.equal(f.state.clicks,0);
 }
});

test('two Chinese X remove buttons without test IDs count as attached media',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 const f=fixture({images,localizedMedia:true});await f.send();
 assert.deepEqual(f.state.uploaded,images);assert.equal(f.state.clicks,1);
});

test('composer character-count progress does not block a ready image, but attachment upload progress still does',async()=>{
 const outside=fixture({image:true,text:'',externalProgress:true});await outside.send();assert.equal(outside.state.clicks,1);
 const inside=fixture({image:true,text:'',uploadPending:true});
 await assert.rejects(inside.send(),error=>error.code==='POST_MEDIA_NOT_READY'&&error.submitted===false);
 assert.equal(inside.state.clicks,0);assert.equal(inside.state.removed,1);
});

test('visible upload progress, partial and excess Chinese media all stop before reservation',async()=>{
 const images=['post-images/one.jpg','post-images/two.png'];
 for(const options of [{uploadPending:true},{uploadedCount:1},{uploadedCount:3}]){
  const f=fixture({images,localizedMedia:true,...options});
  await assert.rejects(f.send(),error=>['POST_MEDIA_NOT_READY','CLEANUP_FAILED','RESIDUAL_DRAFT'].includes(error.code)&&error.message.includes('未点击发送')&&!error.submitted);
  assert.equal(f.state.clicks,0);assert.ok(!f.state.phases.includes('submitting'));
 }
});

test('upload progress returning after reservation blocks the final click',async()=>{
 const f=fixture({image:true,localizedMedia:true,onReserve:({state})=>{state.uploadPending=true;}});
 await assert.rejects(f.send(),error=>/提交前附件发生变化/.test(error.message)&&!error.submitted);
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

test('a generic X error alone waits until the receipt deadline, preserves the draft and quarantines the one submission',async()=>{
  const message='出错了，别担心，让我们再试一次。';
  let clickedAt;
  const f=fixture({allowCleanup:true,receipt:null,onClick:({state})=>{clickedAt=state.now;state.receiptHint=message;}});
  await assert.rejects(f.send(),error=>error.code==='SEND_UNKNOWN'&&error.submitted===true&&error.message.includes(message));
  assert.equal(f.state.now-clickedAt,15000);
  assert.equal(f.state.clicks,1);assert.equal(f.state.closed,1);assert.equal(f.state.text,'expected');
  assert.equal(f.state.phase,'unknown');assert.deepEqual({...f.state.unknownReceipt},{kind:'unknown',evidence:'x_notice',message});
});

test('known browser offline before a click is safe to retry without producing unknown evidence',async()=>{
  const initiallyOff=fixture({initial:{online:false}});
  await assert.rejects(initiallyOff.send(),e=>e.code==='NETWORK'&&!e.submitted);
  assert.equal(initiallyOff.state.clicks,0);assert.equal(initiallyOff.state.text,'');
  const goesOff=fixture({allowCleanup:true,onReserve:({state})=>{state.online=false;}});
  await assert.rejects(goesOff.send(),e=>e.code==='NETWORK'&&!e.submitted);
  assert.equal(goesOff.state.clicks,0);assert.equal(goesOff.state.phase,'waiting');assert.equal(goesOff.state.text,'');
});

test('an X native success settles a published media post despite the error and clears only the owned residual draft',async()=>{
  const success={kind:'confirmed',evidence:'x_create_result',postId:'42',url:'https://x.com/owner/status/42'};
  const f=fixture({image:true,allowCleanup:true,receipt:success,onClick:({state})=>{state.receiptHint='出错了';}});
  await f.send();
  assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');
  assert.equal(f.state.settlement.attemptSubmittedAt,f.state.attemptSubmittedAt);
  assert.equal(f.state.settlement.receipt,success);
  assert.equal(f.state.text,'');assert.equal(f.state.removed,1);
});

test('a verified unsent limit preserves the item, clears the owned draft and returns the next retry time without clicking again',async()=>{
  const notSent={kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88};
  let clickedAt;const f=fixture({allowCleanup:true,receipt:notSent,onClick:({state})=>{clickedAt=state.now;}});
  const pending=await f.send();
  assert.equal(f.state.now-clickedAt,15000);
  assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'not_sent');
  assert.equal(f.state.settlement.attemptSubmittedAt,f.state.attemptSubmittedAt);
  assert.equal(f.state.settlement.receipt,notSent);
  assert.ok(pending.nextAt>=f.state.now+1800000);
  assert.equal(f.state.text,'');assert.ok(!f.state.phases.includes('confirmed'));
});

test('a native terminal reply never erases a user-edited draft or changes confirmed success into uncertainty',async()=>{
  for(const result of [{kind:'confirmed',evidence:'x_create_result',postId:'42',url:'https://x.com/owner/status/42'},
    {kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88}]){
    const f=fixture({allowCleanup:true,receipt:result,onClick:({state})=>{state.text='user text';}});
    await assert.rejects(f.send(),e=>e.code==='RESIDUAL_DRAFT'&&e.preserveDrafts===true&&e.confirmed===(result.kind==='confirmed'));
    assert.equal(f.state.clicks,1);assert.equal(f.state.phase,result.kind);assert.equal(f.state.text,'user text');
  }
});

test('lost local settlement ACK uses the persisted receipt, never a second X action',async()=>{
  for(const receipt of [{kind:'confirmed',evidence:'x_create_result',postId:'42',url:'https://x.com/owner/status/42'},
    {kind:'not_sent',evidence:'x_create_result',reason:'temporary_rejection',code:130}]){
    const f=fixture({allowCleanup:true,receipt,settlementAckFailure:true});
    await f.send();
    assert.equal(f.state.clicks,1);
    assert.equal(f.state.phases.filter(phase=>phase===receipt.kind).length,1);
    assert.equal(f.state.settlement.attemptSubmittedAt,f.state.attemptSubmittedAt);
    assert.equal(f.state.text,'');
  }
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
test('a media post can confirm at 25 seconds without another click',async()=>{
 let clickedAt;
 const f=fixture({image:true,onClick:({state})=>{clickedAt=state.now;},receipt:state=>state.now-clickedAt>=25000?{kind:'confirmed'}:null});
 await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'confirmed');assert.equal(f.state.closed,1);
 assert.ok(f.state.now-clickedAt>=25000);assert.ok(f.state.now-clickedAt<45000);
});
test('a media post with no receipt becomes unknown only after forty-five seconds and is never clicked twice',async()=>{
 let clickedAt;
 const f=fixture({image:true,onClick:({state})=>{clickedAt=state.now;},receipt:null});
 await assert.rejects(f.send(),error=>error.code==='SEND_UNKNOWN'&&error.submitted&&!error.confirmed);
 assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'submitting');assert.equal(f.state.closed,1);
 assert.equal(f.state.now-clickedAt,45000);
});
test('Beijing midnight before the final click prevents submission and clears false reservation',async()=>{
 const midnight=Date.parse('2026-11-05T00:00:00+08:00');
 const f=fixture({allowCleanup:true,startAt:midnight-10000,guard:state=>{if(state.now>=midnight)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},onReserve:({state})=>{state.now=midnight;}});
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
 const f=fixture({allowCleanup:true,startAt:midnight-10000,guard:state=>{if(state.now>=midnight)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},onReceipt:state=>{state.now=midnight;}});
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
 await assert.rejects(f.send(),e=>/附件发生变化/.test(e.message)&&!e.submitted);assert.equal(f.state.clicks,0);
});

test('legacy video/photo links never enter the composer or fall back to a card',async()=>{
 for(const text of [videoLink,'caption '+videoLink,videoLink.replace('/video/1','/photo/1'),'https://video.twimg.com/clip.mp4','https://pbs.twimg.com/media/a.jpg']){
  const f=fixture({text});await assert.rejects(f.send(),{code:'POST_MEDIA_DOWNLOAD_REQUIRED'});assert.equal(f.state.clicks,0);assert.equal(f.state.text,'');
 }
});

test('downloaded MP4 is written as a native File and waits for upload plus fifteen seconds',async()=>{
 const f=fixture({text:'视频正文',images:['data:video/mp4;base64,AAAA'],accept:'video/mp4'});await f.send();
 assert.deepEqual(f.state.uploadedTypes,['video/mp4']);assert.ok(f.state.uploaded[0].endsWith('.mp4'));assert.equal(f.state.videoWait,90000);assert.ok(f.state.sleeps.includes(15000));assert.equal(f.state.clicks,1);
});

test('duplicate refusal preserves non-cleanable draft rather than converting it to success or resending',async()=>{
 const f=fixture({receipt:{kind:'rejected',reason:'duplicate',evidence:'x_notice',message:'哇哦！你已经发过了。'}});
 await assert.rejects(f.send(),e=>e.code==='POST_DUPLICATE');
 assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'rejected');assert.equal(f.state.text,'expected');
});

test('known duplicate clears only owned exact text and returns without a second submission',async()=>{
 const f=fixture({allowCleanup:true,receipt:{kind:'rejected',reason:'duplicate',evidence:'x_notice',message:'哇哦！你已经发过了。'}});
 await f.send();assert.equal(f.state.clicks,1);assert.equal(f.state.text,'');assert.equal(f.state.phase,'rejected');
});
test('duplicate rejection cannot clear text changed by the user after submission',async()=>{
 const f=fixture({allowCleanup:true,onClick:({state})=>{state.text='user edit';},receipt:{kind:'rejected',reason:'duplicate',evidence:'x_notice',message:'哇哦！你已经发过了。'}});
 await assert.rejects(f.send(),e=>e.code==='POST_DUPLICATE');assert.equal(f.state.text,'user edit');
});
