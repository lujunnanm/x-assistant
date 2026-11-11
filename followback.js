// Dedicated verified-followers worker. Only X's own, account-bound follow-back button can be clicked.
(()=>{
 const api=globalThis.XAssistantRuntime,T=globalThis.XAssistantTasks,policy=globalThis.XAssistantServicePolicy;
 const MODULE='followback',KEY='xAssistantFollowbackRuntimeV1',LEDGER='xAssistantFollowbackLedgerV1',SWEEP='xAssistantFollowbackSweepV1';
 const fail=(code,message,props={})=>Object.assign(Error(message),{code,...props});
 const all=(root,selector)=>Array.from(root.querySelectorAll(selector));
 const live=e=>!!e?.isConnected&&!e.closest('[hidden],[inert],[aria-hidden="true"]');
 const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
 const unique=nodes=>nodes.length===1?nodes[0]:null;
 const relation=/^(关注了你|跟隨你|跟随你|正在跟隨你|Follows you|フォローされています)$/iu;
 const tabName=/^(认证关注者|已認證的跟隨者|已認證跟隨者|Verified followers|認証済みのフォロワー|認証済みフォロワー)$/iu;
 const headingName=/^(时间线|時間軸|Timeline|タイムライン)\s*[:：]\s*/iu;
 const handleName=/^@[a-z\d_]{1,15}$/i;
 const cellSel='[data-testid="UserCell"]';
 let session=null,reviewFlight=null;
 function checkOwner(account){
  if(globalThis.XAssistantDOM.account()!==account)throw fail('ACCOUNT_CHANGED','当前账号改变，回关已停止');
  if(!policy.isFollowbackPage(location.href,account))throw fail('PAGE_CHANGED','不是当前账号的认证关注者页，回关已停止');
  if(document.querySelector('[role="dialog"],[role="alertdialog"],[data-testid="attachments"],[data-testid="pollCreator"]')||all(document,'[contenteditable="true"]').some(e=>globalThis.XAssistantCore.editorText(e).trim())||all(document,'input[type="file"]').some(e=>e.files?.length))throw fail('RESIDUAL_DRAFT','工作页有弹窗或草稿，未执行回关');
 }
 // Only native, visible status alerts; do not treat arbitrary bio text as a platform limit.
 function followRefused(){
  const rejected=/(?:无法.{0,6}关注|不能.{0,6}关注|暂(?:时)?(?:无法|不能)关注|達到.{0,10}跟隨上限|达(?:到|到了).{0,10}(?:关注|操作)(?:数量|人数|次数|频率)?上限|关注.{0,10}(?:上限|过快|过于频繁|限制)|操作(?:过于)?频繁|unable to follow|cannot follow|can[’']t follow|follow(?:ing)? limit|temporarily (?:limited|restricted) from following|rate limit exceeded|フォロー.{0,8}(?:上限|制限|できません))/iu;
  const alerts=all(document,'[data-testid="toast"],[role="alert"]').filter(live).map(e=>clean(e.textContent));
  // A relationship/account cap is not a temporary rate limit.
  const rate=/rate limit|too many requests|following too (?:quickly|fast)|too many (?:follow|people).{0,40}(?:short|hour|day)|(?:关注|操作|请求).{0,8}(?:过于频繁|过快)|速率限制|频率限制|频次限制/iu;
  if(alerts.some(text=>rate.test(text)))return 'FOLLOW_RATE_LIMIT';
  return alerts.some(text=>rejected.test(text))?'FOLLOW_LIMIT':null;
 }
 function list(account){
  checkOwner(account);
  const primary=unique(all(document,'[data-testid="primaryColumn"]').filter(live));if(!primary)return null;
  const active=unique(all(primary,'a[role="tab"][aria-selected="true"]').filter(live));
  if(!active||!policy.isFollowbackPage(active.href,account)||!tabName.test(clean(active.textContent)))return null;
  const regions=all(primary,'section[role="region"]').filter(live),lists=[];
  for(const region of regions){
   const heading=unique(all(region,'h1,h2').filter(h=>h.closest('section[role="region"]')===region&&tabName.test(clean(h.textContent))));
   if(!heading?.id||!(region.getAttribute('aria-labelledby')||'').split(/\s+/).includes(heading.id))continue;
   for(const node of all(region,'div[aria-label]')){
    if(!live(node)||node.closest('section[role="region"]')!==region)continue;
    const label=clean(node.getAttribute('aria-label'));if(headingName.test(label)&&tabName.test(label.replace(headingName,'')))lists.push(node);
   }
  }
  return unique(lists);
 }
 function describe(cell){
  if(!live(cell)||!cell.matches('button[role="button"][data-testid="UserCell"]')||cell.closest('article,aside,[role="complementary"],[data-testid="recommendation"],[data-testid="connectModule"]'))return null;
  const wrapper=cell.closest('[data-testid="cellInnerDiv"]');if(!wrapper||unique(all(wrapper,cellSel).filter(live))!==cell)return null;
  const inside=s=>all(cell,s).filter(e=>live(e)&&e.closest(cellSel)===cell);
  const avatar=unique(inside('[data-testid^="UserAvatar-Container-"]'));if(!avatar)return null;
  const handle='@'+avatar.getAttribute('data-testid').slice('UserAvatar-Container-'.length).toLowerCase();
  if(!handleName.test(handle))return null;
  const path='/'+handle.slice(1);
  const profileLinks=inside('a[href]').filter(a=>{try{const u=new URL(a.href);return u.origin==='https://x.com'&&u.pathname.toLowerCase()===path&&!u.search&&!u.hash;}catch{return false;}});
  if(!profileLinks.some(a=>clean(a.textContent).toLowerCase()===handle))return null;
  // A badge or handle in someone's bio does not authenticate this UserCell.
  const badge=unique(inside('[data-testid="icon-verified"]').filter(b=>profileLinks.includes(b.closest('a[href]'))));if(!badge)return null;
  const follower=unique(inside('[data-testid="userFollowIndicator"]'));if(!follower||!relation.test(clean(follower.textContent)))return null;
  const button=unique(inside('button[data-testid$="-follow"],button[data-testid$="-unfollow"]'));
  if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return null;
  const match=/^(\d+)-(unfollow|follow)$/.exec(button.getAttribute('data-testid')||'');if(!match)return null;
  const followed=match[2]==='unfollow',text=clean(button.textContent),aria=clean(button.getAttribute('aria-label'));
  const word=followed?'(?:正在关注|正在跟隨|正在跟随|已关注|已關注|Following|フォロー中)':'(?:回关|回關|跟隨回去|Follow back|フォローバック)';
  const ariaWord=followed?'(?:正在关注|取消关注|正在跟隨|正在跟随|取消跟隨|已关注|已關注|Following|Unfollow|フォロー中)':word;
  if(!new RegExp('^'+word+'$','iu').test(text)||!new RegExp('^(?:'+ariaWord+'\\s*'+handle+'|'+handle+'\\s*(?:を)?'+ariaWord+')$','iu').test(aria))return null;
  return {target:handle,targetId:match[1],followed,button,cell};
 }
 const recommendation=surface=>all(surface,'h1,h2,h3,[role="heading"]').find(e=>live(e)&&/^(?:推荐关注|推荐用户|你可能喜欢|為你推薦|Who to follow|You might like|Suggested for you|おすすめユーザー)$/iu.test(clean(e.textContent)));
 function rows(surface){
  const boundary=recommendation(surface);
  return all(surface,cellSel).filter(e=>e.closest('section[role="region"]')===surface.closest('section[role="region"]')&&(!boundary||!!(e.compareDocumentPosition(boundary)&4))).map(describe).filter(Boolean);
 }
 function locate(account,target,followed){
  const surface=list(account);if(!surface)return null;
  const match=unique(rows(surface).filter(r=>r.target===target.target||r.targetId===target.targetId));
  return match&&match.target===target.target&&match.targetId===target.targetId&&match.followed===followed?match:null;
 }
 const check=s=>{api.check(s.signal);checkOwner(s.account);};
 const patch=(s,value)=>api.runtime(MODULE,'patch',{runId:s.runId,patch:value});
 function next(rows,records,account,withinRange=()=>true){
  const excluded=new Set();for(const [key,r] of Object.entries(records||{})){if(!['in_flight','confirmed','unknown'].includes(r?.status))continue;excluded.add(key.toLowerCase());if(r.targetId)excluded.add(String(r.targetId));}
  const counts=new Map();for(const r of rows){for(const k of [r.target,r.targetId])counts.set(k,(counts.get(k)||0)+1);}
  return rows.find(r=>withinRange(r)&&!r.followed&&r.target.slice(1)!==account.slice(1)&&!excluded.has(r.target)&&!excluded.has(r.targetId)&&counts.get(r.target)===1&&counts.get(r.targetId)===1);
 }
 const tell=(s,step,until)=>globalThis.XAssistantWorkspace.progress(step,until?{until}:{});
 async function scan(s){
  check(s);
  const surface=await T.waitForPage(()=>list(s.account),{signal:s.signal,timeout:15000});if(!surface)throw fail('FOLLOWBACK_LIST','未核实认证关注者列表或所选标签，未执行回关');
  // A new traversal starts at the top even if X restored a scrolled page.
  // Keep the cursor between confirmed follows and bounded scan batches.
  const cursor=s.forwardScan??={fromTop:true,stable:0,progress:null,steps:0,stagnantMs:0,confirmed:false};
  const headScreens=6; // The first viewport counts as one screen.
  const sample=()=>{
   check(s);const mounted=list(s.account);if(!mounted)throw fail('FOLLOWBACK_LIST','认证关注者列表已变化，未执行回关');
   const scroller=document.scrollingElement||document.documentElement,y=window.scrollY,height=scroller?.scrollHeight,viewport=window.innerHeight;
   if(!Number.isFinite(height)||!Number.isFinite(y)||!Number.isFinite(viewport)||viewport<=0)
    throw fail('FOLLOWBACK_SCROLL','无法核对关注者列表滚动位置，未执行回关');
   const region=mounted.closest('section[role="region"]')||mounted;
   const loading=all(region,'[role="progressbar"],[role="progressindicator"],[aria-busy="true"],[data-testid="progressBar"]').some(live);
   const retry=all(region,'button').filter(live).some(e=>!e.closest(cellSel)&&/^(?:重试|重試|重新加载|Try again|Retry)$/iu.test(clean(e.textContent)));
   if(retry)throw fail('FOLLOWBACK_LOADING','X 关注者列表加载失败，未执行回关');
   const boundary=recommendation(mounted),atEnd=boundary?boundary.getBoundingClientRect().top<=viewport:y+viewport>=height-2;
   // Raw rows include ineligible followers: they must still count as list growth.
   const raw=all(mounted,cellSel).filter(c=>!boundary||!!(c.compareDocumentPosition(boundary)&4));
   const signature=[y,height,loading,atEnd,raw.map(c=>c.textContent).join('\n')].join('|');
   return {mounted,y,viewport,loading,atEnd,signature};
  };
  // End stability is only needed to declare exhaustion, not to use a row.
  for(let i=0;i<24;i++){
   const view=sample(),moved=cursor.progress!==view.signature;
   if(moved){
    cursor.progress=view.signature;cursor.stagnantMs=0;cursor.steps++;
    tell(s,'正在从前往后检查关注者 · '+cursor.steps);
   }else if(cursor.stagnantMs>30000&&(view.loading||!view.atEnd||cursor.fromTop&&view.y>1)){
    throw fail('FOLLOWBACK_LOADING','关注者列表加载或滚动停滞，未执行回关');
   }
   if(cursor.fromTop&&view.y>1){
    check(s);window.scrollTo({top:0,behavior:'instant'});
   }else{
    cursor.fromTop=false;
    if(!view.loading){
     const records=(await api.storage.get(LEDGER))[LEDGER]?.[s.account]||{};
     check(s);
     const lastTop=s.headOnly?(headScreens-1)*view.viewport:Infinity;
     // X can mount rows beyond the viewport; don't accept prefetched rows past the cap.
     const row=next(rows(view.mounted).filter(r=>!s.skippedTargets?.has(r.target)&&!s.skippedTargets?.has(r.targetId)),records,s.account,
      r=>!s.headOnly||r.cell.getBoundingClientRect().top+window.scrollY<lastTop+view.viewport);
     if(row){cursor.stable=0;return {target:row.target,targetId:row.targetId};}
     if(!view.atEnd){
      if(view.y>=lastTop){s.forwardScan=null;tell(s,'前 6 屏暂无待回关账号，下轮从顶部开始');return null;}
      const step=s.headOnly?view.viewport:Math.max(1,Math.round(view.viewport*.8));
      check(s);window.scrollBy({top:Math.min(step,lastTop-view.y),behavior:'instant'});
     }
    }
    cursor.stable=view.atEnd&&!view.loading?(moved?1:cursor.stable+1):0;
    if(cursor.stable>=6){
     if(!cursor.confirmed&&!s.sweep)s.headOnly=true;
     s.forwardScan=null;tell(s,'从前往后检查完成，暂无待回关账号');return null;
    }
   }
   const waitingAt=Date.now();await api.sleep(900,s.signal);check(s);cursor.stagnantMs+=Math.max(0,Date.now()-waitingAt);
  }
  return null;
 }
 async function transact(s,target){
  const bind={module:MODULE,runId:s.runId,account:s.account,target:target.target,targetId:target.targetId};
  let claim,button,clicked=false,clickedAt;
  const settle=(outcome,receipt)=>api.call({kind:'FOLLOWBACK_SETTLE',...bind,claimId:claim.claimId,outcome,...(receipt?{receipt}:{})});
  const valid=()=>{check(s);const refusal=followRefused();if(refusal)throw fail(refusal,refusal==='FOLLOW_RATE_LIMIT'?'X 关注频率受限，30 分钟后恢复':'X 显示无法关注或操作受限，回关已停止');const row=locate(s.account,target,false);if(!row)throw fail('FOLLOWBACK_ROW_CHANGED','认证关注者行或回关按钮已变化，未操作');return row.button;};
  try{
   await globalThis.XAssistantActions.click({module:MODULE,runId:s.runId,account:s.account,kind:'follow',signal:s.signal,
    beforeClick:async()=>{valid();claim=await api.call({kind:'FOLLOWBACK_RESERVE',...bind});if(!claim?.claimed)throw fail('FOLLOWBACK_SEEN','这个账号已有处理记录，已跳过');},
    validate:()=>{button=valid();},click:()=>{clicked=true;clickedAt=Date.now();button.click();}});
  }catch(e){
   if(!clicked){if(claim?.claimed)await settle('released');if(['FOLLOWBACK_SEEN','FOLLOWBACK_ROW_CHANGED'].includes(e.code))return {status:'skipped_unsent'};throw e;}
   // The native click may have succeeded even when its ACK or action lease was lost.
  }
  // Read-only after click, even on Stop. A generic toast, another row, a partial handle,
  // a recycled numeric ID or a pending follow request is never confirmation.
  let ok=false,refused=false,observer,consistent=true;const end=clickedAt+10000;
  const matches=()=>{
   const refusal=followRefused();if(refusal){refused=refusal;throw fail(refusal,'X 拒绝关注');}
   return !!locate(s.account,target,true);
  };
  try{
   if(Date.now()+1000<=end&&await T.waitForPage(matches,{timeout:Math.max(0,end-Date.now()-1000)})){
    if(globalThis.MutationObserver&&document.documentElement){
     observer=new MutationObserver(()=>{try{if(!matches())consistent=false;}catch{consistent=false;}});
     observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['aria-label','aria-selected','aria-hidden','data-testid','hidden','disabled','href']});
    }
    // A passive second read needs its own background wake (not just a throttled page timer).
    await api.wakeReadOnly(1000);ok=Date.now()<=end&&consistent&&matches();
   }
  }catch{}finally{observer?.disconnect();}
  if(!ok){
   if(refused==='FOLLOW_RATE_LIMIT'){
    // Retain this target as unknown; only subsequent targets may run after cooldown.
    // A failed save must remain an unknown send, not permission to restart.
    let limited;
    try{limited=await settle('rate_limited',{kind:'rate_limit',target:target.target,targetId:target.targetId});}
    catch{throw fail('SEND_UNKNOWN','限流记录保存未确认，保留现场待核对',{submitted:true});}
    throw fail('FOLLOW_RATE_LIMIT','X 关注频率受限，30 分钟后恢复；本次目标保留待核对且不重试',{submitted:true,retryAt:limited?.nextAt});
   }
   try{await settle('unknown');}catch{}
   throw fail('SEND_UNKNOWN',(refused?'X 提示无法关注或操作受限；':'')+'回关 '+target.target+' 的结果未确认，已暂停且不会自动重试',{submitted:true});
  }
  try{const result=await settle('confirmed',{kind:'following',target:target.target,targetId:target.targetId});return {status:'confirmed',nextAt:result.nextAt};}
  catch(e){throw fail('FOLLOWBACK_SETTLE_FAILED','已看到 '+target.target+' 的已关注状态，但保存回执未确认，已停止',{submitted:true,confirmed:true});}
 }
 async function loop(s,started){
  await globalThis.XAssistantWorkspace.ready;s.account=globalThis.XAssistantDOM.account();
  check(s);
  s.sweep=api.storage?.get?(await api.storage.get(SWEEP))[SWEEP]===true:false;
  const run=await api.runtime(MODULE,'begin',{account:s.account});s.runId=run.runId;started({runId:run.runId,account:s.account});
  let nextAt=Number.isFinite(run.nextAt)&&run.nextAt>Date.now()?run.nextAt:null;
  for(;;){
   check(s);
   // The background samples one persistent 55–70 s deadline; tick once, never catch up.
   if(!Number.isFinite(nextAt))
    nextAt=(await api.call({kind:'FOLLOWBACK_WAIT',module:MODULE,account:s.account,runId:s.runId})).nextAt;
   if(!Number.isFinite(nextAt))throw fail('FOLLOWBACK_SCHEDULE','回关计时未确认，已停止');
   await patch(s,{phase:'waiting',nextAt});tell(s,'等待下一次回关检查',nextAt);
   // Spend the existing cooldown on read-only discovery instead of adding a
   // full traversal after it. Keep the forward cursor, never a stale DOM button
   // or a pre-acquired write lease. scan() rechecks the list/ledger at the deadline.
   s.skippedTargets=new Set();
   let exhausted=false,prepared=false;
   while(Date.now()<nextAt){
    check(s);tell(s,'冷却期间预查下一位回关对象',nextAt);
    const candidate=await scan(s);
    if(candidate){prepared=true;break;}
    if(!s.forwardScan){exhausted=true;break;}
   }
   check(s);tell(s,prepared?'已找到下一位回关对象，等待间隔结束':'等待回关间隔结束',nextAt);
   if(exhausted&&s.sweep){tell(s,'认证关注者列表已完整遍历');await api.call({kind:'FOLLOWBACK_SWEEP_DONE',module:MODULE,account:s.account,runId:s.runId});return;}
   while(Date.now()<nextAt){await api.sleep(nextAt-Date.now(),s.signal);check(s);}
   if(exhausted){nextAt=null;continue;}
   await patch(s,{phase:'followback_scan',nextAt:null});tell(s,'正在检查认证关注者');
   for(;;){
    check(s);const target=await scan(s);
    if(!target){
     // A 24-step batch is not a completed round. Finish the traversal or head
     // window without another 55–70 second delay.
     if(s.forwardScan){tell(s,'继续检查待回关账号');continue;}
     if(s.sweep){tell(s,'认证关注者列表已完整遍历');await api.call({kind:'FOLLOWBACK_SWEEP_DONE',module:MODULE,account:s.account,runId:s.runId});return;}
     nextAt=null;break;
    }
    tell(s,'正在核对回关 '+target.target);
    const result=await transact(s,target);
    if(result.status==='confirmed'){
     if(!Number.isFinite(result.nextAt))throw fail('FOLLOWBACK_SCHEDULE','回关已确认，但后续冷却未确认，已停止',{submitted:true,confirmed:true});
     s.forwardScan.confirmed=true;
     nextAt=result.nextAt;break;
    }
    // A positively unsent stale/claimed row is not a success. Skip it for this
    // traversal, try another candidate, and retain all shared action gates.
    s.skippedTargets.add(target.target);s.skippedTargets.add(target.targetId);
    await patch(s,{phase:'followback_scan',nextAt:null});
   }
  }
 }
 async function inspectUnknown(){
  const data=await api.storage.get([KEY,LEDGER]),run=data[KEY];
  if(run?.active||run?.phase!=='unknown'||!/^\/[A-Za-z0-9_]{1,15}$/.test(run?.account||'')||!/^@[A-Za-z0-9_]{1,15}$/.test(run?.text||''))return {resolved:false,reason:'none'};
  checkOwner(run.account);
  const record=data[LEDGER]?.[run.account.toLowerCase()]?.[run.text.toLowerCase()];
  if(!record||!/^\d{1,24}$/.test(record.targetId||'')||!['unknown','in_flight'].includes(record.status))return {resolved:false,reason:'missing'};
  const target={target:record.target.toLowerCase(),targetId:record.targetId},submitted=typeof Date.parse==='function'?Date.parse(run.submittedAt||''):NaN;
  const surface=await T.waitForPage(()=>list(run.account),{timeout:15000});if(!surface)return {resolved:false,reason:'list'};
  let restarted=false;
  const observed=()=>locate(run.account,target,true)?'confirmed':locate(run.account,target,false)?'not_following':null;
  for(let i=0;i<48;i++){
   api.assertContext();checkOwner(run.account);
   const value=observed();
   if(value){
    if(value==='not_following'&&Number.isFinite(submitted)&&Date.now()-submitted<30000)return {resolved:false,reason:'grace'};
    await api.wakeReadOnly(1000);if(observed()!==value)return {resolved:false,reason:'changed'};
    await api.wakeReadOnly(1000);if(observed()!==value)return {resolved:false,reason:'changed'};
    await api.call({kind:'FOLLOWBACK_REVIEW',module:MODULE,account:run.account,runId:run.runId,target:target.target,targetId:target.targetId,outcome:value,
     receipt:{kind:value==='confirmed'?'following':'not_following',target:target.target,targetId:target.targetId}});
    return {resolved:true,outcome:value};
   }
   const scroller=document.scrollingElement||document.documentElement,y=window.scrollY,height=scroller?.scrollHeight,viewport=window.innerHeight;
   if(!Number.isFinite(y)||!Number.isFinite(height)||!Number.isFinite(viewport)||viewport<=0)return {resolved:false,reason:'scroll'};
   const end=y+viewport>=height-2;
   if(end){if(restarted)return {resolved:false,reason:'not_visible'};window.scrollTo({top:0,behavior:'instant'});restarted=true;}
   else window.scrollBy({top:Math.max(1,Math.round(viewport*.8)),behavior:'instant'});
   await api.wakeReadOnly(900);
  }
  return {resolved:false,reason:'not_visible'};
 }
 function reviewUnknown(){
  if(!reviewFlight)reviewFlight=inspectUnknown().finally(()=>{reviewFlight=null;});
  return reviewFlight;
 }
 function announce(running,error){window.dispatchEvent(new CustomEvent('x-assistant-module-state',{detail:{module:MODULE,running,error:error?.message,code:error?.code,submitted:error?.submitted===true,confirmed:error?.confirmed===true}}));}
 async function start(){
  if(session)throw Error('本工作页已在回关');
  const controller=new AbortController(),s={controller,signal:controller.signal,runId:null};session=s;
  let resolve,reject;const started=new Promise((yes,no)=>{resolve=yes;reject=no;});
  s.task=(async()=>{let failure;
   try{await loop(s,result=>{announce(true);resolve(result);});}
   catch(e){failure=e.name==='AbortError'?null:e;reject(e);}
   finally{
    try{if(s.runId)await api.runtime(MODULE,'stop',{runId:s.runId});}catch(e){failure||=e;}
    if(session===s)session=null;announce(false,failure);
   }
  })();return started;
 }
 async function stop(){const s=session;if(s){s.controller.abort();await s.task;}}
 window.addEventListener('pagehide',()=>session?.controller.abort(),{once:true});
 window.addEventListener('x-assistant-invalidate',()=>session?.controller.abort(),{once:true});
 chrome.storage.onChanged.addListener((c,area)=>{const state=c[KEY]?.newValue;if(area==='local'&&c[KEY]&&session?.runId&&(!state?.active||state.runId!==session.runId))session.controller.abort();});
 // Read-only integration diagnostics: never expose controls/handles or issue network requests.
 globalThis.XAssistantFollowbackProbe={inspect:()=>{
  const account=globalThis.XAssistantDOM.account(),surface=list(account);
  if(!surface)return {verifiedList:false};
  const items=rows(surface);return {verifiedList:true,recognized:items.length,following:items.filter(r=>r.followed).length,
   actionable:items.filter(r=>!r.followed&&r.target.slice(1)!==account.slice(1)&&items.filter(o=>o.target===r.target||o.targetId===r.targetId).length===1).length};
 }};
 globalThis.XAssistantFollowbackDriver={start,stop,reviewUnknown,isRunning:()=>!!session};
})();
