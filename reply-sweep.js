// 灯神 2 · 回帖调度
// 每一轮做两遍，找到就回：
//  1. 提及页扫到底：别人回我的评论、回我回复的回复、@我的帖子。
//  2. 时间窗口内的每一条本人原帖都完整进一遍：直接评论和楼中楼。
// 不按评论数暂存或跳过，不按“分支最新一条”筛选，不设回复轮数上限；
// 对话该不该结束由模型判断。没回成的评论留在原处，下一轮再来。
// 页面读卡、展开楼层、发送和去重账本沿用已有的 XAssistantNotifications.scan
// 与 XAssistantReplyEngine，这里只决定“去哪里、什么顺序、何时算完”。
(() => {
  const T=globalThis.XAssistantTasks,D=globalThis.XAssistantDOM;
  const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
  const KEY='xAssistantReplySweepV2';
  const DAY=86400000;
  const POLICY=Object.freeze({
    window:7*DAY,          // 本人原帖：最近 7 天发的都进
    revisit:30*60000,      // 安静的原帖也至少每 30 分钟完整进一遍
    pendingRetry:60000,    // 有没处理完的，1 分钟后再来一轮
    profilePages:60,       // 资料页最多往下翻这么多屏
    threadPasses:6,        // 一条原帖里分页加载时，最多连续读几次
    maxPosts:400           // 每个账号最多记这么多条原帖的状态
  });

  const emptyState=()=>({version:2,posts:{},round:0});
  function normalizeState(raw){
    const s=raw&&typeof raw==='object'&&raw.version===2?raw:emptyState();
    const posts={};
    for(const [id,p] of Object.entries(s.posts||{})){
      if(!/^\d{1,20}$/.test(id)||!p||typeof p!=='object'||!Number.isFinite(p.at))continue;
      posts[id]={at:p.at,count:Number.isInteger(p.count)?p.count:null,visitedCount:Number.isInteger(p.visitedCount)?p.visitedCount:null,
        lastVisitAt:Number.isFinite(p.lastVisitAt)?p.lastVisitAt:0,complete:p.complete===true,misses:Math.max(0,Number(p.misses)||0)};
    }
    return {version:2,posts,round:Math.max(0,Number(s.round)||0),
      ...(Number.isFinite(s.lastRoundAt)?{lastRoundAt:s.lastRoundAt}:{}),...(s.last&&typeof s.last==='object'?{last:s.last}:{})};
  }
  // Which originals to enter this round. Pure: exported for tests.
  function dueThreads(state,listed,now=Date.now()){
    const out=[];
    for(const item of listed){
      if(!Number.isFinite(item.at)||item.at<now-POLICY.window||item.at>now)continue;
      const p=state.posts[item.id];
      const count=Number.isInteger(item.count)?item.count:null;
      // A post with zero comments that was fully read is quiet until its count moves or the revisit clock runs out.
      const quietZero=count===0&&p?.complete&&p.visitedCount===0&&now-p.lastVisitAt<POLICY.revisit;
      const settled=p?.complete&&count!==null&&p.visitedCount===count&&now-p.lastVisitAt<POLICY.revisit;
      if(quietZero||settled)continue;
      out.push(item);
    }
    // Newest first: fresh conversations are the ones people are waiting on.
    return out.sort((a,b)=>b.at-a.at);
  }
  function prune(state,now=Date.now()){
    const keep=Object.entries(state.posts).filter(([,p])=>p.at>=now-POLICY.window-DAY).sort((a,b)=>b[1].at-a[1].at).slice(0,POLICY.maxPosts);
    state.posts=Object.fromEntries(keep);
  }

  async function scan(options){
    const {signal,account,runId}=options,owner=account.toLowerCase(),me=owner.slice(1);
    const show=options.show||(()=>{});
    const N=globalThis.XAssistantNotifications,workspace=globalThis.XAssistantWorkspace;
    const primary=()=>document.querySelector('[data-testid="primaryColumn"]');
    const rows=()=>{const c=primary();return c?D.rows(owner).filter(r=>c.contains(r.article)):[];};
    const scrollY=()=>Number(window.scrollY??document.scrollingElement?.scrollTop)||0;
    const scrollTo=top=>window.scrollTo({top:Math.max(0,top),behavior:'instant'});
    const signature=()=>rows().map(r=>r.id).join(',')+'|'+scrollY();
    const profileBound=()=>location.pathname.toLowerCase()===owner&&!!primary()?.querySelector('[data-testid="UserProfileHeader_Items"]');
    const guard=()=>{
      T.check(signal);workspace?.check(signal);
      if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化，回帖已停止');
    };
    const drafts=()=>D.dialogs().length||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim())||
      !!document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length);

    const data=(await local().get(KEY))[KEY]||{};
    const state=normalizeState(data[owner]);
    const save=async()=>{guard();const all=(await local().get(KEY))[KEY]||{};await local().set({[KEY]:{...all,[owner]:state}});};
    const now0=Date.now();
    state.round++;prune(state,now0);
    const stats={eligible:0,confirmed:0,failed:0,aiFailed:0,pending:0,visited:0,posts:0};
    const add=result=>{for(const k of ['eligible','confirmed','failed','aiFailed'])stats[k]+=Number(result?.stats?.[k])||0;};
    const finish=async(reason,extra={})=>{
      const complete=reason==='profile_idle';
      state.lastRoundAt=Date.now();
      state.last={at:state.lastRoundAt,reason,stats:{...stats}};
      await save();
      const wake=complete?Date.now()+10*60000:Date.now()+POLICY.pendingRetry;
      return {reason,complete,rest:!complete,scheduling:'watch',queuePending:!complete,stats,nextWakeAt:wake,...extra};
    };

    // ---- 1. 提及页：回我的、@我的 ----
    guard();
    if(drafts())throw new T.TaskError('RESIDUAL_DRAFT','工作页存在弹窗或草稿，本轮未继续');
    show('检查提及页：回我的评论和 @我的帖子');
    const mentions=await N.scan({account,runId,signal,show,mentionsOnly:true,returnToHome:false,until:Date.now()});
    if(mentions?.reason==='page_changed')return {reason:'page_changed'};
    if(mentions?.sample)return {...mentions,sample:true};
    add(mentions);
    const mentionsDone=mentions?.complete===true;
    if(!mentionsDone)stats.pending++;

    // ---- 2. 本人主页：列出窗口内的原帖 ----
    guard();
    const enterProfile=async()=>{
      if(profileBound())return true;
      if(drafts())throw new T.TaskError('RESIDUAL_DRAFT','工作页存在弹窗或草稿，本轮未继续');
      const link=await T.waitForPage(()=>{guard();const a=document.querySelector('[data-testid="AppTabBar_Profile_Link"]');return a?.getAttribute('href')?.toLowerCase()===owner?a:null;},{signal,timeout:7000});
      if(!link)throw new T.TaskError('PROFILE_NAV_LINK','未找到当前账号原生个人资料链接：'+owner);
      workspace?.expectNavigation(link.getAttribute('href'));link.click();
      return !!await T.waitForPage(()=>{guard();return profileBound()&&(rows().length>0||!!primary()?.querySelector('[data-testid="emptyState"]'));},{signal,timeout:15000});
    };
    if(!await enterProfile())return finish('PAGE_NOT_READY');
    show('列出最近 7 天的本人原帖');
    scrollTo(0);await T.sleep(400,signal);
    const listed=new Map();
    const cutoff=Date.now()-POLICY.window;
    let older=0,idle=0;
    for(let page=0;page<POLICY.profilePages&&idle<4;page++){
      guard();if(!profileBound())return finish('PAGE_NOT_READY');
      let added=false;
      for(const r of rows()){
        if(r.author.toLowerCase()!==me||!D.originalPost(r.id,owner)||!Number.isFinite(r.at))continue;
        if(r.at<cutoff){
          // A pinned post can be old. Two old originals in a row means we are past the window.
          if(!listed.has('old:'+r.id)){listed.set('old:'+r.id,null);older++;}
          continue;
        }
        const box=r.article.getBoundingClientRect?.(),y=scrollY()+(box?.top||0);
        const count=Number.isInteger(r.replyCount)?r.replyCount:null;
        const known=listed.get(r.id);
        if(!known){listed.set(r.id,{id:r.id,at:r.at,count,y});added=true;}
        else if(count!==null)known.count=count;
      }
      if(older>=2)break;
      idle=added?0:idle+1;
      const before=signature();
      window.scrollBy(0,Math.max(600,innerHeight*.85));
      await T.waitForPage(()=>{guard();return signature()!==before;},{signal,timeout:2500});
      await T.sleep(250,signal);
    }
    const originals=[...listed.values()].filter(Boolean);
    stats.posts=originals.length;
    for(const o of originals){
      const p=state.posts[o.id]||(state.posts[o.id]={at:o.at,count:null,visitedCount:null,lastVisitAt:0,complete:false,misses:0});
      p.at=o.at;p.count=o.count;
    }
    await save();

    // ---- 3. 逐条进原帖，回直接评论和楼中楼 ----
    const due=dueThreads(state,originals,Date.now());
    const locate=async item=>{
      const find=()=>rows().find(r=>r.id===item.id&&r.author.toLowerCase()===me&&D.originalPost(r.id,owner)&&r.article.isConnected);
      if(find())return find();
      scrollTo(item.y-innerHeight*.3);
      let live=await T.waitForPage(()=>{guard();return find()||null;},{signal,timeout:3000});
      if(live)return live;
      // Virtualised profile: sweep from the top until the card mounts.
      scrollTo(0);await T.sleep(400,signal);
      for(let page=0;page<POLICY.profilePages;page++){
        guard();live=find();if(live)return live;
        const before=signature();window.scrollBy(0,Math.max(600,innerHeight*.85));
        await T.waitForPage(()=>{guard();return signature()!==before;},{signal,timeout:2500});
        if(rows().some(r=>r.author.toLowerCase()===me&&Number.isFinite(r.at)&&r.at<item.at-DAY))break;
      }
      return find()||null;
    };
    for(const [index,item] of due.entries()){
      guard();
      const p=state.posts[item.id];
      show(`进入原帖 ${index+1}/${due.length}，回复全部评论`);
      if(!await enterProfile())return finish('PAGE_NOT_READY');
      const live=await locate(item);
      if(!live){p.complete=false;p.misses++;stats.pending++;await save();continue;}
      let trip;
      try{trip=await workspace.openOwnOriginal(live,{signal});}
      catch(error){
        if(['TARGET_UPDATED','TARGET_MISMATCH','TARGET_NOT_READY'].includes(error.code)&&!error.submitted){p.complete=false;p.misses++;stats.pending++;await save();continue;}
        throw error;
      }
      stats.visited++;
      let result=null,complete=false;
      try{
        for(let pass=0;pass<POLICY.threadPasses;pass++){
          result=await N.scan({account,runId,signal,show,threadPath:owner+'/status/'+item.id,rootId:item.id,retryOriginal:true,readToBottom:true,returnToHome:false,until:Date.now()});
          if(result?.reason==='page_changed')return {reason:'page_changed'};
          if(result?.sample)return {...result,sample:true};
          add(result);
          if(!result?.evidence?.retainView)break; // X is still paging this thread in: read again on the same page
        }
        complete=result?.complete===true&&!result?.stats?.failed&&!result?.stats?.aiFailed;
      }finally{
        if(trip)await trip.returnToSource();
      }
      p.lastVisitAt=Date.now();p.complete=complete;p.misses=0;
      const finalCount=Number.isInteger(result?.finalCommentCount)?result.finalCommentCount:item.count;
      p.visitedCount=complete&&Number.isInteger(finalCount)?finalCount:null;
      if(!complete)stats.pending++;
      await save();
    }
    stats.pending+=Object.entries(state.posts).filter(([id,p])=>!p.complete&&listed.has(id)&&!due.some(d=>d.id===id)).length;
    return finish(stats.pending?'profile_pending':'profile_idle');
  }
  globalThis.XAssistantReplySweep={scan,dueThreads,normalizeState,POLICY,KEY};
})();
