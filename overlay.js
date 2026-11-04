// Interaction driver; the scheduler is the only start/stop entry point.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root)return;
 const api=globalThis.XAssistantRuntime;let activeRun=null,account=null;
 const core=globalThis.XAssistantCore,RUNTIME='xAssistantRuntimeV1',FOLLOWED='xAssistantFollowedV1',PROCESSED='xAssistantProcessedV1';
 const $=s=>root.querySelector(s);let pauseRequested=false,running=false,controller=null,selected=null,hidden=false,sessionAuthors=new Set(),runPromise=Promise.resolve();
 const interactionSection=$('[data-module="interaction"]');
 const setProgress=value=>interactionSection.style.setProperty('--progress',Math.max(0,Math.min(1,value)));
 const status=t=>($('[data-status="interaction"]').textContent=t,!/秒/.test(t)&&setProgress(0));
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
 const abortError=()=>new DOMException('互动已结束','AbortError'),check=s=>{if(s.aborted)throw abortError();if(account&&selfHandle()!==account.slice(1).toLowerCase())throw Object.assign(Error('账号发生变化，当前项已跳过'),{code:'ACCOUNT_CHANGED'});};
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(abortError());}signal.addEventListener('abort',abort,{once:true});});
 const randomWait=async(min,max,signal,label)=>{const seconds=core.randomSeconds(min,max),total=seconds*1000,deadline=performance.now()+total;if(total<=0){setProgress(0);return;}for(;;){check(signal);const remaining=Math.max(0,deadline-performance.now());setProgress(1-remaining/total);$('[data-status="interaction"]').textContent=`${label} · ${core.formatSeconds(remaining/1000)} 秒`;if(remaining<=0){setProgress(0);return;}await sleep(Math.min(100,remaining),signal);}};

 const postInfo=a=>{const link=[...a.querySelectorAll('a[href]')].find(x=>x.querySelector('time'));if(!link)return null;const u=new URL(link.href),m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);if(u.origin!=='https://x.com'||!m)return null;const author=m[1],authorLink=[...a.querySelectorAll('a[href]')].find(x=>{try{return new URL(x.href).pathname.toLowerCase()==='/'+author.toLowerCase()}catch{return false}}),analytics=a.querySelector(`a[href$="/status/${m[2]}/analytics"]`),viewLabel=analytics?.getAttribute('aria-label')||analytics?.textContent||'';return {quoteHandles:[...a.querySelectorAll('[role="link"]:not(a)')].flatMap(q=>[...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase())),article:a,url:u.origin+u.pathname,path:u.pathname,author,id:m[2],displayName:(authorLink?.textContent||'').trim(),text:(a.querySelector('[data-testid="tweetText"]')?.textContent||'（无文本内容）').trim(),time:a.querySelector('time')?.getAttribute('datetime'),views:core.parseViews(viewLabel)};};
 const selfHandle=()=>{const a=document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');try{return new URL(a?.href).pathname.slice(1).toLowerCase()}catch{return'';}};
 const visiblePosts=()=>[...document.querySelectorAll('article[data-testid="tweet"]')].map(postInfo).filter(x=>x&&x.article.getBoundingClientRect().bottom>0&&x.article.getBoundingClientRect().top<innerHeight&&!/Promoted|推广|推荐广告/i.test(x.article.innerText));
 const clickNative=b=>{b.scrollIntoView({block:'center'});b.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};b.dispatchEvent(new PointerEvent('pointerdown',c));b.dispatchEvent(new MouseEvent('mousedown',c));b.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));b.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}b.click();};
 const waitFor=(probe,count=80,delay=100,signal)=>globalThis.XAssistantTasks.waitFor(()=>{if(signal)check(signal);return probe();},{signal,timeout:count*delay,interval:delay});
 const closeMenu=async(caret,menu,signal)=>{if(menu&&document.contains(menu))clickNative(caret);await waitFor(()=>!document.contains(menu),20,50,signal);};
 const inspectFollowState=async(info,signal)=>{check(signal);const caret=info.article.querySelector('[data-testid="caret"]');if(!caret)return'unknown';clickNative(caret);const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!menu)return'unknown';const own=t=>t.toLowerCase().includes('@'+info.author.toLowerCase()),items=[...menu.querySelectorAll('[role="menuitem"]')],text=x=>(x.textContent||'').trim();let state='unknown';if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x))))state='followed';else if(items.some(x=>own(text(x))&&/^(关注|回关|Follow|Follow back)\s/i.test(text(x))))state='unfollowed';await closeMenu(caret,menu,signal);if(state==='followed')await addFollowed(info,'observed');return state;};
 const reasonLabels={self:'自己的帖子',confirmed:'已成功回复',uncertain:'发送结果待核对',retry_cooldown:'暂时退避',author_confirmed:'本轮已回复该作者',views_missing:'曝光无法读取',low_views:'曝光不足500',unrelated:'交友语义不符'};
 let diagnostics={seen:0,skips:{},outcomes:{},last:null},observedPosts=new Set(),observedReasons=new Set();
 const recordCandidate=(info,reason)=>{
  if(!observedPosts.has(info.id)){observedPosts.add(info.id);diagnostics.seen++;}
  const key=info.id+':'+reason;
  if(reason&&!observedReasons.has(key)){observedReasons.add(key);diagnostics.skips[reason]=(diagnostics.skips[reason]||0)+1;diagnostics.last={postId:info.id,reason,at:Date.now()};}
 };
 const recordOutcome=(info,reason)=>{diagnostics.outcomes[reason]=(diagnostics.outcomes[reason]||0)+1;diagnostics.last={postId:info.id,reason,at:Date.now()};};
 const publishDiagnostics=()=>updateRuntime({diagnostics:{...diagnostics,skips:{...diagnostics.skips},outcomes:{...diagnostics.outcomes}}});
 const skipSummary=()=>Object.entries(diagnostics.skips).map(([name,count])=>`${reasonLabels[name]} ${count}`).join(' · ');
 const findCandidate=async(signal,followEnabled)=>{
  if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗，请先处理草稿');
  const lastScreen=6;
  for(let screen=0;screen<=lastScreen;screen++){
   check(signal);if(pauseRequested)return null;
   const done=await processed(),self=selfHandle();if(!self)throw Error('无法核对当前账号');
   for(const info of visiblePosts()){
    const reason=core.interactionSkipReason(info,{self,record:done.posts[info.id],authors:sessionAuthors});
    recordCandidate(info,reason);if(reason)continue;
    await publishDiagnostics();
    if(!followEnabled)return{...info,followState:'unrestricted'};
    const state=await inspectFollowState(info,signal);return{...info,followState:state};
   }
   if(screen<lastScreen){status(`本屏无合格目标，滚动第 ${screen+1}/${lastScreen} 屏 · ${skipSummary()}`);window.scrollBy({top:Math.max(600,innerHeight*.9),behavior:'smooth'});await sleep(1400,signal);}
  }
  await publishDiagnostics();return null;
 };
 const aiReply=async(info)=>api.call({kind:'AI_REPLY',runId:activeRun,post:{id:info.id,text:info.text}});
 // Sending is a single guarded transaction shared with notification replies.
 let replySubmitted=false;
 const cleanupDialog=async()=>replySubmitted?false:globalThis.XAssistantPopup.cancel();
 const replyAndSend=async(info,text,signal,onConfirmed)=>{
  replySubmitted=false;check(signal);
  try{
   await globalThis.XAssistantReplyEngine.send({
    row:info,text,account,signal,patch:updateRuntime,
    onConfirmed
   });
   return 'verified';
  }catch(error){replySubmitted=!!error.submitted&&!error.confirmed;throw error;}
 };
 const relocatePost=info=>{
  const row=globalThis.XAssistantDOM.relocate(info,account||'/'+selfHandle());
  if(!row)throw Error('目标帖子已更新或移出页面，本次操作跳过');
  return {...info,...row};
 };
  const likePost=async(info,signal)=>{check(signal);info=relocatePost(info);if(info.article.querySelectorAll('[data-testid="unlike"]').length===1)return'skipped';const buttons=[...info.article.querySelectorAll('[data-testid="like"]')].filter(b=>!b.disabled);if(buttons.length!==1)throw Error('未找到唯一点赞按钮');clickNative(buttons[0]);const ok=await waitFor(()=>{try{return relocatePost(info).article.querySelectorAll('[data-testid="unlike"]').length===1;}catch{return false;}},100,100,signal);return ok?'verified':'unknown';};
 const followAuthor=async(info,signal)=>{check(signal);if(!await autoFollow())return'skipped_disabled';info=relocatePost(info);const caret=info.article.querySelector('[data-testid="caret"]');if(!caret)throw Error('未找到帖子菜单');clickNative(caret);const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!menu)throw Error('帖子菜单未打开');const own=t=>t.toLowerCase().includes('@'+info.author.toLowerCase()),items=[...menu.querySelectorAll('[role="menuitem"]')],text=x=>(x.textContent||'').trim();if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)))){await closeMenu(caret,menu,signal);await addFollowed(info,'observed');return'skipped';}const matches=items.filter(x=>own(text(x))&&/^(关注|回关|Follow|Follow back)\s/i.test(text(x)));if(matches.length!==1){await closeMenu(caret,menu,signal);throw Error('菜单中未找到唯一关注项');}if(!await autoFollow()){await closeMenu(caret,menu,signal);return'skipped_disabled';}check(signal);clickNative(matches[0]);await waitFor(()=>!document.contains(menu),50,100,signal);await sleep(500,signal);clickNative(caret);const verify=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!verify)return'unknown';const confirmed=[...verify.querySelectorAll('[role="menuitem"]')].some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)));await closeMenu(caret,verify,signal);if(confirmed){await addFollowed(info,'interaction');return'verified';}return'unknown';};
 const markSelected=info=>{selected?.classList.remove('x-assistant-selected');selected=info.article;selected.classList.add('x-assistant-selected');};
 const deferRecord=(info,record)=>saveProcessed(info,{...record,retryAt:Date.now()+Math.max(60000,globalThis.XAssistantTime.ms('interaction'))});
 const waitAfterAttempt=async(signal,label='等待下一帖')=>{
  check(signal);await publishDiagnostics();if(pauseRequested)return;
  const end=await globalThis.XAssistantTime.arm('interaction',activeRun,account);
  const seconds=Math.max(0,(end-Date.now())/1000);
  await randomWait(seconds,seconds,signal,label);
 };
  const runLoop = async (signal, runId) => {
  while (!signal.aborted) {
   if (pauseRequested) return;
   if (document.querySelector('[role="dialog"],[role="alertdialog"]') && !await globalThis.XAssistantPopup.cancel())
    throw Object.assign(Error('弹窗无法取消，30 秒后重试'),{code:'CLEANUP_FAILED'});
   const desiredPage=await globalThis.XAssistantEntry?.targetFor?.();
   if (!core.interactionPage(location.href) || (desiredPage && location.pathname+location.search !== desiredPage)) {
    await globalThis.XAssistantEntry.enter('interaction',signal);
    continue;
   }

   const r = await runtime();
   if (!r.active || r.runId !== runId) return;
   const followEnabled = await autoFollow();
   status('正在寻找交友帖 · 曝光≥500');
   const info = await findCandidate(signal, followEnabled);

   if (!info) {
    if (pauseRequested) return;
    if (await globalThis.XAssistantEntry?.nextFriendTopic?.()) {
     await globalThis.XAssistantEntry.enter('interaction',signal);
     continue;
    }
    status('六次滚屏仍无目标，3 秒后刷新当前页面继续寻找');
    await updateRuntime({phase: 'refreshing'});
    await sleep(3000, signal);
    check(signal);
    if (pauseRequested) return;
    const latest = await runtime();
    if (!latest.active || latest.runId !== runId) return;
    if (document.querySelector('[role="dialog"]'))
     throw Error('已有弹窗，取消刷新以保护草稿');
    const replies = await api.runtime('notifications', 'get');
    if (replies.active && replies.phase !== 'waiting') {
     await sleep(1000, signal);
     continue;
    }
    const post = await api.runtime('posting', 'get');
    if (post.active && post.phase !== 'waiting') {
     await sleep(1000, signal);
     continue;
    }
    if (globalThis.XAssistantScheduler) {
     await globalThis.XAssistantScheduler.beforeRefresh();
    }
    location.reload();
    return;
   }

   markSelected(info);
   status('DeepSeek 正在读取帖子并写回复');
   const generated = await aiReply(info);
   check(signal);
   if (pauseRequested) return;
   if (generated.postId !== info.id) throw Error('AI 回复目标不匹配');

   if (generated.skippedGenerationError) {
    recordOutcome(info,'ai_error');
    await deferRecord(info,{reply:'ai_error',reasonCode:generated.reasonCode,error:generated.reason});
    selected?.classList.remove('x-assistant-selected');
    selected = null;
    await waitAfterAttempt(signal,'AI 生成失败，等待下一帖');
    continue;
   }
   if (generated.action === 'skip') {
    recordOutcome(info,'ai_skip');
    await deferRecord(info,{reply:'skipped_ai',reasonCode:generated.skipReason||'model_choice'});
    selected?.classList.remove('x-assistant-selected');
    selected = null;
    await waitAfterAttempt(signal,'AI 主动跳过，等待下一帖');
    continue;
   }
   if (generated.action !== 'send_reply') throw Error('AI 未返回有效发送指令');

   const reply = generated.text,
    record = {
     authorType: info.followState,
     views: info.views,
     replyText: reply,
     reply: 'in_flight',
     like: 'disabled',
     follow: followEnabled ? (info.followState === 'unfollowed' ? 'pending' : info.followState === 'followed' ? 'skipped' : 'skipped_unknown') : 'skipped_disabled'
    };
   await saveProcessed(info, record);
   status(`正在评价 @${info.author}`);
   try {
    record.reply = await replyAndSend(info, reply, signal, async () => {
     record.reply = 'verified';
     sessionAuthors.add(info.author.toLowerCase());
     recordOutcome(info,'confirmed');
     await saveProcessed(info, record);
    });
    await saveProcessed(info, record);
   } catch (e) {
    if (e.confirmed || record.reply === 'verified') {
     record.reply = 'verified';
     await saveProcessed(info, record);
     throw e;
    }
    const uncertain = replySubmitted;
    record.reply = uncertain ? 'unknown' : ['ACCOUNT_CHANGED','CLEANUP_FAILED','RESIDUAL_DRAFT'].includes(e.code) ? 'skipped_issue' : 'failed';
    record.error = e.message;
    record.reasonCode = e.code || 'REPLY_FAILURE';
    if (e.cause) record.cause = {code:e.cause.code || 'REPLY_FAILURE',message:e.cause.message};
    const popup = !!document.querySelector('[role="dialog"],[role="alertdialog"]');
    const cleaned = popup ? await globalThis.XAssistantPopup.cancel() : true;
    // Keep the original failure code; an open reply composer is not itself the cause.
    recordOutcome(info,uncertain?'unknown':'send_failed');
    if(uncertain)await saveProcessed(info,record);else await deferRecord(info,record);
    selected?.classList.remove('x-assistant-selected');
    selected = null;
    if (e.name === 'AbortError') throw e;
    if (!cleaned || e.code === 'CLEANUP_FAILED') throw Object.assign(Error('回复草稿无法安全清理，30 秒后重试'),{code:'CLEANUP_FAILED',cause:e});
    if (uncertain) {
     // The per-post ledger already quarantines this target. Return the module
     // runtime to a non-submitting phase so the next target may proceed safely.
     await updateRuntime({phase:'waiting'});
     replySubmitted = false;
    }
    await waitAfterAttempt(signal,uncertain?'结果未知，隔离当前帖并等待':'本次未发送，等待下一帖');
    continue;
   }

   record.like = 'disabled';
   if (followEnabled && info.followState === 'unfollowed' && !await autoFollow()) {
    record.follow = 'skipped_disabled';
    await saveProcessed(info, record);
   } else if (followEnabled && info.followState === 'unfollowed') {
    status(`正在关注 @${info.author}`);
    try {
     record.follow = await followAuthor(info, signal);
    } catch (e) {
     record.follow = e.name === 'AbortError' ? 'unknown' : 'failed';
     record.error = [record.error, e.message].filter(Boolean).join('；');
     if (e.name === 'AbortError') {
      await saveProcessed(info, record);
      throw e;
     }
    }
    await saveProcessed(info, record);
   }

   const latest = await runtime();
   await updateRuntime({
    completed: (latest.completed || 0) + 1,
    phase: 'waiting'
   });
   selected?.classList.remove('x-assistant-selected');
   selected = null;
   if (pauseRequested) return;

   await waitAfterAttempt(signal);
  }
 };

 // A single owner per module; the background rejects cross-tab module splitting.
 const start=async(resume=false)=>{
  if(running)return;
  if(!navigator.locks){status('浏览器不支持执行锁');throw Error('浏览器不支持执行锁');}
  activeRun=null;running=true;pauseRequested=false;controller=new AbortController();const signal=controller.signal;
  const existing=await runtime(),lockOptions=resume||existing.active?{ifAvailable:true}:{steal:true};
  let readyResolve,readyReject,readySettled=false;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const started=()=>{if(!readySettled){readySettled=true;readyResolve();}};
  const failed=e=>{if(!readySettled){readySettled=true;readyReject(e);}};
  runPromise=navigator.locks.request('x-assistant-interaction-v2',lockOptions,async lock=>{
   if(!lock)throw Error('互动正在另一个 X 标签页执行');
   if(document.querySelector('[role="dialog"],[role="alertdialog"]')&&!await globalThis.XAssistantPopup.cancel())throw Object.assign(Error('页面草稿无法安全清理，30 秒后重试'),{code:'CLEANUP_FAILED'});
   if(!core.interactionPage(location.href))throw Error('请在 X 主页或帖子搜索结果页启动互动');
   if(resume){account=null;await waitFor(()=>selfHandle(),150,100,signal);check(signal);}
   account='/'+selfHandle();
   const s=await api.runtime('interaction','begin',{resume,account});activeRun=s.runId;
   started();
   await globalThis.XAssistantTime.ready;
   const remaining=Math.max(0,((await globalThis.XAssistantTime.pending(account))-Date.now())/1000);
   if(remaining)await randomWait(remaining,remaining,signal,'恢复互动冷却');
   status(resume?'已恢复互动循环':'互动循环已开始');sessionAuthors=new Set();
   diagnostics={seen:0,skips:{},outcomes:{},last:null};observedPosts=new Set();observedReasons=new Set();
   await runLoop(signal,activeRun);
  }).catch(async e=>{
   failed(e);
   if(e.name==='AbortError'||signal.aborted)return;
   status('互动循环停止：'+e.message);
   if(activeRun){try{await updateRuntime({error:e.message});await api.runtime('interaction','stop');}catch{}}
  }).finally(async()=>{running=false;const latest=await runtime();if(latest.active&&!pauseRequested)status('互动正在执行或等待刷新恢复');});
  await ready;
 };
 const stop=async({preserveDrafts=false}={})=>{
  controller?.abort();await api.runtime('interaction','stop');await runPromise;
  if(!preserveDrafts)await cleanupDialog();selected?.classList.remove('x-assistant-selected');selected=null;
  status('互动模块已结束');
 };
 const pauseAfterCurrent=async()=>{
  pauseRequested=true;status('发帖等待交接：完成当前互动后暂停');await runPromise;
  if(document.querySelector('[role="dialog"]'))throw Error('互动尚有弹窗，未交接发帖');
  if(activeRun){const s=await runtime();if(s.active&&s.runId===activeRun)await updateRuntime({phase:'paused'});}
 };
 const gate=globalThis.createInteractionGate({isRunning:()=>running,stop:pauseAfterCurrent,start:()=>start(true),onPaused:()=>{status('互动已暂停，等待发帖完成');}});
 globalThis.XAssistantInteraction=gate;
 globalThis.XAssistantInteractionDriver={start,pause:pauseAfterCurrent,stop,isRunning:()=>running};
 $('[data-a="hide"]').onclick=()=>{hidden=!hidden;root.querySelectorAll(':scope > :not(header)').forEach(x=>x.style.display=hidden?'none':'');const toggle=$('[data-a="hide"]');toggle.textContent=hidden?'+':'—';toggle.setAttribute('aria-expanded',String(!hidden));toggle.setAttribute('aria-label',hidden?'展开控制台':'收起控制台');toggle.title=hidden?'展开控制台':'收起控制台';};
 chrome.storage.onChanged.addListener((changes,area)=>{
  const s=changes[RUNTIME]?.newValue;if(area!=='local'||!s)return;
  if(!s.active){gate.cancel();controller?.abort();if(!running)status('互动模块已停止');}
  else if(!running){status(s.phase==='paused'?'互动已暂停，等待发帖完成':'互动正在另一个 X 标签页运行');}
 });
 runtime().then(r=>{if(r.active&&!globalThis.XAssistantSchedulerCore)start(true);else if(['unknown','submitting'].includes(r.phase))status('上次回复结果未知，请先核对平台记录');}).catch(e=>status(e.message));
 window.addEventListener('x-assistant-invalidate',()=>controller?.abort(),{once:true});
 window.addEventListener('pagehide',()=>controller?.abort(),{once:true});
})();
