// Independent posting driver. Its tab owns the composer and its own timer.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root||root.dataset.postingReady)return;root.dataset.postingReady='1';
 const core=globalThis.XAssistantCore,api=globalThis.XAssistantRuntime;let runId=null,runPromise=Promise.resolve();
 const patch=patch=>api.runtime('posting','patch',{runId,patch});
 const KEY='xAssistantPostingV1';
 const section=root.querySelector('[data-module="posting"]'),output=document.createElement('div');output.className='status';output.dataset.status='posting';output.setAttribute('role','status');output.textContent='发帖已停止 · 等待启动';section.append(output);
 let control=null,timer=null,mirrorTimer=null,preSubmitTask=null;const progress=value=>section.style.setProperty('--progress',Math.max(0,Math.min(1,value)));const show=t=>(output.textContent=t,!/下次发帖/.test(t)&&progress(0));

 const local=api.storage||chrome.storage.local;
 const read=async()=>{const data=await local.get([KEY,'xAssistantPostSchedulesV1']),state=data[KEY];const account=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')||state?.account;const saved=data.xAssistantPostSchedulesV1?.[account?.toLowerCase()];return saved?{...state,lastPostedAt:saved.lastPostedAt,nextPostAt:saved.nextPostAt}:state;};
 const check=signal=>{if(signal.aborted)throw new DOMException('发帖已停止','AbortError');globalThis.XAssistantWorkspace?.check(signal);};
 const sleep=(ms,signal)=>api.sleep(ms,signal);
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const wait=async(fn,signal,label,count=300,code=null)=>{const value=await globalThis.XAssistantTasks.waitForPage(fn,{signal,timeout:count*100});if(value)return value;throw Object.assign(Error(label+'超时，已停止，避免重复发帖'),code?{code}:{});};
 const clickNative=button=>{button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};button.dispatchEvent(new PointerEvent('pointerdown',c));button.dispatchEvent(new MouseEvent('mousedown',c));button.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}button.click();};
 const attachmentSelector='[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="mediaPreview"]';
 const removeMediaSelector='[data-testid="mediaRemoveButton"],[data-testid="postVideoRemove"],button[aria-label="Remove media"],button[aria-label="移除媒体"],button[aria-label^="Remove attachment"],button[aria-label^="移除附件"]';
 const imagePreviewSelector='[data-testid="attachments"] img,[data-testid="tweetPhoto"] img,[data-testid="mediaPreview"] img';
 const videoPreviewSelector='[data-testid="attachments"] video,[data-testid="videoPlayer"] video,[data-testid="mediaPreview"] video';
 const hasAttachment=dialog=>!!dialog?.querySelector(attachmentSelector);
 // X also renders native remove buttons with a localized label and no test ID.
 const mediaRemoveButtons=dialog=>[...dialog.querySelectorAll(removeMediaSelector)].filter(visible);
 const sameNodes=(a,b)=>a.length===b.length&&a.every((node,i)=>node===b[i]);
 const mediaOwnership=(dialog,max)=>{
  const attachment=dialog.querySelector(attachmentSelector),remove=mediaRemoveButtons(dialog);
  return attachment&&remove.length>0&&remove.length<=max?{attachment,remove}:null;
 };
 const sameOwnedMedia=(dialog,owned)=>!!owned&&dialog.querySelector(attachmentSelector)===owned.attachment&&sameNodes(mediaRemoveButtons(dialog),owned.remove);
 const mediaUploading=dialog=>[...dialog.querySelectorAll(attachmentSelector)].some(attachment=>[...attachment.querySelectorAll('[role="progressbar"]')].some(visible));
 const mediaReady=(dialog,paths)=>{
  const count=paths.length,videoCount=paths.filter(path=>path?.startsWith('data:video/mp4;')).length,imageCount=count-videoCount;
  if(!hasAttachment(dialog)||mediaRemoveButtons(dialog).length!==count||mediaUploading(dialog))return false;
  const images=[...dialog.querySelectorAll(imagePreviewSelector)].filter(image=>visible(image)&&image.complete===true&&image.naturalWidth>0&&image.naturalHeight>0);
  const videos=[...dialog.querySelectorAll(videoPreviewSelector)].filter(video=>visible(video)&&!video.error&&Number(video.readyState)>=2);
  return images.length>=imageCount&&videos.length>=videoCount;
 };
 const waitCleanup=async(fn,count=50)=>!!await globalThis.XAssistantTasks.waitFor(fn,{timeout:count*100});
 async function uploadImage(dialog,paths,signal,guard,observeOwned){
  guard();
  const isVideo=path=>path?.startsWith('data:video/mp4;'),isGif=path=>path?.startsWith('data:image/gif;');
  const accepts=input=>{
   if(!input.accept?.trim())return true;
   const types=input.accept.toLowerCase().split(',').map(type=>type.trim());
   return paths.every(path=>isVideo(path)?types.some(type=>['video/mp4','video/*','.mp4'].includes(type)):
    isGif(path)?types.some(type=>['image/gif','image/*','.gif'].includes(type)):types.some(type=>type.startsWith('image/')));
  };
  const inputs=await wait(()=>{const rows=[...dialog.querySelectorAll('input[type="file"]')].filter(accepts);return rows.length===1?rows:null;},signal,'等待图片或动图上传入口');
  if(paths.length>1&&!inputs[0].multiple)throw Error('X 图片入口不支持一次上传多张，未发送');
  const data=new DataTransfer();
  for(const [index,path] of paths.entries()){
  const inline=/^data:(?:image\/(?:jpeg|png|webp|gif)|video\/mp4);base64,[A-Za-z0-9+/]+={0,2}$/.test(path||'');
  if(!inline&&!/^post-images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(path||''))throw Error('文案配图路径无效');
  const response=await fetch(inline?path:chrome.runtime.getURL(path));check(signal);
  if(!response.ok)throw Error('读取配图失败');
  const blob=await response.blob();check(signal);
  if((isVideo(path)?blob.type!=='video/mp4':isGif(path)?blob.type!=='image/gif':!/^image\/(?:jpeg|png|webp)$/.test(blob.type))||blob.size<1||blob.size>(isVideo(path)?20:5)*1024*1024)throw Error('附件无效或超过限制（图片 5 MB、视频 20 MB）');
  if(!isVideo(path)){
   let decoded;try{decoded=await createImageBitmap(blob);if(!decoded.width||!decoded.height)throw Error('empty image');}
   catch{throw Error('配图无法解码，未发送；请重新选择有效图片');}finally{decoded?.close();}check(signal);
  }
  const filename=inline?'post-image-'+(index+1)+'.'+({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4' }[blob.type]):path.split('/').pop();
  const file=new File([blob],filename,{type:blob.type,lastModified:Date.now()});data.items.add(file);
  }
  await sleep(500,signal);check(signal);
  guard();if(!inputs[0].isConnected||!dialog.contains(inputs[0])||!accepts(inputs[0])||inputs[0].files?.length)throw Error('图片入口或已有配图发生变化，未提交');
  try{inputs[0].files=data.files;}catch{Object.defineProperty(inputs[0],'files',{configurable:true,value:data.files});}
  inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
  const ready=await globalThis.XAssistantTasks.waitForPage(()=>{const owned=mediaOwnership(dialog,paths.length);if(owned)observeOwned?.(owned);return mediaReady(dialog,paths);},{signal,timeout:paths.some(isVideo)?90000:30000});
  if(!ready)throw postingFailure('POST_MEDIA_NOT_READY',`等待配图就绪超时（识别到 ${mediaRemoveButtons(dialog).length}/${paths.length} 张），未点击发送`);
 }
 async function removeOwnedImage(dialog,owned,cleanable){
  if(!hasAttachment(dialog))return true;
  if(!owned||owned.remove.length<1||owned.remove.length>4||!cleanable()||!sameOwnedMedia(dialog,owned))return false;
  const remaining=[...owned.remove];
  while(remaining.length){
   const remove=remaining[0];
   await new Promise(resolve=>setTimeout(resolve,500));
   if(remove.isConnected===false||!cleanable()||!sameNodes(mediaRemoveButtons(dialog),remaining)||dialog.querySelector(attachmentSelector)!==owned.attachment||globalThis.XAssistantWorkspace?.canCleanComposer?.()===false)return false;
   try{clickNative(remove);}catch{return false;}
   remaining.shift();
   if(!await waitCleanup(()=>{
    if(!cleanable())return false;
    const current=mediaRemoveButtons(dialog);
    return remaining.length?dialog.querySelector(attachmentSelector)===owned.attachment&&sameNodes(current,remaining):!hasAttachment(dialog)&&current.length===0;
   }))return false;
  }
  return true;
 }
 const waitAccount=signal=>wait(()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href'),signal,'核对当前账号',300,'POST_ACCOUNT_NOT_READY');
 // Original posting has no permission to open /compose or use a status reply form.
 // Bind the unique original editor AND inline post button to their nearest shared
 // home composer (never the entire feed). The public probe returns counts only.
 const postingFailure=(code,message)=>Object.assign(Error(message),{code});
 const mediaState=form=>[...form.querySelectorAll('[data-testid="attachments"] img,[data-testid="tweetPhoto"] img,[data-testid="mediaPreview"] img,video,'+removeMediaSelector)].map(n=>[n,n.getAttribute('src')||'']);
 const sameMedia=(a,b)=>a.length===b.length&&a.every(([node,src],i)=>node===b[i][0]&&src===b[i][1]);
 const unsafeContext=form=>!!form.querySelector('article,[data-testid="inline_reply_offscreen"],[data-testid="pollOptions"],[data-testid="quoteTweet"],[data-testid="tweetText"]');
 function inspectOriginal(account){
  const route=location.pathname,info={route,reason:'route',editors:0,buttons:0,files:0};
  const fail=reason=>({info:{...info,reason}});
  if(location.origin!=='https://x.com'||route!=='/home')return fail('route');
  const own=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
  if(!own||!/^\/[a-z0-9_]{1,15}$/.test(own)||account&&own!==account.toLowerCase())return fail('account');
  if(document.querySelector('[role="dialog"],[role="alertdialog"]'))return fail('dialog');
  const excluded='article,[data-testid="inline_reply_offscreen"],[role="dialog"],[role="alertdialog"],[hidden],[inert],[aria-hidden="true"]';
  const live=e=>e.isConnected&&!e.closest(excluded)&&visible(e);
  const mains=[...document.querySelectorAll('[data-testid="primaryColumn"]')].filter(live);
  if(mains.length!==1)return fail('primary');
  const main=mains[0],eds=[...main.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"],[data-testid="tweetTextarea_0"] [contenteditable="true"]')].filter(live);
  const btns=[...main.querySelectorAll('[data-testid="tweetButtonInline"]')].filter(live);
  info.editors=eds.length;info.buttons=btns.length;
  if(eds.length!==1||btns.length!==1)return fail('controls');
  const editor=eds[0],button=btns[0];
  if(!/^(?:Post|Tweet|发帖|發帖|发布|發佈|發布|发推|發文|ポストする|ポスト|ツイートする)$/i.test((button.innerText||button.textContent||button.getAttribute('aria-label')||'').trim()))return fail('not_original');
  let dialog=editor.parentElement;
  while(dialog&&dialog!==main&&!dialog.contains(button))dialog=dialog.parentElement;
  if(!dialog||dialog===main||!main.contains(dialog)||unsafeContext(dialog))return fail('context');
  if([...dialog.querySelectorAll('[contenteditable="true"]')].filter(live).length!==1)return fail('editors');
  info.files=dialog.querySelectorAll('input[type="file"]').length;if(info.files!==1)return fail('files');
  return {dialog,editor,button,info:{...info,reason:'ready',hasDraft:!!core.editorText(editor).trim(),hasMedia:hasAttachment(dialog)}};
 }
 globalThis.XAssistantPostingProbe={inspect:account=>inspectOriginal(account).info};
 async function publish(row,signal,runId){
  let dialog=null,editor=null,button=null,submitted=false,confirmed=false,ownsDraft=false,ownedUpload=null,expectedAttachment=null,expectedMedia=[],receipt=null;
  let reserved=false,releasePreSubmit=null;
  const start=await read();check(signal);
  if(!start?.active||start.runId!==runId)throw new DOMException('已停止','AbortError');
  const owner=start.account,expected=core.editorText({innerText:row.text});
  const images=row.images??(row.image?[row.image]:[]);
  const hasVideo=images.some(path=>path?.startsWith('data:video/mp4;'));
  let expectedEditor=expected;
  const assertCopyReady=()=>{
   if(row.enabled===false)throw postingFailure('POST_COPY_DISABLED','文案已停用，未发送');
  };
  const assertOnline=()=>{if(globalThis.navigator?.onLine===false)throw postingFailure('NETWORK','浏览器当前离线，未点击发帖');};
  const same=()=>{const h=inspectOriginal(owner);return h.dialog===dialog&&h.editor===editor&&h.button===button&&!!dialog?.isConnected;};
  const assertBound=(stage='')=>{check(signal);const current=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
   if(current&&current.toLowerCase()!==owner.toLowerCase())throw postingFailure('ACCOUNT_CHANGED',stage+'账号发生变化，未发送');
   if(!same())throw postingFailure('POST_COMPOSER_CHANGED',stage+'首页原创发帖按钮已变化（路径、正文编辑器或上下文不符），未发送');};
  const emptyBeforeUpload=()=>{assertBound('上传前');if(core.editorText(editor)!==expected||hasAttachment(dialog))throw postingFailure('POST_DRAFT_CHANGED','上传前文案或附件发生变化，未发送');};
  const baseCleanable=()=>ownsDraft&&(!globalThis.XAssistantWorkspace||globalThis.XAssistantWorkspace.canCleanComposer?.()!==false)&&same()&&
   (!core.editorText(editor)||core.editorText(editor)===expectedEditor);
  const clearOwnedText=()=>{
   const current=core.editorText(editor);if(!current)return true;
   if(!expectedEditor||current!==expectedEditor||hasAttachment(dialog)||!baseCleanable()||typeof getSelection!=='function'||typeof document.execCommand!=='function')return false;
   editor.focus();if(!baseCleanable()||document.activeElement!==editor&& !editor.contains(document.activeElement))return false;
   const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
   document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
   return !core.editorText(editor);
  };
  const cleanupOwnedDraft=async()=>{
   if(!ownsDraft)return null;
   if(hasAttachment(dialog)){
    if(!ownedUpload||!baseCleanable()||!sameOwnedMedia(dialog,ownedUpload))return 'RESIDUAL_DRAFT';
    if(!await removeOwnedImage(dialog,ownedUpload,baseCleanable))return 'CLEANUP_FAILED';
   }
   const current=core.editorText(editor);
   if(!current)return null;
   if(!baseCleanable()||current!==expectedEditor)return 'RESIDUAL_DRAFT';
   return clearOwnedText()?null:'CLEANUP_FAILED';
  };
  const withCleanupIssue=(error,issue)=>{
   if(!issue)return error;
   if(error.code!=='ACCOUNT_CHANGED')error.code=issue;
   error.preserveDrafts=true;
   error.message+=issue==='RESIDUAL_DRAFT'?'；页面、正文或媒体已变化，已保留首页草稿供人工核对':'；本次媒体或正文未能完整清理，已保留首页草稿供人工核对';
   return error;
  };
  const settleNative=async settlement=>{
   try{return await patch(settlement);}catch(error){
    const saved=await read().catch(()=>null),expected=settlement.receipt,actual=saved?.receipt;
    if(saved?.runId!==runId||saved.account!==owner||saved.rowId!==row.id||saved.submittedAt!==settlement.attemptSubmittedAt)throw error;
    if(actual?.kind===expected.kind&&actual.evidence===expected.evidence&&
      (expected.kind==='confirmed'?actual.postId===expected.postId&&actual.url===expected.url:
        actual.reason===expected.reason&&actual.code===expected.code&&Number.isFinite(saved.nextPostAt)))return saved;
    // Retry only the local bookkeeping write, not the X submission.
    if(saved.active&&saved.phase==='submitting')return patch(settlement);
    throw error;
   }
  };
  try{
   assertCopyReady();
   assertOnline();
   if(/https:\/\/(?:video\.twimg\.com\/|pbs\.twimg\.com\/media\/)/.test(expected)||/https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+\/(?:video|photo)\/[1-4](?:[?#\s]|$)/.test(expected))throw postingFailure('POST_MEDIA_DOWNLOAD_REQUIRED','旧文案含媒体链接，请重新采集为文件附件后发帖；未输入、未发送');
   await patch({phase:'opening',rowId:row.id,text:row.text,libraryRevision:row.libraryRevision,receipt:null,submittedAt:null});
   globalThis.XAssistantWorkspace?.progress?.('等待首页独立原创发帖框');
   const peek=()=>{const h=inspectOriginal(owner);if(h.dialog)return h;
    if(h.info.reason==='account')throw postingFailure('ACCOUNT_CHANGED','当前账号与发帖任务不一致，未输入、未发送');
    if(['route','dialog','not_original','context','editors'].includes(h.info.reason))throw postingFailure('POST_COMPOSER_UNSAFE','无法核对首页原创编辑器：'+h.info.reason+'；未输入、未发送');return null;};
   const h=await globalThis.XAssistantTasks.waitForPage(peek,{signal,timeout:12000});
   if(!h)throw postingFailure('POST_EDITOR_NOT_READY','首页原创发帖框未就绪：'+JSON.stringify(inspectOriginal(owner).info)+'；未输入、未发送');
   ({dialog,editor,button}=h);
   await patch({phase:'filling'});await sleep(500,signal);assertBound('输入前');
   if(core.editorText(editor).trim()||hasAttachment(dialog))throw postingFailure('RESIDUAL_DRAFT','首页发帖框已有用户草稿或附件，已保留，未覆盖');
   show('正在写入文案 '+row.id);editor.scrollIntoView({block:'center'});editor.focus();assertBound('聚焦后');
   if(core.editorText(editor).trim()||hasAttachment(dialog))throw postingFailure('RESIDUAL_DRAFT','聚焦后检测到原有草稿或附件，已保留');
   ownsDraft=true;
   if(expected.trim()){
   const data=new DataTransfer();data.setData('text/plain',row.text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   await sleep(500,signal);assertBound('粘贴后');
   if(!core.editorText(editor)){await sleep(500,signal);assertBound();if(core.editorText(editor)||hasAttachment(dialog))throw Error('输入框内容已变化');editor.focus();if(document.activeElement!==editor&&!editor.contains(document.activeElement))throw Error('无法确认当前输入焦点，未写入');document.execCommand('insertText',false,row.text);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:row.text}));}
   await wait(()=>core.editorText(editor)===expected,signal,'文案写入回读');
   }
   if(images.length){
    show('正在上传配图 '+row.id);await uploadImage(dialog,images,signal,emptyBeforeUpload,owned=>{ownedUpload??=owned;});
    expectedAttachment=dialog.querySelector(attachmentSelector);expectedMedia=mediaState(dialog);
    if(!mediaReady(dialog,images))throw Error('配图未就绪或数量与文案库不一致，未发送');
    ownedUpload=mediaOwnership(dialog,images.length);
   }
   const readyDelay=hasVideo?15000:3000;
   show(hasVideo?'视频已填好，15 秒后发送':images.length?'配图已填好，3 秒后发送':'文案已填好，3 秒后发送');await sleep(readyDelay,signal);check(signal);
   if(core.editorText(editor)!==expectedEditor)throw Error('等待期间文案发生变化，未发送');
   if(images.length&&(!hasAttachment(dialog)))throw Error('等待期间媒体消失，未发送');
   await wait(()=>{const bs=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');return bs.length===1?bs:null;},signal,'等待发帖按钮');
   assertBound('发送前');
   const state=await read();check(signal);if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state?.account)throw postingFailure('ACCOUNT_CHANGED','账号发生变化，未发送');if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
   const receiptWindow=images.length?45000:15000;
   let finalButtons,clickedAt=null,attemptSubmittedAt=null;
   try{
    await globalThis.XAssistantActions.click({module:'posting',runId,account:state.account,kind:'post',signal,
     beforeClick:async()=>{
      check(signal);
      // No submitting evidence is written while waiting for global pacing.
      preSubmitTask=new Promise(resolve=>{releasePreSubmit=resolve;});reserved=true;
      attemptSubmittedAt=new Date().toISOString();
      await patch({phase:'submitting',text:row.text,rowId:row.id,submittedAt:attemptSubmittedAt});check(signal);
      await sleep(500,signal);check(signal);
     },
     validate:()=>{
      check(signal);
      assertCopyReady();
      assertOnline();
      // Every asynchronous persistence boundary invalidates earlier DOM checks.
      assertBound('提交前');
      if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state.account)throw postingFailure('ACCOUNT_CHANGED','提交前账号发生变化，未发送');
      if(!dialog.isConnected||!editor.isConnected||!dialog.contains(editor))throw Error('提交前发帖框已更新，未发送');
      if(core.editorText(editor)!==expectedEditor)throw Error('提交前文案发生变化，未发送');
      if(hasAttachment(dialog)!==!!images.length||(images.length&&(dialog.querySelector(attachmentSelector)!==expectedAttachment||!sameMedia(expectedMedia,mediaState(dialog))||!mediaReady(dialog,images))))throw Error('提交前附件发生变化，未发送');
      if(unsafeContext(dialog))throw Error('提交前发帖上下文发生变化，未发送');
      finalButtons=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
      if(finalButtons.length!==1||finalButtons[0]!==button||!finalButtons[0].isConnected||!dialog.contains(finalButtons[0]))throw Error('提交前发帖按钮已变化，未发送');
      const native=globalThis.XAssistantPostingNative?.create({document,button,account:state.account,text:row.text,mediaCount:images.length,timeout:receiptWindow});
      receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account:state.account,text:row.text,hasMedia:images.length>0,native,now:Date.now,setInterval,clearInterval});
      check(signal);
     },
     click:()=>{submitted=true;clickedAt=Date.now();releasePreSubmit();preSubmitTask=null;finalButtons[0].click();},
    });
   }catch(error){if(!submitted||!receipt)throw error;}
   // Already clicked: stop/ACK loss/midnight cannot cancel read-only confirmation.
   const observed=await globalThis.XAssistantTasks.waitForPage(()=>receipt.poll(),{timeout:Math.max(0,clickedAt+receiptWindow-Date.now())});
   const result=observed||receipt.atDeadline?.();
   const hint=receipt.hint;receipt.close();receipt=null;
   if(!result||!['confirmed','rejected','not_sent'].includes(result.kind)){
    const failure=postingFailure('SEND_UNKNOWN','发帖提交结果未知，请核对平台记录'+(hint?'；X 提示：'+hint:''));
    if(hint){
     // Keep the notice with this attempt, not as a rejection or permission to retry.
     try{await patch({phase:'unknown',receipt:{kind:'unknown',evidence:'x_notice',message:hint},error:failure.message});}
     catch(e){failure.cause=e;} // The existing submitting record still locks this attempt.
    }
    throw failure;
   }
   if(result.kind==='not_sent'){
    const message=result.reason==='rate_limit'?'X 确认这条未发送；限流结束后按队列重试':'X 暂时拒绝提交，确认未发送；原稿保留并按排期重试';
    // Do not clear an attempted draft until the definitive response and delay are durable.
    const pending=await settleNative({phase:'not_sent',attemptSubmittedAt,receipt:result,error:message});
    const issue=await cleanupOwnedDraft();
    if(issue)throw withCleanupIssue(postingFailure(issue,message),issue);
    return pending;
   }
   const latest=await read();
   if(result.kind==='rejected'){
    await patch({phase:'rejected',receipt:result,error:result.message});
    if(result.reason==='duplicate')throw Object.assign(Error('X 已拒绝重复文案，本条已停用并保留'),{code:'POST_DUPLICATE'});
    throw Object.assign(Error('X 未确认发送，平台提示：'+result.message),{code:'PLATFORM_REJECTED'});
   }
   confirmed=true;
   const settled={phase:'confirmed',completed:(latest.completed||0)+1,receipt:result,error:null};
   const done=result.evidence==='x_create_result'?await settleNative({...settled,attemptSubmittedAt}):await patch(settled);
   // X may publish successfully and still leave the attempted draft on screen.
   if(result.evidence==='x_create_result'&&same()){
    const issue=await cleanupOwnedDraft();
    if(issue)throw withCleanupIssue(postingFailure(issue,'X 已确认发帖成功'),issue);
   }
   return done;
  }catch(error){
   receipt?.close();
   error.submitted=submitted;error.confirmed=confirmed;
   if(!submitted&&reserved){
    try{await patch({phase:'waiting',submittedAt:null,receipt:null});}
    catch{error.message+='；尚未点击发送，但运行状态恢复失败，请核对后重启';}
   }
   // The inline form also belongs to the user. Clear only the exact upload and
   // exact text introduced by this transaction; every observed change fails closed.
   const duplicate=error.code==='POST_DUPLICATE';
   const issue=!submitted||duplicate?await cleanupOwnedDraft():null;
   if(!submitted)withCleanupIssue(error,issue);
   if(duplicate&&!issue&&baseCleanable()&&!core.editorText(editor)&&!hasAttachment(dialog))return await read();
   throw error;
  }finally{
   releasePreSubmit?.();preSubmitTask=null;
  }
 }

 const renderRemote=state=>{
  if(!state?.active){if(!control)show(['unknown','submitting'].includes(state?.phase)?'上次发送结果未知，请核对平台记录':state?.error||'发帖已停止');return;}

  if(!control){const remaining=Math.max(0,(state.nextAt||Date.now())-Date.now());output.textContent=`下次发帖 ${(remaining/1000).toFixed(1)} 秒 · 运行于另一个 X 标签页`;}
 };
 async function stopLoop(){
  const ownedRun=runId;control?.abort();await preSubmitTask;await runPromise;if(ownedRun)await api.runtime('posting','stop',{runId:ownedRun});
  clearInterval(timer);progress(0);show('发帖已结束；已提交的请求无法撤回');
 }
 async function countdown(deadline,signal,label,displayAt=deadline){
  const duration=Math.max(1,deadline-Date.now());
  while(Date.now()<deadline){check(signal);const remaining=Math.max(0,deadline-Date.now());progress(1-remaining/duration);output.textContent=`${label} ${(Math.max(0,displayAt-Date.now())/1000).toFixed(1)} 秒`;await sleep(Math.min(document.hidden?10000:250,remaining),signal);}
 }
 const emitState=(running,failure)=>window.dispatchEvent(new CustomEvent('x-assistant-module-state',{detail:{module:'posting',running,...(failure?{
  error:failure,message:failure.message||String(failure),...(failure.code?{code:failure.code}:{}),submitted:failure.submitted===true,confirmed:failure.confirmed===true,
  ...(failure.preserveDrafts===true?{preserveDrafts:true}:{}),...(Number.isInteger(failure.httpStatus)?{httpStatus:failure.httpStatus}:{}),
  ...(Number.isInteger(failure.status)?{status:failure.status}:{}),...(Number.isFinite(failure.retryAt)?{retryAt:failure.retryAt}:{})
 }: {})}}));
 async function launch(resume=false){
  if(control)return;
  await globalThis.XAssistantWorkspace?.ready;
  if(control)return;
  if(!navigator.locks)throw Error('浏览器不支持跨标签页执行锁');
  runId=null;const own=new AbortController();control=own;const signal=own.signal;
  let readyResolve,readyReject,readySettled=false,terminalError=null;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const started=()=>{if(!readySettled){readySettled=true;readyResolve();emitState(true);}};
  const failed=e=>{if(!readySettled){readySettled=true;readyReject(e);}};
  runPromise=navigator.locks.request('x-assistant-original-post-loop',{ifAvailable:true},async lock=>{
   if(!lock)throw Error('发帖正在另一个 X 标签页运行');
   check(signal);
   const account=await waitAccount(signal);check(signal);
   const state=await api.runtime('posting','begin',{resume,account});runId=state.runId;
   started();
   let deadline=state.nextAt;
   while(!signal.aborted){
    // An overdue slot runs once now; confirmation schedules a fresh future slot.
    if(deadline<Date.now())deadline=Date.now();
    await patch({phase:'waiting',nextAt:deadline});
    await countdown(deadline,signal,'下次发帖');
    check(signal);
    if(await waitAccount(signal)!==account)throw postingFailure('ACCOUNT_CHANGED','账号发生变化，已停止');
    if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw Error('页面已有弹窗或草稿，请先处理后重新启动');
    const row=await api.runtime('posting','pick',{runId});check(signal);
    if(row?.type!=='post'||typeof row.text!=='string'||!row.text.trim()&&!row.image&&!row.images?.length)throw Error('发帖文案库条目无效，未发送');
    show('正在使用文案库原文发帖');
    if(await waitAccount(signal)!==account)throw postingFailure('ACCOUNT_CHANGED','账号发生变化，未发送');
    let confirmedState;
    try{confirmedState=await publish(row,signal,runId);}
    catch(error){if(error.code==='POST_COPY_CHANGED'&&!error.submitted){check(signal);continue;}throw error;}
    check(signal);
    if(confirmedState?.libraryRemaining===0){show('已无启用文案；发帖已自动关闭');return;}
    deadline=(await read()).nextAt;
   }
  }).catch(async e=>{
   failed(e);
   if(!signal.aborted&&e.name!=='AbortError'){
    terminalError=e;show('发帖已停止：'+e.message);
    if(runId){try{await patch({error:e.message});}catch{}}
   }
  }).finally(async()=>{
   if(runId){try{await api.runtime('posting','stop',{runId});}catch{}}
   if(control===own)control=null;
   try{if(!api.retired?.())renderRemote(await read());}catch(e){if(!api.isInvalid?.(e)){terminalError=terminalError||e;show(terminalError.message||String(terminalError));}}finally{emitState(false,terminalError);}
  });
  await ready;
 }

 globalThis.XAssistantPostingDriver={start:launch,stop:stopLoop,isRunning:()=>!!control,finished:()=>runPromise};
 // Only the clock changes every second. Never poll extension storage from idle/retired tabs.
 let mirror=null,mirrorRevision=0,retired=false;
 read().then(s=>{if(!retired&&!mirrorRevision){mirror=s;renderRemote(s);}}).catch(e=>{if(!retired)show(e.message);});
 chrome.storage.onChanged.addListener((changes,area)=>{if(retired||area!=='local'||!changes[KEY])return;mirrorRevision++;mirror=changes[KEY].newValue;if(!mirror?.active)control?.abort();renderRemote(mirror);});
 mirrorTimer=setInterval(()=>{if(!control&&mirror?.active)renderRemote(mirror);},1000);
 window.addEventListener('x-assistant-invalidate',()=>{retired=true;control?.abort();clearInterval(mirrorTimer);clearInterval(timer);},{once:true});
 window.addEventListener('pagehide',()=>{control?.abort();clearInterval(timer);clearInterval(mirrorTimer);},{once:true});
})();
