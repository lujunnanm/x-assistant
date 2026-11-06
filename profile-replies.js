// Profile count-driven discovery followed by mentions; uses the existing guarded reply transaction and ledger.
(()=>{
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
 const D=globalThis.XAssistantDOM,T=globalThis.XAssistantTasks;
 async function scan(options){
  const {signal,account}=options,owner=account.toLowerCase(),until=options.until||Date.now();
  const primary=()=>document.querySelector('[data-testid="primaryColumn"]');
  const rows=()=>{const c=primary();return c?D.rows(owner).filter(r=>c.contains(r.article)):[];};
  const busy=()=>[...(primary()?.querySelectorAll('[role="progressbar"]')||[])].some(n=>!n.closest('article,form,[data-testid="inline_reply_offscreen"]'));
  const profileBound=()=>!!primary()?.querySelector('[data-testid="UserProfileHeader_Items"],[data-testid="UserName"]') &&
    (rows().some(r=>r.author.toLowerCase()===owner.slice(1))||!!primary()?.querySelector('[data-testid="emptyState"]'));
  let expected=location.pathname;
  const guard=()=>{T.check(signal);globalThis.XAssistantWorkspace?.check(signal);if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化');if(location.pathname.toLowerCase()!==expected.toLowerCase())throw new T.TaskError('PAGE_CHANGED','页面已切换');};
  const issue=async(code,message,targetId)=>globalThis.XAssistantRuntime.runtime('notifications','patch',{runId:options.runId,patch:{lastIssue:{code,message,targetId}}});
  const scrollY=()=>Number(window.scrollY??document.scrollingElement?.scrollTop)||0;
  const scrollTo=top=>window.scrollTo({top:Math.max(0,top),behavior:'instant'});
  const topMarkers=new Set();
  const go=async(atTop=true)=>{
   const oldY=scrollY(),onProfile=location.pathname.toLowerCase()===owner,oldIds=onProfile?new Set(rows().map(r=>r.id)):new Set();
   // A short profile can keep all cards mounted while scrolling. Record only
   // owned originals already laid out at the document's first viewport. Their
   // absolute top and exact timestamp must still agree after returning to zero.
   const firstLayout=new Map();
   if(atTop&&onProfile&&oldY>=innerHeight*.6&&profileBound())for(const r of rows()){
    const box=r.article.getBoundingClientRect?.(),top=box&&oldY+box.top;
    if(r.article.isConnected!==false&&!r.article.closest?.('[hidden],[inert],[aria-hidden="true"]')&&
      r.author.toLowerCase()===owner.slice(1)&&D.originalPost(r.id,owner)&&Number.isFinite(r.at)&&
      box?.height>0&&Number.isFinite(top)&&top>=0&&top<innerHeight&&!firstLayout.has(r.id))
     firstLayout.set(r.id,{at:r.at,top});
   }
   const oldDetail=!atTop&&!onProfile?new Set(rows().map(r=>r.article)):null;
   guard();
   if(location.pathname.toLowerCase()!==owner){
    if(D.dialogs().length||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw new T.TaskError('RESIDUAL_DRAFT','页面存在草稿');
    const profile=await T.waitForPage(()=>{guard();const a=document.querySelector('[data-testid="AppTabBar_Profile_Link"]');return a?.getAttribute('href')?.toLowerCase()===owner?a:null;},{signal,timeout:7000});
    if(!profile)throw new T.TaskError('PROFILE_NAV_LINK','未找到当前账号原生个人资料链接：'+owner);
    guard();globalThis.XAssistantWorkspace?.expectNavigation(profile.getAttribute('href'));
    profile.click();
    if(!await T.waitForPage(()=>location.pathname.toLowerCase()===owner,{signal,timeout:12000}))throw new T.TaskError('PROFILE_NAV_LINK','页面未进入当前账号资料：'+owner);
    expected=location.pathname;
   }
   guard();if(!atTop)return T.waitForPage(()=>{guard();return profileBound()&&(!oldDetail||rows().some(r=>!oldDetail.has(r.article))||!!primary()?.querySelector('[data-testid="emptyState"]'));},{signal,timeout:15500});
   scrollTo(0);
   return await T.waitForPage(()=>{
    guard();if(!profileBound()||scrollY()>4)return false;
    if(oldY<innerHeight*.6||!oldIds.size)return true;
    const live=rows();
    // scrollTop changes synchronously, but X can leave old bottom cards mounted for seconds.
    if(live.some(r=>topMarkers.has(r.id)||!oldIds.has(r.id))||!!primary()?.querySelector('[data-testid="emptyState"]'))return true;
    return !busy()&&live.some(r=>{
     const old=firstLayout.get(r.id),box=r.article.getBoundingClientRect?.();
     return old&&r.article.isConnected!==false&&!r.article.closest?.('[hidden],[inert],[aria-hidden="true"]')&&
      live.filter(other=>other.id===r.id).length===1&&old.at===r.at&&r.author.toLowerCase()===owner.slice(1)&&
      D.originalPost(r.id,owner)&&box?.height>0&&box.top>=0&&box.top<innerHeight&&Math.abs(box.top+scrollY()-old.top)<=4;
    });
   },{signal,timeout:15500});
  };
  // X only binds its router to real timestamp links. A cached, virtualized profile
  // row is not a link: revisit the profile and find it again rather than faking history.
  const findPost=async post=>{
    const match=()=>location.pathname.toLowerCase()===owner&&rows().some(r=>r.id===post.id&&r.author.toLowerCase()===owner.slice(1)&&D.originalPost(r.id,owner));
    guard();if(match())return true; // Prefer the real card while it is still mounted.
    if(location.pathname.toLowerCase()!==owner&&!await go())return false;
    const end=Date.now()+20000;
    const waitMatch=ms=>T.waitForPage(()=>{guard();return match();},{signal,timeout:Math.min(ms,Math.max(0,end-Date.now()))});
    scrollTo(post.viewport);if(await waitMatch(6500))return true;
    // Scroll positions can shift (new posts, dynamic image heights). A second search
    // only starts from a verified first-page marker, never from the old bottom DOM.
    scrollTo(0);
    const top=await T.waitForPage(()=>{guard();return match()||scrollY()<=4&&rows().some(r=>topMarkers.has(r.id));},{signal,timeout:4000});
    if(!top)return false;
    for(let page=0;page<30&&Date.now()<end;page++){
      guard();if(match())return true;
      const sig=rows().map(r=>r.id).join(',');
      window.scrollBy(0,Math.max(600,innerHeight*.8));
      await T.waitForPage(()=>{guard();return match()||rows().map(r=>r.id).join(',')!==sig;},{signal,timeout:Math.min(2200,end-Date.now())});
    }
    return match();
  };
  globalThis.XAssistantWorkspace?.progress?.('检查个人主页');
  if(!await go()){
   const c=primary(),list=rows();
   const message='未核对个人资料主栏、原创帖或空状态：'+owner+'（主栏 '+Number(!!c)+'，资料头 '+Number(!!c?.querySelector('[data-testid="UserProfileHeader_Items"],[data-testid="UserName"]'))+'，本人卡 '+list.filter(r=>r.author.toLowerCase()===owner.slice(1)).length+'，滚动位置 '+Math.round(scrollY())+'）';await issue('PROFILE_NOT_READY',message,owner);
   return {complete:false,rest:true,reason:'PROFILE_NOT_READY',detail:message,stats:{}};
  }
  const posts=new Map(),audited=new Set();
  let last='',stable=0,complete=false,linkMisses=0,loadMisses=0,deferProfile=false;
  const countKey='xAssistantProfileCommentCountsV1';
  const allCounts=(await local().get(countKey))[countKey]||{};
  const counts=allCounts[owner]||{};
  const saveCounts=async()=>{
   const latest=(await local().get(countKey))[countKey]||{};
   await local().set({[countKey]:{...latest,[owner]:counts}});
  };
  const stats={eligible:0,confirmed:0,posts:posts.size,pending:0,visited:0,skipped:0};
  const visit=async post=>{
   audited.add(post.id);
   guard();
   globalThis.XAssistantWorkspace?.progress?.('检查个人帖 '+post.id);
   const previous=counts[post.id]||{};
   const count=Number.isInteger(post.replyCount)?post.replyCount:null;
   counts[post.id]={...previous,observed:count,checkedAt:Date.now()};
   await saveCounts();
   if(previous.checkpointVersion===2&&previous.lastOutcome!=='pending'&&count!==null&&previous.handled!==undefined&&count<=previous.handled){counts[post.id].lastOutcome='unchanged';stats.skipped++;await saveCounts();return;}
   if(count===0){counts[post.id].handled=0;counts[post.id].checkpointVersion=2;counts[post.id].lastOutcome='no_comments';stats.skipped++;await saveCounts();return;}
   stats.visited++;
   await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),phase:'profile',currentPost:post.id,stats,postIds:[...posts.keys()]}});
   const visible=await findPost(post);
   let result;
   if(!visible){
    deferProfile=++linkMisses>=3;
    const message='个人资料中未重新找到原创帖的原生链接：'+post.id+(deferProfile?'；连续 3 帖未定位，剩余原创帖保留下轮，转查提及':'');
    await issue(deferProfile?'PROFILE_LINK_BATCH_PAUSED':'PROFILE_POST_LINK',message,post.id);
    result={complete:false,reason:'PROFILE_POST_LINK',detail:message};
   }else {linkMisses=0;result=await globalThis.XAssistantNotifications.scan({...options,threadPath:owner+'/status/'+post.id,rootId:post.id,expectedCommentCount:count,returnToHome:false});}
   expected=location.pathname;
   const noCards=['THREAD_ROOT_NOT_READY','THREAD_COMMENTS_PENDING'].includes(result.reason)&&result.evidence?.threadRows===0&&!result.stats?.seen;
   loadMisses=noCards?loadMisses+1:0;
   if(loadMisses>=3){
    deferProfile=true;
    await issue('PROFILE_LOAD_BATCH_PAUSED',(result.detail||post.id)+'；连续 3 个详情未装载评论卡，剩余原创帖留待下轮，转查提及',post.id);
   }
   for(const key of ['eligible','confirmed'])stats[key]+=result.stats?.[key]||0;
   if(result.sample){
    counts[post.id].lastOutcome='pending';counts[post.id].lastReason=result.detail||result.reason;await saveCounts();
    await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),phase:'sample',sampleReason:result.reason,currentPost:post.id,stats,postIds:[...posts.keys()]}});
    return {...result,stats};
   }
   if(!result.complete||result.stats?.failed||result.stats?.aiFailed){
    stats.pending++;
    counts[post.id].lastOutcome='pending';
    counts[post.id].lastReason=result.detail||result.reason;
    await saveCounts();
    // A local loading or reply failure must not discard the rest of the queue.
    // A user navigation or interrupted cleanup must still stop this scan.
    if(result.reason==='page_changed'||!['/home',owner,owner+'/status/'+post.id].includes(location.pathname.toLowerCase()))return {...result,complete:false,rest:true,reason:'profile_pending',stats};
    return;
   }
   counts[post.id].lastOutcome='completed';
   if(Number.isInteger(result.finalCommentCount)){
    counts[post.id].handled=result.finalCommentCount;
    counts[post.id].checkpointVersion=2;
    counts[post.id].observed=result.finalCommentCount;
    counts[post.id].completedAt=Date.now();
    await saveCounts();
   }
  };
  discovery: for(let page=0;page<30;page++){
   guard();
   const list=rows(),viewport=scrollY(),eligible=[],anchors=new Map(),knownHere=new Map();
   if(page===0)for(const r of list.slice(0,3))topMarkers.add(r.id);
   for(const r of list){
    const rect=r.article?.getBoundingClientRect?.(),laidOut=rect?.height>0&&Number.isFinite(rect.top);
    const inView=laidOut&&rect.bottom>0&&rect.top<innerHeight;
    if(!Number.isFinite(r.at)||r.at<until-86400000||r.at>until||!D.originalPost(r.id,owner))continue;
    // A viewport hint is not a destination or ownership proof; findPost always
    // re-verifies a live row. Avoid keeping old nodes as X virtualizes the list.
    const newPost={id:r.id,at:r.at,replyCount:r.replyCount,viewport:Math.max(0,laidOut?viewport+rect.top-innerHeight*.32:viewport)};
    posts.set(r.id,newPost);knownHere.set(r.id,newPost);if(inView)anchors.set(r.id,rect.top);stats.posts=posts.size;
    if(!audited.has(r.id)&&inView)eligible.push(newPost);
   }
   const signature=list.map(r=>r.id).join(',');
   stable=signature===last?stable+1:0;last=signature;
   const own=list.filter(r=>r.author.toLowerCase()===owner.slice(1));
   const endHere=(own.filter(r=>r.at<until-86400000).length>=3||stable>=3)&&!busy();
   // Both normal and sample rounds use visible cards now, before X can recycle them.
   // Restore via a known account-bound original, not pixels, foreign cards or stale overscan.
   const place=(align=false)=>{
    if(location.pathname.toLowerCase()!==owner||!profileBound())return null;
    const live=rows(),seen=new Map();for(const r of live)seen.set(r.id,(seen.get(r.id)||0)+1);
    let next=false,correction=null;
    for(const r of live){
     if(seen.get(r.id)!==1)continue;
     const rect=r.article.getBoundingClientRect?.();if(!(rect?.height>0&&Number.isFinite(rect.top)))continue;
     const visible=rect.bottom>0&&rect.top<innerHeight,known=knownHere.get(r.id);
     if(!known||known.at!==r.at||r.author.toLowerCase()!==owner.slice(1)||!D.originalPost(r.id,owner))continue;
     // Avatar/media heights can move a genuine original by more than a viewport.
     // A recommendation/overscan card alone must never establish our position.
     if(visible&&anchors.has(r.id))return 'same';
     if(visible&&!audited.has(r.id))next=true;
     if(anchors.has(r.id)&&!visible&&correction===null)correction=scrollY()+rect.top-anchors.get(r.id);
    }
    if(next)return 'next'; // A known, unvisited original is visibly mounted: rediscover here.
    if(align&&correction!==null){scrollTo(correction);return 'adjusted';}
    return null;
   };
   eligible.sort((a,b)=>b.at-a.at);
   for(const [i,post] of eligible.entries()){
    const result=await visit(post);if(result)return result;
    if(deferProfile||endHere&&i===eligible.length-1)break;
    guard();let placement=place();
    if(!placement&&(location.pathname.toLowerCase()===owner||await go(false))){
     // Let X restore its own viewport first; the old numeric offset is only a hint.
     placement=place();
     if(!placement){
      scrollTo(viewport);let adjusted=false;
      placement=await T.waitForPage(()=>{guard();const result=place(!adjusted);if(result==='adjusted'){adjusted=true;return false;}return result;},{signal,timeout:7000});
     }
    }
    if(placement==='next'){last='';stable=0;continue discovery;}
    if(placement==='same')continue;
    deferProfile=true;stats.pending++;
    await issue('PROFILE_VIEWPORT_PENDING','返回个人资料后未核对到原浏览位置；未检查的原创帖留待下轮，转查提及',post.id);
    break;
   }
   if(deferProfile)break;
   if(endHere){complete=true;break;}
   await T.sleep(500,signal);guard();
   window.scrollBy(0,Math.max(600,innerHeight*.8));await T.sleep(1200,signal);
  }
  for(const post of [...posts.values()].sort((a,b)=>b.at-a.at)){
   if(deferProfile)break;
   if(!audited.has(post.id)){const result=await visit(post);if(result)return result;}
  }
  await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),stats,postIds:[...posts.keys()]}});
  if(!complete&&!deferProfile){return {complete:false,rest:true,reason:'profile_scan_limit',stats};}
  guard();
  globalThis.XAssistantWorkspace?.progress?.('检查通知提及');
  options.show?.('个人帖队列检查结束，进入提及处理待回复评论');
  await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),phase:'mentions',stats,postIds:[...posts.keys()]}});
  const mentions=await globalThis.XAssistantNotifications.scan({...options,mentionsOnly:true,returnToHome:false});
  for(const key of ['eligible','confirmed'])stats[key]+=mentions.stats?.[key]||0;
  await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),phase:'finished',mentionsReason:mentions.reason,stats,postIds:[...posts.keys()]}});
  if(mentions.sample)return {...mentions,stats};
  if(stats.pending)return {...mentions,complete:false,rest:true,reason:'profile_pending',stats};
  return {...mentions,reason:mentions.complete?'profile_complete':mentions.reason,stats};
 }
 globalThis.XAssistantProfileReplies={scan};
})();
