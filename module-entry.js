// All starts navigate through observed X navigation links, never overwrite inline drafts.
(()=>{
 const root=document.getElementById('x-assistant-float'),api=globalThis.XAssistantRuntime;
 let interactionTarget='/home',interactionMode=null,pendingListPaint=null;
 const SEARCH_KEY='xAssistantFriendSearchV1';
 const topics=[
  '蓝V交友 OR "make new friends" OR 友達募集',
  '蓝V互关 OR "follow back" OR 相互フォロー',
  '蓝V扩列 OR "new mutuals" OR 相互さん募集',
  '蓝V浇友 OR "lets connect" OR 繋がりたい',
  '蓝V互助 OR "mutual support" OR 交流したい',
  '蓝V新人 OR "new creators" OR X友募集',
  '蓝V活人 OR "active mutuals" OR 絡み募集中',
  '诚信互关 OR "follow back guaranteed" OR フォロバ確実',
  '有关必回 OR "I follow back" OR フォロー返します',
  '蓝V涨粉 OR "gain followers" OR フォロワー募集',
  '蓝V串门 OR "connect with me" OR 仲良くしてください',
  '蓝V出摊 OR "creator community" OR 仲間募集',
  '互关互赞 OR "engagement friends" OR 交流希望',
  '真诚互粉 OR "mutual follow" OR フォロバ歓迎',
  '蓝V抱团 OR "grow together" OR 仲良くなりたい',
  '蓝友互关 OR "blue check mutuals" OR ブルーバッジ仲間'
 ];
 topics.push('蓝V 曝光 转化 OR 蓝V 粉丝量 OR 蓝V 曝光破万','蓝V 涨粉速度 OR 蓝V 粉丝目标 OR 蓝V 有效曝光','蓝朋友 曝光 OR 蓝V 多少粉 OR 蓝V 粉丝转化');
 const waterKeywords=['互浇', '浇朋友', '浇个朋友', '浇起来', '浇友', '真诚浇友', '蓝V浇友', '蓝V互浇', '蓝V交友', '蓝V互关', '蓝V新人', '蓝朋友', '有关必回', '互粉互串', '真诚串门', '真诚出摊', '出摊了', '来交朋友', '蓝宝宝', '评论区来打个卡', '朋友们', '来者不拒皆为客', '真诚交友', '蓝V浇朋友', '诚信互关', '继续出摊', '还在更推', '蓝朋友们', '多多走动', '欢迎留下足迹', '一起加油', '蓝V互动', '出摊就位', '日更的小伙伴', '抱团交朋友', '真诚互访', '蓝V互推', '积极回关', '浇盆友', '交个朋友', '蓝V互关互粉', '出晚摊啦', '各位朋友多多帮忙', '一起往前走', '还在更玩的', '关注列表', '欢迎新朋友加入', '早高峰出摊', '晚高峰', '肝王出摊', '积极回关中', '未被回关', '回关路上', '每日关注量', '新的蓝朋友', '蓝V账号涨粉', '多评论', '多互动', '主动和别人交流', '每天涨粉', '互相关注', '涨粉加速', '活人账号', '持续更推', '粉丝蹭蹭往上涨', '大规模涨粉', '时间线迅速曝光', '蓝V活人', '互关交个朋友', '纯活人', '晚场开摆', '夜场开张', '回完睡觉', '曝光量', '蓝v好友', '多回复', '蓝v朋友', '互动一波', '真诚待人', '缘分刷到', '串门浇朋友', '出来营业啦', '蓝V活人一枚', '不玩套路', '评论必回访', '来串串门', '打个招呼', '来打声招呼', '欢迎再坐一会儿', '互互关', '互关必回', '关注我，必回关', '早高峰', '晚高峰不发帖', '关注列表还在努力扩建', '新朋友加入', '曝光进度', '有效曝光的持续考核', '长期保持达标状态', '时间线重合'];
 for(let i=0;i<waterKeywords.length;i+=4) topics.push(waterKeywords.slice(i,i+4).map(t=>'"'+t+'"').join(' OR '));
 // A missing key retains the previous default-on behavior. Never overwrite a
 // user's explicit off preference while completing the old migration marker.
 const local=api?.storage||chrome.storage.local;
 const discoveryReady=Promise.resolve().then(()=>local.get('xAssistantUnfollowedDiscoveryV1')).then(async d=>{
  if(!d.xAssistantUnfollowedDiscoveryV1)await local.set({xAssistantUnfollowedDiscoveryV1:true});
 });
 // Eager migration may fail before a driver awaits it; keep the original rejecting promise.
 discoveryReady.catch(()=>{});
 const TOPIC_KEY='xAssistantFriendTopicIndexV1';
 const searchEnabled=async()=>{await discoveryReady;return (await local.get(SEARCH_KEY))[SEARCH_KEY]!==false;};
 const usesTopics=async()=>{
  if(interactionMode==='home')return false;
  const enabled=await searchEnabled();
  if(interactionMode==='search'&&!enabled)throw Object.assign(Error('互动来源已切换'),{code:'SOURCE_CHANGED'});
  return enabled;
 };
 const targetFor=async()=>{if(!await usesTopics())return '/home';const d=await local.get(TOPIC_KEY);const index=Number.isInteger(d[TOPIC_KEY])&&d[TOPIC_KEY]>=0?d[TOPIC_KEY]%topics.length:0;return '/search?q='+encodeURIComponent(topics[index])+'&src=typed_query';};
 const nextFriendTopic=async()=>{if(!await usesTopics())return false;const d=await local.get(TOPIC_KEY);const index=Number.isInteger(d[TOPIC_KEY])&&d[TOPIC_KEY]>=0?d[TOPIC_KEY]:0;await local.set({[TOPIC_KEY]:(index+1)%topics.length});return true;};
 const current=()=>location.pathname+location.search;
 const captureInteractionTarget=()=>{interactionTarget=globalThis.XAssistantCore.interactionPage(location.href)?topSearch(current()):'/home';return interactionTarget;};
 const topSearch=path=>{if(!path.startsWith('/search?'))return path;const u=new URL(path,'https://x.com');u.searchParams.delete('f');return u.pathname+u.search;};
 const setInteractionTarget=path=>{interactionTarget=globalThis.XAssistantCore.interactionPage(path)?topSearch(path):'/home';};
 const setInteractionMode=mode=>{interactionMode=mode==='home'?'home':'search';};
 const account=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
 async function enter(module,signal){
  await globalThis.XAssistantWorkspace?.ready;globalThis.XAssistantWorkspace?.check(signal);
  const self=account();if(!/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))throw Error('账号未加载完成');
  const target=module==='interaction'?await targetFor():module==='posting'?'/home':self;
  const noDraft=()=>{
   if(document.querySelector('[role="dialog"],[role="alertdialog"]')||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim())||
    [...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length)||document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]'))
    throw Object.assign(Error('工作页已有弹窗或草稿，请处理后重新启动'),{code:'RESIDUAL_DRAFT',preserveDrafts:true});
  };
  noDraft();
  const moving=current()!==target;
  const rows='[data-testid="primaryColumn"] article[data-testid="tweet"], [data-testid="primaryColumn"] [data-testid="emptyState"]';
  const visible=node=>node.isConnected&&!node.closest('[hidden],[inert],[aria-hidden="true"]');
  if(moving){
   await globalThis.XAssistantTasks.sleep(500,signal);api.check(signal);if(account()!==self)throw Error('账号发生变化');
   globalThis.XAssistantWorkspace?.check(signal);noDraft();
   if(module==='interaction'&&(pendingListPaint||location.pathname!==new URL(target,location.href).pathname))
    pendingListPaint={target,previous:[...document.querySelectorAll(rows)].filter(visible)};
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
    if(current()!==target)return false;
    if(!paint)return true;
    globalThis.XAssistantWorkspace?.check(signal);
    // The URL may commit before React replaces the prior list. Never act on its cards.
    return paint.target===target&&!paint.previous.some(visible)&&[...document.querySelectorAll(rows)].some(visible);
   },{signal,timeout:15000});
   if(!ready||current()!==target)throw Object.assign(Error('工作页列表未能确认切换，请查看工作页'),{code:'NAVIGATION'});
   if(paint===pendingListPaint)pendingListPaint=null;
  }
  api.check(signal);globalThis.XAssistantWorkspace?.check(signal);if(account()!==self)throw Error('账号发生变化');noDraft();return self;
 }
 globalThis.XAssistantEntry={enter,account,captureInteractionTarget,setInteractionTarget,setInteractionMode,targetFor,nextFriendTopic,searchEnabled};
})();
