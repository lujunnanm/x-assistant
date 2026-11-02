// A fresh session per work window: no persisted "seen" flags can strand unsent replies.
(() => {
  const api=globalThis.XAssistantRuntime, T=globalThis.XAssistantTasks;
  const D=globalThis.XAssistantDOM, P=globalThis.XAssistantNotificationPolicy;
  const KEY='xAssistantNotificationRepliesV1';
  let activeScan=null;
  const read=async()=>(await chrome.storage.local.get(KEY))[KEY]||{};

  async function scanWindow(options) {
    const {account,runId,signal}=options, owner=account.toLowerCase();
    const deadline=options.yieldAt??Infinity, startedAt=Date.now();
    const show=options.show||(()=>{}), attempted=new Set(), observed=new Set();
    let resumable=false;
    const stats={seen:0,eligible:0,confirmed:0,aiSkipped:0,aiFailed:0,failed:0,excluded:{}};
    const all=await read();
    const db={records:{},cycles:0,...all[owner]};
    db.records=db.records||{};
    // Migration: these legacy fields encoded "attempted before generating" across windows.
    delete db.batchSeen;delete db.batchUntil;
    db.since=startedAt-P.DAY;
    const processed=(await chrome.storage.local.get('xAssistantProcessedV1')).xAssistantProcessedV1?.posts||{};
    const save=async()=>{
      const latest=await read();latest[owner]=db;await chrome.storage.local.set({[KEY]:latest});
    };
    const patch=value=>api.runtime('notifications','patch',{runId,patch:value});
    const guard=()=>{
      T.check(signal,deadline);
      if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化，停止通知回复');
    };
    const record=async(row,status,extra={})=>{
      db.records[row.id]={...db.records[row.id],status,at:Date.now(),commentAt:row.at,author:row.author,...extra};
      await save();
    };
    const report=message=>show(`${message} · 本轮已回复 ${stats.confirmed}，AI跳过 ${stats.aiSkipped}，失败 ${stats.failed+stats.aiFailed}`);
    const navigate=async(path,allowExpired=false)=>{
      const timeLimit=allowExpired?Infinity:deadline;
      if(D.dialogs().length)throw new T.TaskError('CLEANUP_FAILED','仍有未处理的回复弹窗');
      if(location.pathname===path)return;
      const link=await T.waitFor(()=>[...document.querySelectorAll('a[href]')].find(a=>{
        try{const url=new URL(a.getAttribute('href'),'https://x.com');return url.origin==='https://x.com'&&url.pathname.replace(/\/$/,'')===path;}catch{return false;}
      }),{signal,deadline:timeLimit,timeout:2000});
      if(link)link.click();
      else {
        // X sometimes omits the mentions tab while its navigation is rendering.
        // Use the existing SPA router, without reloading or resuming a send.
        T.check(signal,timeLimit);guard();
        if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw new T.TaskError('RESIDUAL_DRAFT','页面存在未发送的内联草稿，请先处理');
        if(!['/home','/notifications','/notifications/mentions'].includes(path))throw new T.TaskError('NAVIGATION','不支持的通知导航路径');
        history.pushState(history.state,'',path);
        window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
      }
      if(!await T.waitFor(()=>location.pathname===path,{signal,deadline:timeLimit,timeout:10000}))throw new T.TaskError('NAVIGATION','通知页面切换失败');
    };
    const finish=async(reason,complete=false)=>{
      db.lastChecked=Date.now();db.nextAt=0;db.cycles++;
      db.lastScan={startedAt,finishedAt:Date.now(),reason,stats};
      await save();resumable=true;
      report(reason==='yield'?'本轮时间已到，未完成评论留待下轮':reason==='exhausted'?'暂无可回复评论，本轮结束':reason==='scan_limit'?'本轮扫描已达上限，稍后继续':'本轮暂歇：'+reason);
      return {complete,rest:!complete&&reason!=='yield',reason,stats};
    };
    const checkUncertain=()=>{
      if(Object.values(db.records).some(r=>P.uncertain(r)))throw new T.TaskError('SEND_UNKNOWN','存在未知发送记录，请先核对；不会自动重复发送');
    };
    checkUncertain();guard();await save();
    let token=null;
    try {
      if(!options.cooldownSlot)token=await globalThis.XAssistantInteraction.pause();
      guard();
      await patch({phase:'notification_scan',nextAt:Number.isFinite(deadline)?deadline:null});
      show('检查最新评论 · 最近24小时 · 已成功回复自动略过');
      if(location.pathname!=='/notifications/mentions'){
        if(!location.pathname.startsWith('/notifications'))await navigate('/notifications');
        await navigate('/notifications/mentions');
      }
      window.scrollTo({top:0,behavior:'instant'});
      await T.sleep(500,signal,deadline);
      await T.waitFor(()=>D.rows(owner).length||!document.querySelector('[role="progressbar"]'),{signal,deadline,timeout:5000});
      let stable=0,last='';
      for(let screen=0;screen<100;screen++){
        guard();
        if(location.pathname!=='/notifications/mentions')throw new T.TaskError('NAVIGATION','通知页面已变化');
        // Refresh nodes after every attempt. X can replace articles after opening a composer.
        for(;;){
          guard();
          const rows=P.newestFirst(D.rows(owner));
          let target=null;
          for(const row of rows){
            const reason=P.reason(row,{account:owner,until:startedAt,record:db.records[row.id],prior:processed[row.id],attempted});
            if(!observed.has(row.id)){
              observed.add(row.id);stats.seen++;
              if(reason)stats.excluded[reason]=(stats.excluded[reason]||0)+1;
            }
            if(reason==='unknown_send')throw new T.TaskError('SEND_UNKNOWN','目标评论存在未知发送记录，请先核对');
            if(!reason){target=row;break;}
          }
          if(!target)break;
          stats.eligible++;
          report('AI 正在生成回复 @'+target.author);
          // Nothing is marked attempted until generation produces a definite outcome.
          const generated=await T.bounded(()=>api.call({kind:'AI_NOTIFICATION_REPLY',runId,post:{id:target.id,text:target.text}}),{signal,deadline});
          guard();
          if(generated.postId!==target.id)throw new T.TaskError('TARGET_MISMATCH','AI 回复目标不匹配');
          if(!P.recent(target.at)){attempted.add(target.id);continue;}
          if(generated.skippedGenerationError){
            stats.aiFailed++;attempted.add(target.id);
            await record(target,'ai_error',{reasonCode:generated.reasonCode||'AI_GENERATION',reason:generated.reason||'AI 生成失败'});
            report('AI 生成失败，未发送；下轮可重试');
            if(/连接|HTTP|超时/.test(generated.reason||'')){await T.sleep(1000,signal,deadline);return await finish('AI 服务暂不可用');}
          } else if(generated.action==='skip'){
            stats.aiSkipped++;attempted.add(target.id);
            await record(target,'skipped',{reasonCode:'AI_CHOICE',reason:generated.skipReason||'AI 主动选择不回复'});
            report('AI 主动跳过此评论');
          } else {
            if(generated.action!=='send_reply')throw new T.TaskError('AI_PROTOCOL','AI 未返回有效回复');
            try {
              await globalThis.XAssistantReplyEngine.send({
                row:target,text:generated.text,account:owner,signal,deadline,requireAddressed:true,patch,
                validate:row=>{if(!P.recent(row.at))throw new T.TaskError('EXPIRED','评论已超过24小时');},
                onBeforeSubmit:()=>record(target,'in_flight',{text:generated.text,reasonCode:null,reason:null}),
                onConfirmed:receipt=>record(target,'confirmed',{receipt,reasonCode:null,reason:null})
              });
              stats.confirmed++;attempted.add(target.id);
              await patch({phase:'notification_scan'});
              report('回复已确认');
            } catch(error){
              if(error.confirmed||P.confirmed(db.records[target.id]))throw error; // confirmed ledger retained even if runtime persistence failed
              if(error.submitted){await record(target,'unknown',{reasonCode:'SEND_UNKNOWN',reason:error.message});throw error;}
              if(error.name==='AbortError'||error.code==='YIELD'){
                // Reservation may exist, but engine proves no click occurred.
                if(db.records[target.id]?.status==='in_flight')await record(target,'failed',{reasonCode:'INTERRUPTED_BEFORE_SEND',reason:'未提交，留待下轮'});
                throw error;
              }
              stats.failed++;attempted.add(target.id);
              await record(target,'failed',{reasonCode:error.code||'REPLY_FAILURE',reason:error.message});
              if(['ACCOUNT_CHANGED','CLEANUP_FAILED'].includes(error.code))throw error;
              await patch({phase:'notification_scan'});
              report('未发送：'+error.message+'；下轮可重试');
            }
          }
          const cooldownMs=generated.skippedGenerationError||generated.action==='skip'?1000:globalThis.XAssistantCore.randomSeconds(3,5)*1000;
          const end=Date.now()+cooldownMs;
          while(Date.now()<end){
            report('下一条 · '+((end-Date.now())/1000).toFixed(1)+' 秒');
            await T.sleep(Math.min(200,end-Date.now()),signal,deadline);
          }
        }
        const rows=P.newestFirst(D.rows(owner)), signature=rows.map(r=>r.id).join(',');
        stable=signature===last?stable+1:0;last=signature;
        if(rows.length&&rows.every(r=>r.at<Date.now()-P.DAY))return await finish('exhausted',true);
        if(stable>=3)return await finish(document.querySelector('[role="progressbar"]')?'通知仍在加载':'exhausted',!document.querySelector('[role="progressbar"]'));
        window.scrollBy(0,Math.max(600,innerHeight*.8));
        await T.sleep(1200,signal,deadline);
      }
      return await finish('scan_limit');
    } catch(error){
      if(error.code==='YIELD'||error.name==='YieldError')return await finish('yield');
      db.lastScan={startedAt,finishedAt:Date.now(),reason:error.name==='AbortError'?'stopped':'error',error:error.message,stats};
      await save();throw error;
    } finally {
      // Scheduling owns the work destination; leave the page in a known safe state.
      if(resumable&&!signal.aborted&&!D.dialogs().length&&location.pathname.startsWith('/notifications'))await navigate('/home',true);
      if(resumable&&token&&!signal.aborted&&location.pathname==='/home')await globalThis.XAssistantInteraction.resume(token);
    }
  }
  async function scan(options){
    if(activeScan)throw new Error('回帖正在执行，请等待当前窗口结束');
    activeScan=scanWindow(options);
    try{return await activeScan;}finally{activeScan=null;}
  }
  globalThis.XAssistantNotifications={
    scan,alreadyReplied:P.confirmed,isRecent:P.recent,shouldIgnore:author=>author?.toLowerCase()==='grok',
    discardResidual:async()=>{const runtime=await api.runtime('notifications','get');return ['submitting','unknown'].includes(runtime.phase)?false:globalThis.XAssistantPopup.cancel();},
    async nextAt(account){return(await read())[account.toLowerCase()]?.nextAt||0;}
  };
})();
