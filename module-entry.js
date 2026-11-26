// All starts navigate through observed X navigation links, never overwrite inline drafts.
(()=>{
 const root=document.getElementById('x-assistant-float'),api=globalThis.XAssistantRuntime;
 let interactionTarget='/home',interactionMode=null,pendingListPaint=null;
 const SEARCH_KEY='xAssistantFriendSearchV1',prefs=globalThis.XAssistantInteractionPrefs;
 let filterRevision=0,pageKeyword=null,nativeSearchPath=null,refreshRestored=false,refreshed=false;
 const refreshKey=()=>{const id=globalThis.XAssistantWorkspace?.state?.().tabId;return Number.isInteger(id)?'xAssistantInteractionRefreshV1:'+id:null;};
 const rows='[data-testid="primaryColumn"] article[data-testid="tweet"], [data-testid="primaryColumn"] [data-testid="emptyState"]';
 const visible=node=>node.isConnected&&!node.closest('[hidden],[inert],[aria-hidden="true"]');
 const snapshotSearchList=()=>[...new Set([...(pendingListPaint?.previous||[]),...document.querySelectorAll(rows)])];
 const filterKeys=[prefs.KEY,prefs.VIEWS_KEY,prefs.LIKES_KEY,prefs.METRIC_KEY,prefs.COMMENTS_KEY];
 const readFilters=values=>prefs.normalize(values[prefs.KEY],values[prefs.VIEWS_KEY],values[prefs.LIKES_KEY],values[prefs.METRIC_KEY],values[prefs.COMMENTS_KEY]);
 chrome.storage.onChanged?.addListener((changes,area)=>{
  if(area!=='local')return;
  const change=changes[prefs.KEY],views=changes[prefs.VIEWS_KEY];
  if(changes[prefs.COMMENTS_KEY]||changes[prefs.LIKES_KEY]||changes[prefs.METRIC_KEY]||views&&views.oldValue!==views.newValue||change&&!prefs.same(change.oldValue,change.newValue,interactionMode!=='home'&&!pageKeyword))filterRevision++;
 });
 // A missing key retains the previous default-on behavior. Never overwrite a
 // user's explicit off preference while completing the old migration marker.
 const local=api?.storage||chrome.storage.local;
 const discoveryReady=Promise.resolve().then(()=>local.get('xAssistantUnfollowedDiscoveryV1')).then(async d=>{
  if(!d.xAssistantUnfollowedDiscoveryV1)await local.set({xAssistantUnfollowedDiscoveryV1:true});
 });
 // Eager migration may fail before a driver awaits it; keep the original rejecting promise.
 discoveryReady.catch(()=>{});
 const TOPIC_KEY=prefs.INDEX_KEY;
 const searchEnabled=async()=>{await discoveryReady;return (await local.get(SEARCH_KEY))[SEARCH_KEY]!==false;};
 const usesTopics=async()=>{
  if(interactionMode==='home')return false;
  const enabled=await searchEnabled();
  if(interactionMode==='search'&&!enabled)throw Object.assign(Error('互动来源已切换'),{code:'SOURCE_CHANGED'});
  return enabled;
 };
 const filterChanged=()=>Object.assign(Error('互动关键词或筛选门槛已修改，旧目标不再发送'),{code:'INTERACTION_FILTER_CHANGED'});
 async function filtersFor(){
  const revision=filterRevision,keyword=pageKeyword,path=nativeSearchPath,search=await usesTopics();
  const values=await local.get(search?[...filterKeys,TOPIC_KEY]:filterKeys),value=readFilters(values),index=values[TOPIC_KEY];
  const validate=()=>{if(revision!==filterRevision)throw filterChanged();};
  const refresh=async()=>{
   const latest=readFilters(await local.get(filterKeys));
   if(!prefs.same(value,latest,search&&!keyword))throw filterChanged();
   validate();
  };
  const selection=search&&keyword?prefs.selection({...value,keywords:[keyword]},0,true):prefs.selection(value,index,search);
  return {...selection,...(search&&path?{path}:{}),validate,refresh};
 }
 const targetFor=async()=>(await filtersFor()).path;
 const nextFriendTopic=async previous=>{
  const current=await filtersFor();
  previous?.validate();current.validate();
  if(current.count<2)return false;
  await local.set({[TOPIC_KEY]:(current.position+1)%current.count});return true;
 };
 const current=()=>location.pathname+location.search;
 const noDraft=()=>{
  if(document.querySelector('[role="dialog"],[role="alertdialog"]')||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim())||
   [...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length)||document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]'))
   throw Object.assign(Error('工作页已有弹窗或草稿，请处理后重新启动'),{code:'RESIDUAL_DRAFT',preserveDrafts:true});
 };
 const captureInteractionTarget=()=>{interactionTarget=globalThis.XAssistantCore.interactionPage(location.href)?topSearch(current()):'/home';return interactionTarget;};
 const topSearch=path=>{if(!path.startsWith('/search?'))return path;const u=new URL(path,'https://x.com');u.searchParams.delete('f');return u.pathname+u.search;};
 const setInteractionTarget=path=>{interactionTarget=globalThis.XAssistantCore.interactionPage(path)?topSearch(path):'/home';};
 const setInteractionMode=mode=>{
  interactionMode=mode==='home'?'home':'search';
  if(interactionMode==='home'&&pageKeyword){pageKeyword=null;nativeSearchPath=null;filterRevision++;}
 };
 function searchWorkspace(){
  const state=globalThis.XAssistantWorkspace?.state?.();
  return interactionMode==='search'&&state?.status==='running'&&state.active==='interaction'&&
   state.assignment?.sourceMode==='search'&&state.assignment.shouldRun===true;
 }
 function setPageKeyword(text){
  if(!searchWorkspace()||location.pathname!=='/search')throw Error('仅可在运行中的互动搜索工作页换词');
  globalThis.XAssistantWorkspace.check();
  const words=prefs.parseKeywords(text);
  if(words.length>1)throw Error('工作页一次只能设置一个关键词或短语');
  const next=words[0]||null;
  if(next!==pageKeyword||nativeSearchPath){pageKeyword=next;nativeSearchPath=null;filterRevision++;}
  return next;
 }
 function acceptNativeSearch({path,keyword,previous}){
  pageKeyword=keyword;nativeSearchPath=path;pendingListPaint={target:path,previous};filterRevision++;
  window.dispatchEvent(new CustomEvent('x-assistant-native-search',{detail:{keyword}}));
 }
 const account=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
 async function enter(module,signal){
  await globalThis.XAssistantWorkspace?.ready;globalThis.XAssistantWorkspace?.check(signal);
  const self=account();if(!/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))throw Error('账号未加载完成');
  if(module==='interaction'&&!refreshRestored){
   refreshRestored=true;
   const key=refreshKey(),saved=key?(await local.get(key))[key]:null;
   if(saved){
    await local.set({[key]:null});
    const assignment=globalThis.XAssistantWorkspace?.state?.().assignment;
    if(saved.token===assignment?.token&&saved.account===self&&saved.mode===interactionMode&&saved.path===current()&&Date.now()-saved.at>=0&&Date.now()-saved.at<600000){
     pageKeyword=saved.keyword;nativeSearchPath=saved.nativePath;refreshed=true;
    }
   }
  }
  const filters=module==='interaction'?await filtersFor():null,target=filters?.path??(module==='posting'?'/home':self);
  const checkTarget=()=>{globalThis.XAssistantWorkspace?.check(signal);filters?.validate();};
  checkTarget();
  noDraft();
  const moving=current()!==target;
  if(moving){
   await globalThis.XAssistantTasks.sleep(500,signal);api.check(signal);if(account()!==self)throw Error('账号发生变化');
   checkTarget();noDraft();
   if(module==='interaction')
    pendingListPaint={target,previous:snapshotSearchList()};
   globalThis.XAssistantWorkspace?.expectNavigation(target);
   if(target.startsWith('/search?')||target===self){
    history.pushState(history.state,'',target);window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
   }else{
   const link=document.querySelector('[data-testid="AppTabBar_Home_Link"]');
   if(!link||new URL(link.href,location.href).href!=='https://x.com/home')throw Error('未找到工作页面入口');link.click();
   }
  }
  // Keep the proof across a timed out/cancelled entry: on retry, matching URL
  // alone must not authorize cards left behind by the cancelled navigation.
  const paint=module==='interaction'?pendingListPaint:null;
  if(moving||paint){
   const ready=await globalThis.XAssistantTasks.waitForPage(()=>{
    checkTarget();
    if(current()!==target)return false;
    if(!paint)return true;
    // The URL may commit before React replaces the prior list. Never act on its cards.
    return paint.target===target&&!paint.previous.some(visible)&&[...document.querySelectorAll(rows)].some(visible);
   },{signal,timeout:15000});
   checkTarget();
   if(!ready||current()!==target){
    if(current()===target&&target===nativeSearchPath&&paint===pendingListPaint)
     throw Object.assign(Error('等待 X 搜索结果加载，旧列表不参与互动'),{code:'SEARCH_RESULTS_WAIT'});
    throw Object.assign(Error('工作页列表未能确认切换，请查看工作页'),{code:'NAVIGATION'});
   }
   if(paint===pendingListPaint)pendingListPaint=null;
  }
  api.check(signal);checkTarget();if(account()!==self)throw Error('账号发生变化');noDraft();
  if(module==='interaction'&&target==='/home')await globalThis.XAssistantHomeTimeline?.enter(signal);
  api.check(signal);checkTarget();if(account()!==self)throw Error('账号发生变化');noDraft();return self;
 }
 async function refreshCurrent(signal){
  await globalThis.XAssistantWorkspace?.ready;globalThis.XAssistantWorkspace?.check(signal);api.check(signal);noDraft();
  const filters=await filtersFor(),target=filters.path;filters.validate();
  if(current()!==target)throw Object.assign(Error('互动工作页已变化，未刷新旧时间线'),{code:'PAGE_CHANGED'});
  if(target!=='/home'&&!target?.startsWith('/search?'))throw Object.assign(Error('当前互动时间线不可刷新'),{code:'NAVIGATION'});
  const owner=account(),key=refreshKey(),assignment=globalThis.XAssistantWorkspace?.state?.().assignment;
  if(!key||assignment?.module!=='interaction')throw Object.assign(Error('未找到互动工作页归属'),{code:'NO_WORKER_SESSION'});
  const home=target==='/home'?globalThis.XAssistantHomeTimeline:null,token=home?.capture();
  if(home&&!await home.rememberCurrent())throw Object.assign(Error('当前首页时间线未能保存'),{code:'TIMELINE_NOT_READY'});
  await local.set({[key]:{account:owner,token:assignment.token,mode:interactionMode,path:target,keyword:pageKeyword,nativePath:nativeSearchPath,at:Date.now()}});
  globalThis.XAssistantWorkspace.check(signal);api.check(signal);filters.validate();noDraft();home?.check(token);
  if(current()!==target||account()!==owner)throw Object.assign(Error('工作页已变化，取消刷新'),{code:'PAGE_CHANGED'});
  // A same-tab click or same-URL popstate can be a React no-op. Reload the
  // document; the managed worker restores its source and persisted cooldown.
  location.reload();
  // Never let the old document rescan while unload is pending or blocked.
  await globalThis.XAssistantTasks.sleep(15000,signal);
  throw Object.assign(Error('当前时间线页面未能重新加载'),{code:'NAVIGATION'});
 }
 globalThis.XAssistantEntry={enter,account,captureInteractionTarget,setInteractionTarget,setInteractionMode,targetFor,filtersFor,nextFriendTopic,searchEnabled,searchWorkspace,setPageKeyword,pageKeyword:()=>pageKeyword,
  snapshotSearchList,acceptNativeSearch,refreshCurrent,consumeRefresh:()=>{const value=refreshed;refreshed=false;return value;},waitingForList:()=>!!pendingListPaint};
})();
