// Independent original-post loop. Never likes, follows or replies.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root||root.dataset.postingReady)return;root.dataset.postingReady='1';
 const core=globalThis.XAssistantCore;
 const start=root.querySelector('[data-a="post-start"]'),stop=root.querySelector('[data-a="post-stop"]'),KEY='xAssistantPostingV1';
 const section=start.closest('section'),output=document.createElement('div');output.className='status';output.dataset.status='posting';output.setAttribute('role','status');output.textContent='发帖已停止 · 随机间隔 600.0–900.0 秒';section.append(output);
 let control=null,timer=null;const progress=value=>section.style.setProperty('--progress',Math.max(0,Math.min(1,value)));const show=t=>(output.textContent=t,!/下次发帖/.test(t)&&progress(0));
 const read=async()=> (await chrome.storage.local.get(KEY))[KEY];
 const check=signal=>{if(signal.aborted)throw new DOMException('发帖已停止','AbortError');};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(new DOMException('发帖已停止','AbortError'));}signal.addEventListener('abort',abort,{once:true});});
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const wait=async(fn,signal)=>{for(let n=0;n<150;n++){check(signal);const value=fn();if(value)return value;await sleep(100,signal);}throw Error('页面响应超时，已停止，避免重复发帖');};
 const waitAccount=async signal=>{for(let n=0;n<300;n++){check(signal);const href=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');if(href)return href;await sleep(100,signal);}throw Error('无法核对当前登录账号');};
 async function publish(row,signal,runId){
  check(signal);
  if(document.querySelector('[role="dialog"]'))throw Error('已有弹窗，未发送');
  // Always use the global composer, scoped to its new dialog, on every X route.
  const launchers=[...document.querySelectorAll('[data-testid="SideNav_NewTweet_Button"]')].filter(visible);
  if(launchers.length!==1)throw Error('未找到唯一的全局发帖入口');
  launchers[0].click();
  const dialog=await wait(()=>{const ds=[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'));return ds.length===1?ds[0]:null;},signal);
  const editor=await wait(()=>{const es=[...dialog.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]')].filter(visible);return es.length===1?es[0]:null;},signal);
  if(editor.textContent.trim())throw Error('发帖框已有用户草稿，未覆盖');
  if(dialog.querySelector('[data-testid="tweetText"]'))throw Error('检测到回复或引用上下文，未发送');
  const copy=await chrome.runtime.sendMessage({kind:'COPY_TEXT',text:row.text});check(signal);if(!copy?.ok)throw Error(copy?.error||'复制失败');
  editor.scrollIntoView({block:'center'});editor.focus();const data=new DataTransfer();data.setData('text/plain',row.text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  await wait(()=>core?.editorText(editor)===core?.editorText({innerText:row.text}),signal);
  const buttons=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');if(buttons.length!==1)throw Error('未找到唯一可用发帖按钮');
  const state=await read();check(signal);if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
  await chrome.storage.local.set({[KEY]:{...state,phase:'submitting',text:row.text,rowId:row.id,submittedAt:new Date().toISOString()}});check(signal);
  const previousToasts=new Set(document.querySelectorAll('[data-testid="toast"]'));
  buttons[0].click();
  // Require explicit success toast, not merely a closed/cleared composer.
  await wait(()=>[...document.querySelectorAll('[data-testid="toast"]')].find(e=>!previousToasts.has(e)&&/你的帖子已发送|Your post was sent|Your Tweet was sent/i.test(e.textContent)),signal);
  const latest=await read();await chrome.storage.local.set({[KEY]:{...latest,phase:'confirmed',completed:(latest.completed||0)+1,lastId:row.id}});
 }
 async function stopLoop(){control?.abort();clearInterval(timer);progress(0);const state=await read();await chrome.storage.local.set({[KEY]:{...state,active:false,nextAt:null,phase:state?.phase==='submitting'?'unknown':'stopped'}});start.disabled=false;stop.disabled=true;show('发帖已结束；已提交的请求无法撤回，未发起下一条');}
 start.disabled=false;stop.disabled=true;
 stop.onclick=()=>stopLoop().catch(e=>show(e.message));
 async function launch(resume=false){
  if(control&&!control.signal.aborted)return;
  if(!navigator.locks){show('当前浏览器不支持跨标签页执行锁');return;}
  control=new AbortController();const signal=control.signal;start.disabled=true;stop.disabled=false;
  navigator.locks.request('x-assistant-original-post-loop',{ifAvailable:true},async lock=>{
   if(!lock){show('另一个 X 标签页正在发帖；可在此结束全局循环');return;}
   const {app}=await chrome.storage.local.get('app');if(!app?.rows?.some(r=>r.type==='post'&&r.enabled&&r.text?.trim()))throw Error('发帖文案库为空');
   const saved=await read();
   if(resume&&!saved?.active)return;
   const runId=resume?saved.runId:crypto.randomUUID();let bag=[],last=null,pendingNextAt=resume?saved.nextAt:null;
   const account=await waitAccount(signal);
   if(resume&&saved.account!==account)throw Error('登录账号与上次循环不一致');
   if(!resume)await chrome.storage.local.set({[KEY]:{active:true,runId,account,completed:0,phase:'waiting'}});
   while(!signal.aborted){
    const randomMs=(6000+Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296*3001))*100;
    const nextAt=Number.isFinite(pendingNextAt)?pendingNextAt:Date.now()+randomMs,ms=Math.max(0,nextAt-Date.now())||1;pendingNextAt=null;
    const state=await read();if(!state?.active||state.runId!==runId)throw new DOMException('已停止','AbortError');
    await chrome.storage.local.set({[KEY]:{...state,nextAt,phase:'waiting'}});
    timer=setInterval(()=>{const remaining=Math.max(0,nextAt-Date.now());progress(1-remaining/ms);output.textContent=`下次发帖 ${(remaining/1000).toFixed(1)} 秒 · 600.0–900.0 秒随机`;},100);
    await sleep(ms,signal);clearInterval(timer);check(signal);
    if(document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')!==account)throw Error('账号发生变化，已停止');
    const {app}=await chrome.storage.local.get('app'),rows=(app?.rows||[]).filter(r=>r.type==='post'&&r.enabled&&r.text?.trim());
    if(!rows.length)throw Error('发帖文案库为空');const ids=new Set(rows.map(r=>r.id));bag=bag.filter(id=>ids.has(id));
    if(!bag.length){bag=rows.map(r=>r.id);for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}if(bag.length>1&&bag[0]===last)[bag[0],bag[1]]=[bag[1],bag[0]];}
    const row=rows.find(r=>r.id===bag.shift());last=row.id;show('等待互动模块停止后发帖');
    const gate=globalThis.XAssistantInteraction;if(!gate)throw Error('互动协调器未就绪');
    const resumeToken=await gate.pause();check(signal);
    show('正在发送文案 '+row.id);await publish(row,signal,runId);check(signal);
    await gate.resume(resumeToken);show('平台已提示发送成功，准备下一轮');
   }
  }).catch(async e=>{clearInterval(timer);if(e.name!=='AbortError'){control?.abort();const state=await read();await chrome.storage.local.set({[KEY]:{...state,active:false,nextAt:null,error:e.message,phase:state?.phase==='submitting'?'unknown':'error'}});show('发帖已停止：'+e.message);}start.disabled=false;stop.disabled=true;});
 }
 start.onclick=()=>launch(false);
 read().then(state=>{if(state?.active)setTimeout(()=>launch(true),1200);});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY]?.newValue?.active===false)control?.abort();});
 window.addEventListener('pagehide',()=>{control?.abort();clearInterval(timer);});
})();
