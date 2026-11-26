// Both reply modules call this only after opening the verified target detail.
(() => {
  const MAX_OWN_TURNS=3;
  async function generate({row,account,module,runId,signal,deadline=Infinity,notBefore=0,validate=()=>{}}){
    const T=globalThis.XAssistantTasks,D=globalThis.XAssistantDOM;
    const guard=()=>{T.check(signal,deadline);globalThis.XAssistantWorkspace?.check(signal);if(D.account()!==account.toLowerCase())throw new T.TaskError('ACCOUNT_CHANGED','读取对话时账号变化');validate();};
    const blockedVideo=()=>module==='notifications'?D.replyVideoOnly?.(row):D.replyHasVideo?.(row);
    const videoSkip=()=>({action:'skip',text:'',postId:row.id,skipReason:'video_post'});
    const cooldownAt=Number.isFinite(notBefore)?notBefore:0;
    const waitCooldown=async validatePrepared=>{
      if(Date.now()<cooldownAt)globalThis.XAssistantWorkspace?.progress?.(validatePrepared?'图片回复已准备，等待冷却结束':'等待回复冷却结束',{until:cooldownAt});
      while(Date.now()<cooldownAt){
        guard();if(blockedVideo())return false;validatePrepared?.();
        await T.sleep(Math.min(1000,cooldownAt-Date.now()),signal,deadline);
      }
      guard();return !blockedVideo();
    };
    guard();if(blockedVideo())return videoSkip();
    const read=()=>{guard();return D.replyContext(row,account);};
    globalThis.XAssistantWorkspace?.progress?.('读取原帖、当前对话分支和已确认回复');
    let context=await T.waitForPage(read,{signal,deadline,timeout:5000});
    guard();
    if(blockedVideo())return videoSkip();
    if(!context)return {action:'skip',text:'',postId:row.id,skipReason:'context_unavailable'};
    // Interaction conversations end after MAX_OWN_TURNS replies by this account in the same branch.
    // 灯神 2 回帖 has no turn cap: the model decides when a conversation has ended.
    const owner=account.toLowerCase().replace(/^\//,'');
    if(module!=='notifications'&&context.history.filter(item=>String(item.author||'').toLowerCase()===owner).length>=MAX_OWN_TURNS)
      return {action:'skip',text:'',postId:row.id,skipReason:'conversation_ended'};
    const containsImages=value=>[value.root,...value.history,value.target].some(item=>item.imageUrls?.length);
    if(!containsImages(context)&&Date.now()<cooldownAt){
      if(!await waitCooldown())return videoSkip();
      context=read();
      if(!context)return {action:'skip',text:'',postId:row.id,skipReason:'context_unavailable'};
    }
    const snapshot=JSON.stringify(context),hasImages=containsImages(context);
    const validatePrepared=()=>{
      guard();
      if(blockedVideo())throw new T.TaskError('VIDEO_POST','目标评论只有无法读取的视频，未发送');
      if(JSON.stringify(read())!==snapshot)throw new T.TaskError('TARGET_UPDATED','生成后原帖、图片或对话内容已变化，未发送');
    };
    globalThis.XAssistantWorkspace?.progress?.(hasImages?'正在读图并生成回复，单次最多等待 90 秒':'正在根据对话生成回复');
    const generated=await T.bounded(()=>globalThis.XAssistantRuntime.call({kind:module==='notifications'?'AI_NOTIFICATION_REPLY':'AI_REPLY',runId,post:{id:row.id,text:context.target.text,context}}),{signal,deadline});
    guard();
    if(blockedVideo())return videoSkip();
    if(generated.postId!==row.id)throw new T.TaskError('TARGET_MISMATCH','AI 回复目标不匹配');
    validatePrepared();
    // One selected/claimed photo target only. A model skip does not start a
    // speculative batch while the previous send is still cooling down.
    if(!await waitCooldown(validatePrepared))return videoSkip();
    validatePrepared();
    return {...generated,sourceText:context.target.text,validatePrepared};
  }
  globalThis.XAssistantReplyPreparation={generate};
})();
