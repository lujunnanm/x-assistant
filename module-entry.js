// All starts navigate through observed X navigation links, never overwrite inline drafts.
(()=>{
 const root=document.getElementById('x-assistant-float'),api=globalThis.XAssistantRuntime;
 let interactionTarget='/home';
 const SEARCH_KEY='xAssistantFriendSearchV1';
 const topics=['蓝v交友','蓝V互关','蓝V扩列','交友','互浇','蓝V交朋友','互关交友','蓝V互助'];
 const TOPIC_KEY='xAssistantFriendTopicIndexV1';
 const targetFor=async()=>{const d=await chrome.storage.local.get([SEARCH_KEY,TOPIC_KEY]);const index=Number.isInteger(d[TOPIC_KEY])&&d[TOPIC_KEY]>=0?d[TOPIC_KEY]%topics.length:0;return d[SEARCH_KEY]===true?'/search?q='+encodeURIComponent(topics[index])+'&src=typed_query':interactionTarget;};
 const nextFriendTopic=async()=>{const d=await chrome.storage.local.get([SEARCH_KEY,TOPIC_KEY]);if(d[SEARCH_KEY]!==true)return false;const index=Number.isInteger(d[TOPIC_KEY])&&d[TOPIC_KEY]>=0?d[TOPIC_KEY]:0;await chrome.storage.local.set({[TOPIC_KEY]:(index+1)%topics.length});return true;};
 const current=()=>location.pathname+location.search;
 const captureInteractionTarget=()=>{interactionTarget=globalThis.XAssistantCore.interactionPage(location.href)?topSearch(current()):'/home';return interactionTarget;};
 const topSearch=path=>{if(!path.startsWith('/search?'))return path;const u=new URL(path,'https://x.com');u.searchParams.delete('f');return u.pathname+u.search;};
 const setInteractionTarget=path=>{interactionTarget=globalThis.XAssistantCore.interactionPage(path)?topSearch(path):'/home';};
 const account=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
 async function enter(module,signal){
  const self=account();if(!/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))throw Error('账号未加载完成');
  const target=module==='interaction'?await targetFor():module==='posting'?interactionTarget:'/home';
  if(document.querySelector('[role="dialog"],[role="alertdialog"]')&&!await globalThis.XAssistantPopup.cancel())throw Error('无法取消弹窗，已停止');
  if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw Error('页面存在未发送的内联草稿，请先处理');
  if(current()!==target){
   if(target.startsWith('/search?')){
    history.pushState(history.state,'',target);window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
   }else{
   const link=document.querySelector('[data-testid="AppTabBar_Home_Link"]');
   if(!link)throw Error('未找到工作页面入口');link.click();
   }
   await globalThis.XAssistantTasks.waitFor(()=>current()===target,{signal,timeout:15000});
   if(current()!==target)throw Error('工作页面切换失败');
  }
  api.check(signal);if(account()!==self)throw Error('账号发生变化');return self;
 }
 globalThis.XAssistantEntry={enter,account,captureInteractionTarget,setInteractionTarget,targetFor,nextFriendTopic};
})();
