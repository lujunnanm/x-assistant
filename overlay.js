(()=>{
 if(document.getElementById('x-assistant-float'))return;
 const api=globalThis.XAssistantRuntime;let activeRun=null,account=null;
 const core=globalThis.XAssistantCore,RUNTIME='xAssistantRuntimeV1',FOLLOWED='xAssistantFollowedV1',PROCESSED='xAssistantProcessedV1';
 const root=document.createElement('aside');root.id='x-assistant-float';root.innerHTML=`
 <header><strong><img class="brand-icon" src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="">神圣计划</strong><button class="close" data-a="hide">—</button></header>
 <section data-module="interaction"><b>互动</b><label class="follow-option"><input type="checkbox" data-setting="auto-follow" checked disabled>自动关注</label><div class="row"><button data-a="start">开始</button><button class="danger" data-a="stop" disabled>结束</button></div><div class="status" data-status="interaction" role="status">互动模块已停止</div></section>
 <section data-module="posting"><b>发帖</b><div class="row"><button data-a="post-start" disabled>开始</button><button class="danger" data-a="post-stop" disabled>结束</button></div></section>
 <section data-module="notifications"><b>回帖</b><div class="row"><button data-a="reply-start">开始</button><button class="danger" data-a="reply-stop" disabled>结束</button></div><div class="status" data-status="notifications" role="status">回帖已停止</div></section>
 <section data-module="cleanup"><b>清理</b><div class="row"><button data-a="clean-start" disabled>开始</button><button class="danger" data-a="clean-stop" disabled>结束</button></div></section>`;document.documentElement.append(root);
root.dataset.build='3.0.15';
 const aiAlert=document.createElement('div');aiAlert.setAttribute('role','alert');aiAlert.style.cssText='color:#ffb4b4;background:#421f2b;padding:10px;white-space:normal';root.insertBefore(aiAlert,root.children[1]);
 const showAIError=s=>{aiAlert.hidden=!s?.error;aiAlert.textContent=s?.error?'AI 异常：'+s.error+' · 第 '+s.attempt+' 次失败 · '+(s.retrying?'正在重试，尚未发送':'生成失败，尚未发送。请检查网络、API 余额或插件密钥设置。'):'';};
 showAIError(null);chrome.storage.local.get('xAssistantAIStatusV1').then(d=>showAIError(d.xAssistantAIStatusV1));
 chrome.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c.xAssistantAIStatusV1)showAIError(c.xAssistantAIStatusV1.newValue);});

 const invalidate=()=>{window.dispatchEvent(new Event('x-assistant-invalidate'));root.querySelectorAll('button').forEach(button=>button.disabled=true);root.querySelectorAll('[role="status"]').forEach(status=>status.textContent='扩展已更新，请刷新当前 X 页面');};
 const heartbeat=setInterval(()=>{try{chrome.runtime.sendMessage({kind:'PING'},reply=>{if(chrome.runtime.lastError||!reply?.ok){clearInterval(heartbeat);invalidate();}});}catch{clearInterval(heartbeat);invalidate();}},5000);
 window.addEventListener('pagehide',()=>clearInterval(heartbeat),{once:true});
 root.querySelectorAll('section').forEach(section=>{
 const posting=section.dataset.module==='posting',cleanup=section.dataset.module==='cleanup',icon=document.createElement('span');icon.className='module-icon';icon.innerHTML=cleanup?'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9h18M12 9V6h8v3M10 9l1 17h10l1-17M14 13v9M18 13v9"/></svg>':posting?'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 27l2-9L22 3a4 4 0 015 5L12 24zM19 6l7 7"/></svg>':'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 24l-2 5 8-3a13 13 0 10-6-2z"/><circle cx="10" cy="14" r="1"/><circle cx="16" cy="14" r="1"/><circle cx="22" cy="14" r="1"/></svg>';section.prepend(icon);
 const timer=document.createElement('div');timer.className='countdown';timer.innerHTML='<span>—</span><small>秒</small>';section.insertBefore(timer,section.querySelector('.row'));
 const sync=()=>{const text=section.querySelector('.status')?.textContent||'',match=text.match(/(?:下次(?:发帖|清理|检查)\s*|·\s*)([0-9]+(?:\.[0-9]+)?)\s*秒/);const value=match?Number(match[1]).toFixed(1):'—';if(timer.querySelector('span').textContent!==value)timer.querySelector('span').textContent=value;section.title=text;};new MutationObserver(sync).observe(section,{childList:true,subtree:true,characterData:true});
 });
 const $=s=>root.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));let pauseRequested=false,running=false,controller=null,selected=null,hidden=false,sessionAuthors=new Set(),runPromise=Promise.resolve();
 const interactionStart=$('[data-a="start"]'),interactionStop=$('[data-a="stop"]');
 const interactionSection=$('[data-module="interaction"]');
 const setProgress=value=>interactionSection.style.setProperty('--progress',Math.max(0,Math.min(1,value)));
 const status=t=>($('[data-status="interaction"]').textContent=t,!/秒/.test(t)&&setProgress(0));
 const setButtons=on=>{interactionStart.disabled=on;interactionStop.disabled=!on;};
 const getLocal=async key=>(await chrome.storage.local.get(key))[key],setLocal=(key,value)=>chrome.storage.local.set({[key]:value});
 const runtime=async()=>await getLocal(RUNTIME)||{active:false,runId:null,cycleIndex:0,completed:0,phase:'stopped'};
 const updateRuntime=patch=>api.runtime('interaction','patch',{runId:activeRun,patch});
 const followed=async()=>await getLocal(FOLLOWED)||{handles:{}};
 const FOLLOW_SETTING='xAssistantAutoFollowV1',followToggle=$('[data-setting="auto-follow"]');
 const autoFollow=async()=>core.autoFollowEnabled(await getLocal(FOLLOW_SETTING));
 autoFollow().then(enabled=>{followToggle.checked=enabled;followToggle.disabled=false;}).catch(e=>status('关注设置读取失败：'+e.message));
 followToggle.onchange=async()=>{const next=followToggle.checked;followToggle.disabled=true;try{await setLocal(FOLLOW_SETTING,next);}catch(e){followToggle.checked=!next;status('关注设置保存失败：'+e.message);}finally{followToggle.disabled=false;}};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[FOLLOW_SETTING])followToggle.checked=core.autoFollowEnabled(changes[FOLLOW_SETTING].newValue);});
 const addFollowed=(info,source)=>api.call({kind:'FOLLOW_MERGE',rows:[{handle:'@'+info.author,displayName:info.displayName||'',lastSeenAt:new Date().toISOString(),source,owner:account?.slice(1)}]});
 const processed=async()=>await getLocal(PROCESSED)||{posts:{}};
 const saveProcessed=(info,record)=>api.call({kind:'PROCESSED',id:info.id,record:{author:'@'+info.author,url:info.url,at:new Date().toISOString(),...record}});
 const abortError=()=>new DOMException('互动已结束','AbortError'),check=s=>{if(s.aborted)throw abortError();if(account&&selfHandle()!==account.slice(1).toLowerCase())throw Error('账号发生变化，已停止');};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(abortError());}signal.addEventListener('abort',abort,{once:true});});
 const randomWait=async(min,max,signal,label)=>{const seconds=core.randomSeconds(min,max),total=seconds*1000,deadline=performance.now()+total;for(;;){check(signal);const remaining=Math.max(0,deadline-performance.now());setProgress(1-remaining/total);$('[data-status="interaction"]').textContent=`${label} · ${core.formatSeconds(remaining/1000)} 秒`;if(remaining<=0){setProgress(0);return;}await sleep(Math.min(100,remaining),signal);}};
 const normalized=v=>(v||'').replace(/(?:(?:https?:\/\/)?pic\.x\.com\/[A-Za-z0-9]+\s*)+$/,'').replace(/\s+/g,' ').trim();
 const postInfo=a=>{const link=[...a.querySelectorAll('a[href]')].find(x=>x.querySelector('time'));if(!link)return null;const u=new URL(link.href),m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);if(u.origin!=='https://x.com'||!m)return null;const author=m[1],authorLink=[...a.querySelectorAll('a[href]')].find(x=>{try{return new URL(x.href).pathname.toLowerCase()==='/'+author.toLowerCase()}catch{return false}}),analytics=a.querySelector(`a[href$="/status/${m[2]}/analytics"]`),viewLabel=analytics?.getAttribute('aria-label')||analytics?.textContent||'';return {quoteHandles:[...a.querySelectorAll('[role="link"]:not(a)')].flatMap(q=>[...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase())),article:a,url:u.origin+u.pathname,path:u.pathname,author,id:m[2],displayName:(authorLink?.textContent||'').trim(),text:(a.querySelector('[data-testid="tweetText"]')?.textContent||'（无文本内容）').trim(),time:a.querySelector('time')?.getAttribute('datetime'),views:globalThis.XAssistantCleanupCore.parseViews(viewLabel)};};
 const selfHandle=()=>{const a=document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');try{return new URL(a?.href).pathname.slice(1).toLowerCase()}catch{return'';}};
 const visiblePosts=()=>[...document.querySelectorAll('article[data-testid="tweet"]')].map(postInfo).filter(x=>x&&x.article.getBoundingClientRect().bottom>0&&x.article.getBoundingClientRect().top<innerHeight&&!/Promoted|推广|推荐广告/i.test(x.article.innerText));
 const clickNative=b=>{b.scrollIntoView({block:'center'});b.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};b.dispatchEvent(new PointerEvent('pointerdown',c));b.dispatchEvent(new MouseEvent('mousedown',c));b.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));b.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}b.click();};
 const waitFor=async(fn,count=80,delay=100,signal)=>{for(let i=0;i<count;i++){signal&&check(signal);const value=fn();if(value)return value;await sleep(delay,signal||new AbortController().signal);}return null;};
 const closeMenu=async(caret,menu,signal)=>{if(menu&&document.contains(menu))clickNative(caret);await waitFor(()=>!document.contains(menu),20,50,signal);};
 const inspectFollowState=async(info,signal)=>{check(signal);const caret=info.article.querySelector('[data-testid="caret"]');if(!caret)return'unknown';clickNative(caret);const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!menu)return'unknown';const own=t=>t.toLowerCase().includes('@'+info.author.toLowerCase()),items=[...menu.querySelectorAll('[role="menuitem"]')],text=x=>(x.textContent||'').trim();let state='unknown';if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x))))state='followed';else if(items.some(x=>own(text(x))&&/^(关注|回关|Follow|Follow back)\s/i.test(text(x))))state='unfollowed';await closeMenu(caret,menu,signal);if(state==='followed')await addFollowed(info,'observed');return state;};
 const findCandidate=async(desired,signal,followEnabled)=>{if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗，请先处理草稿');for(let screen=0;screen<=6;screen++){check(signal);if(pauseRequested)return null;const done=await processed(),self=selfHandle();if(!self)throw Error('无法核对当前账号');for(const info of visiblePosts()){if(info.author.toLowerCase()===self||done.posts[info.id]||sessionAuthors.has(info.author.toLowerCase()))continue;if(!followEnabled){if(core.highExposure(info.views,5000))return{...info,followState:'unrestricted'};continue;}const state=await inspectFollowState(info,signal);if(state===desired)return{...info,followState:state};}if(screen<6){const label=followEnabled?(desired==='followed'?'已关注':'未关注'):'曝光高于 5000';status(`本屏无${label}目标，滚动第 ${screen+1}/6 屏`);window.scrollBy({top:Math.max(600,innerHeight*.9),behavior:'smooth'});await sleep(1400,signal);}}return null;};
 const aiReply=async(info)=>api.call({kind:'AI_REPLY',runId:activeRun,post:{id:info.id,text:info.text}});
 const innermostDialog=()=>[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'))[0];
 let ownedReplyDialog=null,ownedReplyText='',replySubmitted=false;
 const cleanupDialog=async()=>{
  const cleaned=await globalThis.XAssistantReplyCleanup.cleanup({dialog:ownedReplyDialog,submitted:replySubmitted,expectedText:ownedReplyText,editorText:core.editorText,hasDialog:()=>!!document.querySelector('[role="dialog"],[role="alertdialog"]'),sleep:wait,clearEditor:async editor=>{editor.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));await wait(100);}});
  if(cleaned){ownedReplyDialog=null;ownedReplyText='';}return cleaned;
 };
 const replyAndSend=async(info,text,signal)=>{ownedReplyDialog=null;ownedReplyText='';replySubmitted=false;check(signal);info=relocatePost(info);if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗');const buttons=[...info.article.querySelectorAll('[data-testid="reply"]')];if(buttons.length!==1)throw Error('未找到唯一回复按钮');clickNative(buttons[0]);const editor=await waitFor(()=>{const opened=innermostDialog();if(opened&&!ownedReplyDialog)ownedReplyDialog=opened;return ownedReplyDialog?.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');},150,100,signal),dialog=ownedReplyDialog;if(!editor||!dialog)throw Error('回复输入框未就绪');const matched=await waitFor(()=>replyTargetMatches(dialog,info),30,100,signal);if(!matched)throw Error('回复目标核对失败：弹窗未包含匹配的原帖，已跳过');if(core.editorText(editor).trim())throw Error('回复框已有内容');ownedReplyDialog=dialog;ownedReplyText=text;editor.focus();const data=new DataTransfer();data.setData('text/plain',text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));await sleep(350,signal);if(!core.editorText(editor)){editor.focus();document.execCommand('insertText',false,text);}if(core.editorText(editor)!==core.editorText({innerText:text}))throw Error('文案粘贴回读不一致');const send=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');if(send.length!==1)throw Error('未找到唯一发送按钮');await updateRuntime({phase:'submitting',text,submittedAt:new Date().toISOString()});check(signal);
 const receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account,text,setInterval,clearInterval});
 try{replySubmitted=true;clickNative(send[0]);const result=await waitFor(()=>receipt.poll(),150,100,signal);if(result?.kind!=='confirmed')throw Error(result?.message||'回复提交结果未知');await updateRuntime({phase:'confirmed',receipt:result});ownedReplyDialog=null;replySubmitted=false;return'verified';}finally{receipt.close();}};
 const replyTargetMatches=(dialog,info)=>{
  const sameText=text=>{
   const value=normalized(text),expected=normalized(info.text);
   if(value===expected)return true;
   // Composer appends a shortened quote URL omitted from the timeline text.
   // Accept only an exact original body plus a handle present in its quote card.
   return (info.quoteHandles||[]).some(handle=>value===expected+' x.com/'+handle+'/st…');
  };
  const author='/'+info.author.toLowerCase();
  const exactContent=scope=>[...scope.querySelectorAll('a[href]')].some(a=>{try{return new URL(a.href).pathname.toLowerCase()===author;}catch{return false;}})&&sameText(scope.querySelector('[data-testid="tweetText"]')?.textContent)&&scope.querySelector('time')?.getAttribute('datetime')===info.time;
  const articles=[...dialog.querySelectorAll('article[data-testid="tweet"]')];
  // X composer previews have an article and time but often no status permalink.
  // In that layout verify author + full normalized content + exact timestamp.
  if(articles.length)return articles.some(article=>{
   const row=postInfo(article);
   return row?row.id===info.id&&row.author.toLowerCase()===info.author.toLowerCase()&&row.time===info.time&&sameText(row.text):exactContent(article);
  });
  return exactContent(dialog);
 };
 const relocatePost=info=>{
  const matches=[...document.querySelectorAll('article[data-testid="tweet"]')].map(postInfo).filter(row=>row&&row.id===info.id&&row.author.toLowerCase()===info.author.toLowerCase()&&row.time===info.time&&normalized(row.text)===normalized(info.text)&&row.article.isConnected);
  if(matches.length!==1)throw Error('目标帖子已更新或移出页面，本次操作跳过');
  return matches[0];
 };
  const likePost=async(info,signal)=>{check(signal);info=relocatePost(info);if(info.article.querySelectorAll('[data-testid="unlike"]').length===1)return'skipped';const buttons=[...info.article.querySelectorAll('[data-testid="like"]')].filter(b=>!b.disabled);if(buttons.length!==1)throw Error('未找到唯一点赞按钮');clickNative(buttons[0]);const ok=await waitFor(()=>{try{return relocatePost(info).article.querySelectorAll('[data-testid="unlike"]').length===1;}catch{return false;}},100,100,signal);return ok?'verified':'unknown';};
 const followAuthor=async(info,signal)=>{check(signal);if(!await autoFollow())return'skipped_disabled';info=relocatePost(info);const caret=info.article.querySelector('[data-testid="caret"]');if(!caret)throw Error('未找到帖子菜单');clickNative(caret);const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!menu)throw Error('帖子菜单未打开');const own=t=>t.toLowerCase().includes('@'+info.author.toLowerCase()),items=[...menu.querySelectorAll('[role="menuitem"]')],text=x=>(x.textContent||'').trim();if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)))){await closeMenu(caret,menu,signal);await addFollowed(info,'observed');return'skipped';}const matches=items.filter(x=>own(text(x))&&/^(关注|回关|Follow|Follow back)\s/i.test(text(x)));if(matches.length!==1){await closeMenu(caret,menu,signal);throw Error('菜单中未找到唯一关注项');}if(!await autoFollow()){await closeMenu(caret,menu,signal);return'skipped_disabled';}check(signal);clickNative(matches[0]);await waitFor(()=>!document.contains(menu),50,100,signal);await sleep(500,signal);clickNative(caret);const verify=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!verify)return'unknown';const confirmed=[...verify.querySelectorAll('[role="menuitem"]')].some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)));await closeMenu(caret,verify,signal);if(confirmed){await addFollowed(info,'interaction');return'verified';}return'unknown';};
 const markSelected=info=>{selected?.classList.remove('x-assistant-selected');selected=info.article;selected.classList.add('x-assistant-selected');};
  const runLoop=async(signal,runId)=>{while(!signal.aborted){if(pauseRequested)return;if(document.querySelector('[role="dialog"],[role="alertdialog"]')&&!await globalThis.XAssistantPopup.cancel())throw Error('弹窗无法取消，已停止');if(location.pathname!=='/home')throw Error('请在 X 主页启动互动；不会自动跳转覆盖当前页面');const r=await runtime();if(!r.active||r.runId!==runId)return;const followEnabled=await autoFollow(),desired=followEnabled?core.desiredAuthorType(r.cycleIndex):'high_exposure';status(followEnabled?`正在寻找${desired==='followed'?'已关注':'未关注'}作者`:'正在寻找曝光高于 5000 的帖子');const info=await findCandidate(desired,signal,followEnabled);if(!info){if(pauseRequested)return;status('六次滚屏仍无目标，3 秒后刷新主页继续寻找');await updateRuntime({phase:'refreshing'});await sleep(3000,signal);check(signal);if(pauseRequested)return;const latest=await runtime();if(!latest.active||latest.runId!==runId)return;if(document.querySelector('[role="dialog"]'))throw Error('已有弹窗，取消刷新以保护草稿');const replies=await api.runtime('notifications','get');if(replies.active&&replies.phase!=='waiting'){await sleep(1000,signal);continue;}const post=await api.runtime('posting','get');if(post.active&&post.phase!=='waiting'){await sleep(1000,signal);continue;}if(globalThis.XAssistantScheduler){await globalThis.XAssistantScheduler.beforeRefresh();}location.reload();return;}sessionAuthors.add(info.author.toLowerCase());markSelected(info);status('DeepSeek 正在读取帖子并写回复');const generated=await aiReply(info);check(signal);if(pauseRequested)return;if(generated.postId!==info.id)throw Error('AI 回复目标不匹配');if(generated.skippedGenerationError){sessionAuthors.delete(info.author.toLowerCase());selected?.classList.remove('x-assistant-selected');selected=null;await randomWait(followEnabled?60:5,followEnabled?90:10,signal,generated.reason+'，本条未发送，等待下一帖');continue;}if(generated.action==='skip'){await saveProcessed(info,{reply:'skipped_ai'});selected?.classList.remove('x-assistant-selected');selected=null;await randomWait(followEnabled?10:5,followEnabled?20:10,signal,'AI 主动跳过（并非发送失败），等待下一帖');continue;}if(generated.action!=='send_reply')throw Error('AI 未返回有效发送指令');const reply=generated.text,record={authorType:desired,views:info.views,replyText:reply,reply:'in_flight',like:'pending',follow:followEnabled?(desired==='followed'?'skipped':'pending'):'skipped_disabled'};await saveProcessed(info,record);status(`正在评价 @${info.author}`);try{record.reply=await replyAndSend(info,reply,signal);await saveProcessed(info,record);}catch(e){const uncertain=replySubmitted;record.reply=uncertain?'unknown':'failed';record.error=e.message;const popup=!!document.querySelector('[role="dialog"],[role="alertdialog"]');const cleaned=uncertain?false:popup?await globalThis.XAssistantPopup.cancel():await cleanupDialog();if(popup&&!uncertain&&cleaned)record.reply='skipped_popup';await saveProcessed(info,record);selected?.classList.remove('x-assistant-selected');selected=null;if(e.name==='AbortError')throw e;if(uncertain)throw Error('回复提交结果未知，互动已停止，避免重复操作');if(!cleaned)throw Error('回复草稿无法安全清理，互动已停止');await randomWait(5,followEnabled?20:10,signal,'本条未发送，等待下一个帖子');continue;}await randomWait(followEnabled?5:3,followEnabled?10:5,signal,'评价完成，等待点赞');status(`正在点赞 @${info.author}`);try{record.like=await likePost(info,signal);}catch(e){record.like=e.name==='AbortError'?'unknown':'failed';record.error=[record.error,e.message].filter(Boolean).join('；');if(e.name==='AbortError'){await saveProcessed(info,record);throw e;}}await saveProcessed(info,record);if(followEnabled&&desired==='unfollowed'&&!await autoFollow()){record.follow='skipped_disabled';await saveProcessed(info,record);}else if(followEnabled&&desired==='unfollowed'){await randomWait(5,10,signal,record.like==='verified'||record.like==='skipped'?'点赞已确认，等待关注':'点赞未确认，等待关注');status(`正在关注 @${info.author}`);try{record.follow=await followAuthor(info,signal);}catch(e){record.follow=e.name==='AbortError'?'unknown':'failed';record.error=[record.error,e.message].filter(Boolean).join('；');if(e.name==='AbortError'){await saveProcessed(info,record);throw e;}}await saveProcessed(info,record);}const latest=await runtime();await updateRuntime({cycleIndex:followEnabled?core.nextCycleIndex(latest.cycleIndex):latest.cycleIndex,completed:(latest.completed||0)+1,phase:'waiting'});selected?.classList.remove('x-assistant-selected');selected=null;if(pauseRequested)return;await randomWait(followEnabled?40:5,followEnabled?60:10,signal,record.like==='verified'||record.like==='skipped'?'本帖处理结束，等待下一帖':'评价已发送，点赞未成功确认，等待下一帖');}};

 // A single owner per module; the background rejects cross-tab module splitting.
 const start=async(resume=false)=>{
  if(running)return;
  if(!navigator.locks){status('浏览器不支持执行锁');return;}
  activeRun=null;running=true;pauseRequested=false;controller=new AbortController();const signal=controller.signal;setButtons(true);
  const existing=await runtime(),lockOptions=resume||existing.active?{ifAvailable:true}:{steal:true};
  runPromise=navigator.locks.request('x-assistant-interaction-v2',lockOptions,async lock=>{
   if(!lock){status('互动正在另一个 X 标签页执行');return;}
   if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗，请先处理草稿');if(location.pathname!=='/home')throw Error('请在 X 主页启动互动');
   if(resume){account=null;await waitFor(()=>selfHandle(),150,100,signal);check(signal);}
   account='/'+selfHandle();
   const s=await api.runtime('interaction','begin',{resume,account});activeRun=s.runId;
   status(resume?'已恢复互动循环':'互动循环已开始');sessionAuthors=new Set();
   await runLoop(signal,activeRun);
  }).catch(async e=>{
   if(e.name==='AbortError'||signal.aborted)return;
   status('互动循环停止：'+e.message);
   if(activeRun){try{await updateRuntime({error:e.message});await api.runtime('interaction','stop');}catch{}}
  }).finally(async()=>{running=false;const latest=await runtime();setButtons(!!latest.active);if(latest.active&&!pauseRequested)status('互动正在执行或等待刷新恢复');});
 };
 const stop=async()=>{
  controller?.abort();await api.runtime('interaction','stop');await runPromise;
  await cleanupDialog();selected?.classList.remove('x-assistant-selected');selected=null;
  status('互动模块已结束');setButtons(false);
 };
 const pauseAfterCurrent=async()=>{
  pauseRequested=true;status('发帖等待交接：完成当前互动后暂停');await runPromise;
  if(document.querySelector('[role="dialog"]'))throw Error('互动尚有弹窗，未交接发帖');
  if(activeRun){const s=await runtime();if(s.active&&s.runId===activeRun)await updateRuntime({phase:'paused'});}
 };
 const gate=globalThis.createInteractionGate({isRunning:()=>running,stop:pauseAfterCurrent,start:()=>start(true),onPaused:()=>{status('互动已暂停，等待发帖完成');interactionStart.disabled=true;interactionStop.disabled=false;}});
 globalThis.XAssistantInteraction=gate;
 globalThis.XAssistantInteractionDriver={start,pause:pauseAfterCurrent,stop,isRunning:()=>running};
 const safe=fn=>()=>Promise.resolve().then(fn).catch(e=>status(e.message));
 interactionStart.onclick=safe(async()=>{const p=await api.runtime('posting','get');if(['paused_waiting','submitting'].includes(p.phase)&&p.active)throw Error('发帖正在交接或发送，请稍候');if(!await api.review('interaction','/'+selfHandle()))return;gate.cancel();await start(false);});
 interactionStop.onclick=safe(()=>{gate.cancel();return stop();});
 $('[data-a="hide"]').onclick=()=>{hidden=!hidden;root.querySelectorAll(':scope > :not(header)').forEach(x=>x.style.display=hidden?'none':'');$('[data-a="hide"]').textContent=hidden?'+':'—';};
 chrome.storage.onChanged.addListener((changes,area)=>{
  const s=changes[RUNTIME]?.newValue;if(area!=='local'||!s)return;
  if(!s.active){gate.cancel();controller?.abort();setButtons(false);if(!running)status('互动模块已停止');}
  else if(!running){setButtons(true);status(s.phase==='paused'?'互动已暂停，等待发帖完成':'互动正在另一个 X 标签页运行');}
 });
 runtime().then(r=>{if(r.active&&!globalThis.XAssistantSchedulerCore)start(true);else if(['unknown','submitting'].includes(r.phase))status('上次回复结果未知，请先核对平台记录');}).catch(e=>status(e.message));
 window.addEventListener('x-assistant-invalidate',()=>controller?.abort(),{once:true});
 window.addEventListener('pagehide',()=>controller?.abort(),{once:true});
})();
