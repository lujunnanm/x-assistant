// Independent original-post loop. Never likes, follows or replies.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root||root.dataset.postingReady)return;root.dataset.postingReady='1';
 const core=globalThis.XAssistantCore,api=globalThis.XAssistantRuntime;let runId=null,runPromise=Promise.resolve();
 const patch=patch=>api.runtime('posting','patch',{runId,patch});
 const start=root.querySelector('[data-a="post-start"]'),stop=root.querySelector('[data-a="post-stop"]'),KEY='xAssistantPostingV1';
 const section=start.closest('section'),output=document.createElement('div');output.className='status';output.dataset.status='posting';output.setAttribute('role','status');output.textContent='发帖已停止 · 随机间隔 30–50 分钟';section.append(output);
 let control=null,timer=null,mirrorTimer=null;const progress=value=>section.style.setProperty('--progress',Math.max(0,Math.min(1,value)));const show=t=>(output.textContent=t,!/下次发帖/.test(t)&&progress(0));
 
 const read=async()=> (await chrome.storage.local.get(KEY))[KEY];
 const check=signal=>{if(signal.aborted)throw new DOMException('发帖已停止','AbortError');};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(new DOMException('发帖已停止','AbortError'));}signal.addEventListener('abort',abort,{once:true});});
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const wait=async(fn,signal,label,count=300)=>{for(let n=0;n<count;n++){check(signal);const value=fn();if(value)return value;await sleep(100,signal);}throw Error(label+'超时，已停止，避免重复发帖');};
 const clickNative=button=>{button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};button.dispatchEvent(new PointerEvent('pointerdown',c));button.dispatchEvent(new MouseEvent('mousedown',c));button.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}button.click();};
 const waitAccount=async signal=>{for(let n=0;n<300;n++){check(signal);const href=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');if(href)return href;await sleep(100,signal);}throw Error('无法核对当前登录账号');};
 async function publish(row,signal,runId){
  let dialog=null,editor=null,submitted=false,ownsDraft=false,receipt=null;
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
    if(editors.length!==1||core.editorText(editors[0]).trim()||dialog.querySelector('[data-testid="tweetText"],[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="pollOptions"],input[type="file"] + img'))throw Error('已有用户草稿、附件或非普通发帖弹窗，未覆盖');
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
   show('文案已填好，3 秒后发送');await sleep(3000,signal);check(signal);
   if(core.editorText(editor)!==core.editorText({innerText:row.text}))throw Error('等待期间文案发生变化，未发送');
   const buttons=await wait(()=>{const bs=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');return bs.length===1?bs:null;},signal,'等待发帖按钮');
   const state=await read();check(signal);if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==state?.account)throw Error('账号发生变化，未发送');if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
   await patch({phase:'submitting',text:row.text,rowId:row.id,submittedAt:new Date().toISOString()});check(signal);
   receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account:state.account,text:row.text,now:Date.now,setInterval,clearInterval});
   submitted=true;clickNative(buttons[0]);
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
   if(!submitted&&ownsDraft&&dialog?.isConnected&&(!core.editorText(editor)||core.editorText(editor)===core.editorText({innerText:row.text}))){
    // Cleanup must finish even when Stop aborted the publishing signal.
    if(editor&&core.editorText(editor)){
     editor.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
     document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
     for(let n=0;n<20&&core.editorText(editor);n++)await new Promise(resolve=>setTimeout(resolve,100));
    }
    // Never close a nonempty editor: X would open a blocking save/discard prompt.
    if(!editor||!core.editorText(editor)){
     const close=dialog.querySelector('[data-testid="app-bar-close"]')||[...dialog.querySelectorAll('button')].find(b=>/^(Close|关闭)$/i.test(b.getAttribute('aria-label')||''));close?.click();
    }else error.message+='；草稿未清空，保留编辑框，请手动保存';
   }
   throw error;
  }
 }

 const renderRemote=state=>{
  if(!state?.active){start.disabled=false;stop.disabled=true;if(!control)show(['unknown','submitting'].includes(state?.phase)?'上次发送结果未知，请核对平台记录':state?.error||'发帖已停止');return;}
  start.disabled=true;stop.disabled=false;
  if(!control){const remaining=Math.max(0,(state.nextAt||Date.now())-Date.now());output.textContent=`下次发帖 ${(remaining/1000).toFixed(1)} 秒 · 运行于另一个 X 标签页`;}
 };
 async function stopLoop(){
  control?.abort();await api.runtime('posting','stop');await runPromise;
  clearInterval(timer);progress(0);show('发帖已结束；已提交的请求无法撤回');start.disabled=false;stop.disabled=true;
 }
 async function countdown(deadline,signal,label,displayAt=deadline){
  const duration=Math.max(1,deadline-Date.now());
  while(Date.now()<deadline){check(signal);const remaining=Math.max(0,deadline-Date.now());progress(1-remaining/duration);output.textContent=`${label} ${(Math.max(0,displayAt-Date.now())/1000).toFixed(1)} 秒`;await sleep(Math.min(100,remaining),signal);}
 }
 async function launch(resume=false){
  if(control)return;
  if(!navigator.locks){show('浏览器不支持跨标签页执行锁');return;}
  runId=null;const own=new AbortController();control=own;const signal=own.signal;start.disabled=true;stop.disabled=false;
  const existing=await read(),lockOptions=resume||existing?.active?{ifAvailable:true}:{steal:true};
  runPromise=navigator.locks.request('x-assistant-original-post-loop',lockOptions,async lock=>{
   if(!lock)throw Error('发帖正在另一个 X 标签页运行');
   const account=await waitAccount(signal);
   const state=await api.runtime('posting','begin',{resume,account});runId=state.runId;
   let deadline=state.nextAt;
   while(!signal.aborted){
    // Sleep/wake skips backlog instead of sending bursts.
    if(deadline<Date.now()-120000)deadline=Date.now()+30000;
    await patch({phase:'waiting',nextAt:deadline});
    await countdown(Math.max(Date.now(),deadline-30000),signal,'下次发帖',deadline);
    let token=null;
    try{
     const gate=globalThis.XAssistantInteraction;if(!gate)throw Error('互动协调器未就绪');
     show('等待当前互动完成');token=await gate.pause();check(signal);
     deadline=Math.max(deadline,Date.now()+30000);
     await patch({phase:'paused_waiting',nextAt:deadline});
     await countdown(deadline,signal,'互动已暂停 · 下次发帖');
     if(await waitAccount(signal)!==account)throw Error('账号发生变化，已停止');
     const row=await api.runtime('posting','pick',{runId});check(signal);
     show('DeepSeek 正在生成发帖文案');await patch({phase:'generating',rowId:row.id});
     const generated=await api.call({kind:'AI_POST',runId,rowId:row.id});check(signal);
     if(generated.rowId!==row.id)throw Error('AI 发帖文案与参考条目不匹配');
     if(generated.action==='skip')throw Error('AI 跳过此主题，发帖已停止；未发送');
     if(generated.action!=='send_post')throw Error('AI 未返回有效发帖指令');
     if(await waitAccount(signal)!==account)throw Error('生成期间账号发生变化，未发送');
     await publish({...row,text:generated.text},signal,runId);check(signal);
     deadline=Date.now()+Math.round(core.randomSeconds(1800,3000)*1000);
    }finally{if(token)await globalThis.XAssistantInteraction?.resume(token);}
   }
  }).catch(async e=>{
   if(!signal.aborted&&e.name!=='AbortError'){
    show('发帖已停止：'+e.message);
    if(runId){try{await patch({error:e.message});await api.runtime('posting','stop');}catch{}}
   }
  }).finally(async()=>{if(control===own)control=null;renderRemote(await read());});
 }
 start.disabled=false;stop.disabled=true;
 start.onclick=async()=>{try{const account=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');if(await api.review('posting',account))await launch(false);}catch(e){show(e.message);}};stop.onclick=()=>stopLoop().catch(e=>show(e.message));
 read().then(s=>{if(s?.active)launch(true);else renderRemote(s);}).catch(e=>show(e.message));
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes[KEY])return;const s=changes[KEY].newValue;if(!s?.active)control?.abort();renderRemote(s);});
 mirrorTimer=setInterval(()=>{if(!control)read().then(renderRemote).catch(()=>{});},1000);
 window.addEventListener('x-assistant-invalidate',()=>control?.abort(),{once:true});
 window.addEventListener('pagehide',()=>{control?.abort();clearInterval(timer);clearInterval(mirrorTimer);},{once:true});
})();
