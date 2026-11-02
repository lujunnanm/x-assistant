(()=>{
 const root=document.getElementById('x-assistant-float'),api=globalThis.XAssistantRuntime,C=globalThis.XAssistantSchedulerCore;
 const KEY='xAssistantSchedulerV3',I=globalThis.XAssistantInteractionDriver,P=globalThis.XAssistantPostingDriver;
 const master=document.createElement('div');master.className='master-control';master.innerHTML='<button data-a="master" role="switch" aria-checked="false">启动协同</button><span data-master-status role="status">已停止</span>';root.querySelector('header').after(master);
 const button=master.querySelector('button'),summary=master.querySelector('span'),lamps={};
 for(const name of ['posting','interaction','notifications']){
  const section=root.querySelector(`[data-module="${name}"]`),row=section.querySelector('.row');
  const lamp=document.createElement('span');lamp.className='state-lamp';lamp.setAttribute('role','status');lamp.dataset.state='off';lamp.textContent='已停止';row.replaceWith(lamp);lamps[name]=lamp;
 }
 // Preserve the established visual style; post priority is reflected in the row order.
 root.insertBefore(root.querySelector('[data-module="posting"]'),root.querySelector('[data-module="interaction"]'));
 let controller=null,task=Promise.resolve(),state=null,postingBusy=false,replyTask=null,replyRun=null,owns=false,queue=Promise.resolve(),refreshing=false;
 const serialized=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 const save=()=>chrome.storage.local.set({[KEY]:state});
 const show=(name,text,kind)=>{lamps[name].textContent=text;lamps[name].dataset.state=kind;};
 const remaining=ms=>`${Math.ceil(Math.max(0,ms)/60000)} 分钟`;
 function render(post){
  button.textContent=controller?'停止协同':'启动协同';button.setAttribute('aria-checked',String(!!controller));
  if(!controller){for(const n in lamps)show(n,'已停止','off');return;}
  show('posting',postingBusy?'正在发帖':'冷却中',postingBusy?'on':'wait');
  show('interaction',I.isRunning()?'运行中':state.mode==='replies'?'休息中':'等待发帖',I.isRunning()?'on':'wait');
  show('notifications',replyTask?'回帖中':state.mode==='interaction'?'等待休息':state.repliesDone?'本轮休息':'暂停等待',replyTask?'on':'wait');
  summary.textContent=state.mode==='interaction'?`互动剩余 ${remaining(C.WORK-state.workMs)}`:`休息剩余 ${remaining(state.restUntil-Date.now())}`;
 }
 async function pauseInteraction(){if(I.isRunning())await I.pause();}
 async function stopAll(){
  // Abort signals are issued together; no lower-priority resume can occur during stop.
  await Promise.allSettled([I.stop(),P.stop(),api.runtime('notifications','stop')]);
  if(replyTask)await replyTask.catch(()=>{});
 }
 async function start(resume=false){
  if(controller)return;const own=new AbortController();controller=own;const signal=own.signal;button.disabled=true;
  task=navigator.locks.request('x-assistant-master-v3',{ifAvailable:true},async lock=>{
   if(!lock)throw Error('协同正在另一个 X 标签页运行');
   let self;for(let i=0;i<150;i++){api.check(signal);self=globalThis.XAssistantEntry.account();if(/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))break;await api.sleep(100,signal);}
   if(!/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))throw Error('账号加载超时，请刷新后重试');
   summary.textContent='正在检查 DeepSeek 连接';await api.call({kind:'AI_CHECK'});api.check(signal);
   if(!resume){for(const name of ['posting','interaction','notifications'])if(!await api.review(name,self))throw Error('未完成旧发送记录核对');}
   for(const name of ['posting','interaction','notifications'])await api.runtime(name,'prepare',{account:self});
   const previous=(await chrome.storage.local.get(KEY))[KEY],post=await api.runtime('posting','get');
   if(resume&&(!previous?.active||previous.account!==self||!post.active))throw Error('旧协同已停止，请重新启动');
   owns=true;state=resume?{...previous,lastTick:Date.now()}: {...C.fresh(Date.now()),account:self,active:true};
   await globalThis.XAssistantEntry.enter('posting',signal);await save();
   await P.start(resume);button.disabled=false;
   for(let i=0;i<100;i++){api.check(signal);if((await api.runtime('posting','get')).active)break;await api.sleep(50,signal);}
   while(!signal.aborted){
    await serialized(async()=>{
     api.check(signal);if(globalThis.XAssistantEntry.account()!==state.account)throw Error('账号变化，已停止协同');
     const post=await api.runtime('posting','get'),interaction=await api.runtime('interaction','get');
     if(!post.active||post.error)throw Error(post.error||'发帖模块已停止');
     if(interaction.error&&state.workStarted)throw Error(interaction.error);
     state=C.tick(state,Date.now(),I.isRunning()&&!postingBusy);
     const action=C.choose(state,Date.now(),{busy:postingBusy||post.phase!=='waiting',nextAt:post.nextAt});
     if(action!=='interaction')await pauseInteraction();
     if(action==='interaction'&&!I.isRunning()&&!replyTask){await globalThis.XAssistantEntry.enter('interaction',signal);api.check(signal);if(!postingBusy){const r=await api.runtime('interaction','get');await I.start(!!r.active);state.workStarted=true;}}
     if(action==='notifications'&&!replyTask){
      const deadline=C.replyDeadline(state,post);
      replyTask=(async()=>{
       await navigator.locks.request('x-assistant-page-actions',{signal},async()=>{
        api.check(signal);if(postingBusy||Date.now()>=deadline)return;
        await globalThis.XAssistantEntry.enter('notifications',signal);
        const old=await api.runtime('notifications','get');const r=await api.runtime('notifications','begin',{account:state.account,resume:!!old.active});replyRun=r.runId;
        const result=await globalThis.XAssistantNotifications.scan({account:state.account,runId:replyRun,signal,show:t=>root.querySelector('[data-status="notifications"]').textContent=t,yieldAt:deadline});
        if(result?.complete||result?.rest)state.repliesDone=true;
        await api.runtime('notifications','patch',{runId:replyRun,patch:{phase:'waiting',nextAt:null}});
       });
      })().catch(e=>{if(!signal.aborted){state.error=e.message;own.abort();}}).finally(()=>{replyTask=null;});
     }
     await save();render(post);
    });
    await api.sleep(500,signal);
   }
  }).catch(e=>{if(e.name!=='AbortError'){if(state)state.error=e.message;summary.textContent=e.message;}}).finally(async()=>{
   if(owns&&!refreshing){await stopAll();state.active=false;await save();}
   if(controller===own)controller=null;owns=false;button.disabled=false;render();summary.textContent=state?.error||summary.textContent||'已停止';
  });
 }
 async function stop(){if(!controller)return;summary.textContent='正在停止';controller.abort();await task;summary.textContent=state?.error||'已停止';}
 globalThis.XAssistantScheduler={active:()=>!!controller,beforePost:async()=>{
  postingBusy=true;await serialized(async()=>{state=C.tick(state,Date.now(),I.isRunning());await pauseInteraction();await save();});
 },afterPost:async()=>{postingBusy=false;},beforeRefresh:async()=>{
  // Preserve only a safe waiting state. Browser reload never retries uncertain sends.
  state=C.tick(state,Date.now(),I.isRunning()&&!postingBusy);await save();refreshing=true;
 },start,stop};
 button.onclick=()=>controller?stop():start();
 window.addEventListener('pagehide',()=>{refreshing=true;controller?.abort();},{once:true});
 window.addEventListener('x-assistant-invalidate',()=>{controller?.abort();},{once:true});
 chrome.storage.local.get(KEY).then(async data=>{const s=data[KEY];if(s?.active&&(await api.runtime('posting','get')).active)start(true);else render();}).catch(e=>summary.textContent=e.message);
})();
