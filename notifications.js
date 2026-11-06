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
    const primary=()=>document.querySelector('[data-testid="primaryColumn"]');
    const stale=new Set();
    const primaryRows=(column=primary())=>column?D.rows(owner).filter(r=>{
      if(!column.contains(r.article))return false;
      if(!stale.has(r.article))return true;
      const region=r.article.closest?.('[role="region"][aria-label]')?.getAttribute('aria-label')||'';
      return (options.threadPath?/conversation|thread|对话|對話|会話|スレッド/i:/mention|提及|提到|メンション/i).test(region);
    }):[];
    const scanRows=()=>primaryRows().filter(r=>!options.rootId||D.inThread(r.id,options.rootId));
    const rootRow=()=>primaryRows().find(r=>r.id===options.rootId&&r.author.toLowerCase()===owner.slice(1));
    const timelineBusy=()=>[...(primary()?.querySelectorAll('[role="progressbar"]')||[])].some(n=>
      !n.closest('[data-testid="inline_reply_offscreen"],form,article,[contenteditable="true"],[role="dialog"]'));
    const mentionsBound=()=>{
      const c=primary();if(!c)return false;
      const tab=c.querySelector('a[role="tab"][aria-selected="true"]');
      if(tab)return tab.getAttribute('href')?.split(/[?#]/)[0].replace(/\/$/,'')==='/notifications/mentions';
      return [...c.querySelectorAll('[role="region"][aria-label]')].some(n=>/mention|提及|提到|メンション/i.test(n.getAttribute('aria-label')||''));
    };
    const empty=()=>!!primary()?.querySelector('[data-testid="emptyState"]');
    const one=globalThis.XAssistantWorkspace?.state?.()?.assignment?.singleRound===true;
    const directSeen=new Set();
    let rootCount=null;
    const deadline=options.yieldAt??Infinity, startedAt=Date.now(), until=Number.isFinite(options.until)?options.until:startedAt;
    const show=options.show||(()=>{}), attempted=new Set(), observed=new Set();
    const stats={seen:0,eligible:0,confirmed:0,libraryFallback:0,aiSkipped:0,aiFailed:0,failed:0,excluded:{}};
    const all=await read();
    const db={records:{},cycles:0,...all[owner]};
    db.records=db.records||{};
    // Migration: these legacy fields encoded "attempted before generating" across windows.
    delete db.batchSeen;delete db.batchUntil;
    db.since=until-P.DAY;
    const processed=(await local().get('xAssistantProcessedV1')).xAssistantProcessedV1?.posts||{};
    // Account-local safety snapshot. The authoritative atomic claim is checked
    // again by the send transaction; this avoids even generating a repeat.
    const shared=(await local().get('xAssistantReplyClaimsV1')).xAssistantReplyClaimsV1?.[owner]||{};
    const quarantined=id=>P.uncertain(db.records[id],processed[id])||['unknown','in_flight'].includes(shared[id]?.status);
    const save=async()=>{
      const latest=await read();latest[owner]=db;await local().set({[KEY]:latest});
    };
    const patch=value=>api.runtime('notifications','patch',{runId,patch:value});
    const issue=(code,message,row)=>({code,message,targetId:row.id});
    const progress=step=>globalThis.XAssistantWorkspace?.progress?.(step);
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
    // Scoped to read-only observation of this exact original. Always release before
    // any candidate generation, action permit, click, editor or receipt handling.
    const readDetail=async work=>{
      guardPage();
      const release=D.beginDetailRead({id:options.rootId,path:workPath,runId,signal});
      try{return await work();}finally{release();}
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
      db.lastChecked=Date.now();db.nextAt=0;db.cycles++;
      db.lastScan={startedAt,finishedAt:Date.now(),reason,stats,...(evidence?{evidence}:{}),page:location.pathname+(location.search||'')};
      await save();
      report(reason==='yield'?'本轮时间已到，未完成评论留待下轮':reason==='exhausted'?'暂无可回复评论，本轮结束':reason==='scan_limit'?'本轮扫描已达上限，稍后继续':'本轮暂歇：'+reason);
      // Return only the count actually compared with observed direct children.
      const finalCommentCount=rootCount;
      return {complete,rest:!complete&&reason!=='yield',reason,stats,finalCommentCount,...(evidence?{evidence}:{})};
    };
    const pending=async(code,detail)=>{
      const target=options.rootId||'/notifications/mentions';
      let evidence=null;
      if(options.rootId&&['THREAD_ROOT_NOT_READY','THREAD_COMMENTS_PENDING'].includes(code)){
        const main=primary(),thread=scanRows();
        evidence={rootId:options.rootId,primaryArticles:[...(main?.querySelectorAll('article[data-testid="tweet"]')||[])].filter(a=>!a.closest?.('[role="dialog"]')).length,
          threadRows:new Set(thread.map(r=>r.id)).size,seenDirect:directSeen.size,metadataDirect:D.loadedDirectChildren(options.rootId)};
      }
      const message=target+'：'+detail+(evidence?'（主栏卡 '+evidence.primaryArticles+'，已核对同串评论卡 '+evidence.threadRows+'，已加载直接子评论元数据 '+evidence.metadataDirect+'）':'')+'；未记为完成';
      await patch({lastIssue:{code,message,targetId:target}});
      const result=await finish(code,false,evidence);return {...result,detail:message};
    };
    const sample=async(reason)=>({...await finish(reason),sample:true});
    guard();await save();
    let currentTarget=null;
    try {
      guard();
      await patch({phase:'notification_scan',nextAt:Number.isFinite(deadline)?deadline:null});
      show('优先检查我的帖子评论 · 逐条回复 · 已成功回复自动略过');
      if(options.threadPath){await navigate(workPath);}
      else if(location.pathname!=='/notifications/mentions'){
        if(!(location.pathname.startsWith('/notifications')||location.pathname===workPath))await navigate('/notifications');
        await navigate('/notifications/mentions');
      }
      await T.sleep(500,signal,deadline);guard();
      window.scrollTo({top:0,behavior:'instant'});
      await T.sleep(500,signal,deadline);
      if(options.threadPath){
        progress('等待原创详情 '+options.rootId);
        const root=await readDetail(()=>waitPage(()=>{guardPage();return rootRow();},{signal,deadline,timeout:15500}));
        if(!root)return await pending('THREAD_ROOT_NOT_READY','等待 15 秒仍未核对主栏原创帖 ID 与作者');
        rootCount=Number.isInteger(root.replyCount)?root.replyCount:null;
      }else{
        progress('等待提及时间线');
        const ready=await waitPage(()=>{guardPage();return mentionsBound()&&(scanRows().length||empty());},{signal,deadline,timeout:16500});
        if(!ready)return await pending('MENTIONS_NOT_READY','等待 16 秒仍未核对到提及列表或明确的空状态');
      }
      // Traverse the whole list for direct comments first, then return to the
      // top for remaining addressed replies.
      let directOnly=!options.mentionsOnly,stable=0,last='',scrolled=false,readBudget=15500;
      for(let screen=0;screen<100;screen++){
        guardPage();
        // Refresh nodes after every attempt. X can replace articles after opening a composer.
        for(;;){
          guardPage();
          const rows=P.priorityFirst(scanRows());
          if(!options.threadPath&&!mentionsBound())return await pending('MENTIONS_NOT_READY','提及页选中状态已变化');
          if(options.threadPath)for(const r of rows)if(D.directChildOf(r.id,options.rootId))directSeen.add(r.id);
          let target=null;
          for(const row of rows){
            const reason=quarantined(row.id)?'unknown_send':P.reason(row,{account:owner,now:options.threadPath?Date.now():until,until:options.threadPath?Date.now():until,record:db.records[row.id],prior:processed[row.id],attempted});
            if(!observed.has(row.id)){
              observed.add(row.id);stats.seen++;
              if(reason)stats.excluded[reason]=(stats.excluded[reason]||0)+1;
            }
            if(!reason&&(!directOnly||row.directComment)){target=row;break;}
          }
          if(!target)break;
          stats.eligible++;currentTarget=target;progress('处理回复 '+target.id);
          report('AI 正在生成回复 @'+target.author);
          // Nothing is marked attempted until generation produces a definite outcome.
          let generated=await T.bounded(()=>api.call({kind:'AI_NOTIFICATION_REPLY',runId,post:{id:target.id,text:target.text}}),{signal,deadline});
          guardPage();
          if(generated.postId!==target.id)throw new T.TaskError('TARGET_MISMATCH','AI 回复目标不匹配');
          if(!P.inReplyScope(target,options.threadPath?Date.now():until)){attempted.add(target.id);continue;}
          if(generated.skippedGenerationError){
            stats.aiFailed++;attempted.add(target.id);
            await record(target,'ai_error',{reasonCode:generated.reasonCode||'AI_GENERATION',reason:generated.reason||'AI 生成失败'});
            await patch({lastIssue:issue(generated.reasonCode||'AI_GENERATION',generated.reason||'AI 生成失败',target)});
            report('AI 生成失败，未发送；下轮可重试');

          } else {
            if(generated.action==='skip'){
              generated={...generated,action:'send_reply',text:globalThis.XAssistantFallbackLibrary.compose(target.text,null),fallbackLibrary:true};
              stats.libraryFallback++;
              report('AI 返回低信息结果，改用文案库');
            }
            if(generated.action!=='send_reply')throw new T.TaskError('AI_PROTOCOL','AI 未返回有效回复');
            let trip;
            try {
              await globalThis.XAssistantReplyEngine.send({
                row:target,text:generated.text,account:owner,signal,deadline,requireAddressed:false,detailInline:true,patch,module:'notifications',runId,
                prepareTarget:async()=>{
                  guardPage();
                  if(!scanRows().some(r=>r.id===target.id&&r.addressed))throw new T.TaskError('TARGET_UPDATED','来源评论已更新');
                  trip=await globalThis.XAssistantWorkspace.openStatusTarget(target,{signal,deadline,requireAddressed:true});
                },
                validate:row=>{guard();if(row.id!==target.id||!P.inReplyScope(target))throw new T.TaskError('EXPIRED','评论已超出回复范围');},
                onBeforeSubmit:()=>record(target,'in_flight',{text:generated.text,reasonCode:null,reason:null}),
                onConfirmed:receipt=>record(target,'confirmed',{receipt,reasonCode:null,reason:null})
              });
              stats.confirmed++;attempted.add(target.id);
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
              } else if(error.name==='AbortError'||error.code==='YIELD'){
                // Reservation may exist, but engine proves no click occurred.
                if(db.records[target.id]?.status==='in_flight')await record(target,'failed',{reasonCode:'INTERRUPTED_BEFORE_SEND',reason:'未提交，留待下轮'});
                throw error;
              } else {
                stats.failed++;attempted.add(target.id);
                if(error.cause?.preserveDrafts||error.cause?.cause?.preserveDrafts)error.preserveDrafts=true;
                const terminal=!!error.preserveDrafts||['ACCOUNT_CHANGED','CLEANUP_FAILED','AUTHOR_BLOCKED'].includes(error.code);
                await record(target,terminal?'skipped_issue':'failed',{reasonCode:error.code||'REPLY_FAILURE',reason:error.message});
                await patch({phase:'notification_scan',lastIssue:issue(error.code||'REPLY_FAILURE',error.message,target)});
                if(error.preserveDrafts||error.stopTargetVisit||trip||['ACCOUNT_CHANGED','CLEANUP_FAILED'].includes(error.code)){currentTarget=null;throw error;}
                report('未发送：'+error.message+'；跳过当前评论');
              }
            }
          }
          currentTarget=null;
          const cooldownMs=generated.skippedGenerationError||generated.action==='skip'||attempted.has(target.id)&&!P.confirmed(db.records[target.id])?0:globalThis.XAssistantTime.ms('replyGap');
          const end=Date.now()+cooldownMs;
          while(Date.now()<end){
            report('下一条 · '+((end-Date.now())/1000).toFixed(1)+' 秒');
            await T.sleep(Math.min(200,end-Date.now()),signal,deadline);
          }
        }
        const rows=P.priorityFirst(scanRows()), signature=rows.map(r=>r.id).join(',');
        stable=signature===last?stable+1:0;last=signature;
        const loading=timelineBusy();
        if(options.threadPath){
          const root=rootRow();if(Number.isInteger(root?.replyCount))rootCount=root.replyCount;
          const revealed=await readDetail(async()=>{
            if(!scrolled){
              guardPage();window.scrollBy(0,Math.max(600,innerHeight*.8));scrolled=true;
              progress('核对下拉后的评论 '+options.rootId);
            }
            const readingAt=Date.now();
            if(readBudget<=0)return false;
            // Count observation of this source, not time away sending an already
            // selected reply, waiting for its permit, or handling its receipt.
            await waitPage(()=>{
              guardPage();
              const live=scanRows();
              if(live.some(r=>!observed.has(r.id)))return true;
              const latest=rootRow();if(Number.isInteger(latest?.replyCount))rootCount=latest.replyCount;
              return rootCount!==null&&directSeen.size>=(rootCount||options.expectedCommentCount||0)&&[...directSeen].every(id=>observed.has(id))&&!timelineBusy()&&15500-readBudget+Date.now()-readingAt>=700;
            },{signal,deadline,timeout:readBudget});
            readBudget-=Math.max(0,Date.now()-readingAt);
            // A throttled deadline callback can fire AFTER the final DOM mutation.
            // Re-read once; this does not extend the wait or authorize metadata-only targets.
            guardPage();return scanRows().some(r=>!observed.has(r.id));
          });
          if(revealed)continue;
          // A stale profile can say nonzero while the detail is still a zero/unreadable
          // placeholder. Never promote that transient value into a completion checkpoint.
          const expected=rootCount!==null&&rootCount>0?rootCount:Math.max(rootCount??0,options.expectedCommentCount??0);
          const unseen=[...directSeen].filter(id=>!observed.has(id)).length;
          if(unseen)return await pending('THREAD_COMMENTS_PENDING','有 '+unseen+' 条曾见直接评论在逐条核对前已卸载，留待下轮');
          if((rootCount===null&&observed.size===0)||directSeen.size<expected)
            return await pending('THREAD_COMMENTS_PENDING','已下拉一次，15 秒内仅核对到 '+directSeen.size+' 条直接评论 / 帖上显示 '+(expected||rootCount||'未知'));
          return await finish('exhausted',true);
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
