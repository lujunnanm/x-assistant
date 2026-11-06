// One lightweight console on every X page; only managed worker tabs execute tasks.
(() => {
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
 const root=document.getElementById('x-assistant-float');if(!root)return;
 const api=globalThis.XAssistantRuntime,P=globalThis.XAssistantServicePolicy;
 const names={posting:'发帖',interaction:'互动',notifications:'回帖',followback:'回关'};
 const keys={posting:'xAssistantPostingV1',interaction:'xAssistantRuntimeV1',notifications:'xAssistantNotificationsRuntimeV1',followback:'xAssistantFollowbackRuntimeV1'};
 let service={enabled:false,selected:{posting:false,interaction:false,notifications:false,followback:false},workers:{}},states={},ai={},loaded=false,busy=false,unavailable='',message='';
 const self=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
 const uncertain=s=>s?.phase==='unknown'||!s?.active&&['submitting','deleting'].includes(s?.phase);
 const STALE_MS=45000,connectStartedAt=Date.now(),CONNECT_TIMEOUT_MS=12000;
 const stamp=ms=>Number.isFinite(ms)?new Date(ms+8*3600000).toISOString().slice(11,19):'';
 const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 const controls=document.createElement('div');controls.className='master-control';
 controls.innerHTML='<button type="button" data-a="service-toggle" role="switch" aria-checked="false" disabled>正在加载</button>';
 root.querySelector('header').after(controls);const master=controls.querySelector('button');
 const summary=document.createElement('div');summary.className='service-summary';summary.setAttribute('role','status');controls.after(summary);
 const notices=document.createElement('div');notices.className='workspace-notice';notices.setAttribute('role','status');notices.hidden=true;root.append(notices);
 const footer=document.createElement('nav');footer.className='workspace-links';footer.setAttribute('aria-label','控制台工具');
 footer.innerHTML='<button type="button" data-a="settings">设置</button><button type="button" data-a="logs">日志</button><span>发帖 · 北京时间 06:00–24:00</span>';root.append(footer);
 const rows={};
 root.insertBefore(root.querySelector('[data-module="posting"]'),root.querySelector('[data-module="interaction"]'));
 for(const module of Object.keys(names)){
  const section=root.querySelector(`[data-module="${module}"]`),title=section.querySelector('b');
  const focus=document.createElement('button');focus.type='button';focus.className='module-title';focus.textContent=names[module];focus.setAttribute('aria-label','查看'+names[module]+'工作页');title.replaceWith(focus);
  const selection=document.createElement('button');selection.className='module-switch';selection.type='button';selection.dataset.option=module;
  selection.setAttribute('role','switch');selection.setAttribute('aria-label','启用'+names[module]);
  selection.onclick=()=>act(async()=>merge(await api.call({kind:'SERVICE_SET',selected:{[module]:!service.selected?.[module]},account:self()})));
  section.append(selection);
  const issue=document.createElement('div');issue.className='module-issue';issue.hidden=true;
  const detail=document.createElement('span'),fix=document.createElement('button');fix.type='button';fix.className='repair-worker';issue.append(detail,fix);section.append(issue);
  focus.onclick=()=>act(()=>api.call({kind:'SERVICE_FOCUS',module}));
  fix.onclick=()=>act(async()=>{
   if(uncertain(states[module])){
    if(!self()||self()!==service.account?.toLowerCase())throw Error('请在原账号登录后核对发送记录');
    if(!await api.review(module,self()))return;
   }
   merge(await api.call({kind:'SERVICE_REPAIR',module,account:self()}));
  });
  rows[module]={section,selection,focus,issue,detail,fix,lamp:section.querySelector('.state-lamp')};
 }
 function merge(value){if(value&&(!Number.isFinite(value.revision)||!Number.isFinite(service.revision)||value.revision>=service.revision))service=value;render();}
 async function act(fn){
  if(!loaded||busy||unavailable)return;busy=true;message='';render();
  try{await globalThis.XAssistantWorkspace.ready;await fn();}
  catch(error){message=error.message||'操作未完成，请稍后重试';}
  finally{busy=false;render();}
 }
 function render(){
  const postingWorking=P.isModuleWorking('posting',Date.now()),enabled=!!service.enabled;
  const optional=['interaction','notifications','followback'].filter(module=>service.selected?.[module]===true);
  const postingSelected=service.selected?.posting===true,working=postingSelected&&postingWorking||optional.length>0;
  root.dataset.workspace='managed';root.dataset.running=String(enabled&&working);root.dataset.serviceEnabled=String(enabled);root.dataset.interactionSelected=String(service.selected?.interaction===true);
  // A slow HELLO / SERVICE_GET is not evidence of an enabled or disabled service.
  // Surface the wait from our existing render clock; never retry a start on timeout.
  const slow=!loaded&&Date.now()-connectStartedAt>=CONNECT_TIMEOUT_MS;
  const caption=unavailable?'请刷新页面':!loaded?(slow?'后台未响应':'正在连接'):busy?'处理中':enabled?'关闭神圣计划':'开启神圣计划';
  setText(master,caption);master.setAttribute('aria-label',caption);master.setAttribute('aria-checked',String(enabled));master.disabled=!loaded||busy||!!unavailable||!enabled&&!self();
  setText(summary,unavailable?'控制台不可用 · 请刷新页面或重新加载扩展':slow?'扩展后台未响应，未确认任务已启动。请刷新页面或重新加载扩展。':!loaded?'正在连接控制台':!enabled?'点击开启神圣计划':service.trial?'单轮诊断 · 不执行发帖':postingSelected&&!postingWorking?(optional.length?'发帖休息 · '+optional.map(module=>names[module]).join('／')+'照常运行':'发帖休息 · 北京时间 06:00 自动恢复'):working?'已开启 · 工作页由插件管理':'已开启 · 请选择模块');
  const problems=[];
  for(const module of Object.keys(names)){
   const row=rows[module],state=states[module]||{},worker=service.workers?.[module]||{},selected=service.selected?.[module]===true;
   row.section.hidden=false;row.section.dataset.selected=String(selected);
   row.selection.disabled=!loaded||busy||!!unavailable;row.selection.setAttribute('aria-checked',String(selected));setText(row.selection,selected?'开':'关');
   row.focus.disabled=!Number.isInteger(worker.tabId)||busy||!!unavailable;
   const working=P.isModuleWorking(module,Date.now());
   const trialSkipped=Boolean(service.trial&&!['interaction','notifications'].includes(module));
   const blocked=['blocked','missing'].includes(worker.status)||uncertain(state);
   const waiting=state.active&&['waiting','paused_waiting'].includes(state.phase);
   const activity=state.activity,now=Date.now();
   const timeKnown=Number.isFinite(activity?.at)&&(!activity.runId||activity.runId===state.runId);
   const waitUntil=Math.max(waiting&&Number.isFinite(state.nextAt)?state.nextAt:0,timeKnown&&Number.isFinite(activity.until)?activity.until:0);
   const staleSince=state.active&&timeKnown?Math.max(activity.at,waitUntil):worker.status==='starting'&&Number.isFinite(worker.createdAt)?worker.createdAt:0;
   const stalled=enabled&&selected&&working&&!trialSkipped&&!blocked&&worker.status!=='retrying'&&staleSince>0&&now-staleSince>=STALE_MS;
   const recent=state.lastIssue,step=timeKnown?activity.step:'等待工作页就绪';
   let label=trialSkipped?'本次不测':!selected?'未启用':!enabled?'待命':!working?'休息中':blocked?'待处理':stalled?'无进展':state.active?(waiting||waitUntil>now?'等待中':'运行中'):worker.status==='retrying'?'稍后重试':worker.status==='starting'?'准备中':'等待中';
   if(state.active&&(!enabled||!working||!selected))label='收尾中';
   setText(row.lamp,label);row.lamp.dataset.state=blocked||stalled?'warn':state.active?'on':enabled&&selected&&working&&!trialSkipped?'wait':'off';
   const deadline=state.active&&waitUntil>now?String(waitUntil):enabled&&selected&&Number.isFinite(worker.retryAt)?String(worker.retryAt):'';
   if(row.section.dataset.nextAt!==deadline)row.section.dataset.nextAt=deadline;
   const info=[];
   if(blocked)info.push(uncertain(state)?(module==='followback'?'回关结果待核对，不会自动重试':'发送结果待核对，不会重发'):worker.status==='missing'?'工作页已关闭':worker.error||'工作页需要处理');
   else if(stalled)info.push('已 '+Math.floor((now-staleSince)/1000)+' 秒无进展：'+step);
   else if(worker.status==='retrying'&&worker.error)info.push('稍后重试：'+worker.error);
   else if(!state.active&&state.error)info.push('停止原因：'+state.error);
   // Deferred coverage and skips are real records, not stopped workers. Keep
   // full diagnostics available without presenting a previous run as a new alarm.
   const deferred={PROFILE_VIEWPORT_PENDING:'资料页位置待复核，未检查项保留',THREAD_COMMENTS_PENDING:'评论未全部显示，保留下轮检查',TARGET_SKIPPED_UNSENT:'目标未核对，已跳过且未发送',LIKE_TARGET:'回复已确认，未核实点赞目标'};
   const history=recent?.runId&&(!state.active||recent.runId!==state.runId);
   const needsReview=recent?.code==='SEND_UNKNOWN'||uncertain(state);
   const pending=deferred[recent?.code];
   const quiet=!info.length&&!needsReview&&(!!history||!!pending);
   const diagnostic=recent?.message?stamp(recent.at)+' '+(recent.code?'['+recent.code+'] ':'')+recent.message+(recent.targetId?' · '+recent.targetId:''):'';
   if(diagnostic)info.push(quiet?(history?'上轮记录：':'本轮提示：')+(pending||recent.message)+' · '+stamp(recent.at):'上次异常 '+diagnostic);
   const reason=info.join('；');
   row.issue.dataset.tone=quiet?'note':'warning';
   row.issue.hidden=!reason;setText(row.detail,reason);row.detail.title=quiet?diagnostic:reason;
   setText(row.fix,uncertain(state)?'核对结果':'恢复');row.fix.hidden=!blocked||(enabled&&!selected);
   row.fix.disabled=busy||!!unavailable;
   row.section.title=reason||(state.active&&timeKnown?'当前步骤：'+step:label);
   if(module!=='followback'&&enabled&&selected&&ai[module]?.error&&ai[module]?.retrying)problems.push(names[module]+'正在重试 AI 请求');
  }
  const follow=controls.querySelector('.follow-button');if(follow)follow.hidden=service.selected?.interaction!==true;
  const note=unavailable||message||problems.join(' · ');notices.hidden=!note;setText(notices,note);
 }
 master.onclick=()=>act(async()=>{
  if(!service.enabled&&!self())throw Error('请先登录 X 并等待账号加载完成');
  merge(await api.call({kind:'SERVICE_SET',enabled:!service.enabled,account:self()}));
 });
 const close=root.querySelector('[data-a="hide"]');close.onclick=()=>{const collapsed=root.dataset.collapsed!=='true';root.dataset.collapsed=String(collapsed);close.setAttribute('aria-expanded',String(!collapsed));close.setAttribute('aria-label',collapsed?'展开控制台':'收起控制台');close.title=collapsed?'展开控制台':'收起控制台';};
 footer.querySelector('[data-a="settings"]').onclick=()=>act(()=>api.call({kind:'OPEN_PANEL',section:'library'}));
 footer.querySelector('[data-a="logs"]').onclick=()=>act(()=>api.call({kind:'OPEN_PANEL',section:'logs'}));
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  for(const [name,key] of Object.entries(keys))if(changes[key])states[name]=changes[key].newValue||{};
  if(changes.xAssistantAIStatusV2)ai=changes.xAssistantAIStatusV2.newValue||{};
  if(changes[P.KEY])merge(changes[P.KEY].newValue);else render();
 });
 async function refresh(){
  await globalThis.XAssistantWorkspace.ready;
  const [snapshot,data]=await Promise.all([api.call({kind:'SERVICE_GET'}),local().get([...Object.values(keys),'xAssistantAIStatusV2'])]);
  for(const [name,key] of Object.entries(keys))if(!states[name]||Number(data[key]?.revision)>Number(states[name]?.revision))states[name]=data[key]||{};
  ai=data.xAssistantAIStatusV2||{};loaded=true;merge(snapshot);
 }
 refresh().catch(error=>{unavailable||=error.message||'控制台连接失败';render();});
 // Pure UI updates only; ordinary browsing tabs never poll or execute workers.
 const timer=setInterval(()=>{if(!document.hidden&&root.dataset.collapsed!=='true')render();},1000);
 window.addEventListener('x-assistant-invalidate',event=>{clearInterval(timer);unavailable=event.detail?.reason||'扩展已更新，请刷新页面';render();});
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 globalThis.XAssistantConsole={refresh,render};render();
})();
