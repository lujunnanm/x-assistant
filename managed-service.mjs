import './service-policy.js';

export const SERVICE_KEY='xAssistantManagedServiceV1';
export const BOUNDARY_ALARM='x-assistant-service-boundary';
export const WATCHDOG_ALARM='x-assistant-service-watchdog';
const MODULES=['posting','interaction','notifications','followback'];
const SEARCH_KEY='xAssistantFriendSearchV1';
const validAccount=value=>/^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
const uncertain=state=>['submitting','unknown','deleting'].includes(state?.phase);
const needsReview=state=>state?.phase==='unknown'||(!state?.active&&uncertain(state));
const failure=(code,message)=>Object.assign(Error(message),{code});

// Every mutation is serialized independently of network generation and content scripts.
// Never await a worker response while holding this queue: worker Stop writes runtime state.
export function createManagedService({read,write,tabs,alarms,runtimeFor,retireMissingRun,postingReady=async()=>true,now=Date.now,uuid=()=>crypto.randomUUID(),policy=globalThis.XAssistantServicePolicy}){
 let queue=Promise.resolve(),watchdogArmed=false;
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const normalize=raw=>({...raw,enabled:raw?.enabled===true,account:validAccount(raw?.account),revision:Number.isInteger(raw?.revision)&&raw.revision>=0?raw.revision:0,selected:{posting:raw?.selected?.posting===true,interaction:raw?.selected?.interaction===true,notifications:raw?.selected?.notifications===true,followback:raw?.selected?.followback===true},workers:Object.fromEntries(MODULES.filter(module=>raw?.workers?.[module]&&typeof raw.workers[module]==='object').map(module=>[module,raw.workers[module]]))});
 // Search is a separate preference, not an implicit interaction-module switch.
 // The preference chooses a source; it never disables the interaction module.
 const load=async()=>{const [raw,search]=await Promise.all([read(SERVICE_KEY),read(SEARCH_KEY)]);return {...normalize(raw),searchEnabled:search!==false};};
 const save=async state=>{const {searchEnabled,...persisted}=state;await write(SERVICE_KEY,persisted);return state;};
 const desired=(state,module)=>state.trial?state.trial.pending?.[module]===true&&now()<state.trial.expiresAt:state.selected[module]===true;
 // Explicit operator diagnostics run one interaction cycle and one profile scan.
 // A diagnostic cannot promote posting or alter the saved posting preference.
 function finishTrial(state,module,reason){
  const trial=state.trial;if(!trial?.pending[module])return false;
  trial.pending[module]=false;trial.results[module]={at:now(),reason:String(reason).slice(0,300)};state.selected[module]=false;state.revision++;
  if(!Object.values(trial.pending).some(Boolean)){state.enabled=false;state.selected=trial.previousSelected;state.lastTrial={...trial,finishedAt:now()};delete state.trial;}
  return true;
 }
 async function trialStartInner(account,requestId,issuedAt,only){
  const state=await load(),owner=validAccount(account);
  if(only!==undefined&&!['interaction','notifications'].includes(only))throw failure('TRIAL_MODULE_INVALID','诊断只支持互动或回帖');
  const selected={posting:false,interaction:only!=='notifications',notifications:only!=='interaction',followback:false};
  const fresh=()=>Number.isFinite(issuedAt)&&now()>=issuedAt&&now()-issuedAt<=15000;
  if(!/^[a-zA-Z0-9_-]{12,80}$/.test(requestId||''))throw failure('TRIAL_REQUEST_INVALID','试跑请求缺少唯一编号；未启动');
  if(state.account===owner&&(state.trial?.requestId===requestId||state.lastTrial?.requestId===requestId))return view(state);
  if(!fresh())throw failure('TRIAL_REQUEST_EXPIRED','启动请求过期，未延迟开启任务');
  if(!owner||state.enabled||state.trial)throw Error('请先停止服务并核对本次试跑账号');
  if(state.account&&state.account!==owner)throw failure('ACCOUNT_CHANGED','试跑账号与已保存账号不一致');
  for(const mod of MODULES){const r=await runtimeFor(mod);if(r?.active||needsReview(r))throw Error('仍有运行中或待核对模块，不能开始单轮试跑');}
  if(!fresh())throw failure('TRIAL_REQUEST_EXPIRED','启动请求过期，未开启任务');
  const old=state.workers;state.workers={};state.trial={id:uuid(),requestId,startedAt:now(),expiresAt:now()+30*60000,pending:{interaction:selected.interaction,notifications:selected.notifications},results:{},previousSelected:{...state.selected}};
  state.account=owner;state.enabled=true;state.selected=selected;state.revision++;await save(state);notify({workers:old});return reconcileInner();
 }
 async function trialDoneInner(module,owner,reason){
  const s=await load();if(s.workers[module]?.tabId!==owner||!finishTrial(s,module,reason))return;
  await save(s);await planAlarms(s);notify(s);
 }

 const notify=state=>{for(const worker of Object.values(state.workers))if(Number.isInteger(worker.tabId)){
  try{Promise.resolve(tabs.sendMessage?.(worker.tabId,{kind:'SERVICE_SYNC'})).catch(()=>{});}catch{}
 }};
 const view=state=>{const instant=now(),postingWorking=policy.isWorkingTime(instant),working=policy.activeModules(state.selected).some(module=>policy.isModuleWorking(module,instant)),nextBoundary=policy.nextBoundary(instant);return {...state,working,postingWorking,nextBoundary,window:{working:postingWorking,nextBoundary},status:!state.enabled?'off':working?'working':'resting'};};
 const find=(state,tabId)=>Object.entries(state.workers).find(([,worker])=>worker.tabId===tabId);
 function assignmentFrom(state,module,worker,runtime){
  const sourceMode=module==='interaction'?(state.searchEnabled?'search':'home'):null;
  let reason=null;
  if(!state.enabled)reason='SERVICE_DISABLED';
  else if(!desired(state,module))reason='MODULE_DISABLED';
  else if(!policy.isModuleWorking(module,now()))reason='OUTSIDE_WORKING_HOURS';
  else if(needsReview(runtime))reason='SEND_UNKNOWN';
  else if(['missing','blocked'].includes(worker.status))reason=worker.code||'WORKER_BLOCKED';
  else if(sourceMode&&runtime?.active&&runtime.sourceMode!==sourceMode)reason='SOURCE_CHANGED';
  else if(Number(worker.retryAt)>now())reason='RETRY_WAIT';
  return {module,...(sourceMode?{sourceMode}:{}),token:worker.token,account:state.account,tabId:worker.tabId,shouldRun:!reason,reason,revision:state.revision,status:worker.status,retryAt:worker.retryAt||null,...(state.trial?{singleRound:true}:{})};
 }
 async function assignment(tabId){
  const state=await load(),found=find(state,tabId);if(!found)return null;
  const [module,worker]=found;return assignmentFrom(state,module,worker,await runtimeFor(module));
 }
 async function authorize(tabId,module,account){
  const state=await load(),worker=state.workers[module];
  if(!worker||worker.tabId!==tabId)throw failure('NOT_MANAGED_WORKER','请从神圣计划总开关启动，当前页面不是此模块工作页');
  if(validAccount(account)!==state.account)throw failure('ACCOUNT_CHANGED','工作账号发生变化，请停止后核对账号');
  const assignment=assignmentFrom(state,module,worker,await runtimeFor(module));
  if(!assignment.shouldRun)throw failure(assignment.reason,assignment.reason==='OUTSIDE_WORKING_HOURS'?'发帖北京时间 00:00–06:00 休息，06:00 自动恢复':assignment.reason==='SEND_UNKNOWN'?'上次发送结果待核对，不会自动重发':assignment.reason==='SOURCE_CHANGED'?'互动来源已切换，旧目标不再执行':'当前模块未获运行许可');
  return assignment;
 }
 async function planAlarms(state){
  if(!state.enabled){await alarms.clear?.(BOUNDARY_ALARM);await alarms.clear?.(WATCHDOG_ALARM);watchdogArmed=false;return;}
  if(state.selected.posting){const boundary=policy.nextBoundary(now()),existingBoundary=await alarms.get?.(BOUNDARY_ALARM);
   if(!existingBoundary||existingBoundary.scheduledTime!==boundary)await alarms.create?.(BOUNDARY_ALARM,{when:boundary});
  }else await alarms.clear?.(BOUNDARY_ALARM);
  const watchdog=alarms.get?await alarms.get(WATCHDOG_ALARM):watchdogArmed;
  if(!watchdog){await alarms.create?.(WATCHDOG_ALARM,{periodInMinutes:1});watchdogArmed=true;}
 }
 function urlFor(module,account,searchEnabled){return 'https://x.com'+(module==='posting'||module==='interaction'&&!searchEnabled?'/home':module==='interaction'?'/search?q='+encodeURIComponent('蓝V交友 OR "make new friends"')+'&src=typed_query':module==='followback'?account+'/verified_followers':account);}
 async function createWorker(state,module){
  // A blank tab cannot execute extension content scripts before ownership is persisted.
  const token=uuid(),worker={tabId:null,token,status:'starting',error:null,code:null,retryAt:null,retryAttempts:0,createdAt:now(),lastSeen:0};
  state.workers[module]=worker;await save(state);
  let tab;
  try{
   tab=await tabs.create({url:'about:blank',active:false});
   if(!Number.isInteger(tab?.id))throw Error('工作页创建失败');
   worker.tabId=tab.id;await save(state);
   // The operator can switch the source while the initial blank tab is being created.
   if(module==='interaction')state.searchEnabled=(await read(SEARCH_KEY))!==false;
   await tabs.update(tab.id,{url:urlFor(module,state.account,state.searchEnabled),active:false});
  }catch(error){worker.status='blocked';worker.code='WORKER_CREATE_FAILED';worker.error=error.message||'工作页创建失败';await save(state);}
 }
 // onRemoved may not reach a sleeping background page. Only an explicit
 // Chromium "no such tab" response is evidence of closure; a failed lookup alone is not.
 async function inspectOwnedTab(state,module,worker,run){
  const known=Number.isInteger(worker?.tabId),missing=worker?.status==='missing'&&worker.code==='WORKER_CLOSED';
  if(!known&&!(missing&&run?.active))return {};
  const id=known?worker.tabId:worker.closedTabId??run.owner;
  if(!Number.isInteger(id))return {};
  try{return {tab:await tabs.get(id)};}catch(e){
   if(!new RegExp('^No tab with id: '+id+'[.]?$','i').test(e?.message||''))return {};
  }
  // Legacy tombstones omitted the former tab ID. Check the persisted owner
  // itself, its account, and that no different worker now owns that tab.
  if(run?.active&&run.owner===id&&validAccount(run.account)===state.account&&run.runId&&
    !Object.entries(state.workers).some(([name,w])=>name!==module&&w.tabId===id)){
   await retireMissingRun?.(module,run);
  }
  if(!known)return {};
  Object.assign(worker,{tabId:null,closedTabId:id,status:'missing',code:'WORKER_CLOSED',error:'工作页已关闭，请点击恢复',retryAt:null});
  return {changed:true};
 }
 async function reconcileInner(){
  const state=await load();let changed=false;
  if(state.trial&&now()>=state.trial.expiresAt)for(const m of ['interaction','notifications'])changed=finishTrial(state,m,'单轮试跑到达安全时间上限')||changed;
  if(state.enabled&&!validAccount(state.account)){state.enabled=false;changed=true;}
  for(const module of MODULES){
   const wanted=state.enabled&&state.selected[module]===true&&desired(state,module)&&policy.isModuleWorking(module,now()),worker=state.workers[module];
   if(!wanted&&!worker)continue;
   let runtime=await runtimeFor(module),tab;
   if(worker&&(runtime?.active||wanted&&!['blocked','missing'].includes(worker.status))){
    const found=await inspectOwnedTab(state,module,worker,runtime);tab=found.tab;changed=changed||!!found.changed;
    if(!tab&&runtime?.active)runtime=await runtimeFor(module);
   }
   if(!wanted)continue;
   if(needsReview(runtime)){
    if(worker&&worker.code!=='SEND_UNKNOWN'){Object.assign(worker,{status:'blocked',code:'SEND_UNKNOWN',error:'上次发送结果待核对，不会自动重发',retryAt:null});changed=true;}
    // No worker is created until the user has reviewed a legacy uncertain runtime.
    if(!worker){state.workers[module]={tabId:null,token:uuid(),status:'blocked',code:'SEND_UNKNOWN',error:'上次发送结果待核对，不会自动重发',retryAt:null};changed=true;}
    continue;
   }
   if(!worker){await createWorker(state,module);continue;}
   if(worker.status==='missing'||worker.status==='blocked')continue;
   if(tab){
     if(tab.discarded){Object.assign(worker,{status:'blocked',code:'WORKER_DISCARDED',error:'工作页已挂起，请恢复工作页',retryAt:null});changed=true;}
     else if(runtime?.active&&worker.lastSeen&&now()-worker.lastSeen>180000){Object.assign(worker,{status:'blocked',code:'WORKER_UNRESPONSIVE',error:'工作页长时间未响应，请查看并恢复',retryAt:null});changed=true;}
     else if(worker.createdAt&&now()-worker.createdAt>120000&&!worker.lastSeen){Object.assign(worker,{status:'blocked',code:'WORKER_NOT_READY',error:'工作页未就绪，请检查登录或恢复工作页',retryAt:null});changed=true;}
   }
  }
  if(state.trial)for(const module of ['interaction','notifications']){
   const worker=state.workers[module];if(['blocked','missing'].includes(worker?.status))changed=finishTrial(state,module,worker.error||worker.code)||changed;
  }
  if(changed)await save(state);
  await planAlarms(state);notify(state);return view(state);
 }
 async function setInner(patch){
  const state=await load();
  if(state.trial){
   if(patch.enabled!==false)throw Error('单轮试跑中；请先关闭服务再修改配置');
   for(const m of ['interaction','notifications'])finishTrial(state,m,'手动停止单轮试跑');
  }
  if(patch.selected!==undefined){
   if(!patch.selected||typeof patch.selected!=='object'||Array.isArray(patch.selected)||Object.keys(patch.selected).some(k=>!MODULES.includes(k)))throw Error('模块选项无效');
   if(patch.selected.posting===true&&!await postingReady())throw failure('POST_LIBRARY_EMPTY','发帖文案库为空，请先在设置中添加文案');
   for(const [name,value] of Object.entries(patch.selected)){if(typeof value!=='boolean')throw Error('模块选项必须为开或关');state.selected[name]=value;}
  }
  if(patch.enabled!==undefined&&typeof patch.enabled!=='boolean')throw Error('总开关状态无效');
  if(patch.account!==undefined&&patch.enabled!==false){
   const account=validAccount(patch.account);if(!account)throw Error('请在已登录的 X 页面开启神圣计划');
   if(state.enabled&&state.account&&state.account!==account)throw failure('ACCOUNT_CHANGED','请先关闭神圣计划，再切换工作账号');
   if(state.account&&state.account!==account){
    // Retire ownership rather than turning an old account page into a new account worker.
    for(const module of MODULES)if((await runtimeFor(module))?.active)throw Error('旧账号任务尚未结束，请稍候');
    state.workers={};
   }
   state.account=account;
  }
  if(patch.enabled===true&&!validAccount(state.account))throw Error('请先确认当前 X 登录账号');
  if(patch.enabled!==undefined)state.enabled=patch.enabled;
  if(state.enabled&&state.selected.posting&&!await postingReady())throw failure('POST_LIBRARY_EMPTY','发帖文案库为空，请先在设置中添加文案');
  state.revision++;await save(state);return reconcileInner();
 }
 async function pollInner(tabId){
  const state=await load(),found=find(state,tabId);if(!found)return null;
  const [module,worker]=found;
  if(!worker.lastSeen||now()-worker.lastSeen>=30000){worker.lastSeen=now();await save(state);}
  return assignmentFrom(state,module,worker,await runtimeFor(module));
 }
 async function reportInner(tabId,msg){
  const state=await load(),worker=state.workers[msg.module];
  if(!worker||worker.tabId!==tabId||worker.token!==msg.token)throw failure('WORKER_REPLACED','旧工作页报告已忽略');
  if(!['running','stopped','blocked','error'].includes(msg.status))throw Error('工作页状态无效');
  worker.lastSeen=now();
  if(msg.status==='running'){
   const permit=assignmentFrom(state,msg.module,worker,await runtimeFor(msg.module));
   if(!permit.shouldRun)throw failure(permit.reason,'当前模块未获运行许可');
   Object.assign(worker,{status:'running',error:null,code:null,retryAt:null});
  }else if(msg.status==='stopped'){
   // A delayed Stop acknowledgement may not erase a pending retry or human-action block.
   if(!['blocked','missing','retrying'].includes(worker.status))worker.status='stopped';
  }else{
   const runtime=await runtimeFor(msg.module);
   const message=String(msg.error||msg.message||'工作页需要检查').slice(0,500);
   const error={message,code:msg.code,submitted:msg.submitted,confirmed:msg.confirmed};
   const classification=policy.classifyFailure(error);
   const attempt=(worker.retryAttempts||0)+1;
   if(!uncertain(runtime)&&(['SERVICE_DISABLED','MODULE_DISABLED','SOURCE_CHANGED','OUTSIDE_WORKING_HOURS','OUTSIDE_WINDOW'].includes(msg.code)||classification.reason==='cancelled')){
    if(!['blocked','missing','retrying'].includes(worker.status))Object.assign(worker,{status:'stopped',error:null,code:null,retryAt:null});
   }else if(!state.trial&&msg.status==='error'&&msg.submitted===false&&!uncertain(runtime)&&classification.retryable&&attempt<=3){
    Object.assign(worker,{status:'retrying',error:message,code:msg.code||'TRANSIENT_FAILURE',retryAttempts:attempt,retryAt:now()+[15000,60000,180000][attempt-1]});
   }else Object.assign(worker,{status:'blocked',error:message,code:uncertain(runtime)?'SEND_UNKNOWN':msg.code||'WORKER_BLOCKED',retryAt:null});
  }
  if(worker.status==='blocked')finishTrial(state,msg.module,worker.error||worker.code);
  await save(state);await planAlarms(state);notify(state);return view(state);
 }
 async function repairInner(module){
  if(!MODULES.includes(module))throw Error('模块无效');
  const state=await load(),old=state.workers[module];let runtime=await runtimeFor(module);
  if(old&&runtime?.active){
   const checked=await inspectOwnedTab(state,module,old,runtime);
   if(checked.changed)await save(state);
   runtime=await runtimeFor(module);
  }
  if(uncertain(runtime))throw failure('SEND_UNKNOWN','请先核对上次发送记录，再恢复工作页');
  if(runtime?.active)throw Error('模块仍在运行或收尾，请先停止后恢复');
  if(state.enabled&&!desired(state,module))throw Error('请先启用这个模块');
  state.revision++;
  // Repairs create a fresh owned tab. Never navigate a page the user may have repurposed.
  delete state.workers[module];await save(state);
  if(old?.tabId)notify({workers:{retired:old}});
  return reconcileInner();
 }
 async function removedInner(tabId){
  const state=await load(),found=find(state,tabId);if(!found)return;
  Object.assign(found[1],{tabId:null,closedTabId:tabId,status:'missing',error:'工作页已关闭，请点击恢复',code:'WORKER_CLOSED',retryAt:null});state.revision++;await save(state);notify(state);
 }
 async function updatedInner(tabId,change){
  if(!change.url||/^https:\/\/x\.com\//.test(change.url))return;
  const state=await load(),found=find(state,tabId);if(!found)return;
  const worker=found[1];if(change.url==='about:blank'&&worker.status==='starting')return;
  Object.assign(worker,{status:'blocked',error:'工作页已离开 X，请点击恢复',code:'PAGE_CHANGED',retryAt:null});state.revision++;await save(state);notify(state);
 }
 async function recoverInner({clearWorkers=false}={}){
  const state=await load();state.enabled=false;state.revision++;
  if(state.trial)for(const m of ['interaction','notifications'])finishTrial(state,m,'浏览器或插件重新启动，单轮试跑已终止');
  if(clearWorkers)state.workers={};
  else for(const worker of Object.values(state.workers))if(!['blocked','missing'].includes(worker.status))worker.status='stopped';
  await save(state);await planAlarms(state);notify(state);return view(state);
 }
 return {get:async()=>view(await load()),assignment,authorize,trialStart:(account,requestId,issuedAt,only)=>serial(()=>trialStartInner(account,requestId,issuedAt,only)),trialDone:(module,owner,reason)=>serial(()=>trialDoneInner(module,owner,reason)),
  set:patch=>serial(()=>setInner(patch)),reconcile:()=>serial(reconcileInner),poll:tabId=>serial(()=>pollInner(tabId)),report:(tabId,msg)=>serial(()=>reportInner(tabId,msg)),repair:module=>serial(()=>repairInner(module)),
  removed:tabId=>serial(()=>removedInner(tabId)),updated:(tabId,change)=>serial(()=>updatedInner(tabId,change)),recover:options=>serial(()=>recoverInner(options)),
  focus:async module=>{const state=await load(),worker=state.workers[module];if(!worker||!Number.isInteger(worker.tabId))throw Error('工作页不存在，请先开启或恢复');await tabs.update(worker.tabId,{active:true});return {focused:true};}
 };
}
