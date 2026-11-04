// Posting driver. The coordinator owns lower-priority handoffs.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root||root.dataset.postingReady)return;root.dataset.postingReady='1';
 const core=globalThis.XAssistantCore,api=globalThis.XAssistantRuntime;let runId=null,runPromise=Promise.resolve();
 const patch=patch=>api.runtime('posting','patch',{runId,patch});
 const KEY='xAssistantPostingV1';
 const section=root.querySelector('[data-module="posting"]'),output=document.createElement('div');output.className='status';output.dataset.status='posting';output.setAttribute('role','status');output.textContent='发帖已停止 · 等待启动';section.append(output);
 let control=null,timer=null,mirrorTimer=null,preSubmitTask=null;const progress=value=>section.style.setProperty('--progress',Math.max(0,Math.min(1,value)));const show=t=>(output.textContent=t,!/下次发帖/.test(t)&&progress(0));

 const read=async()=>{const data=await chrome.storage.local.get([KEY,'xAssistantPostSchedulesV1']),state=data[KEY];const account=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')||state?.account;const saved=data.xAssistantPostSchedulesV1?.[account?.toLowerCase()];return saved?{...state,lastPostedAt:saved.lastPostedAt,nextPostAt:saved.nextPostAt}:state;};
 const check=signal=>{if(signal.aborted)throw new DOMException('发帖已停止','AbortError');};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(new DOMException('发帖已停止','AbortError'));}signal.addEventListener('abort',abort,{once:true});});
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const wait=async(fn,signal,label,count=300)=>{const value=await globalThis.XAssistantTasks.waitFor(fn,{signal,timeout:count*100});if(value)return value;throw Error(label+'超时，已停止，避免重复发帖');};
 const clickNative=button=>{button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};button.dispatchEvent(new PointerEvent('pointerdown',c));button.dispatchEvent(new MouseEvent('mousedown',c));button.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}button.click();};
 const attachmentSelector='[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="mediaPreview"]';
 const hasAttachment=dialog=>!!dialog?.querySelector(attachmentSelector);
 const waitCleanup=async(fn,count=50)=>!!await globalThis.XAssistantTasks.waitFor(fn,{timeout:count*100});
 async function uploadImage(dialog,path,signal){
  if(!/^post-images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(path||''))throw Error('文案配图路径无效');
  const inputs=await wait(()=>{const rows=[...dialog.querySelectorAll('input[type="file"]')].filter(input=>!input.accept||/image/i.test(input.accept));return rows.length===1?rows:null;},signal,'等待图片上传入口');
  const response=await fetch(chrome.runtime.getURL(path));check(signal);
  if(!response.ok)throw Error('读取配图失败');
  const blob=await response.blob();check(signal);
  if(!/^image\//.test(blob.type)||blob.size<1||blob.size>5*1024*1024)throw Error('配图文件无效或超过 5 MB');
  const file=new File([blob],path.split('/').pop(),{type:blob.type,lastModified:Date.now()}),data=new DataTransfer();data.items.add(file);
  try{inputs[0].files=data.files;}catch{Object.defineProperty(inputs[0],'files',{configurable:true,value:data.files});}
  inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>hasAttachment(dialog),signal,'等待图片上传');
 }
 async function removeOwnedImage(dialog){
  if(!hasAttachment(dialog))return true;
  const remove=[...dialog.querySelectorAll('[data-testid="mediaRemoveButton"],button[aria-label="Remove media"],button[aria-label="移除媒体"],button[aria-label^="Remove attachment"],button[aria-label^="移除附件"]')];
  if(remove.length!==1)return false;
  clickNative(remove[0]);return waitCleanup(()=>!hasAttachment(dialog));
 }
 const waitAccount=signal=>wait(()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href'),signal,'核对当前登录账号');
 async function publish(row,signal,runId){
  let dialog=null,editor=null,submitted=false,ownsDraft=false,ownsImage=false,receipt=null;
  let reserved=false,releasePreSubmit=null;
  check(signal);

  try{
   // Always use the global composer, scoped to its new dialog, on every X route.
   await patch({phase:'opening',rowId:row.id,text:row.text,receipt:null,submittedAt:null});
   const existing=[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'));
   let openedHere=false;
   if(existing.length){
    if(existing.length!==1)throw Error('多个弹窗，未发送');
    dialog=existing[0];
    const editors=dialog.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]');
    if(editors.length!==1||core.editorText(editors[0]).trim()||dialog.querySelector('[data-testid="tweetText"],[data-testid="pollOptions"]')||hasAttachment(dialog))throw Error('已有用户草稿、附件或非普通发帖弹窗，未覆盖');
   }else{
    const launchers=[...document.querySelectorAll('[data-testid="SideNav_NewTweet_Button"]')].filter(visible);
    if(launchers.length!==1)throw Error('未找到唯一的全局发帖入口');
    show('正在打开全局发帖框');clickNative(launchers[0]);openedHere=true;
    dialog=await wait(()=>{const ds=[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'));return ds.length===1?ds[0]:null;},signal,'打开发帖框');
   }
   editor=await wait(()=>{const es=[...dialog.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]')].filter(visible);return es.length===1?es[0]:null;},signal,'等待发帖输入框');
   if(core.editorText(editor).trim())throw Error('发帖框已有用户草稿，未覆盖');
   if(dialog.querySelector('[data-testid="tweetText"]'))throw Error('检测到回复或引用上下文，未发送');
   ownsDraft=openedHere;await patch({phase:'filling'});show('正在写入文案 '+row.id);editor.scrollIntoView({block:'center'});editor.focus();const data=new DataTransfer();data.setData('text/plain',row.text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   await sleep(500,signal);
   if(!core.editorText(editor)){editor.focus();document.execCommand('insertText',false,row.text);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:row.text}));}
   await wait(()=>core.editorText(editor)===core.editorText({innerText:row.text}),signal,'文案写入回读');
   if(row.image){show('正在上传配图 '+row.id);ownsImage=true;await uploadImage(dialog,row.image,signal);}
   show(row.image?'文案和配图已填好，3 秒后发送':'文案已填好，3 秒后发送');await sleep(3000,signal);check(signal);
   if(core.editorText(editor)!==core.editorText({innerText:row.text}))throw Error('等待期间文案发生变化，未发送');
   if(row.image&&!hasAttachment(dialog))throw Error('等待期间配图消失，未发送');
   await wait(()=>{const bs=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');return bs.length===1?bs:null;},signal,'等待发帖按钮');
   const expectedAttachment=row.image?dialog.querySelector(attachmentSelector):null;
   const state=await read();check(signal);if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state?.account)throw Error('账号发生变化，未发送');if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
   // Stop waits only for this short pre-click reservation, not for AI generation.
   preSubmitTask=new Promise(resolve=>{releasePreSubmit=resolve;});reserved=true;
   await patch({phase:'submitting',text:row.text,rowId:row.id,submittedAt:new Date().toISOString()});check(signal);
   // Every asynchronous persistence boundary invalidates earlier DOM checks.
   if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state.account)throw Error('提交前账号发生变化，未发送');
   if(!dialog.isConnected||!editor.isConnected||!dialog.contains(editor))throw Error('提交前发帖框已更新，未发送');
   const finalEditors=[...dialog.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]')].filter(visible);
   if(finalEditors.length!==1||finalEditors[0]!==editor||core.editorText(editor)!==core.editorText({innerText:row.text}))throw Error('提交前文案发生变化，未发送');
   if(hasAttachment(dialog)!==!!row.image||(row.image&&dialog.querySelector(attachmentSelector)!==expectedAttachment))throw Error('提交前配图发生变化，未发送');
   if(dialog.querySelector('[data-testid="tweetText"],[data-testid="pollOptions"]'))throw Error('提交前发帖上下文发生变化，未发送');
   const finalButtons=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
   if(finalButtons.length!==1||!finalButtons[0].isConnected||!dialog.contains(finalButtons[0]))throw Error('提交前发帖按钮已变化，未发送');
   receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account:state.account,text:row.text,now:Date.now,setInterval,clearInterval});
   submitted=true;releasePreSubmit();preSubmitTask=null;clickNative(finalButtons[0]);
   const result=await wait(()=>receipt.poll(),signal,'等待 X 发送成功回执');
   receipt.close();receipt=null;
   const latest=await read();
   if(result.kind==='rejected'){
    await patch({phase:'rejected',error:result.message});
    throw Error('X 未确认发送，平台提示：'+result.message);
   }
   await patch({phase:'confirmed',completed:(latest.completed||0)+1,receipt:result,error:null});
  }catch(error){
   receipt?.close();
   error.submitted=submitted;
   if(!submitted&&reserved){
    try{await patch({phase:'waiting',submittedAt:null,receipt:null});}
    catch{error.message+='；尚未点击发送，但运行状态恢复失败，请核对后重启';}
   }
   if(!submitted&&ownsDraft&&dialog?.isConnected&&(!core.editorText(editor)||core.editorText(editor)===core.editorText({innerText:row.text}))){
    // Cleanup must finish even when Stop aborted the publishing signal.
    if(editor&&core.editorText(editor)){
     editor.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
     document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
     for(let n=0;n<20&&core.editorText(editor);n++)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(ownsImage&&hasAttachment(dialog)&&!await removeOwnedImage(dialog))error.message+='；配图未清除，保留编辑框，请手动处理';
    // Never close a nonempty editor: X would open a blocking save/discard prompt.
    if((!editor||!core.editorText(editor))&&!hasAttachment(dialog)){
     const close=dialog.querySelector('[data-testid="app-bar-close"]')||[...dialog.querySelectorAll('button')].find(b=>/^(Close|关闭)$/i.test(b.getAttribute('aria-label')||''));close?.click();
    }else if(core.editorText(editor))error.message+='；草稿未清空，保留编辑框，请手动保存';
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
  control?.abort();await preSubmitTask;await api.runtime('posting','stop');await runPromise;
  clearInterval(timer);progress(0);show('发帖已结束；已提交的请求无法撤回');
 }
 async function countdown(deadline,signal,label,displayAt=deadline){
  const duration=Math.max(1,deadline-Date.now());
  while(Date.now()<deadline){check(signal);const remaining=Math.max(0,deadline-Date.now());progress(1-remaining/duration);output.textContent=`${label} ${(Math.max(0,displayAt-Date.now())/1000).toFixed(1)} 秒`;await sleep(Math.min(100,remaining),signal);}
 }
 async function launch(resume=false){
  if(control)return;
  if(!navigator.locks){show('浏览器不支持跨标签页执行锁');return;}
  runId=null;const own=new AbortController();control=own;const signal=own.signal;
  const existing=await read(),lockOptions=resume||existing?.active?{ifAvailable:true}:{steal:true};
  runPromise=navigator.locks.request('x-assistant-original-post-loop',lockOptions,async lock=>{
   if(!lock)throw Error('发帖正在另一个 X 标签页运行');
   const account=await waitAccount(signal);
   const state=await api.runtime('posting','begin',{resume,account});runId=state.runId;
   let deadline=state.nextAt;
   while(!signal.aborted){
    // An overdue slot runs once now; confirmation schedules a fresh future slot.
    if(deadline<Date.now())deadline=Date.now();
    await patch({phase:'waiting',nextAt:deadline});
    await countdown(Math.max(Date.now(),deadline-globalThis.XAssistantTime.ms('guard')),signal,'下次发帖',deadline);
    await navigator.locks.request('x-assistant-page-actions',{signal},async()=>{
    let token=null;
    try{
     const gate=globalThis.XAssistantInteraction;if(!gate)throw Error('互动协调器未就绪');
     show('等待当前互动完成');if(globalThis.XAssistantScheduler)await globalThis.XAssistantScheduler.beforePost();else token=await gate.pause();check(signal);
     deadline=Math.max(deadline,Date.now());
     await patch({phase:'paused_waiting',nextAt:deadline});
     await countdown(deadline,signal,'互动已暂停 · 下次发帖');
     if(await waitAccount(signal)!==account)throw Error('账号发生变化，已停止');
     if(document.querySelector('[role="dialog"],[role="alertdialog"]')){if(!await globalThis.XAssistantPopup.cancel())throw Error('弹窗取消失败');show('已取消弹窗，跳过本次发帖');deadline=Date.now()+globalThis.XAssistantTime.ms('posting');return;}
     const row=await api.runtime('posting','pick',{runId});check(signal);
     show('DeepSeek 正在生成发帖文案');await patch({phase:'generating',rowId:row.id});
     const generated=await api.call({kind:'AI_POST',runId,rowId:row.id});check(signal);
     if(generated.rowId!==row.id)throw Error('AI 发帖文案与参考条目不匹配');
     if(generated.action==='skip'){show('AI 跳过此主题，等待下轮；未发送');deadline=Date.now()+globalThis.XAssistantTime.ms('posting');return;}
     if(generated.action!=='send_post')throw Error('AI 未返回有效发帖指令');
     if(await waitAccount(signal)!==account)throw Error('生成期间账号发生变化，未发送');
     try{await publish({...row,text:generated.text},signal,runId);}catch(e){
      const latest=await read();
      if(signal.aborted||['submitting','unknown','rejected','confirmed'].includes(latest.phase)||!document.querySelector('[role="dialog"],[role="alertdialog"]'))throw e;
      if(!await globalThis.XAssistantPopup.cancel())throw e;
      show('已取消弹窗，跳过本次发帖');deadline=Date.now()+globalThis.XAssistantTime.ms('posting');return;
     }check(signal);
     deadline=(await read()).nextAt;
    }finally{if(token)await globalThis.XAssistantInteraction?.resume(token);if(globalThis.XAssistantScheduler)await globalThis.XAssistantScheduler.afterPost();}
    });
   }
  }).catch(async e=>{
   if(!signal.aborted&&e.name!=='AbortError'){
    show('发帖已停止：'+e.message);
    if(runId){try{await patch({error:e.message});await api.runtime('posting','stop');}catch{}}
   }
  }).finally(async()=>{if(control===own)control=null;renderRemote(await read());});
 }

 globalThis.XAssistantPostingDriver={start:launch,stop:stopLoop,isRunning:()=>!!control};
 read().then(s=>{if(s?.active&&!globalThis.XAssistantSchedulerCore)launch(true);else renderRemote(s);}).catch(e=>show(e.message));
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes[KEY])return;const s=changes[KEY].newValue;if(!s?.active)control?.abort();renderRemote(s);});
 mirrorTimer=setInterval(()=>{if(!control)read().then(renderRemote).catch(()=>{});},1000);
 window.addEventListener('x-assistant-invalidate',()=>control?.abort(),{once:true});
 window.addEventListener('pagehide',()=>{control?.abort();clearInterval(timer);clearInterval(mirrorTimer);},{once:true});
})();
