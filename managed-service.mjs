import './service-policy.js';
import './interaction-preferences.js';

export const SERVICE_KEY='xAssistantManagedServiceV1';
export const BOUNDARY_ALARM='x-assistant-service-boundary';
export const WATCHDOG_ALARM='x-assistant-service-watchdog';
const MODULES=['posting','interaction','notifications','followback'];
const SEARCH_KEY='xAssistantFriendSearchV1',prefs=globalThis.XAssistantInteractionPrefs;
const validAccount=value=>/^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
const uncertain=state=>['submitting','unknown','deleting'].includes(state?.phase);
const needsReview=state=>state?.phase==='unknown'||(!state?.active&&uncertain(state));
const failure=(code,message)=>Object.assign(Error(message),{code});
const draftBlock=worker=>worker?.status==='blocked'&&['RESIDUAL_DRAFT','RESIDUAL_POPUP'].includes(worker.code);
const draftProof=(state,worker,run)=>({token:worker.token,account:state.account,runId:run?.runId||null});
function canRecheckDraft(state,module,worker,run){
 if(module!=='interaction'||state.trial||!draftBlock(worker)||!Number.isInteger(worker.tabId)||run?.active||uncertain(run))return false;
 if(run?.phase&&run.phase!=='stopped'||run?.account&&validAccount(run.account)!==state.account||run?.owner!=null&&run.owner!==worker.tabId)return false;
 if(run?.submittedAt&&run.receipt?.kind!=='confirmed')return false;
 // New blocks carry explicit settled-operation evidence. A different run may
 // not inherit it; a deliberate null means this failure was not safe to retry.
 if(worker.draftRecovery!==undefined){
  const proof=worker.draftRecovery;
  return !!proof&&proof.token===worker.token&&proof.account===state.account&&proof.runId===(run?.runId||null);
 }
 // Upgrade old persisted blocks only with positive same-owner runtime proof.
 return run?.active===false&&run.phase==='stopped'&&!!run.runId&&run.owner===worker.tabId&&validAccount(run.account)===state.account;
}

// Every mutation is serialized independently of network generation and content scripts.
// Never await a worker response while holding this queue: worker Stop writes runtime state.
export function createManagedService({read,write,tabs,alarms,runtimeFor,retireMissingRun,prepareWorkerRepair,canRecoverPosting=async()=>false,postingReady=async()=>true,now=Date.now,uuid=()=>crypto.randomUUID(),policy=globalThis.XAssistantServicePolicy}){
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
  else if(worker.status==='retrying'||Number(worker.retryAt)>now())reason='RETRY_WAIT';
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
  if(!assignment.shouldRun)throw failure(assignment.reason,assignment.reason==='OUTSIDE_WORKING_HOURS'?'工作时钟无效，当前模块未获运行许可':assignment.reason==='SEND_UNKNOWN'?'上次发送结果待核对，不会自动重发':assignment.reason==='SOURCE_CHANGED'?'互动来源已切换，旧目标不再执行':'当前模块未获运行许可');
  return assignment;
 }
 async function planAlarms(state){
  if(!state.enabled){await alarms.clear?.(BOUNDARY_ALARM);await alarms.clear?.(WATCHDOG_ALARM);watchdogArmed=false;return;}
  if(state.selected.posting){const boundary=policy.nextBoundary(now()),existingBoundary=await alarms.get?.(BOUNDARY_ALARM);
   if(!existingBoundary||existingBoundary.scheduledTime!==boundary)await alarms.create?.(BOUNDARY_ALARM,{when:boundary});
  }else await alarms.clear?.(BOUNDARY_ALARM);
  const watchdog=alarms.get?await alarms.get(WATCHDOG_ALARM):watchdogArmed;
  if(!watchdog||watchdog.periodInMinutes&&watchdog.periodInMinutes!==0.5){await alarms.create?.(WATCHDOG_ALARM,{periodInMinutes:0.5});watchdogArmed=true;}
 }
 async function urlFor(module,account,searchEnabled){
  if(module==='interaction'&&searchEnabled){
   const value=await read(prefs.KEY),index=await read(prefs.INDEX_KEY);
   return 'https://x.com'+prefs.selection(value,index,true).path;
  }
  return 'https://x.com'+(['posting','interaction'].includes(module)?'/home':module==='followback'?account+'/verified_followers':account);
 }
 function lifecycle(state,module,event,worker,extra={}){
  state.workerEvents=[...(state.workerEvents||[]),{at:now(),module,event,tabId:worker?.tabId??worker?.closedTabId??null,...extra}].slice(-40);
 }
 async function recoveryProof(state,module,worker,run){
  return module==='posting'&&!state.trial&&state.enabled&&state.selected.posting&&
   worker?.status!=='blocked'&&run?.active===true&&run.phase==='waiting'&&
   run.owner===worker.tabId&&run.account===state.account&&!!run.runId&&
   !run.error&&(!run.submittedAt||run.receipt?.kind==='confirmed')&&await canRecoverPosting(run);
 }
 async function markMissing(state,module,worker,run,source,extra={}){
  const safe=await recoveryProof(state,module,worker,run);
  lifecycle(state,module,source,worker,{phase:run?.phase||null,...extra});
  Object.assign(worker,{closedTabId:worker.tabId,tabId:null,status:'missing',code:'WORKER_CLOSED',error:'工作页不可用，请点击恢复',retryAt:null,
   recoveryProof:safe?{owner:run.owner,runId:run.runId,account:run.account}:null,recoverAt:safe?now()+15000:null});
 }
 async function createWorker(state,module){
  // A blank tab cannot execute extension content scripts before ownership is persisted.
  const previous=state.workers[module],token=uuid(),worker={autoRecoveryTimes:previous?.autoRecoveryTimes||[],tabId:null,token,status:'starting',error:null,code:null,retryAt:null,retryAttempts:0,createdAt:now(),lastSeen:0};
  state.workers[module]=worker;await save(state);
  let tab;
  try{
   tab=await tabs.create({url:'about:blank',active:false});
   if(!Number.isInteger(tab?.id))throw Error('工作页创建失败');
   worker.tabId=tab.id;await save(state);
   // The operator can switch the source while the initial blank tab is being created.
   if(module==='interaction')state.searchEnabled=(await read(SEARCH_KEY))!==false;
   await tabs.update(tab.id,{url:await urlFor(module,state.account,state.searchEnabled),active:false});
  }catch(error){worker.status='blocked';worker.code='WORKER_CREATE_FAILED';worker.error=error.message||'工作页创建失败';await save(state);}
  return worker;
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
  if(known)await markMissing(state,module,worker,run,'lookup_missing');
  // Legacy tombstones omitted the former tab ID. Check the persisted owner
  // itself, its account, and that no different worker now owns that tab.
  if(run?.active&&run.owner===id&&validAccount(run.account)===state.account&&run.runId&&
    !Object.entries(state.workers).some(([name,w])=>name!==module&&w.tabId===id)){
   await retireMissingRun?.(module,run);
  }
  if(!known)return {};
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
   if(worker&&(runtime?.active||wanted&&!['blocked','missing'].includes(worker.status)||wanted&&canRecheckDraft(state,module,worker,runtime)||wanted&&module==='followback'&&needsReview(runtime))){
    const found=await inspectOwnedTab(state,module,worker,runtime);tab=found.tab;changed=changed||!!found.changed;
    if(!tab&&runtime?.active)runtime=await runtimeFor(module);
   }
   if(!wanted)continue;
   if(needsReview(runtime)){
    if(module==='followback'){
     let review=worker;
     if(!tab){review=await createWorker(state,module);changed=true;}
     if(review&&review.code!=='SEND_UNKNOWN'){Object.assign(review,{status:'blocked',code:'SEND_UNKNOWN',error:'正在自动核对上次回关结果，不会重复关注',retryAt:null});changed=true;}
    }else{
     if(worker&&worker.code!=='SEND_UNKNOWN'){Object.assign(worker,{status:'blocked',code:'SEND_UNKNOWN',error:'上次发送结果待核对，不会自动重发',retryAt:null});changed=true;}
     if(!worker){state.workers[module]={tabId:null,token:uuid(),status:'blocked',code:'SEND_UNKNOWN',error:'上次发送结果待核对，不会自动重发',retryAt:null};changed=true;}
    }
    continue;
   }
   if(module==='followback'&&worker?.status==='blocked'&&worker.code==='SEND_UNKNOWN'){
    Object.assign(worker,{status:'stopped',code:null,error:null,retryAt:null});changed=true;
   }
   if(!worker){await createWorker(state,module);continue;}
   if(worker.status==='missing'&&worker.recoveryProof&&worker.recoverAt<=now()){
    const proof=worker.recoveryProof,attempts=(worker.autoRecoveryTimes||[]).filter(t=>now()-t<3600000);
    if(runtime?.active||runtime?.phase!=='stopped'||runtime.owner!==proof.owner||runtime.runId!==proof.runId||runtime.account!==proof.account||
      proof.account!==state.account||attempts.length>=3||!await canRecoverPosting(runtime))continue;
    worker.autoRecoveryTimes=[...attempts,now()];lifecycle(state,module,'auto_recreate',worker);
    await createWorker(state,module);continue;
   }
   const recheckDraft=canRecheckDraft(state,module,worker,runtime);
   if(worker.status==='retrying'||recheckDraft){
    if(Number(recheckDraft?worker.draftRecheckAt:worker.retryAt)>now()||runtime?.active)continue;
    // The backend owns the restart: never let an old page race the repair.
    // Missing tabs stay missing; automatic recovery does not spawn windows.
    if(!tab)continue;
    if(changed)await save(state);
    try{await repairInner(module,{sameTabOnly:true});}catch(e){
     const latest=await load(),failed=latest.workers[module];
     if(failed){
      Object.assign(failed,{status:'blocked',code:e.code||'WORKER_REPAIR_FAILED',error:e.message,retryAt:null});
      const recheck=module==='interaction'&&!latest.trial&&draftBlock(failed);
      Object.assign(failed,{draftRecovery:recheck?draftProof(latest,failed,runtime):null,draftRecheckAt:recheck?now()+30000:null});
      await save(latest);notify(latest);
     }
    }
    return reconcileInner();
   }
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
   const retryBase=now(),reportedRetryAt=Number(msg.retryAt),runtimeRetryAt=msg.module==='followback'&&msg.code==='FOLLOW_RATE_LIMIT'?Number(runtime?.nextAt):NaN;
   const retryDeadline=Math.max(retryBase+classification.delay,Number.isFinite(reportedRetryAt)?reportedRetryAt:0,Number.isFinite(runtimeRetryAt)?runtimeRetryAt:0);
   if(!uncertain(runtime)&&(['SERVICE_DISABLED','MODULE_DISABLED','SOURCE_CHANGED','OUTSIDE_WORKING_HOURS','OUTSIDE_WINDOW'].includes(msg.code)||classification.reason==='cancelled')){
    if(!['blocked','missing','retrying'].includes(worker.status))Object.assign(worker,{status:'stopped',error:null,code:null,retryAt:null});
   }else if(!state.trial&&msg.status==='error'&&(msg.submitted===false||msg.confirmed===true||msg.module==='followback'&&msg.code==='FOLLOW_RATE_LIMIT')&&!uncertain(runtime)&&classification.retryable){
    Object.assign(worker,{status:'retrying',error:message,code:msg.code||'TRANSIENT_FAILURE',retryAttempts:attempt,retryAt:worker.status==='retrying'&&worker.retryAt?Math.max(worker.retryAt,classification.reason==='rate_limit'&&worker.retryReason!=='rate_limit'?retryDeadline:worker.retryAt):retryDeadline,retryReason:classification.reason});
   }else Object.assign(worker,{status:'blocked',error:message,code:uncertain(runtime)?'SEND_UNKNOWN':msg.code||'WORKER_BLOCKED',retryAt:null});
  }
  if(msg.status!=='stopped'){
   const run=await runtimeFor(msg.module),recheck=msg.module==='interaction'&&!state.trial&&draftBlock(worker)&&!uncertain(run)&&(msg.submitted===false||msg.confirmed===true);
   Object.assign(worker,{draftRecovery:recheck?draftProof(state,worker,run):null,draftRecheckAt:recheck?now()+30000:null});
  }
  if(worker.status==='blocked')finishTrial(state,msg.module,worker.error||worker.code);
  await save(state);await planAlarms(state);notify(state);return view(state);
 }
 async function repairInner(module,{sameTabOnly=false}={}){
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
  if(!state.enabled)return view(state);
  let tab;
  if(Number.isInteger(old?.tabId)){
   try{tab=await tabs.get(old.tabId);}catch(e){
    if(!new RegExp('^No tab with id: '+old.tabId+'[.]?$','i').test(e?.message||''))throw e;
   }
  }
  state.revision++;
  if(tab){
   // Keep the same tab/window, but retire the failed task's token before navigation.
   // A draft or an unreadable page is not permission to create another worker.
   if(!prepareWorkerRepair)throw Error('无法检查原工作页，请刷新扩展后重试');
   await prepareWorkerRepair(tab,state.account);
   let url=await urlFor(module,state.account,state.searchEnabled);
   const current=new URL(tab.url);
   if(module==='interaction'&&state.searchEnabled&&current.origin==='https://x.com'&&current.pathname==='/search'&&
      current.searchParams.get('q')?.trim()&&['','top','live'].includes(current.searchParams.get('f')||''))url=tab.url;
   if(sameTabOnly){
    const latest=await runtimeFor(module);
    if(uncertain(latest))throw failure('SEND_UNKNOWN','上次发送结果待核对，不会自动重发');
    if(latest?.active||latest?.runId!==runtime?.runId||latest?.owner!==runtime?.owner||latest?.account!==runtime?.account||draftBlock(old)&&!canRecheckDraft(state,module,old,latest))
     throw failure('WORKER_REPAIR_FAILED','预检期间运行状态发生变化，请核对后恢复');
   }
   const worker={...old,token:uuid(),status:'blocked',code:'WORKER_REPAIRING',error:null,
    retryAt:null,retryAttempts:0,createdAt:now(),lastSeen:0,recoveryProof:null,recoverAt:null,draftRecovery:null,draftRecheckAt:null};
   state.workers[module]=worker;await save(state);
   try{await tabs.update(tab.id,{url,active:false});}
   catch(e){worker.code='WORKER_REPAIR_FAILED';worker.error=e.message||'原工作页恢复失败';await save(state);notify(state);throw e;}
   Object.assign(worker,{status:'starting',code:null});lifecycle(state,module,'repair_in_place',worker);
   await save(state);notify(state);return view(state);
  }
  if(sameTabOnly)throw failure('WORKER_CLOSED','原工作页已关闭，自动恢复不会新建页面');
  // Only a positively missing original tab requires a new page.
  delete state.workers[module];await save(state);
  if(old?.tabId)notify({workers:{retired:old}});
  return reconcileInner();
 }
 async function removedInner(tabId,info={}){
  const state=await load(),found=find(state,tabId);if(!found)return;
  await markMissing(state,found[0],found[1],await runtimeFor(found[0]),'tab_removed',{isWindowClosing:info.isWindowClosing===true});state.revision++;await save(state);notify(state);
 }
 async function replacedInner(addedTabId,removedTabId){
  const state=await load(),found=Object.entries(state.workers).find(([,w])=>w.tabId===removedTabId||w.closedTabId===removedTabId);
  if(!found||!Number.isInteger(addedTabId)||find(state,addedTabId))return;
  const [module,worker]=found,run=await runtimeFor(module);
  let tab;try{tab=await tabs.get(addedTabId);}catch{return;}
  // Only an explicit browser replacement can transfer ownership. Never adopt a random home tab.
  const proof=worker.recoveryProof;
  const safe=await recoveryProof(state,module,worker,run)||module==='posting'&&state.enabled&&state.selected.posting&&!state.trial&&
   worker.status==='missing'&&proof&&run?.active===false&&run.phase==='stopped'&&run.owner===proof.owner&&
   run.runId===proof.runId&&run.account===proof.account&&state.account===proof.account&&await canRecoverPosting(run);
  const route=tab.url==='https://x.com/home'&&(!tab.pendingUrl||tab.pendingUrl==='https://x.com/home');
  lifecycle(state,module,'tab_replaced',worker,{addedTabId,removedTabId,phase:run?.phase||null});
  Object.assign(worker,{tabId:addedTabId,closedTabId:removedTabId,token:uuid(),createdAt:now(),lastSeen:0,
   status:safe&&route?'starting':'blocked',code:safe&&route?null:uncertain(run)?'SEND_UNKNOWN':'WORKER_REPLACED',
   error:safe&&route?null:'工作页已替换，原任务需核对后恢复',recoveryProof:null,recoverAt:null,retryAt:null});
  state.revision++;await save(state);notify(state);
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
  removed:(tabId,info)=>serial(()=>removedInner(tabId,info)),replaced:(added,removed)=>serial(()=>replacedInner(added,removed)),updated:(tabId,change)=>serial(()=>updatedInner(tabId,change)),recover:options=>serial(()=>recoverInner(options)),
  focus:async module=>{const state=await load(),worker=state.workers[module];if(!worker||!Number.isInteger(worker.tabId))throw Error('工作页不存在，请先开启或恢复');await tabs.update(worker.tabId,{active:true});return {focused:true};}
 };
}
