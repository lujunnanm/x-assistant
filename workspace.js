// Only background-owned work tabs execute drivers. Ordinary X pages are controls only.
(() => {
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
 const api=globalThis.XAssistantRuntime,policy=globalThis.XAssistantWorkspacePolicy;
 const P=globalThis.XAssistantServicePolicy,T=globalThis.XAssistantTasks;
 const SERVICE_KEY=P.KEY||'xAssistantManagedServiceV1';
 const SEARCH_KEY='xAssistantFriendSearchV1';
 const keys={posting:'xAssistantPostingV1',interaction:'xAssistantRuntimeV1',notifications:'xAssistantNotificationsRuntimeV1',followback:'xAssistantFollowbackRuntimeV1'};
 const drivers=()=>({posting:globalThis.XAssistantPostingDriver,interaction:globalThis.XAssistantInteractionDriver,notifications:globalThis.XAssistantNotificationDriver,followback:globalThis.XAssistantFollowbackDriver});
 const self=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase()||null;
 const error=(code,message)=>Object.assign(Error(message),{code});
 const uncertain=state=>['submitting','unknown','deleting'].includes(state?.phase);
 let tabId=null,assignment=null,service=null,current=null,closed=false,unavailable='',localStatus='idle',lastError=null,searchEnabled=true;
 let epoch=0,dirty=false,refreshTask=null,pollTimer=null,guardTimer=null,blocked=null;
 const state=()=>({tabId,assignment:assignment?{...assignment}:null,status:localStatus,error:lastError,active:current?.module||null});
 function announce(status=localStatus,failure=lastError){
  localStatus=status;lastError=failure;
  window.dispatchEvent(new CustomEvent('x-assistant-workspace-state',{detail:state()}));
 }
 const ownerEntry=()=>assignment&&service?.workers?.[assignment.module];
 function authorized(a=assignment){
  if(!a||!service?.enabled||service.account?.toLowerCase()!==a.account?.toLowerCase())return false;
  if(a.module!=='posting'&&service.selected?.[a.module]!==true)return false;
  const entry=service.workers?.[a.module];
  return entry?.tabId===tabId&&entry.token===a.token;
 }
 function permissionFailure(){
  if(closed||unavailable)return error('WORKSPACE_UNAVAILABLE',unavailable||'工作页面已关闭');
  if(!assignment||!authorized())return error('SERVICE_PAUSED','神圣计划已暂停或当前工作页归属已变化');
  if(assignment.module==='interaction'){
   const wanted=searchEnabled?'search':'home';
   if(assignment.sourceMode!==wanted||current?.module==='interaction'&&current.assignment.sourceMode!==wanted||assignment.reason==='SOURCE_CHANGED'){
    // Do not treat a coincident manual page/account change as a source switch.
    if(current?.accountReady){try{current.guard.check(location.href,self());}catch(failure){return failure;}}
    return error('SOURCE_CHANGED','互动来源已切换，上一轮收尾后继续');
   }
  }
  const trial=service?.trial;
  if(trial&&(!['interaction','notifications'].includes(assignment.module)||!Number.isFinite(trial.expiresAt)||Date.now()>=trial.expiresAt||trial.pending?.[assignment.module]!==true))return error('SERVICE_PAUSED','单轮诊断已结束或不包含此模块');
  if(!P.isModuleWorking(assignment.module,Date.now()))return error('REST_WINDOW','发帖休息时段，北京时间06:00自动恢复');
  if(!assignment.shouldRun)return error('SERVICE_PAUSED',assignment.reason||'当前模块已暂停');
  return null;
 }
 function check(signal){
  if(signal?.aborted)throw new DOMException('任务已停止','AbortError');
  api.assertContext?.();
  const failure=permissionFailure();if(failure)throw failure;
  if(!current)throw error('NO_WORKER_SESSION','当前页面没有受托执行任务');
  if(current.controller.signal.aborted)throw new DOMException('任务已停止','AbortError');
  if(current.token!==assignment.token||current.module!==assignment.module)throw error('WORKER_REPLACED','工作页任务已替换');
  // The sidebar account can arrive after the content script on a fresh worker page.
  // Before it appears, only bounded readiness probes are allowed, never a driver.
  current.guard.check(location.href,current.accountReady?self():(self()||current.account));
 }
 function expectNavigation(path){check();current.guard.expectNavigation(path,location.href,self());}
 // A status visit is minted only from the exact, live timestamp link of the
 // selected source card. No synthetic pushState and no broad status allowlist.
 async function openStatusTarget(row,{signal,deadline=Infinity,requireAddressed=false}={}){
  const D=globalThis.XAssistantDOM,core=globalThis.XAssistantCore;
  check(signal);
  if(!['interaction','notifications'].includes(current.module))throw error('TARGET_MISMATCH','此工作页不处理回复');
  const owner=self(),session=current,source=policy.normalize(location.href),here=()=>policy.normalize(location.href);
  const safe=()=>{T.check(signal,deadline);check(signal);if(current!==session||self()!==owner)throw error('WORKER_REPLACED','工作页归属变化');};
  const clean=()=>{if(D.dialogs().length||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>core.editorText(e).trim()))throw Object.assign(error('RESIDUAL_DRAFT','当前页有未提交草稿或弹窗，保留现场并停止导航'),{preserveDrafts:true});};
  if(!/^[A-Za-z0-9_]{1,15}$/.test(row?.author)||!/^\d+$/.test(row?.id)||!row?.url)throw error('TARGET_MISMATCH','缺少可核对的目标帖链接');
  const u=new URL(row.url),target=u.pathname;
  if(u.origin!=='https://x.com'||u.search||u.hash||target.toLowerCase()!=='/'+row.author.toLowerCase()+'/status/'+row.id)throw error('TARGET_MISMATCH','目标链接与已选作者或帖子不一致');
  const live=D.relocate(row,owner,requireAddressed);
  if(!live)throw error('TARGET_UPDATED','来源页无法唯一定位原作者、时间和正文都相符的帖子');
  clean();
  const wait=probe=>T.waitForPage(()=>{safe();return probe();},{signal,deadline,timeout:15000});
  if(here()===target){
   if(!await wait(()=>D.detailReply(row)))throw error('INLINE_EDITOR_NOT_READY','当前目标详情不可核验：'+JSON.stringify(D.detailReply(row,true)));
   return {returnToSource:async()=>{safe();}};
  }
  const links=[...live.article.querySelectorAll('a[href]')].filter(a=>{
   if(!a.isConnected||a.closest('article')!==live.article||a.target&&a.target!=='_self'||!a.querySelector('time'))return false;
   try{const h=new URL(a.href);return h.href===u.href;}catch{return false;}
  });
  if(links.length!==1)throw error('TARGET_UPDATED','来源帖没有唯一可核验的原生时间链接');
  const nav=globalThis.navigation,from=nav?.currentEntry,fromKey=from?.key,fromIndex=from?.index,beforeLength=history.length;
  const link=links[0];
  // Recovery is deliberately narrower than an ordinary verified visit. Only the
  // untouched search -> detail transition we actually witnessed can be undone.
  const canRecover=session.module==='interaction'&&new URL(location.href).pathname==='/search'&&fromKey&&
   typeof nav.addEventListener==='function'&&typeof document.addEventListener==='function';
  let firstTargetKey=null,navigationChanged=false,userTouched=false,returning=false,skippedUnsent=false;
  const onEntry=event=>{
   const to=nav.currentEntry;
   if(returning&&event.from?.key===firstTargetKey&&to?.key===fromKey)return;
   if(firstTargetKey||event.from?.key!==fromKey||!to?.key||to.index!==fromIndex+1||to.url!==u.href)navigationChanged=true;
   else firstTargetKey=to.key;
  };
  const onTouch=e=>{if(e.isTrusted)userTouched=true;},inputs=['pointerdown','click','keydown','beforeinput','input','change','paste','drop','submit'];
  if(canRecover){nav.addEventListener('currententrychange',onEntry);for(const k of inputs)document.addEventListener(k,onTouch,true);}
  const untouched=()=>{
   safe();clean();
   const hasMedia=[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length)||
    document.querySelector('[data-testid="inline_reply_offscreen"] [data-testid="attachments"],[data-testid="inline_reply_offscreen"] [data-testid="pollCreator"]');
   if(userTouched||navigationChanged||hasMedia)throw Object.assign(error('RETURN_UNVERIFIED','工作页出现手动操作、导航或媒体草稿；保留现场'),{preserveDrafts:true});
  };
  try{
   progress('从已核对时间链接打开目标帖 '+row.id);
   safe();clean();expectNavigation(target);link.click();
   const rendered=await wait(()=>here()===target&&D.detailReply(row));
   const diagnosis=rendered?null:D.detailReply(row,true);
   // No sendOnce()/editor operation has run at this point: prepareTarget has
   // not returned. Never infer that a missing editor or a route change is safe.
   const recover=!rendered&&canRecover&&firstTargetKey&&nav.currentEntry?.key===firstTargetKey&&
    diagnosis?.reason==='target'&&diagnosis.cards>0&&diagnosis.target===0;
   if(!rendered&&!recover)throw error('INLINE_EDITOR_NOT_READY','真实链接点击后未出现相符的详情和回复框：'+JSON.stringify(diagnosis));
   const to=nav?.currentEntry,toKey=to?.key;
   const cards=recover?[...document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')]:[];
   let returned=false;
   const returnToSource=async()=>{
    if(returned)return;
    if(recover)untouched();else{safe();clean();}
    if(here()!==target)throw error('PAGE_CHANGED','目标详情已切换，不自动返回');
    // A real Back is safe only if this very click produced the immediate history entry.
    const previous=fromKey&&nav.entries().find(e=>e.key===fromKey);
    const proven=fromKey?toKey&&nav.currentEntry?.key===toKey&&to.index===fromIndex+1&&previous?.index===fromIndex&&policy.normalize(previous.url)===source:history.length===beforeLength+1;
    if(!proven)throw error('RETURN_UNVERIFIED','无法证明上一页正是本次来源页，未执行返回');
    progress('返回已核对来源页 '+row.id);
    expectNavigation(source);returning=true;history.back();
    const sourceReady=()=>{
     if(here()!==source||fromKey&&nav.currentEntry?.key!==fromKey)return false;
     // History commits before React repaints. A still-mounted reply surface
     // bound to this exact target proves the old detail is still on screen.
     if(recover){
      untouched();
      // A restored URL and stale detail cards are not evidence of a list repaint.
      const tablist=document.querySelector('[data-testid="primaryColumn"] [role="tablist"]');
      const hidden='[hidden],[inert],[aria-hidden="true"]';
      return cards.length>0&&!cards.some(a=>a.isConnected&&!a.closest(hidden))&&
       !!tablist&&!tablist.closest(hidden)&&!!D.relocate(row,owner,requireAddressed);
     }
     const old=rendered.dialog;
     if(old?.isConnected&&!old.closest('[hidden],[inert],[aria-hidden="true"]')){
      const cell=old.closest('[data-testid="cellInnerDiv"]');
      if([...cell?.querySelectorAll('article[data-testid="tweet"]')||[]].some(a=>a===rendered.article||D.post(a,owner)?.id===row.id))return false;
     }
     if(D.relocate(row,owner,requireAddressed))return true;
     const root=source.match(/^\/([a-z0-9_]+)\/status\/(\d+)$/i),rows=D.rows(owner);
     if(root)return rows.some(r=>r.id===root[2]&&r.author.toLowerCase()===root[1].toLowerCase());
     return !!(rows.length&&document.querySelector('[data-testid="primaryColumn"] [role="tablist"]'));
    };
    if(!await wait(sourceReady))throw error('NAVIGATION','原来源页地址或实际内容未恢复');
    returned=true;
   };
   if(recover){
    await returnToSource();skippedUnsent=true;
    throw error('TARGET_SKIPPED_UNSENT','目标详情未核对通过，未编辑、未发送；已核实返回原搜索列表，跳过本帖。核对结果：'+JSON.stringify(diagnosis));
   }
   return {returnToSource};
  }catch(e){if(!skippedUnsent)e.stopTargetVisit=true;throw e;}
  finally{if(canRecover){nav.removeEventListener('currententrychange',onEntry);for(const k of inputs)document.removeEventListener(k,onTouch,true);}}
 }
 function beginComposer(){check();return current.guard.beginComposer();}
 function canCleanComposer(){
  if(!current)return false;
  // A normal stop/rest boundary may still clean our own draft. A different page/account may not.
  try{current.guard.check(location.href,self());return true;}catch{return false;}
 }
 let pausedInteractionDetail=null; // Exact managed detail entry; never persisted across page loads.
 function validStartRoute(a){
  const path=location.pathname.toLowerCase(),account=a.account.toLowerCase();
  if(a.module==='followback')return P.isFollowbackPage(location.href,account);
  if(a.module==='posting')return path==='/home';
  if(a.module==='interaction'){
   const paused=pausedInteractionDetail;pausedInteractionDetail=null;
   const route=new URL(location.href);
   // Both lists belong to this managed tab. The newly bound list is entered
   // (and its content checked) before any candidate can be considered.
   return (path==='/home'&&!route.search||path==='/search'&&!!route.searchParams.get('q')&&['','top','live'].includes(route.searchParams.get('f')||''))||!!(paused&&paused.token===a.token&&paused.url===location.href&&paused.key===globalThis.navigation?.currentEntry?.key&&
    !document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')&&![...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length));
  }
  return path===account||path==='/notifications'||path.startsWith('/notifications/')||new RegExp('^'+account+'/status/\\d+$').test(path);
 }
 async function report(a,status,failure=null,run=null){
  if(!a)return;
  return api.call({kind:'WORKER_REPORT',module:a.module,token:a.token,status,
   ...(failure?{error:failure.message||String(failure),code:failure.code||'WORKER_ERROR',
    submitted:!!failure.submitted||uncertain(run),confirmed:!!failure.confirmed}:{})});
 }
 const normalStop=failure=>['REST_WINDOW','SERVICE_PAUSED','SOURCE_CHANGED','WORKER_REPLACED','SERVICE_DISABLED','MODULE_DISABLED','OUTSIDE_WORKING_HOURS','OUTSIDE_WINDOW'].includes(failure?.code);
 async function stopSession(session,{failure=null,reason='当前模块已暂停',preserveDrafts=true,reportState=true}={}){
  if(current!==session)return;
  if(session.stopping)return session.stopPromise;
  session.stopping=true;session.controller.abort();announce('stopping',failure?.message||null);
  session.stopPromise=(async()=>{
   let stopFailure=null;
   try{
    // Abort readiness/preflight now, but let a submitted transaction settle its bounded receipt.
    const settled=await Promise.allSettled([drivers()[session.module].stop({preserveDrafts,reason}),session.task,session.driverPromise]);
    if(settled[0].status==='rejected')stopFailure=settled[0].reason;
    if(drivers()[session.module].isRunning())await drivers()[session.module].stop({preserveDrafts,reason});
   }catch(e){stopFailure=e;}
   let run=null;try{run=await api.runtime(session.module,'get');}catch{}
   // A failed final runtime write must not leave an invisible active owner behind.
   // Only repair our own run; never stop a replacement that appeared while awaiting cleanup.
   if(session.driverInvoked&&run?.active&&run.owner===tabId&&(!session.runId||run.runId===session.runId)){
    try{await api.runtime(session.module,'stop',{runId:run.runId});run=await api.runtime(session.module,'get');if(!run?.active&&!drivers()[session.module].isRunning())stopFailure=null;}
    catch(e){stopFailure=e;}
    if(run?.active)stopFailure=error('STOP_FAILED','当前任务的停止状态未确认，请查看工作页');
   }
   let result=stopFailure&&(!failure||normalStop(failure)||failure.name==='AbortError')?stopFailure:failure||stopFailure;
   if(uncertain(run))result=Object.assign(error('SEND_UNKNOWN',session.module==='followback'?'上次回关结果未知，请核对关注状态，不会自动重试':'上次发送结果未知，请先核对平台记录'),{submitted:true});
   const ordinary=!result||normalStop(result)||result.name==='AbortError';
   if(ordinary&&result?.code==='SOURCE_CHANGED'&&session.module==='interaction'){
    const key=globalThis.navigation?.currentEntry?.key,route=policy.normalize(location.href);
    if(key&&/^\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(route)&&session.guard.expected()===route&&self()===session.account)
     pausedInteractionDetail={token:session.token,url:location.href,key};
   }
   if(!ordinary)blocked={token:session.token,at:Date.now(),failure:result,run,reported:false};
   try{if(reportState){await report(session.assignment,ordinary?'stopped':result.code==='SEND_UNKNOWN'?'blocked':'error',ordinary?null:result,run);if(blocked?.token===session.token)blocked.reported=true;}}
   catch(e){if(!ordinary)lastError=(result?.message||'任务已停止')+'；状态回报失败，请刷新控制台查看';}
   if(current===session)current=null;
   announce(ordinary?'stopped':'blocked',ordinary?null:result?.message);
   if(!closed)requestRefresh();
  })();return session.stopPromise;
 }
 async function stop(options={}){
  if(!current)return;
  return stopSession(current,{...options,failure:options.failure||error('MANUAL_PAUSE',options.reason||'当前工作页已手动暂停，请修复后恢复')});
 }
 async function boot(session){
  const signal=session.controller.signal;
  if(!validStartRoute(session.assignment))throw error('PAGE_CHANGED','工作页已离开任务范围，请查看后修复');
  // Background rendering gets a generous allowance, but never an unbounded
  // "starting" state: waitForPage extends its own timeout while hidden.
  const accountDeadline=Date.now()+120000;
  let account;
  try{account=await T.bounded(()=>T.waitForPage(()=>self(),{signal,timeout:120000}),{signal,deadline:accountDeadline});}
  catch(failure){
   if(failure.code==='YIELD'&&Date.now()>=accountDeadline)throw error('ACCOUNT_NOT_READY','工作页账号在两分钟内未就绪，请检查登录或页面加载后恢复');
   throw failure;
  }
  if(!account)throw error('LOGIN_REQUIRED','请先在工作页登录 X');
  session.accountReady=true;check(signal);
  const mediaDraft=session.module==='followback'&&(document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length));
  if(mediaDraft||document.querySelector('[role="dialog"],[role="alertdialog"]')||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw error('RESIDUAL_DRAFT','工作页存在用户草稿或弹窗，请处理后修复');
  const run=await T.bounded(()=>api.runtime(session.module,'get'),{signal});check(signal);
  if(uncertain(run))throw Object.assign(error('SEND_UNKNOWN',session.module==='followback'?'上次回关结果未知，请核对关注状态，不会自动重试':'上次发送结果未知，请先核对平台记录'),{submitted:true});
  if(run.active)throw error('WORKER_BUSY','模块仍有任务收尾，暂不重复启动');
  if(session.module!=='followback')await T.bounded(()=>api.call({kind:'AI_CHECK',module:session.module}),{signal,deadline:Date.now()+45000});
  check(signal);
  if(session.module==='interaction'){
   globalThis.XAssistantEntry.setInteractionMode(session.assignment.sourceMode);
   await globalThis.XAssistantEntry.enter('interaction',signal);check(signal);
  }
  session.driverInvoked=true;session.driverPromise=Promise.resolve(drivers()[session.module].start(false,session.assignment.sourceMode));
  const started=await T.bounded(()=>session.driverPromise,{signal});session.runId=started?.runId||null;check(signal);
  if(!session.runId){const running=await T.bounded(()=>api.runtime(session.module,'get'),{signal});check(signal);session.runId=running?.runId||null;}
  session.starting=false;
  await report(session.assignment,'running');check(signal);
  announce('running',null);
 }
 function retryAllowed(a){
  if(!blocked||blocked.token!==a.token)return true;
  const retryAt=Number(ownerEntry()?.retryAt??a.retryAt);
  return a.shouldRun&&Number.isFinite(retryAt)&&retryAt>blocked.at&&Date.now()>=retryAt;
 }
 function begin(a){
  if(current||permissionFailure()||!retryAllowed(a))return;
  blocked=null;
  const session={module:a.module,token:a.token,account:a.account.toLowerCase(),assignment:{...a},controller:new AbortController(),starting:true,accountReady:false,stopping:false,
   guard:policy.createGuard({module:a.module,url:location.href,self:a.account})};
  current=session;announce('starting',null);
  session.task=Promise.resolve().then(()=>boot(session));
  session.task.catch(failure=>{if(current===session&&!session.stopping)void stopSession(session,{failure,reason:failure.message});});
 }
 async function applyAssignment(next){
  const previous=assignment;assignment=next&&policy.names.includes(next.module)?next:null;
  setTimers();
  if(current){
   const failure=permissionFailure();
   if(failure||current.token!==assignment?.token||current.module!==assignment?.module){
    await stopSession(current,{failure:failure||error('WORKER_REPLACED','工作页任务已更新')});
   }
  }
  if(assignment&&!current){
   // A transient message-channel failure must not leave the controller claiming
   // this worker still runs. Flush the failure once communication is restored.
   if(blocked?.token===assignment.token&&!blocked.reported){
    try{await report(assignment,blocked.failure?.code==='SEND_UNKNOWN'?'blocked':'error',blocked.failure,blocked.run);blocked.reported=true;}catch{}
   }
   const failure=permissionFailure();
   if(!failure)begin(assignment);
   else announce(assignment.status==='blocked'?'blocked':P.isModuleWorking(assignment.module,Date.now())?'stopped':'resting',assignment.status==='blocked'?assignment.reason:null);
  }else if(!assignment&&!current)announce('idle',null);
  if(previous?.token!==assignment?.token)blocked=null;
 }
 async function refresh(){
  await ready;
  while(dirty&&!closed){
   dirty=false;const generation=epoch;
   try{
    const next=await api.call({kind:'WORKER_POLL'});
    if(closed)break;
    if(generation!==epoch){dirty=true;continue;}
    await applyAssignment(next);
   }catch(failure){
    if(current)await stopSession(current,{failure:error('WORKSPACE_UNAVAILABLE',failure.message),reportState:false});
    else announce('blocked',failure.message);
    break;
   }
  }
 }
 function requestRefresh(){
  if(closed)return;
  dirty=true;
  if(refreshTask)return refreshTask;
  refreshTask=Promise.resolve().then(refresh).finally(()=>{refreshTask=null;if(dirty&&!closed)requestRefresh();});
  refreshTask.catch(()=>{});return refreshTask;
 }
 // Business progress is not a heartbeat. Update only for a distinct step; a live
 // tab with a stuck editor must eventually become visibly stale on every console.
 const activityKey=x=>x.step+'|'+(x.until||'');
 function flushProgress(session){
  if(current!==session||session.stopping||!session.runId||!authorized()||session.writingProgress||!session.pendingProgress)return;
  const now=Date.now();
  if(session.progressSentAt!=null&&now-session.progressSentAt<3000)return;
  const activity=session.pendingProgress;session.pendingProgress=null;
  if(activityKey(activity)===session.sentProgress)return;
  session.progressSentAt=now;session.writingProgress=true;
  void api.runtime(session.module,'patch',{runId:session.runId,patch:{activity}}).then(()=>{
   session.sentProgress=activityKey(activity);
  }).catch(()=>{
   if(!session.pendingProgress)session.pendingProgress=activity;
  }).finally(()=>{session.writingProgress=false;});
 }
 function progress(step,{until}={}){
  const session=current;if(!session||session.stopping||!session.runId||!authorized()||typeof step!=='string')return;
  session.lastDomStep=domProgress(session)?.step||session.lastDomStep;
  step=step.trim().slice(0,160);if(!step)return;
  const activity={step,until:Number.isFinite(until)&&until>Date.now()?until:null};
  session.pendingProgress=activity;flushProgress(session);
 }
 function domProgress(session){
  const output=document.querySelector('#x-assistant-float [data-status="'+session.module+'"]');
  const text=output?.textContent?.trim()||'';
  if(text&&text.length<600){
   // Freeze the absolute deadline once. A throttled DOM showing "20s" must
   // never keep postponing this time every time the supervisor samples it.
   const wait=text.match(/(?:下次(?:发帖|回帖)\s*|·\s*)(\d+(?:\.\d+)?)\s*秒/);
   const step=(wait?text.replace(wait[0],wait[0].replace(/[\d.]+\s*秒/,'')).replace(/\s*·\s*$/,'').trim():text).slice(0,160);
   return {step,until:wait?Date.now()+Number(wait[1])*1000:null};
  }
  return null;
 }
 function sampleProgress(session){
  if(!session.runId)return;
  const activity=domProgress(session);
  if(activity&&activity.step!==session.lastDomStep){
   session.lastDomStep=activity.step;session.pendingProgress=activity;
  }
  flushProgress(session);
 }
 function inspect(){
  if(!current||current.stopping)return;
  try{check();}catch(failure){void stopSession(current,{failure,reason:failure.message});return;}
  if(!current.starting)sampleProgress(current);
  if(!current.starting&&!drivers()[current.module].isRunning()){
   const session=current;
   void api.runtime(session.module,'get').then(run=>{
    if(current!==session||session.stopping)return;
    const failure=permissionFailure()||Object.assign(error(uncertain(run)?'SEND_UNKNOWN':'DRIVER_STOPPED',run.error||'任务意外停止，请查看工作页'),{submitted:uncertain(run)});
    void stopSession(session,{failure});
   }).catch(failure=>{if(current===session)void stopSession(session,{failure});});
  }
 }
 function setTimers(){
  if(assignment&&!closed){
   if(!pollTimer)pollTimer=setInterval(requestRefresh,5000);
   if(!guardTimer)guardTimer=setInterval(inspect,500);
  }else{
   clearInterval(pollTimer);clearInterval(guardTimer);pollTimer=null;guardTimer=null;
  }
 }
 const ready=api.call({kind:'WORKSPACE_HELLO'}).then(async result=>{
  tabId=result.tabId;assignment=result.assignment||null;
  const data=await local().get([SERVICE_KEY,SEARCH_KEY]);
  service=data[SERVICE_KEY]||null;searchEnabled=data[SEARCH_KEY]!==false;
  announce('idle',null);setTimers();return result;
 }).catch(failure=>{closed=true;dirty=false;setTimers();unavailable=failure.message;announce('blocked',failure.message);throw failure;});
 globalThis.XAssistantWorkspace={ready,check,progress,expectNavigation,openStatusTarget,beginComposer,canCleanComposer,stop,active:()=>current?.module||null,tabId:()=>tabId,state};
 ready.then(()=>{if(assignment)requestRefresh();}).catch(()=>{});
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes[SEARCH_KEY]){
   searchEnabled=changes[SEARCH_KEY].newValue!==false;
   epoch++;if(current?.module==='interaction')inspect();
   if(assignment?.module==='interaction')requestRefresh();
  }
  if(!changes[SERVICE_KEY])return;
  service=changes[SERVICE_KEY].newValue||null;epoch++;
  inspect();
  if(assignment||Object.values(service?.workers||{}).some(w=>w.tabId===tabId))requestRefresh();
 });
 chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.kind!=='SERVICE_SYNC')return false;
  requestRefresh();respond?.({ok:true});return false;
 });
 window.addEventListener('popstate',inspect);
 window.addEventListener('x-assistant-module-state',event=>{
  const detail=event.detail,session=current;
  if(!session||session.starting||session.stopping||detail?.module!==session.module||detail.running)return;
  const failed=Object.assign(error(detail.code||'DRIVER_STOPPED',detail.error||'任务意外停止，请查看工作页'),{submitted:detail.submitted===true,confirmed:detail.confirmed===true});
  const failure=detail.submitted===true||detail.confirmed===true?failed:permissionFailure()||failed;
  void stopSession(session,{failure});
 });
 window.addEventListener('x-assistant-invalidate',event=>{
  closed=true;dirty=false;epoch++;setTimers();
  unavailable=event.detail?.reason||'扩展连接已断开，请刷新页面';
  if(current)void stopSession(current,{failure:error('WORKSPACE_UNAVAILABLE',unavailable),reportState:false});
  else announce('blocked',unavailable);
 });
 window.addEventListener('pagehide',()=>{
  closed=true;setTimers();if(current)void stopSession(current,{reason:'工作页面已关闭或刷新',reportState:false});
 },{once:true});
})();
