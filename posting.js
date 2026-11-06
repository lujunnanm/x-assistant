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
 const wait=async(fn,signal,label,count=300)=>{const value=await globalThis.XAssistantTasks.waitForPage(fn,{signal,timeout:count*100});if(value)return value;throw Error(label+'超时，已停止，避免重复发帖');};
 const clickNative=button=>{button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};button.dispatchEvent(new PointerEvent('pointerdown',c));button.dispatchEvent(new MouseEvent('mousedown',c));button.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}button.click();};
 const attachmentSelector='[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="mediaPreview"]';
 const hasAttachment=dialog=>!!dialog?.querySelector(attachmentSelector);
 const waitCleanup=async(fn,count=50)=>!!await globalThis.XAssistantTasks.waitFor(fn,{timeout:count*100});
 async function uploadImage(dialog,path,signal,guard){
  guard();
  if(!/^post-images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(path||''))throw Error('文案配图路径无效');
  const inputs=await wait(()=>{const rows=[...dialog.querySelectorAll('input[type="file"]')].filter(input=>!input.accept||/image/i.test(input.accept));return rows.length===1?rows:null;},signal,'等待图片上传入口');
  const response=await fetch(chrome.runtime.getURL(path));check(signal);
  if(!response.ok)throw Error('读取配图失败');
  const blob=await response.blob();check(signal);
  if(!/^image\//.test(blob.type)||blob.size<1||blob.size>5*1024*1024)throw Error('配图文件无效或超过 5 MB');
  const file=new File([blob],path.split('/').pop(),{type:blob.type,lastModified:Date.now()}),data=new DataTransfer();data.items.add(file);
  await sleep(500,signal);check(signal);
  guard();if(!inputs[0].isConnected||!dialog.contains(inputs[0])||inputs[0].files?.length)throw Error('图片入口或已有配图发生变化，未提交');
  try{inputs[0].files=data.files;}catch{Object.defineProperty(inputs[0],'files',{configurable:true,value:data.files});}
  inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>hasAttachment(dialog),signal,'等待图片上传');
 }
 async function removeOwnedImage(dialog,cleanable){
  if(!hasAttachment(dialog))return true;
  const remove=[...dialog.querySelectorAll('[data-testid="mediaRemoveButton"],button[aria-label="Remove media"],button[aria-label="移除媒体"],button[aria-label^="Remove attachment"],button[aria-label^="移除附件"]')];
  if(remove.length!==1)return false;
  await new Promise(resolve=>setTimeout(resolve,500));if(remove[0].isConnected===false||!cleanable()||globalThis.XAssistantWorkspace?.canCleanComposer?.()===false)return false;
  clickNative(remove[0]);return waitCleanup(()=>!hasAttachment(dialog));
 }
 const waitAccount=signal=>wait(()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href'),signal,'核对当前登录账号');
 // Original posting has no permission to open /compose or use a status reply form.
 // Bind the unique original editor AND inline post button to their nearest shared
 // home composer (never the entire feed). The public probe returns counts only.
 const postingFailure=(code,message)=>Object.assign(Error(message),{code});
 const mediaState=form=>[...form.querySelectorAll('[data-testid="attachments"] img,[data-testid="tweetPhoto"] img,[data-testid="mediaPreview"] img,video,[data-testid="mediaRemoveButton"]')].map(n=>[n,n.getAttribute('src')||'']);
 const sameMedia=(a,b)=>a.length===b.length&&a.every(([node,src],i)=>node===b[i][0]&&src===b[i][1]);
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
  if(!dialog||dialog===main||!main.contains(dialog)||dialog.querySelector('article,[data-testid="inline_reply_offscreen"],[data-testid="tweetText"],[data-testid="pollOptions"],[data-testid="quoteTweet"]'))return fail('context');
  if([...dialog.querySelectorAll('[contenteditable="true"]')].filter(live).length!==1)return fail('editors');
  info.files=dialog.querySelectorAll('input[type="file"]').length;if(info.files!==1)return fail('files');
  return {dialog,editor,button,info:{...info,reason:'ready',hasDraft:!!core.editorText(editor).trim(),hasMedia:hasAttachment(dialog)}};
 }
 globalThis.XAssistantPostingProbe={inspect:account=>inspectOriginal(account).info};
 async function publish(row,signal,runId){
  let dialog=null,editor=null,button=null,submitted=false,confirmed=false,ownsDraft=false,expectedAttachment=null,expectedMedia=[],receipt=null;
  let reserved=false,releasePreSubmit=null;
  const start=await read();check(signal);
  if(!start?.active||start.runId!==runId)throw new DOMException('已停止','AbortError');
  const owner=start.account,expected=core.editorText({innerText:row.text});
  const same=()=>{const h=inspectOriginal(owner);return h.dialog===dialog&&h.editor===editor&&h.button===button&&!!dialog?.isConnected;};
  const assertBound=(stage='')=>{check(signal);if(!same())throw postingFailure('POST_COMPOSER_CHANGED',stage+'首页原创发帖按钮已变化（账号、路径、正文编辑器或上下文不符），未发送');};
  const emptyBeforeUpload=()=>{assertBound('上传前');if(core.editorText(editor)!==expected||hasAttachment(dialog))throw postingFailure('POST_DRAFT_CHANGED','上传前文案或附件发生变化，未发送');};
  try{
   await patch({phase:'opening',rowId:row.id,text:row.text,receipt:null,submittedAt:null});
   globalThis.XAssistantWorkspace?.progress?.('等待首页独立原创发帖框');
   const peek=()=>{const h=inspectOriginal(owner);if(h.dialog)return h;
    if(['route','account','dialog','not_original','context','editors'].includes(h.info.reason))throw postingFailure('POST_COMPOSER_UNSAFE','无法核对首页原创编辑器：'+h.info.reason+'；未输入、未发送');return null;};
   const h=await globalThis.XAssistantTasks.waitForPage(peek,{signal,timeout:12000});
   if(!h)throw postingFailure('POST_EDITOR_NOT_READY','首页原创发帖框未就绪：'+JSON.stringify(inspectOriginal(owner).info)+'；未输入、未发送');
   ({dialog,editor,button}=h);
   await patch({phase:'filling'});await sleep(500,signal);assertBound('输入前');
   if(core.editorText(editor).trim()||hasAttachment(dialog))throw postingFailure('RESIDUAL_DRAFT','首页发帖框已有用户草稿或附件，已保留，未覆盖');
   show('正在写入文案 '+row.id);editor.scrollIntoView({block:'center'});editor.focus();assertBound('聚焦后');
   if(core.editorText(editor).trim()||hasAttachment(dialog))throw postingFailure('RESIDUAL_DRAFT','聚焦后检测到原有草稿或附件，已保留');
   ownsDraft=true;const data=new DataTransfer();data.setData('text/plain',row.text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   await sleep(500,signal);assertBound('粘贴后');
   if(!core.editorText(editor)){await sleep(500,signal);assertBound();if(core.editorText(editor)||hasAttachment(dialog))throw Error('输入框内容已变化');editor.focus();if(document.activeElement!==editor&&!editor.contains(document.activeElement))throw Error('无法确认当前输入焦点，未写入');document.execCommand('insertText',false,row.text);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:row.text}));}
   await wait(()=>core.editorText(editor)===core.editorText({innerText:row.text}),signal,'文案写入回读');
   if(row.image){show('正在上传配图 '+row.id);await uploadImage(dialog,row.image,signal,emptyBeforeUpload);expectedAttachment=dialog.querySelector(attachmentSelector);expectedMedia=mediaState(dialog);if(expectedMedia.filter(([n])=>n.getAttribute('data-testid')==='mediaRemoveButton').length>1)throw Error('检测到多项媒体，未发送');}
   show(row.image?'文案和配图已填好，3 秒后发送':'文案已填好，3 秒后发送');await sleep(3000,signal);check(signal);
   if(core.editorText(editor)!==core.editorText({innerText:row.text}))throw Error('等待期间文案发生变化，未发送');
   if(row.image&&!hasAttachment(dialog))throw Error('等待期间配图消失，未发送');
   await wait(()=>{const bs=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');return bs.length===1?bs:null;},signal,'等待发帖按钮');
   assertBound('发送前');
   const state=await read();check(signal);if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state?.account)throw Error('账号发生变化，未发送');if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
   let finalButtons,clickedAt=null;
   try{
    await globalThis.XAssistantActions.click({module:'posting',runId,account:state.account,kind:'post',signal,
     beforeClick:async()=>{
      check(signal);
      // No submitting evidence is written while waiting for global pacing.
      preSubmitTask=new Promise(resolve=>{releasePreSubmit=resolve;});reserved=true;
      await patch({phase:'submitting',text:row.text,rowId:row.id,submittedAt:new Date().toISOString()});check(signal);
      await sleep(500,signal);check(signal);
     },
     validate:()=>{
      check(signal);
      // Every asynchronous persistence boundary invalidates earlier DOM checks.
      assertBound('提交前');
      if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state.account)throw Error('提交前账号发生变化，未发送');
      if(!dialog.isConnected||!editor.isConnected||!dialog.contains(editor))throw Error('提交前发帖框已更新，未发送');
      if(core.editorText(editor)!==expected)throw Error('提交前文案发生变化，未发送');
      if(hasAttachment(dialog)!==!!row.image||(row.image&&(dialog.querySelector(attachmentSelector)!==expectedAttachment||!sameMedia(expectedMedia,mediaState(dialog)))))throw Error('提交前配图发生变化，未发送');
      if(dialog.querySelector('[data-testid="tweetText"],[data-testid="pollOptions"]'))throw Error('提交前发帖上下文发生变化，未发送');
      finalButtons=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
      if(finalButtons.length!==1||finalButtons[0]!==button||!finalButtons[0].isConnected||!dialog.contains(finalButtons[0]))throw Error('提交前发帖按钮已变化，未发送');
      receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account:state.account,text:row.text,now:Date.now,setInterval,clearInterval});
      check(signal);
     },
     click:()=>{submitted=true;clickedAt=Date.now();releasePreSubmit();preSubmitTask=null;finalButtons[0].click();},
    });
   }catch(error){if(!submitted||!receipt)throw error;}
   // Already clicked: stop/ACK loss/midnight cannot cancel read-only confirmation.
   const result=await globalThis.XAssistantTasks.waitForPage(()=>receipt.poll(),{timeout:Math.max(0,clickedAt+15000-Date.now())});
   receipt.close();receipt=null;
   if(!result||!['confirmed','rejected'].includes(result.kind))throw Object.assign(Error('发帖提交结果未知，请核对平台记录'),{code:'SEND_UNKNOWN'});
   const latest=await read();
   if(result.kind==='rejected'){
    await patch({phase:'rejected',error:result.message});
    throw Object.assign(Error('X 未确认发送，平台提示：'+result.message),{code:'PLATFORM_REJECTED'});
   }
   confirmed=true;
   await patch({phase:'confirmed',completed:(latest.completed||0)+1,receipt:result,error:null});
  }catch(error){
   receipt?.close();
   error.submitted=submitted;error.confirmed=confirmed;
   if(!submitted&&reserved){
    try{await patch({phase:'waiting',submittedAt:null,receipt:null});}
    catch{error.message+='；尚未点击发送，但运行状态恢复失败，请核对后重启';}
   }
   // The inline form also belongs to the user. Never clear on uncertainty,
   // another route/account, changed content, or an unproven attachment.
   const cleanable=()=>ownsDraft&&(!globalThis.XAssistantWorkspace||globalThis.XAssistantWorkspace.canCleanComposer?.()!==false)&&same()&&
    (!core.editorText(editor)||core.editorText(editor)===expected)&&dialog.querySelector(attachmentSelector)===expectedAttachment&&sameMedia(expectedMedia,mediaState(dialog));
   if(!submitted&&cleanable()){
    if(expectedAttachment&&!await removeOwnedImage(dialog,cleanable))error.message+='；已保留配图，请核对首页草稿';
    if(!hasAttachment(dialog)&&core.editorText(editor)===expected){
     expectedAttachment=null;expectedMedia=[];
     if(cleanable()&&typeof getSelection==='function'&&typeof document.execCommand==='function'){
      editor.focus();if(cleanable()&&(document.activeElement===editor||editor.contains(document.activeElement))){
       const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
       document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
      }
     }
    }
   }
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
 const emitState=(running,error)=>window.dispatchEvent(new CustomEvent('x-assistant-module-state',{detail:{module:'posting',running,...(error?{error}: {})}}));
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
    if(await waitAccount(signal)!==account)throw Error('账号发生变化，已停止');
    if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw Error('页面已有弹窗或草稿，请先处理后重新启动');
    const row=await api.runtime('posting','pick',{runId});check(signal);
    if(row?.type!=='post'||typeof row.text!=='string'||!row.text.trim())throw Error('发帖文案库条目无效，未发送');
    show('正在使用文案库原文发帖');
    if(await waitAccount(signal)!==account)throw Error('账号发生变化，未发送');
    await publish(row,signal,runId);check(signal);
    deadline=(await read()).nextAt;
   }
  }).catch(async e=>{
   failed(e);
   if(!signal.aborted&&e.name!=='AbortError'){
    terminalError=e.message;show('发帖已停止：'+e.message);
    if(runId){try{await patch({error:e.message});}catch{}}
   }
  }).finally(async()=>{
   if(runId){try{await api.runtime('posting','stop',{runId});}catch{}}
   if(control===own)control=null;
   try{if(!api.retired?.())renderRemote(await read());}catch(e){if(!api.isInvalid?.(e)){terminalError=terminalError||e.message;show(terminalError);}}finally{emitState(false,terminalError);}
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
