// Independent interaction driver; only its owning workspace controls this loop.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root)return;
 const api=globalThis.XAssistantRuntime;let activeRun=null,account=null;
 const core=globalThis.XAssistantCore,RUNTIME='xAssistantRuntimeV1',FOLLOWED='xAssistantFollowedV1',PROCESSED='xAssistantProcessedV1';
 const $=s=>root.querySelector(s);let running=false,controller=null,selected=null,sessionAuthors=new Set(),runPromise=Promise.resolve();
 const interactionSection=$('[data-module="interaction"]');
 const setProgress=value=>interactionSection.style.setProperty('--progress',Math.max(0,Math.min(1,value)));
 const status=t=>($('[data-status="interaction"]').textContent=t,!/秒/.test(t)&&setProgress(0));
 const local=api.storage||chrome.storage.local;
 const getLocal=async key=>(await local.get(key))[key],setLocal=(key,value)=>local.set({[key]:value});
 const runtime=async()=>await getLocal(RUNTIME)||{active:false,runId:null,cycleIndex:0,completed:0,phase:'stopped'};
 const updateRuntime=patch=>api.runtime('interaction','patch',{runId:activeRun,patch});
 const followed=async()=>await getLocal(FOLLOWED)||{handles:{}};
 const FOLLOW_SETTING='xAssistantAutoFollowV1',followToggle=$('[data-setting="auto-follow"]');
 const autoFollow=async()=>core.autoFollowEnabled(await getLocal(FOLLOW_SETTING));
 autoFollow().then(enabled=>{followToggle.checked=enabled;followToggle.disabled=false;}).catch(e=>status('关注设置读取失败：'+e.message));
 followToggle.onchange=async()=>{const next=followToggle.checked;followToggle.disabled=true;try{await setLocal(FOLLOW_SETTING,next);}catch(e){followToggle.checked=!next;status('关注设置保存失败：'+e.message);}finally{followToggle.disabled=!!api.retired?.();}};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[FOLLOW_SETTING])followToggle.checked=core.autoFollowEnabled(changes[FOLLOW_SETTING].newValue);});
 const addFollowed=(info,source)=>api.call({kind:'FOLLOW_MERGE',rows:[{handle:'@'+info.author,displayName:info.displayName||'',lastSeenAt:new Date().toISOString(),source,owner:account?.slice(1)}]});
 const processed=async()=>await getLocal(PROCESSED)||{posts:{}};
 const saveProcessed=(info,record)=>api.call({kind:'PROCESSED',id:info.id,record:{author:'@'+info.author,url:info.url,at:new Date().toISOString(),...record}});
 const abortError=()=>new DOMException('互动已结束','AbortError'),check=s=>{if(s.aborted)throw abortError();globalThis.XAssistantWorkspace?.check(s);if(account&&selfHandle()!==account.slice(1).toLowerCase())throw Object.assign(Error('账号发生变化，当前项已跳过'),{code:'ACCOUNT_CHANGED'});};
 const requireSource=async mode=>{if(mode!==(await globalThis.XAssistantEntry.searchEnabled()?'search':'home'))throw Object.assign(Error('互动来源已切换，结束旧来源任务'),{code:'SOURCE_CHANGED'});};
 const sleep=async(ms,signal)=>{check(signal);await api.sleep(ms,signal);check(signal);};
 const randomWait=async(min,max,signal,label)=>{const seconds=core.randomSeconds(min,max),total=seconds*1000,deadline=performance.now()+total;if(total<=0){setProgress(0);return;}for(;;){check(signal);const remaining=Math.max(0,deadline-performance.now());setProgress(1-remaining/total);$('[data-status="interaction"]').textContent=`${label} · ${core.formatSeconds(remaining/1000)} 秒`;if(remaining<=0){setProgress(0);return;}await sleep(Math.min(document.hidden?1000:100,remaining),signal);}};

 const moreSelector='[data-testid="tweet-text-show-more-link"]';
 const postInfo=a=>{const link=[...a.querySelectorAll('a[href]')].find(x=>x.querySelector('time'));if(!link)return null;const u=new URL(link.href),m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);if(u.origin!=='https://x.com'||!m)return null;const author=m[1],authorLink=[...a.querySelectorAll('a[href]')].find(x=>{try{return new URL(x.href).pathname.toLowerCase()==='/'+author.toLowerCase()}catch{return false}}),analytics=a.querySelector(`a[href$="/status/${m[2]}/analytics"]`),viewLabel=analytics?.getAttribute('aria-label')||analytics?.textContent||'';return {quoteHandles:[...a.querySelectorAll('[role="link"]:not(a)')].flatMap(q=>[...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase())),article:a,clipped:!!a.querySelector(moreSelector),url:u.origin+u.pathname,path:u.pathname,author,id:m[2],displayName:(authorLink?.textContent||'').trim(),text:(a.querySelector('[data-testid="tweetText"]')?.textContent||'（无文本内容）').trim(),time:a.querySelector('time')?.getAttribute('datetime'),views:core.parseViews(viewLabel)};};
 const selfHandle=()=>{const a=document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');try{return new URL(a?.href).pathname.slice(1).toLowerCase()}catch{return'';}};
 const visiblePosts=()=>[...document.querySelectorAll('article[data-testid="tweet"]')].map(postInfo).filter(x=>x&&x.article.getBoundingClientRect().bottom>0&&x.article.getBoundingClientRect().top<innerHeight&&!/Promoted|推广|推荐广告/i.test(x.article.innerText));
 const clickNow=b=>{if(b.isConnected===false||b.disabled)throw Error('操作目标已更新');b.scrollIntoView({block:'center'});b.focus?.({preventScroll:true});if(typeof PointerEvent==='function'){const c={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};b.dispatchEvent(new PointerEvent('pointerdown',c));b.dispatchEvent(new MouseEvent('mousedown',c));b.dispatchEvent(new PointerEvent('pointerup',{...c,buttons:0}));b.dispatchEvent(new MouseEvent('mouseup',{...c,buttons:0}));}b.click();};
 const clickNative=async(b,signal)=>{await sleep(500,signal);check(signal);clickNow(b);};
 const waitFor=(probe,count=80,delay=100,signal)=>globalThis.XAssistantTasks.waitForPage(()=>{if(signal)check(signal);return probe();},{signal,timeout:count*delay,interval:delay});
 // Only X's read-only Show more sibling of this exact source card is eligible.
 // Its preview is never a substitute for the independently compared full detail body.
 const expandSearchCard=async(info,signal)=>{
  check(signal);
  const source=location.href,key=globalThis.navigation?.currentEntry?.key,article=info.article;
  if(!['/home','/search'].includes(location.pathname)||!key||!article?.isConnected)return null;
  const guard=()=>{
   check(signal);
   if(location.href!==source||globalThis.navigation?.currentEntry?.key!==key)
    throw Object.assign(Error('展开正文时来源页发生变化；未操作目标'),{code:'PAGE_CHANGED',preserveDrafts:true});
   if(document.querySelector('[role="dialog"],[role="alertdialog"]')||
      [...document.querySelectorAll('[contenteditable="true"]')].some(e=>core.editorText(e).trim())||
      [...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))
    throw Object.assign(Error('来源页出现弹窗或草稿，停止展开正文'),{code:'RESIDUAL_DRAFT',preserveDrafts:true});
  };
  const D=globalThis.XAssistantDOM,body=article.querySelector('[data-testid="tweetText"]'),buttons=[...article.querySelectorAll(moreSelector)],button=buttons[0];
  if(!body||buttons.length!==1||!button.matches('button[type="button"]')||button.disabled||
    button.closest('article')!==article||button.closest('a,form,[role="link"],[hidden],[inert],[aria-hidden="true"]')||
    button.parentElement!==body.parentElement||D.relocate(info,account)?.article!==article)return null;
  guard();button.click();
  const full=await waitFor(()=>{
   guard();if(!article.isConnected)return null;
   const row=postInfo(article);
   return row&&!row.clipped&&row.id===info.id&&row.author===info.author&&row.time===info.time&&row.text!==info.text&&
    !!article.querySelector('[data-testid="tweetText"]')?.textContent.trim()&&D.relocate(row,account)?.article===article?row:null;
  },30,100,signal);
  guard();return full?{...full,previewText:info.text}:null;
 };
 const closeMenu=async(caret,menu,signal)=>{if(menu&&document.contains(menu))await clickNative(caret,signal);await waitFor(()=>!document.contains(menu),20,50,signal);};
 const followsYouBadge=info=>/(?:关注了你|关注你|Follows you)/i.test(info.article.querySelector('[data-testid="User-Name"]')?.textContent||'');
 const inspectFollowState=async(info,signal)=>{check(signal);const badge=followsYouBadge(info),caret=info.article.querySelector('[data-testid="caret"]');if(!caret)return{state:'unknown',followsYou:badge?true:null};await clickNative(caret,signal);const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);if(!menu)return{state:'unknown',followsYou:badge?true:null};const own=t=>new RegExp('@'+info.author+'(?![A-Za-z0-9_])','i').test(t),items=[...menu.querySelectorAll('[role="menuitem"]')],text=x=>(x.textContent||'').trim(),followBack=items.some(x=>own(text(x))&&/^(回关|Follow back)\s/i.test(text(x))),plainFollow=items.some(x=>own(text(x))&&/^(关注|Follow)\s/i.test(text(x)));let state='unknown';if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x))))state='followed';else if(followBack||plainFollow)state='unfollowed';await closeMenu(caret,menu,signal);if(state==='followed')await addFollowed(info,'observed');return{state,followsYou:badge||followBack?true:plainFollow?false:null};};
 const fallbackReply=(text,followsYou)=>globalThis.XAssistantFallbackLibrary.compose(text,followsYou);
 const addFollowBack=text=>globalThis.XAssistantFallbackLibrary.appendFollowBack(text);
 const reasonLabels={self:'自己的帖子',confirmed:'已成功回复',uncertain:'发送结果待核对',retry_cooldown:'暂时退避',author_confirmed:'本轮已回复该作者',unrelated:'交友语义不符',already_following:'我已关注',follow_unknown:'关注状态未确认',unchanged_mismatch:'来源正文未变，已安全跳过',incomplete_text:'帖子预览未能原地展开'};
 let diagnostics={seen:0,skips:{},outcomes:{},last:null},observedPosts=new Set(),observedReasons=new Set();
 const recordCandidate=(info,reason)=>{
  if(!observedPosts.has(info.id)){observedPosts.add(info.id);diagnostics.seen++;}
  const key=info.id+':'+reason;
  if(reason&&!observedReasons.has(key)){observedReasons.add(key);diagnostics.skips[reason]=(diagnostics.skips[reason]||0)+1;diagnostics.last={postId:info.id,reason,at:Date.now()};}
 };
 const recordOutcome=(info,reason)=>{diagnostics.outcomes[reason]=(diagnostics.outcomes[reason]||0)+1;diagnostics.last={postId:info.id,reason,at:Date.now()};};
 const publishDiagnostics=()=>updateRuntime({diagnostics:{...diagnostics,skips:{...diagnostics.skips},outcomes:{...diagnostics.outcomes}}});
 const skipSummary=()=>Object.entries(diagnostics.skips).map(([name,count])=>`${reasonLabels[name]} ${count}`).join(' · ');
 const findCandidate=async(signal,followEnabled,unsentMismatches)=>{
  if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗，请先处理草稿');
  const lastScreen=6,triedPreviews=new Set();
  for(let screen=0;screen<=lastScreen;screen++){
   check(signal);
   const done=await processed(),self=selfHandle();if(!self)throw Error('无法核对当前账号');
   const followCooling=await followCooldownActive();
   for(let info of visiblePosts()){
    check(signal);
    const opts={self,record:done.posts[info.id],authors:sessionAuthors};
    let reason=core.interactionSkipReason(info,opts);
    if(info.clipped&&(!reason||reason==='unrelated')){
     if(triedPreviews.has(info.id)){recordCandidate(info,'incomplete_text');continue;}
     triedPreviews.add(info.id);
     const full=await expandSearchCard(info,signal);
     if(!full){recordCandidate(info,'incomplete_text');continue;}
     info=full;reason=core.interactionSkipReason(info,opts);
    }
    const prior=unsentMismatches?.get(info.id);
    reason=reason||(prior&&prior.author===info.author&&prior.time===info.time&&prior.text===info.text?'unchanged_mismatch':null);
    recordCandidate(info,reason);if(reason)continue;
    await publishDiagnostics();
    const relation=await inspectFollowState(info,signal);
    const candidate={...info,followState:followEnabled?relation.state:'unrestricted',followsYou:relation.followsYou};
    // Selection concerns whom I follow, independently of who follows me.
    if(relation.state==='unfollowed'||(followCooling&&relation.state==='followed'))return candidate;
    recordCandidate(info,relation.state==='followed'?'already_following':'follow_unknown');
   }
   if(screen<lastScreen){status(`本屏无合格目标，滚动第 ${screen+1}/${lastScreen} 屏 · ${skipSummary()}`);await sleep(500,signal);check(signal);window.scrollBy({top:Math.max(600,innerHeight*.9),behavior:'smooth'});await sleep(1400,signal);}
  }
  await publishDiagnostics();return null;
 };
 const aiReply=(info,signal)=>globalThis.XAssistantTasks.bounded(()=>api.call({kind:'AI_REPLY',runId:activeRun,post:{id:info.id,text:info.text}}),{signal});
 // Sending is a single guarded transaction shared with notification replies.
 let replySubmitted=false;
 const cleanupDialog=async()=>replySubmitted?false:globalThis.XAssistantPopup.cancel();
 const replyAndSend=async(info,text,signal,onConfirmed,onBeforeSubmit)=>{
  replySubmitted=false;check(signal);let visit=null,confirmed=false;
  try{
   await globalThis.XAssistantReplyEngine.send({
    row:info,text,account,signal,patch:updateRuntime,module:'interaction',runId:activeRun,
    detailInline:true,prepareTarget:async()=>{visit=await globalThis.XAssistantWorkspace.openStatusTarget(info,{signal});},
    onConfirmed:async receipt=>{confirmed=true;await onConfirmed(receipt);},onBeforeSubmit
   });
   await visit.returnToSource(); // Return to the verified timeline or search list, never an arbitrary page.
   return 'verified';
  }catch(error){
   if(confirmed){error.confirmed=true;error.submitted=true;}
   replySubmitted=!!error.submitted&&!error.confirmed;
   // Never leave an inline unknown or a restored draft. A proven, clean
   // pre-click failure may return only through the actual history entry.
   if(visit){
    if(error.submitted||error.preserveDrafts)error.stopTargetVisit=true;
    else try{await visit.returnToSource();}catch(back){error.stopTargetVisit=true;error.preserveDrafts=true;error.message+='；'+back.message;}
   }
   throw error;
  }
 };
 const relocatePost=info=>{
  const row=globalThis.XAssistantDOM.relocate(info,account||'/'+selfHandle());
  if(!row)throw Error('目标帖子已更新或移出页面，本次操作跳过');
  return {...info,...row};
 };
 const followCooldownActive=async()=>{
  const owner=account||'/'+selfHandle();
  const gate=await getLocal('xAssistantActionGateV1');
  if(gate?.version===1){
   const record=gate.accounts?.[owner];
   return Number(record?.lastFollowAt)+120000>Date.now()||gate.holder?.kind==='follow'&&gate.holder.account===owner&&gate.holder.expiresAt+120000>Date.now();
  }
  const legacy=await getLocal('xAssistantFollowCooldownV1')||{};
  return Number(legacy[owner]?.nextAt)>Date.now();
 };
 const followAuthor=async(info,signal)=>{
  check(signal);if(!await autoFollow())return'skipped_disabled';
  if(await followCooldownActive())return'skipped_cooldown';
  // Back may remount the original collapsed search card. Re-expand only the
  // exact old preview; the ordinary full-body relocation below is still mandatory.
  if(info.previewText&&!globalThis.XAssistantDOM.relocate(info,account)){
   const prior=globalThis.XAssistantDOM.relocate({...info,text:info.previewText},account);
   if(prior){const expanded=await expandSearchCard({...info,...prior,text:info.previewText},signal);if(!expanded||expanded.text!==info.text)return'skipped_changed';}
   else return'skipped_changed';
  }
  info=relocatePost(info);
  // Check only when actually trying to follow, not for every scanned timeline row.
  const reservedFollowback=async id=>{
   const records=(await getLocal('xAssistantFollowbackLedgerV1'))?.[account.toLowerCase()];
   if(!records)return false;
   return !!records['@'+info.author.toLowerCase()]||!!(id&&Object.values(records).some(r=>r.targetId===id));
  };
  if(await reservedFollowback())return 'skipped_followback_ledger';
  const caret=info.article.querySelector('[data-testid="caret"]');
  if(!caret)throw Error('未找到帖子菜单');
  await clickNative(caret,signal);
  const menu=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);
  if(!menu)throw Error('帖子菜单未打开');
  const own=t=>new RegExp('@'+info.author+'(?![A-Za-z0-9_])','i').test(t),text=x=>(x.textContent||'').trim();
  const items=[...menu.querySelectorAll('[role="menuitem"]')];
  if(items.some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)))){
   await closeMenu(caret,menu,signal);await addFollowed(info,'observed');return'skipped';
  }
  let button,submitted=false;
  try{
  await globalThis.XAssistantActions.click({module:'interaction',runId:activeRun,account,kind:'follow',signal,
   beforeClick:async()=>{
    if(!await autoFollow())throw Object.assign(Error('自动关注已关闭'),{code:'FOLLOW_DISABLED'});
    // The global lease excludes concurrent follow-back reservations during the final check.
    const matching=[...menu.querySelectorAll('[role="menuitem"]')].filter(x=>own(text(x)));
    const id=matching.length===1?/^(\d+)-(?:un)?follow$/.exec(matching[0].getAttribute?.('data-testid')||'')?.[1]:null;
    if(await reservedFollowback(id))throw Object.assign(Error('此账号已有回关记录'),{code:'FOLLOWBACK_HELD'});
    await sleep(500,signal);
   },
   validate:()=>{
    check(signal);relocatePost(info);
    if(!followToggle.checked)throw Object.assign(Error('自动关注已关闭'),{code:'FOLLOW_DISABLED'});
    if(!document.contains(menu)||document.querySelector('[role="menu"]')!==menu)throw Error('关注菜单已变化');
    const matches=[...menu.querySelectorAll('[role="menuitem"]')].filter(x=>own(text(x))&&/^(关注|回关|Follow|Follow back)\s/i.test(text(x))&&!x.disabled);
    if(matches.length!==1)throw Error('菜单中未找到唯一关注项');
    button=matches[0];
   },click:()=>{submitted=true;clickNow(button);}
  });
  await waitFor(()=>!document.contains(menu),50,100,signal);await sleep(500,signal);await clickNative(caret,signal);
  const verify=await waitFor(()=>document.querySelector('[role="menu"]'),50,100,signal);
  if(!verify)return'unknown';
  const confirmed=[...verify.querySelectorAll('[role="menuitem"]')].some(x=>own(text(x))&&/^(取消关注|Unfollow)\s/i.test(text(x)));
  await closeMenu(caret,verify,signal);
  if(confirmed){await addFollowed(info,'interaction');return'verified';}return'unknown';
  }catch(error){
   if(!submitted&&error.code==='FOLLOWBACK_HELD'){
    if(document.contains(menu)&&document.querySelector('[role="menu"]')===menu)await closeMenu(caret,menu,signal);
    return 'skipped_followback_ledger';
   }
   if(submitted)error.submitted=true;throw error;
  }
 };
 const markSelected=info=>{selected?.classList.remove('x-assistant-selected');selected=info.article;selected.classList.add('x-assistant-selected');};
 const deferRecord=(info,record)=>saveProcessed(info,{...record,retryAt:Date.now()+Math.max(60000,globalThis.XAssistantTime.ms('interaction'))});
 const waitAfterAttempt=async(signal,label='等待下一帖')=>{
  check(signal);await publishDiagnostics();
  const end=await globalThis.XAssistantTime.arm('interaction',activeRun,account);
  const seconds=Math.max(0,(end-Date.now())/1000);
  await randomWait(seconds,seconds,signal,label);
 };
 const recoverDelayedComposer=async(error,signal)=>{
  const taskOwnedLateEditor=error?.code==='CLEANUP_FAILED'&&(
   error?.cause?.code==='EDITOR_NOT_READY'||error?.cause?.cause?.code==='EDITOR_NOT_READY');
  if(!taskOwnedLateEditor||error.preserveDrafts||error.cause?.preserveDrafts||error.cause?.cause?.preserveDrafts||replySubmitted||!globalThis.XAssistantPopup?.cancel)return false;
  status('页面渲染较慢，正在恢复回复窗口');
  const end=Date.now()+15000;
  for(;;){
   check(signal);
   if(!document.querySelector('[role="dialog"],[role="alertdialog"]')||await globalThis.XAssistantPopup.cancel())break;
   if(Date.now()>=end)throw Object.assign(Error('回复窗口未能安全恢复，请核对草稿'),{code:'CLEANUP_FAILED',cause:error});
   await sleep(1000,signal);
  }
  replySubmitted=false;
  await updateRuntime({phase:'waiting',error:null});
  status('回复窗口已恢复，继续互动');
  return true;
 };
  const runLoop = async (signal, runId, sourceMode) => {
  // Verified unsent list/detail mismatches must not spend AI calls every time the
  // same list card comes back. Exact bodies only, bounded to this run; no DOM nodes.
  const unsentMismatches=new Map();
  while (!signal.aborted) {
   check(signal);await requireSource(sourceMode);check(signal);
   if (document.querySelector('[role="dialog"],[role="alertdialog"]'))
    throw Object.assign(Error('页面已有弹窗或草稿，请先处理后重新启动'),{code:'RESIDUAL_DRAFT'});
   const desiredPage=await globalThis.XAssistantEntry?.targetFor?.();
   if (!core.interactionPage(location.href) || (desiredPage && location.pathname+location.search !== desiredPage)) {
    await globalThis.XAssistantEntry.enter('interaction',signal);
    continue;
   }

   const r = await runtime();
   if (!r.active || r.runId !== runId) return;
   const followEnabled = await autoFollow();
   status(sourceMode==='home'?'正在从首页时间线寻找交友帖':'正在从话题搜索寻找交友帖');
   const info = await findCandidate(signal, followEnabled, unsentMismatches);

   if (!info) {
    // A diagnostic covers one screen scan. Ordinary service may keep rotating topics.
    if(globalThis.XAssistantWorkspace?.state?.().assignment?.singleRound===true){
     await waitAfterAttempt(signal,'单轮试跑未找到合格帖子，结束本轮');
     return;
    }
    if (sourceMode==='search'&&await globalThis.XAssistantEntry?.nextFriendTopic?.()) {
     await globalThis.XAssistantEntry.enter('interaction',signal);
     continue;
    }
    status(sourceMode==='home'?'首页本轮无合格交友帖，冷却后从当前位置继续':'本轮暂无目标，冷却后从当前页面顶部继续检查');
    await waitAfterAttempt(signal,'暂无合格帖子，等待下轮');
    check(signal);
    if(sourceMode!=='home'){window.scrollTo({top:0,behavior:'smooth'});await sleep(1400,signal);}
    continue;
   }

   markSelected(info);
   await requireSource(sourceMode);check(signal);
   status('DeepSeek 正在读取帖子并写回复');
   let generated = await aiReply(info,signal);
   check(signal);await requireSource(sourceMode);check(signal);
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
    generated = {...generated,action:'send_reply',text:fallbackReply(info.text,info.followsYou),fallbackLibrary:true};
    const outcome=info.followsYou===true?'follower_library':info.followsYou===false?'non_follower_library':'unknown_relation_library';
    recordOutcome(info,outcome);
    status(info.followsYou===false?`@${info.author} 未关注，使用文案库并请求回关`:info.followsYou===true?`@${info.author} 已关注，使用文案库问候`:`@${info.author} 关注关系暂不可读，使用文案库问候`);
   }
   if (generated.action !== 'send_reply') throw Error('AI 未返回有效发送指令');

   const reply = info.followsYou===false?addFollowBack(generated.text):generated.text,
    record = {
     authorType: info.followState,
     views: info.views,
     replyText: reply,
     reply: 'preparing',
     like: 'disabled',
     follow: followEnabled ? (info.followState === 'unfollowed' ? 'pending' : info.followState === 'followed' ? 'skipped' : 'skipped_unknown') : 'skipped_disabled'
    };
   if(info.followsYou===false&&!generated.fallbackLibrary){recordOutcome(info,'non_follower_followback');status(`@${info.author} 未关注，回复已添加交友回关尾句`);}
   status(`正在评价 @${info.author}`);
   try {
    await requireSource(sourceMode);check(signal);
    record.reply = await replyAndSend(info, reply, signal, async () => {
     record.reply = 'verified';
     sessionAuthors.add(info.author.toLowerCase());
     recordOutcome(info,'confirmed');
     await saveProcessed(info, record);
    },async()=>{record.reply='in_flight';await saveProcessed(info,record);});
    await saveProcessed(info, record);
   } catch (e) {
    if((e.code==='SOURCE_CHANGED'||e.name==='AbortError'&&e.submitted===false)&&!e.submitted&&!e.confirmed&&record.reply!=='verified'){
     // sendOnce explicitly reports whether the DOM click happened. Only a proven
     // pre-click stop can clear the provisional mark written by onBeforeSubmit.
     if(record.reply==='in_flight'&&e.submitted===false){
      record.reply='skipped_unsent';await saveProcessed(info,record);
     }
     selected?.classList.remove('x-assistant-selected');selected=null;
     throw e;
    }
    if(e.code==='REPLY_ALREADY_CLAIMED'){
     selected?.classList.remove('x-assistant-selected');selected=null;
     await waitAfterAttempt(signal,'此帖已由其他模块处理，等待下一帖');
     continue;
    }
    if (e.confirmed || record.reply === 'verified') {
     record.reply = 'verified';
     await saveProcessed(info, record);
     throw e;
    }
    const uncertain = replySubmitted;
    const safeSkip=!uncertain&&!e.submitted&&!e.stopTargetVisit&&!e.preserveDrafts&&e.code==='TARGET_SKIPPED_UNSENT';
    if(safeSkip){
     unsentMismatches.set(info.id,{author:info.author,time:info.time,text:info.text});
     if(unsentMismatches.size>256)unsentMismatches.delete(unsentMismatches.keys().next().value);
    }
    record.reply = uncertain ? 'unknown' : safeSkip ? 'skipped_issue' : e.code==='AUTHOR_BLOCKED' ? 'blocked_author' : ['ACCOUNT_CHANGED','CLEANUP_FAILED','RESIDUAL_DRAFT'].includes(e.code) ? 'skipped_issue' : 'failed';
    record.error = e.message;
    record.reasonCode = e.code || 'REPLY_FAILURE';
    if (e.cause) record.cause = {code:e.cause.code || 'REPLY_FAILURE',message:e.cause.message};
    const popup = !!document.querySelector('[role="dialog"],[role="alertdialog"]');
    if(e.cause?.preserveDrafts||e.cause?.cause?.preserveDrafts)e.preserveDrafts=true;
    const cleaned = popup ? !uncertain&&!e.stopTargetVisit&&!e.preserveDrafts&&e.code!=='RESIDUAL_DRAFT'&&await globalThis.XAssistantPopup.cancel() : true;
    // Keep the original failure code; an open reply composer is not itself the cause.
    recordOutcome(info,uncertain?'unknown':safeSkip?'target_skipped_unsent':'send_failed');
    if(uncertain||e.code==='AUTHOR_BLOCKED')await saveProcessed(info,record);else await deferRecord(info,record);
    selected?.classList.remove('x-assistant-selected');
    selected = null;
    if (e.name === 'AbortError'||e.stopTargetVisit||e.preserveDrafts&&!popup) throw e;
    if (uncertain&&popup)throw Object.assign(Error('发送结果未知，已隔离目标并保留回复窗口；不会重发'),{code:'SEND_UNKNOWN',submitted:true,preserveDrafts:true,cause:e});
    if (!cleaned || e.code === 'CLEANUP_FAILED') throw Object.assign(Error('回复草稿无法安全清理，请核对后恢复'),{code:'CLEANUP_FAILED',cause:e,preserveDrafts:!!e.preserveDrafts});
    if (uncertain) {
     // The per-post ledger already quarantines this target. Return the module
     // runtime to a non-submitting phase so the next target may proceed safely.
     await updateRuntime({phase:'waiting'});
     replySubmitted = false;
    }
    await waitAfterAttempt(signal,uncertain?'结果未知，隔离当前帖并等待':safeSkip?'目标详情未核对通过，已返回列表并跳过；等待下一帖':'本次未发送，等待下一帖');
    continue;
   }

   record.like = 'disabled';
   if (followEnabled && info.followState === 'unfollowed' && !await autoFollow()) {
    record.follow = 'skipped_disabled';
    await saveProcessed(info, record);
   } else if (followEnabled && info.followState === 'unfollowed') {
    status(`正在关注 @${info.author}`);
    try {
     await requireSource(sourceMode);check(signal);
     record.follow = await followAuthor(info, signal);
    } catch (e) {
     if(e.code==='SOURCE_CHANGED'&&!e.submitted){record.follow='skipped_source_change';await saveProcessed(info,record);throw e;}
     record.follow = e.submitted ? 'unknown' : e.code==='FOLLOW_DISABLED' ? 'skipped_disabled' : 'failed';
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

   await waitAfterAttempt(signal);
  }
 };

 // A single owner per module; other modules may run in separate tabs.
 const emitState=(running,failure)=>window.dispatchEvent(new CustomEvent('x-assistant-module-state',{detail:{module:'interaction',running,...(failure?{error:failure.message,code:failure.code||'INTERACTION_ERROR',submitted:failure.submitted===true,confirmed:failure.confirmed===true}: {})}}));
 const start=async(resume=false,sourceMode)=>{
  if(running)return;
  await globalThis.XAssistantWorkspace?.ready;
  if(running)return;
  if(!navigator.locks){status('浏览器不支持执行锁');throw Error('浏览器不支持执行锁');}
  activeRun=null;account=null;running=true;controller=new AbortController();const signal=controller.signal;
  const lockOptions={ifAvailable:true};let terminalError=null;
  let readyResolve,readyReject,readySettled=false;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const started=()=>{if(!readySettled){readySettled=true;readyResolve();emitState(true);}};
  const failed=e=>{if(!readySettled){readySettled=true;readyReject(e);}};
  runPromise=navigator.locks.request('x-assistant-interaction-v2',lockOptions,async lock=>{
   if(!lock)throw Error('互动正在另一个 X 标签页执行');
   check(signal);
   if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw Error('页面已有弹窗或草稿，请先处理后重新启动');
   if(!['home','search'].includes(sourceMode)||!core.interactionPage(location.href)||location.pathname!=='/'+sourceMode)throw Object.assign(Error('工作页不在指定互动来源，未启动'),{code:'PAGE_CHANGED'});
   await requireSource(sourceMode);check(signal);
   if(resume){account=null;await waitFor(()=>selfHandle(),150,100,signal);check(signal);}
   account='/'+selfHandle();
   const s=await api.runtime('interaction','begin',{resume,account,sourceMode});activeRun=s.runId;
   started();
   await globalThis.XAssistantTime.ready;
   const remaining=Math.max(0,((await globalThis.XAssistantTime.pending(account))-Date.now())/1000);
   if(remaining)await randomWait(remaining,remaining,signal,'恢复互动冷却');
   status(resume?'已恢复互动循环':'互动循环已开始');sessionAuthors=new Set();
   diagnostics={seen:0,skips:{},outcomes:{},last:null};observedPosts=new Set();observedReasons=new Set();
   for(;;){
    try{await runLoop(signal,activeRun,sourceMode);break;}
    catch(e){if(!await recoverDelayedComposer(e,signal))throw e;}
   }
  }).catch(async e=>{
   failed(e);
   if(e.name==='AbortError'||signal.aborted)return;
   terminalError=e;
   if(e.code==='SOURCE_CHANGED'&&!e.submitted&&!e.confirmed){status('互动来源切换中');return;}
   status('互动循环停止：'+e.message);
   if(activeRun){try{await updateRuntime({error:e.message});}catch{}}
  }).finally(async()=>{
   if(activeRun){try{await api.runtime('interaction','stop',{runId:activeRun});}catch{}}
   running=false;emitState(false,terminalError);
  });
  await ready;
 };
 const stop=async({preserveDrafts=false}={})=>{
  const ownedRun=activeRun;controller?.abort();await runPromise;if(ownedRun)await api.runtime('interaction','stop',{runId:ownedRun});
  if(!preserveDrafts&&globalThis.XAssistantWorkspace?.canCleanComposer?.()!==false)await cleanupDialog();selected?.classList.remove('x-assistant-selected');selected=null;
  status('互动模块已结束');
 };
 globalThis.XAssistantInteractionDriver={start,stop,isRunning:()=>running,finished:()=>runPromise};
 chrome.storage.onChanged.addListener((changes,area)=>{
  const s=changes[RUNTIME]?.newValue;if(area!=='local'||!s)return;
  if(!s.active){controller?.abort();if(!running)status('互动模块已停止');}
  else if(!running){status('互动正在另一个 X 标签页运行');}
 });
 runtime().then(r=>{if(['unknown','submitting'].includes(r.phase))status('上次回复结果未知，请先核对平台记录');else if(r.active)status('互动正在另一个 X 标签页运行');}).catch(e=>status(e.message));
 window.addEventListener('x-assistant-invalidate',()=>{followToggle.disabled=true;controller?.abort();},{once:true});
 window.addEventListener('pagehide',()=>controller?.abort(),{once:true});
})();
