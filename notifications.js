// A fresh session per work window: no persisted "seen" flags can strand unsent replies.
(() => {
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
  const api=globalThis.XAssistantRuntime, T=globalThis.XAssistantTasks;
  const D=globalThis.XAssistantDOM, P=globalThis.XAssistantNotificationPolicy;
  const waitPage=(probe,{signal,deadline,timeout})=>(T.waitForPage||T.waitFor)(probe,{signal,deadline,timeout});
  const KEY='xAssistantNotificationRepliesV1';
  let activeScan=null;
  const read=async()=>(await local().get(KEY))[KEY]||{};

  async function scanWindow(options) {
    const {account,runId,signal}=options, owner=account.toLowerCase();
    const workPath=options.threadPath||'/notifications/mentions';
    const anchor=options.branchAnchor,viewId=anchor?.id||options.rootId;
    const flow=options.traversalSession||{};
    const primary=()=>document.querySelector('[data-testid="primaryColumn"]');
    const stale=new Set();
    const primaryRows=(column=primary())=>column?D.rows(owner).filter(r=>{
      if(!column.contains(r.article))return false;
      if(!stale.has(r.article))return true;
      // X reuses the same article nodes when it switches into the Mentions tab.
      // Once the selected native tab is verified as Mentions, a reused node is a
      // current mention, not leftover content from the previous page.
      if(!options.threadPath&&mentionsBound())return true;
      const region=r.article.closest?.('[role="region"][aria-label]')?.getAttribute('aria-label')||'';
      return (options.threadPath?/conversation|thread|对话|對話|会話|スレッド/i:/mention|提及|提到|メンション/i).test(region);
    }):[];
    const scanRows=()=>primaryRows().filter(r=>!options.rootId||D.inThread(r.id,options.rootId)&&(!anchor||D.inBranch?.(r.id,viewId,options.rootId)));
    const unboundReplies=()=>options.rootId?primaryRows().filter(r=>
      r.id!==options.rootId&&r.isComment&&r.addressed&&!D.inThread(r.id,options.rootId)):[];
    const unresolved=new Set();
    const trackUnbound=()=>{
      for(const row of unboundReplies())unresolved.add(row.id);
      for(const id of unresolved)if(D.inThread(id,options.rootId))unresolved.delete(id);
      return unresolved.size;
    };
    const rootRow=()=>{
      if(anchor){
        const normalize=D.normalize||((text)=>String(text||'').trim());
        const matches=primaryRows().filter(r=>r.id===viewId&&r.author.toLowerCase()===anchor.author.toLowerCase()&&r.time===anchor.time&&
          (normalize(r.text)===normalize(anchor.text)||anchor.clipped&&normalize(r.text).startsWith(normalize(anchor.text))));
        return matches.length===1&&matches[0].article.isConnected&&D.inThread(viewId,options.rootId)?matches[0]:null;
      }
      const matches=primaryRows().filter(r=>r.id===options.rootId&&r.author.toLowerCase()===owner.slice(1));
      if(!options.retryOriginal)return matches[0];
      return matches.length===1&&matches[0].article.isConnected&&D.originalPost(options.rootId,owner)?matches[0]:null;
    };
    const timelineBusy=()=>[...(primary()?.querySelectorAll('[role="progressbar"]')||[])].some(n=>
      !n.closest('[data-testid="inline_reply_offscreen"],form,article,[contenteditable="true"],[role="dialog"]'));
    // Expand native spam folds like other reply branches; the label is never a reply target.
    const spamFold=/^(显示可能的垃圾信息|顯示可能的垃圾訊息|show probable spam)$/i;
    const hasFoldControl=()=>[...(primary()?.querySelectorAll('button,[role="button"]')||[])].some(b=>
      b.isConnected&&b.getClientRects().length&&!b.closest('article,form,[role="dialog"],[hidden],[inert],[aria-hidden="true"]')&&
      spamFold.test((b.innerText||'').trim()));
    const mentionsBound=()=>{
      const c=primary();if(!c)return false;
      const tab=c.querySelector('a[role="tab"][aria-selected="true"]');
      if(tab)return tab.getAttribute('href')?.split(/[?#]/)[0].replace(/\/$/,'')==='/notifications/mentions';
      return [...c.querySelectorAll('[role="region"][aria-label]')].some(n=>/mention|提及|提到|メンション/i.test(n.getAttribute('aria-label')||''));
    };
    const empty=()=>!!primary()?.querySelector('[data-testid="emptyState"]');
    const one=globalThis.XAssistantWorkspace?.state?.()?.assignment?.singleRound===true;
    const directSeen=new Set(),seenHere=new Set(),branchIds=new Set();
    let rootCount=null;
    let expanding=null;const expanded=new WeakSet(),unresolvedFolds=new Set();
    const atBottom=()=>{const el=document.scrollingElement||document.documentElement;return !!el&&Number.isFinite(el.scrollHeight)&&Number.isFinite(window.scrollY)&&window.scrollY+innerHeight>=el.scrollHeight-8;};
    const expansion=(includeAttempted=false)=>[...(primary()?.querySelectorAll('button,[role="button"]')||[])].find(b=>
      b.isConnected&&b.getClientRects().length&&!b.disabled&&b.getAttribute?.('aria-disabled')!=='true'&&(includeAttempted||!expanded.has(b))&&
      !b.closest('article,form,[role="dialog"],[hidden],[inert],[aria-hidden="true"]')&&(/^(显示回复|显示更多回复|显示更多回应|Show replies|Show more replies)$/i.test((b.innerText||'').trim())||spamFold.test((b.innerText||'').trim())));
    const deadline=options.yieldAt??Infinity, startedAt=Date.now(), until=Number.isFinite(options.until)?options.until:startedAt;
    const show=options.show||(()=>{}), attempted=flow.attempted??=new Set(), observed=flow.observed??=new Set(), probed=flow.probed??=new Set();
    const visitedBranches=flow.visitedBranches??=new Set(),pendingBranches=flow.pendingBranches??=new Set();
    const stats=flow.stats??={seen:0,eligible:0,confirmed:0,libraryFallback:0,aiSkipped:0,aiFailed:0,failed:0,excluded:{}};
    const all=flow.db?{}:await read();
    const db=flow.db??={records:{},cycles:0,...all[owner]};
    db.records=db.records||{};
    const view=options.rootId?((db.threads??={})[options.rootId]??={views:{}}).views:null;
    const previous=view?.[viewId],cursor=previous?.path===workPath&&previous.rootId===options.rootId?previous:null;
    const retries={...cursor?.retries};
    for(const id of cursor?.unboundIds||[])unresolved.add(id);
    let boundView=false,cursorAdvanced=false,lastTopCheckAt=cursor?.lastTopCheckAt||Date.now(),frontierId=cursor?.anchor?.id;
    let resumeAfterDetour=null,seeking=null,seekPosition=null,seekAdvanced=false,retainView=false,topPass=false,topChecked=false,seekPending=false,replacementFrontier=null;
    // Migration: these legacy fields encoded "attempted before generating" across windows.
    delete db.batchSeen;delete db.batchUntil;
    db.since=until-P.DAY;
    const processed=flow.processed??=(await local().get('xAssistantProcessedV1')).xAssistantProcessedV1?.posts||{};
    // Account-local safety snapshot. The authoritative atomic claim is checked
    // again by the send transaction; this avoids even generating a repeat.
    const shared=flow.claims??=(await local().get('xAssistantReplyClaimsV1')).xAssistantReplyClaimsV1?.[owner]||{};
    const quarantined=id=>P.uncertain(db.records[id],processed[id])||['unknown','in_flight'].includes(shared[id]?.status);
    const reasonFor=row=>(quarantined(row.id)?'unknown_send':options.rootId&&retries[row.id]?.nextAt>Date.now()?'retry_later':P.reason(row,{account:owner,now:options.threadPath?Date.now():until,until:options.threadPath?Date.now():until,record:db.records[row.id],prior:processed[row.id],attempted}))||
      (D.hasOwnReply?.(row.id,owner)?'already_replied':null)||(D.replyVideoOnly?.(row)?'video_post':null);
    const hasBranch=row=>row.replyCount>0||!!view?.[row.id]&&(view[row.id].pending||!Number.isInteger(row.replyCount)||row.replyCount!==view[row.id].observedBranchCount)||
      !Number.isInteger(row.replyCount)&&!!D.loadedBranchIds?.(row.id,options.rootId)?.length;
    const observe=row=>{
      seenHere.add(row.id);
      if(options.threadPath){if(D.directChildOf(row.id,viewId))directSeen.add(row.id);if(hasBranch(row))branchIds.add(row.id);}
      if(!observed.has(row.id)){
        observed.add(row.id);stats.seen++;const reason=reasonFor(row);
        if(reason)stats.excluded[reason]=(stats.excluded[reason]||0)+1;
      }
    };
    const unreadBranch=row=>{
      if(!hasBranch(row)||visitedBranches.has(row.id))return false;
      const cached=view?.[row.id];
      if(cached?.pending===false&&cached.rootId===options.rootId&&Number.isInteger(row.replyCount)&&
        Number.isInteger(cached.observedBranchCount)&&row.replyCount===cached.observedBranchCount)return false;
      const descendants=D.loadedBranchIds?.(row.id,options.rootId);
      return !(descendants?.length&&descendants.filter(id=>D.directChildOf(id,row.id)).length>=row.replyCount&&descendants.every(id=>observed.has(id)));
    };
    const probeCandidate=()=>globalThis.XAssistantWorkspace?.openStatusTarget&&unboundReplies().find(r=>{
      if(probed.has(r.id)||r.author.toLowerCase()===owner.slice(1)||r.article.isConnected===false||r.article.closest?.('[hidden],[inert],[aria-hidden="true"]'))return false;
      const box=r.article.getBoundingClientRect?.();return box?.height>0&&box.bottom>0&&box.top<innerHeight;
    });
    const save=async()=>{
      const latest=await read();latest[owner]=db;await local().set({[KEY]:latest});
    };
    const patch=value=>api.runtime('notifications','patch',{runId,patch:value});
    const issue=(code,message,row)=>({code,message,targetId:row.id});
    const progress=(step,options)=>globalThis.XAssistantWorkspace?.progress?.(step,options);
    const guard=()=>{
      T.check(signal,deadline);
      globalThis.XAssistantWorkspace?.check(signal);
      if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化，停止通知回复');
    };
    const guardPage=()=>{
      guard();
      if(location.pathname.toLowerCase()===workPath.toLowerCase())return;
      // A navigation is a batch boundary, not permission to reply on another page.
      // Do not hand off to a driver that might dismiss a newly opened user draft.
      if(D.dialogs().length)throw Object.assign(new T.TaskError('CLEANUP_FAILED','页面已切换且存在弹窗，请先处理'),{preserveDrafts:true});
      if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw Object.assign(new T.TaskError('RESIDUAL_DRAFT','页面已切换且存在未发送草稿，请先处理'),{preserveDrafts:true});
      throw new T.TaskError('PAGE_CHANGED','通知页面已变化');
    };
    const returnedUnsent=error=>{
      if(!options.rootId||error.code!=='TARGET_SKIPPED_UNSENT'||error.returnedToSource!==true||
        error.submitted!==false||error.confirmed!==false||error.stopTargetVisit||error.preserveDrafts||
        error.cause?.preserveDrafts||error.cause?.cause?.preserveDrafts)return false;
      guardPage();return true;
    };
    // Carry the send deadline across originals and full document navigation,
    // without holding an exhausted thread open just to consume its cooldown.
    flow.nextReplyAt=Math.max(flow.nextReplyAt||0,db.nextReplyAt||0);
    const waitReplyGap=async()=>{
      while(Date.now()<flow.nextReplyAt){
        guardPage();report('下一条 · '+((flow.nextReplyAt-Date.now())/1000).toFixed(1)+' 秒');
        await T.sleep(Math.min(document.hidden?15000:200,flow.nextReplyAt-Date.now()),signal,deadline);
      }
      guardPage();
    };
    // Scoped to read-only observation of this exact original. Always release before
    // any candidate generation, action permit, click, editor or receipt handling.
    const readDetail=async work=>{
      guardPage();
      const release=D.beginDetailRead({id:viewId,path:workPath,runId,signal});
      try{return await work();}finally{release();}
    };
    // A pixel is only a positioning hint. Resume requires the same native
    // comment identity in the verified view; never persist DOM nodes or "seen".
    const normalize=D.normalize||((text)=>String(text||'').trim());
    const visible=row=>{const box=row.article?.getBoundingClientRect?.();return row.article?.isConnected&&box?.height>0&&box.bottom>0&&box.top<innerHeight;};
    const snapshot=row=>{
      const native=D.threadIdentity?.(row.id);
      return native?.id===row.id&&native.root===options.rootId&&native.author===row.author.toLowerCase()?
        {id:row.id,author:native.author,parent:native.parent||null,time:row.time,text:row.text,clipped:!!row.clipped,imageUrls:row.imageUrls||[]}:null;
    };
    const nativeView=()=>{
      const native=D.threadIdentity?.(viewId);
      return native?.root===options.rootId&&D.originalPost?.(options.rootId,owner)&&
        workPath.toLowerCase()==='/'+native.author+'/status/'+viewId;
    };
    const matchCursor=saved=>{
      if(!saved?.anchor||!nativeView())return null;
      const a=saved.anchor,matches=scanRows().filter(r=>{
        const n=D.threadIdentity?.(r.id);
        return visible(r)&&r.id===a.id&&r.author.toLowerCase()===a.author&&r.time===a.time&&n?.root===options.rootId&&n.author===a.author&&n.parent===a.parent&&
          (normalize(r.text)===normalize(a.text)||a.clipped&&normalize(r.text).startsWith(normalize(a.text)))&&
          JSON.stringify(r.imageUrls||[])===JSON.stringify(a.imageUrls||[]);
      });
      return matches.length===1?matches[0]:null;
    };
    const position=row=>{const value=snapshot(row);return value?{anchor:value,scrollY:window.scrollY}:null;};
    const restoreCursor=async saved=>{
      if(!saved?.anchor||!nativeView())return false;
      if(matchCursor(saved))return true;
      if(!Number.isFinite(saved.scrollY)||saved.scrollY<0)return false;
      return !!await readDetail(async()=>{
        window.scrollTo({top:saved.scrollY,behavior:'instant'});
        return waitPage(()=>{guardPage();return matchCursor(saved);},{signal,deadline,timeout:1500});
      });
    };
    const seekCursor=async saved=>{
      if(await restoreCursor(saved))return true;
      if(!nativeView())return false;
      seeking={anchor:saved.anchor,scrollY:saved.scrollY};boundView=true;seekPending=true;
      const prior=cursor?.seek?.target?.anchor?.id===saved.anchor.id?cursor.seek.position:null;
      if(prior&&!matchCursor(prior))await restoreCursor(prior);
      // Reopening a detail may discard its pagination cache. Keep the old
      // frontier and load native pages, never relabel a shallower pixel as it.
      let stalled=false;
      for(let page=0;page<6;page++){
        guardPage();if(matchCursor(saved)){seeking=null;seekPending=false;return true;}
        const before=new Set(scanRows().filter(visible).map(r=>r.id)),more=expansion();
        const fresh=await readDetail(async()=>{
          if(more){expanded.add(more);more.click();}else window.scrollBy(0,Math.max(600,innerHeight*.8));
          await waitPage(()=>{guardPage();return scanRows().some(r=>visible(r)&&!before.has(r.id));},{signal,deadline,timeout:1500});
          return scanRows().filter(r=>visible(r)&&!before.has(r.id)&&snapshot(r));
        });
        trackUnbound();
        for(const row of fresh)if(!reasonFor(row)){
          const queued=position(row);if(queued)retries[row.id]={...queued,nextAt:Date.now()};
        }
        if(matchCursor(saved)){seeking=null;seekPending=false;return true;}
        if(!fresh.length){stalled=true;break;}
        seekAdvanced=true;seekPosition=position(fresh.at(-1));
      }
      retainView=seekAdvanced&&!stalled;
      if(stalled&&atBottom()&&!timelineBusy()&&!expansion(true)){
        const edge=scanRows().filter(visible).at(-1);
        replacementFrontier=edge&&position(edge);
        if(replacementFrontier){
          const retry=retries[saved.anchor.id];
          if(retry&&retry.anchor.text===saved.anchor.text)retry.nextAt=Date.now()+1800000;
          seeking=null;lastTopCheckAt=Date.now();
        }
      }
      return false;
    };
    const settled=id=>P.confirmed(db.records[id],processed[id])||quarantined(id)||D.hasOwnReply?.(id,owner)||
      db.records[id]?.status==='skipped_issue'&&db.records[id].reasonCode!=='RESIDUAL_DRAFT'||
      [owner.slice(1),'grok'].includes(D.threadIdentity?.(id)?.author);
    const remainingBranches=()=>[...new Set([...(cursor?.pendingBranches||[]),...branchIds,
      ...[...pendingBranches].filter(id=>!anchor||D.inBranch?.(id,viewId,options.rootId))])]
      .filter(id=>!visitedBranches.has(id)||pendingBranches.has(id));
    const checkpoint=complete=>{
      if(!view)return {cursorAdvanced:false,resumePending:false};
      for(const id of Object.keys(retries))if(settled(id))delete retries[id];
      if(boundView&&location.pathname.toLowerCase()===workPath.toLowerCase()){
        const row=scanRows().filter(visible).at(-1),live=row&&position(row);
        const next=replacementFrontier||(seeking?cursor:resumeAfterDetour||live||cursor);
        const actualCount=rootRow()?.replyCount;
        if(next?.anchor)view[viewId]={...next,path:workPath,rootId:options.rootId,pending:!complete||!Number.isInteger(actualCount),
          lastTopCheckAt,at:Date.now(),retries,pendingBranches:remainingBranches(),
          unboundIds:[...unresolved],
          observedBranchCount:complete&&anchor&&Number.isInteger(actualCount)?actualCount:null,
          seek:seeking?{target:seeking,position:seekPosition||cursor?.seek?.position||null}:null};
      }
      return {cursorAdvanced:!seekPending&&cursorAdvanced,resumePending:!!view[viewId]?.pending||!complete&&!!(Object.keys(retries).length||remainingBranches().length),
        retainView,seekAdvanced,topChecked};
    };
    const record=async(row,status,extra={})=>{
      db.records[row.id]={...db.records[row.id],status,at:Date.now(),commentAt:row.at,author:row.author,...extra};
      await save();
    };
    const report=message=>show(`${message} · 已回复 ${stats.confirmed}，失败 ${stats.failed+stats.aiFailed}`);
    const navigate=async(path,allowExpired=false)=>{
      const timeLimit=allowExpired?Infinity:deadline;
      if(D.dialogs().length)throw new T.TaskError('CLEANUP_FAILED','仍有未处理的回复弹窗');
      if(location.pathname===path)return;
      if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw new T.TaskError('RESIDUAL_DRAFT','页面存在未发送的内联草稿，请先处理');
      if(!['/home','/notifications','/notifications/mentions',owner,workPath].includes(path))throw new T.TaskError('NAVIGATION','不支持的通知导航路径');
      const before=location.pathname;
      // The sidebar can point straight at the last selected notifications
      // tab. Never take that shortcut from a post body, recommendation or URL guess.
      const directMentions=()=>path==='/notifications'&&!options.threadPath&&
        document.querySelector('a[data-testid="AppTabBar_Notifications_Link"][href="/notifications/mentions"]');
      const findLink=()=>{
        if(path===options.threadPath){
          const candidate=primaryRows().find(r=>r.id===options.rootId&&r.author.toLowerCase()===owner.slice(1));
          const stamp=candidate&&D.statusStamp(candidate.article);
          if(!stamp?.link||stamp.id!==options.rootId||stamp.author.toLowerCase()!==owner.slice(1))return null;
          try{const u=new URL(stamp.link.getAttribute('href'),'https://x.com');return u.href.toLowerCase()==='https://x.com'+path.toLowerCase()?stamp.link:null;}catch{return null;}
        }
        const direct=directMentions();
        if(direct&&direct.getAttribute?.('href')==='/notifications/mentions'&&direct.getAttribute('aria-disabled')!=='true'&&
          direct.isConnected!==false&&direct.getClientRects?.().length>0&&(!direct.target||direct.target==='_self')&&
          !direct.closest?.('article,[role="dialog"],[hidden],[inert],[aria-hidden="true"]'))return direct;
        return [...document.querySelectorAll('a[href]')].find(a=>{
          try{const url=new URL(a.getAttribute('href'),'https://x.com');return url.origin==='https://x.com'&&url.pathname.replace(/\/$/,'')===path;}catch{return false;}
        });
      };
      const link=path===options.threadPath?findLink():await waitPage(findLink,{signal,deadline:timeLimit,timeout:3500});
      if(!link)throw new T.TaskError('NAV_LINK_UNAVAILABLE','未找到 X 页面原生链接：'+path+'（来源：'+before+'）');
      const chosen=new URL(link.getAttribute('href'),'https://x.com'),dest=chosen.pathname.replace(/\/$/,'');
      if(dest!==path&&!(path==='/notifications'&&link===directMentions()&&dest==='/notifications/mentions'))throw new T.TaskError('NAV_LINK_UNAVAILABLE','通知入口与请求页不一致');
      await T.sleep(500,signal,timeLimit);
      T.check(signal,timeLimit);if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化');
      globalThis.XAssistantWorkspace?.check(signal);
      if(location.pathname!==before)throw new T.TaskError('PAGE_CHANGED','选择导航时页面已切换');
      if(D.dialogs().length)throw new T.TaskError('CLEANUP_FAILED','导航前出现弹窗，保留原页');
      if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw new T.TaskError('RESIDUAL_DRAFT','页面存在未发送的内联草稿，请先处理');
      if(link.isConnected===false||link!==findLink()||new URL(link.getAttribute('href'),'https://x.com').href!==chosen.href)throw new T.TaskError('NAV_LINK_UNAVAILABLE','X 页面原生链接已更换：'+path);
      progress('进入'+path);
      for(const row of primaryRows())stale.add(row.article);
      globalThis.XAssistantWorkspace?.expectNavigation(chosen.pathname+chosen.search);
      link.click();
      if(!await waitPage(()=>location.pathname.replace(/\/$/,'').toLowerCase()===dest.toLowerCase(),{signal,deadline:timeLimit,timeout:12000}))throw new T.TaskError('NAVIGATION','X 页面未切换到 '+path);
    };
    const finish=async(reason,complete=false,evidence=null)=>{
      if(options.rootId)evidence={...evidence,...checkpoint(complete)};
      db.lastChecked=Date.now();db.nextAt=0;db.cycles++;
      db.lastScan={startedAt,finishedAt:Date.now(),reason,stats,...(evidence?{evidence}:{}),page:location.pathname+(location.search||'')};
      await save();
      report(reason==='THREAD_COMMENTS_FOLDED'?'X 有折叠回复，未展开；保留待补查':reason==='THREAD_COMMENTS_PENDING'?'评论未全部核对，保留待补查':reason==='yield'?'本轮时间已到，未完成评论留待下轮':['exhausted','visible_exhausted'].includes(reason)?'当前可见评论已扫描，下轮继续补查':reason==='scan_limit'?'本轮扫描已达上限，稍后继续':'本轮暂歇：'+reason);
      // Keep the displayed total as a change hint, not proof of complete coverage.
      const actualCount=boundView&&location.pathname.toLowerCase()===workPath.toLowerCase()?rootRow()?.replyCount:null;
      const finalCommentCount=Number.isInteger(actualCount)?actualCount:null;
      return {complete,rest:!complete&&reason!=='yield',reason,stats,finalCommentCount,...(evidence?{evidence}:{})};
    };
    const pending=async(code,detail)=>{
      const target=options.rootId||'/notifications/mentions';
      let evidence=null;
      const coverage=['THREAD_COMMENTS_PENDING','THREAD_COMMENTS_FOLDED'].includes(code);
      if(options.rootId&&(coverage||code==='THREAD_ROOT_NOT_READY')){
        const main=primary(),thread=scanRows();
        evidence={rootId:options.rootId,primaryArticles:[...(main?.querySelectorAll('article[data-testid="tweet"]')||[])].filter(a=>!a.closest?.('[role="dialog"]')).length,
          ...(anchor?{branchId:viewId}:{}),threadRows:new Set(thread.map(r=>r.id)).size,seenDirect:directSeen.size,metadataDirect:D.loadedDirectChildren(viewId),
          unboundReplyCards:trackUnbound(),expectedDirect:null,displayedReplies:rootCount};
      }
      const message=target+'：'+detail+(evidence?'（主栏卡 '+evidence.primaryArticles+'，已核对同串评论卡 '+evidence.threadRows+'，已加载直接子评论元数据 '+evidence.metadataDirect+'，待绑定评论卡 '+evidence.unboundReplyCards+'）':'')+'；未记为完成';
      // Keep a real item error (especially an unknown send) visible.
      if(!coverage||!(stats.failed||stats.aiFailed))await patch({lastIssue:{code,message,targetId:target}});
      const result=await finish(code,false,evidence);return {...result,detail:message};
    };
    const sample=async(reason)=>({...await finish(reason),sample:true});
    const drainHeldBranch=async branch=>{
      const nested={...options,threadPath:new URL(branch.url).pathname,branchAnchor:branch,
        retryOriginal:true,expectedCommentCount:branch.replyCount,traversalSession:flow};
      for(;;){
        const result=await scanWindow(nested);
        if(result.reason==='page_changed')throw new T.TaskError('PAGE_CHANGED','遍历分支时页面已变化');
        if(result.reason==='trial_sample_unknown')throw Object.assign(new T.TaskError('SEND_UNKNOWN','分支发送结果未知，保留当前页面'),{submitted:true,preserveDrafts:true});
        if(!result.evidence?.retainView)return result;
        if(result.evidence.topChecked)nested.recheckTop=false;
        guard();if(location.pathname.toLowerCase()!==nested.threadPath.toLowerCase())throw new T.TaskError('PAGE_CHANGED','分支阅读位置已变化');
        progress('保留评论分支 · 等待下一批原生分页',{until:Date.now()+30000});
        await T.sleep(30000,signal,deadline);
      }
    };
    guard();await save();
    let currentTarget=null;
    try {
      guard();
      await patch({phase:'notification_scan',nextAt:Number.isFinite(deadline)?deadline:null});
      show('优先检查我的帖子评论 · 逐条回复 · 已成功回复自动略过');
      if(options.threadPath){if(options.retryOriginal)guardPage();else await navigate(workPath);}
      else if(location.pathname!=='/notifications/mentions'){
        if(!(location.pathname.startsWith('/notifications')||location.pathname===workPath))await navigate('/notifications');
        await navigate('/notifications/mentions');
      }
      await T.sleep(500,signal,deadline);guard();
      if(options.threadPath){
        const resume=cursor?.pending&&cursor.anchor?cursor:null;
        const topDue=!!resume&&(options.recheckTop||Date.now()-lastTopCheckAt>=1800000);
        const retry=resume&&!topDue&&Object.values(retries).find(r=>r.nextAt<=Date.now());
        let restored=false;
        if(resume&&!topDue){
          const target=cursor.seek?.target||retry||resume;
          if(target.anchor.id!==resume.anchor.id)resumeAfterDetour=resume;
          restored=await seekCursor(target);
          if(seekPending)return await pending('THREAD_COMMENTS_PENDING','正在原生列表定位旧阅读位置，未把浅层页面记为进展');
        }
        if(!restored){
          window.scrollTo({top:0,behavior:'instant'});lastTopCheckAt=Date.now();
          if(topDue)resumeAfterDetour=resume;
          topPass=true;
        }
        await T.sleep(500,signal,deadline);
        progress((anchor?'等待评论分支 ':'等待原创详情 ')+viewId);
        const root=restored?rootRow()||{replyCount:null}:await readDetail(()=>waitPage(()=>{guardPage();return rootRow();},{signal,deadline,timeout:15500}));
        if(!root)return await pending('THREAD_ROOT_NOT_READY','等待 15 秒仍未核对主栏原创帖 ID 与作者');
        boundView=true;
        frontierId=scanRows().filter(visible).at(-1)?.id||frontierId;
        rootCount=Number.isInteger(root.replyCount)?root.replyCount:null;
      }else{
        window.scrollTo({top:0,behavior:'instant'});await T.sleep(500,signal,deadline);
        progress('等待提及时间线');
        const ready=await waitPage(()=>{guardPage();return mentionsBound()&&(scanRows().length||empty());},{signal,deadline,timeout:16500});
        if(!ready)return await pending('MENTIONS_NOT_READY','等待 16 秒仍未核对到提及列表或明确的空状态');
      }
      // Traverse the whole list for direct comments first, then return to the
      // top for remaining addressed replies.
      let directOnly=!options.mentionsOnly&&!options.threadPath,stable=0,last='';
      // An own thread can have more than 100 screens. Capping every pass and
      // restarting at its top strands all later comments forever. Keep reading
      // while fresh work arrives; one empty read yields to the next original.
      for(let screen=0;options.threadPath||screen<100;screen++){
        guardPage();
        // Refresh nodes after every attempt. X can replace articles after opening a composer.
        for(;;){
          guardPage();
          trackUnbound();
          const rows=P.priorityFirst(scanRows());
          if(!options.threadPath&&!mentionsBound())return await pending('MENTIONS_NOT_READY','提及页选中状态已变化');
          if(options.threadPath)for(const r of rows){
            if(D.directChildOf(r.id,viewId))directSeen.add(r.id);
            if(hasBranch(r))branchIds.add(r.id);
          }
          let target=null;
          for(const row of rows){
            observe(row);const reason=reasonFor(row);
            if(!reason&&(!directOnly||row.directComment)){target=row;break;}
          }
          if(!target){
            // Addressed cards can arrive before their conversation metadata.
            // Read the exact native detail once to collect proof; never send
            // from this probe or infer membership from "Replying to me".
            const unbound=probeCandidate();
            if(unbound){
              probed.add(unbound.id);progress('只读核对评论归属 '+unbound.id);
              try{
                guardPage();
                const trip=await globalThis.XAssistantWorkspace.openStatusTarget(unbound,{signal,deadline,requireAddressed:true,readOnly:true,threadRootId:options.rootId});
                await waitPage(()=>{guard();return D.inThread(unbound.id,options.rootId);},{signal,deadline,timeout:5000});
                await trip.returnToSource();guardPage();
              }catch(error){
                if(!returnedUnsent(error)){error.stopTargetVisit=true;throw error;}
              }
              continue;
            }
            // A branch whose native children are already fully read needs no
            // second permalink visit. Its own child branches remain queued.
            if(options.threadPath)for(const row of rows){
              if(!branchIds.has(row.id)||visitedBranches.has(row.id))continue;
              if(!unreadBranch(row))visitedBranches.add(row.id);
            }
            const branch=options.threadPath&&rows.find(r=>branchIds.has(r.id)&&!visitedBranches.has(r.id));
            if(branch&&globalThis.XAssistantWorkspace?.openStatusTarget&&D.inBranch){
              visitedBranches.add(branch.id);progress('遍历评论分支 '+branch.id);
              try{
                guardPage();
                const trip=await globalThis.XAssistantWorkspace.openStatusTarget(branch,{signal,deadline,requireAddressed:false,readOnly:true,threadRootId:options.rootId});
                const result=await drainHeldBranch(branch);
                if(!result.complete)pendingBranches.add(branch.id);
                await trip.returnToSource();guardPage();
                if(result.sample)return result;
              }catch(error){
                if(!returnedUnsent(error)){error.stopTargetVisit=true;throw error;}
                pendingBranches.add(branch.id);
              }
              continue;
            }
            // Cooldown gates the next send, not leaving an exhausted thread.
            if(!options.threadPath)await waitReplyGap();break;
          }
          const photoTarget=D.replyHasImages?.(target)||target.imageUrls?.length||target.rootPost?.imageUrls?.length;
          const retryPosition=options.rootId&&position(target);
          if(!photoTarget)await waitReplyGap();
          stats.eligible++;currentTarget=target;progress('处理回复 '+target.id);
          report('阿妍正在读取原帖和对话 @'+target.author);
          let generated,trip;
          try {
              const result=await globalThis.XAssistantReplyEngine.send({
                row:target,account:owner,signal,deadline,requireAddressed:false,detailInline:true,patch,module:'notifications',runId,
                prepareTarget:async()=>{
                  guardPage();
                  if(!scanRows().some(r=>r.id===target.id&&r.addressed))throw new T.TaskError('TARGET_UPDATED','来源评论已更新');
                  trip=await globalThis.XAssistantWorkspace.openStatusTarget(target,{signal,deadline,requireAddressed:true,threadRootId:options.rootId});
                },
                prepareReply:async()=>{
                  generated=await globalThis.XAssistantReplyPreparation.generate({row:target,account:owner,module:'notifications',runId,signal,deadline,notBefore:flow.nextReplyAt,validate:guard});
                  guard();
                  return generated;
                },
                validate:row=>{guard();if(row.id!==target.id||!P.inReplyScope(target))throw new T.TaskError('EXPIRED','评论已超出回复范围');},
                onBeforeSubmit:()=>record(target,'in_flight',{text:generated.text,reasonCode:null,reason:null}),
                onConfirmed:receipt=>{
                  db.nextReplyAt=flow.nextReplyAt=Math.max(flow.nextReplyAt,Date.now()+globalThis.XAssistantTime.ms('replyGap'));
                  return record(target,'confirmed',{receipt,reasonCode:null,reason:null});
                }
              });
              if(result?.action==='skip'){
                attempted.add(target.id);
                const skipLabel=result.skippedGenerationError?'AI 生成失败':result.skipReason==='conversation_ended'?'对话已自然结束':result.skipReason==='video_post'?'视频帖已跳过':result.skipReason==='context_unavailable'?'原帖或交流记录未读全':'本条未生成回复';
                if(result.skippedGenerationError){
                  stats.aiFailed++;
                  await record(target,'ai_error',{reasonCode:result.reasonCode||'AI_GENERATION',reason:result.reason||'AI 生成失败'});
                  await patch({lastIssue:issue(result.reasonCode||'AI_GENERATION',result.reason||'AI 生成失败',target)});
                }else{
                  stats.aiSkipped++;
                  if(result.skipReason==='context_unavailable')stats.failed++;
                  await record(target,'skipped',{reasonCode:result.skipReason||'model_choice',reason:skipLabel});
                }
                if(trip)await trip.returnToSource();
                guardPage();currentTarget=null;
                if(options.rootId){
                  if(result.skippedGenerationError||result.skipReason==='context_unavailable'){
                    if(retryPosition)retries[target.id]={...retryPosition,nextAt:Date.now()+300000};
                  }else delete retries[target.id];
                }
                report(skipLabel+'，未发送');
                continue;
              }
              stats.confirmed++;attempted.add(target.id);
              delete retries[target.id];
              await patch({phase:'notification_scan'});
              report('回复已确认');
              if(trip)await trip.returnToSource();
              guardPage();
              if(one)return await sample('trial_sample_confirmed');
            } catch(error){
              if(error.code==='REPLY_ALREADY_CLAIMED'){
                attempted.add(target.id);currentTarget=null;
                report('该评论已由其他模块处理，跳过重复回复');
                continue;
              }
              if(error.confirmed||P.confirmed(db.records[target.id])){
                error.confirmed=true;error.submitted=true;await patch({lastIssue:issue(error.code||'RETURN_FAILED',error.message,target)});throw error;
              } // confirmed ledger retained even if runtime persistence failed
              if(error.submitted){
                stats.failed++;attempted.add(target.id);
                await record(target,'unknown',{reasonCode:'SEND_UNKNOWN',reason:error.message});
                await patch({phase:'notification_scan',lastIssue:issue('SEND_UNKNOWN',error.message,target)});
                // Do not continue scanning or navigate away from a possibly
                // submitted composer. The row and cross-module claim stay unknown.
                if(/^\/compose\/(?:post|tweet)\/?$/.test(location.pathname)){
                  currentTarget=null;
                  throw Object.assign(new T.TaskError('SEND_UNKNOWN','回复结果未确认，保留编辑页且不会重发：'+error.message),{submitted:true,preserveDrafts:true});
                }
                if(one)return await sample('trial_sample_unknown');
                if(trip||location.pathname!==workPath)throw Object.assign(new T.TaskError('SEND_UNKNOWN','子评论发送结果未知；保留现场，不重发：'+error.message),{submitted:true,preserveDrafts:true});
                report('发送结果不明，跳过当前评论');
              } else if(error.name==='AbortError'||error.code==='YIELD'||error.code==='PAGE_CHANGED'){
                // Reservation may exist, but engine proves no click occurred.
                if(db.records[target.id]?.status==='in_flight')await record(target,'failed',{reasonCode:'INTERRUPTED_BEFORE_SEND',reason:'未提交，留待下轮'});
                throw error;
              } else {
                if(error.code==='TARGET_SKIPPED_UNSENT'){
                  if(trip||!returnedUnsent(error))throw error;
                  if(retryPosition)retries[target.id]={...retryPosition,nextAt:Date.now()+300000};
                }
                stats.failed++;attempted.add(target.id);
                if(error.cause?.preserveDrafts||error.cause?.cause?.preserveDrafts)error.preserveDrafts=true;
                const terminal=!!error.preserveDrafts||['ACCOUNT_CHANGED','CLEANUP_FAILED','AUTHOR_BLOCKED'].includes(error.code);
                await record(target,terminal?'skipped_issue':'failed',{reasonCode:error.code||'REPLY_FAILURE',reason:error.message});
                await patch({phase:'notification_scan',lastIssue:issue(error.code||'REPLY_FAILURE',error.message,target)});
                // A generation/pre-click error is not a reason to strand the
                // worker on somebody else's detail. Return only through the
                // already-proven visit, before the supervisor stops this run.
                if(trip&&!terminal&&!error.stopTargetVisit&&!['RESIDUAL_DRAFT','RESIDUAL_POPUP'].includes(error.code)){
                  try{
                    guard();
                    if(document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))throw new T.TaskError('RESIDUAL_DRAFT','详情存在媒体草稿，保留现场');
                    await trip.returnToSource();guardPage();
                  }catch(back){
                    const failure=new T.TaskError('RETURN_UNVERIFIED',error.message+'；未能安全返回来源页：'+back.message);
                    failure.cause=back;failure.preserveDrafts=true;failure.stopTargetVisit=true;currentTarget=null;throw failure;
                  }
                  currentTarget=null;throw error; // preserve the API error and its recovery policy
                }
                if(error.preserveDrafts||error.stopTargetVisit||trip||['ACCOUNT_CHANGED','CLEANUP_FAILED'].includes(error.code)){currentTarget=null;throw error;}
                report('未发送：'+error.message+'；跳过当前评论');
              }
          }
          currentTarget=null;
        }
        const rows=P.priorityFirst(scanRows()), signature=rows.map(r=>r.id).join(',');
        stable=signature===last?stable+1:0;last=signature;
        const loading=timelineBusy();
        if(options.threadPath){
          if(topPass){topChecked=true;topPass=false;}
          if(resumeAfterDetour){
            const saved=resumeAfterDetour;resumeAfterDetour=null;
            if(await seekCursor(saved)){frontierId=saved.anchor.id;continue;}
            return await pending('THREAD_COMMENTS_PENDING','顶部或待补查评论已处理，正在恢复深层阅读位置');
          }
          if(expanding){
            if(observed.size>expanding.seen)expanded.delete(expanding.node); // X may reuse the same pagination button.
            else if(expanding.node.isConnected&&expanding.node.getClientRects().length)unresolvedFolds.add(expanding.node);
            expanding=null;
          }
          const root=rootRow();if(Number.isInteger(root?.replyCount))rootCount=root.replyCount;
          const fresh=await readDetail(async()=>{
            guardPage();const more=expansion(),scroll=!more&&!atBottom();
            if(more){expanded.add(more);expanding={node:more,seen:observed.size};more.click();}
            else if(scroll)window.scrollBy(0,Math.max(600,innerHeight*.8));
            progress('读取评论与楼中楼 '+options.rootId);
            if(more||scroll)await waitPage(()=>{guardPage();return scanRows().some(r=>!observed.has(r.id))||probeCandidate();},{signal,deadline,timeout:1500});
            guardPage();return scanRows().filter(r=>!observed.has(r.id));
          });
          const edge=scanRows().filter(visible).at(-1);
          if(edge&&snapshot(edge)&&edge.id!==frontierId){cursorAdvanced=true;frontierId=edge.id;}
          if(fresh.some(r=>!reasonFor(r)||unreadBranch(r))||probeCandidate())continue;
          fresh.forEach(observe);
          // No useful work after one native load: never refresh, rewind or wait
          // for repeated empty confirmations. Unknown coverage stays pending.
          const unseen=[...directSeen].filter(id=>!observed.has(id)).length;
          const loaded=anchor?(D.loadedBranchIds?.(viewId,options.rootId)||[]):(D.loadedThreadIds?.(options.rootId)||[]);
          const unread=loaded.filter(id=>!observed.has(id)&&!settled(id)).length;
          const coveredDirect=new Set([...directSeen,...loaded.filter(id=>D.directChildOf(id,viewId)&&settled(id))]).size;
          const unbound=trackUnbound();
          if(!seenHere.size&&!unbound&&Math.max(rootCount||0,options.expectedCommentCount||0)>0)
            return await pending('THREAD_COMMENTS_PENDING','帖上有回复但评论卡仍未加载');
          if(unseen||unread||D.loadedDirectChildren(viewId)>coveredDirect||unbound||[...branchIds].some(id=>!visitedBranches.has(id))){
            return await pending('THREAD_COMMENTS_PENDING','下拉未发现新的待回复目标，未核对卡片留待下轮，立即检查下一帖');
          }
          if(unresolvedFolds.size||hasFoldControl()||expansion(true))return await pending('THREAD_COMMENTS_FOLDED','仍有折叠回复未展开，留待下轮');
          if(!anchor&&pendingBranches.size)return await pending('THREAD_COMMENTS_PENDING','仍有 '+pendingBranches.size+' 个评论分支未读完，保留待补查');
          if(remainingBranches().length||Object.keys(retries).some(id=>!settled(id)))
            return await pending('THREAD_COMMENTS_PENDING','仍有已记录的评论或分支待复查，保留阅读位置');
          if(!atBottom()||timelineBusy())return await pending('THREAD_COMMENTS_PENDING','下拉未发现新的待回复目标，立即检查下一帖');
          // X's displayed count includes our replies and deeper branches. It is
          // informational only, never a direct-child completion target.
          return await finish('visible_exhausted',true,{rootId:options.rootId,seenDirect:directSeen.size,seenThread:observed.size,displayedReplies:rootCount});
        }
        if(stable>=(loading?15:3)){
          if(directOnly&&!loading){
            directOnly=false;stable=0;last='';
            show('我的帖子评论已扫描，继续处理其他回复');
            guardPage();window.scrollTo({top:0,behavior:'instant'});
            await T.sleep(500,signal,deadline);continue;
          }
          if(loading||!mentionsBound()||!scanRows().length&&!empty())return await pending('MENTIONS_NOT_READY','主栏仍在加载或缺少提及空状态');
          return await finish('exhausted',true);
        }
        await T.sleep(500,signal,deadline);guardPage();
        window.scrollBy(0,Math.max(600,innerHeight*.8));await T.sleep(1200,signal,deadline);
      }
      return await finish('scan_limit');
    } catch(error){
      if(currentTarget&&['ACCOUNT_CHANGED','CLEANUP_FAILED','RESIDUAL_DRAFT'].includes(error.code)&&!P.confirmed(db.records[currentTarget.id])&&!P.uncertain(db.records[currentTarget.id])){
        stats.failed++;attempted.add(currentTarget.id);
        await record(currentTarget,'skipped_issue',{reasonCode:error.code,reason:error.message});
        currentTarget=null;
      }
      // No send is in flight here: the engine propagates unknown sends separately.
      // A user navigation ends only this scan; the independent driver decides when to retry.
      if(!error.stopTargetVisit&&!error.submitted&&!error.confirmed&&['NAV_LINK_UNAVAILABLE','NAVIGATION'].includes(error.code)&&!currentTarget)return await pending(error.code,error.message);
      if(error.code==='PAGE_CHANGED'&&!error.stopTargetVisit&&!error.preserveDrafts&&!error.submitted&&!error.confirmed)return await finish('page_changed');
      if(error.code==='YIELD'||error.name==='YieldError')return await finish('yield');
      db.lastScan={startedAt,finishedAt:Date.now(),reason:error.name==='AbortError'?'stopped':'error',error:error.message,stats,page:location.pathname+(location.search||'')};
      await save();throw error;
    }
  }
  async function scan(options){
    if(activeScan)throw new Error('回帖正在执行，请等待当前窗口结束');
    activeScan=scanWindow(options);
    try{return await activeScan;}finally{activeScan=null;}
  }
  globalThis.XAssistantNotifications={
    scan,alreadyReplied:P.confirmed,isRecent:P.recent,shouldIgnore:author=>author?.toLowerCase()==='grok',
    discardResidual:async()=>{const runtime=await api.runtime('notifications','get');return !['submitting','unknown'].includes(runtime.phase)&&D.dialogs().length===0;},
    async nextAt(account){return(await read())[account.toLowerCase()]?.nextAt||0;}
  };
})();
