// Dedicated verified-followers worker. Only X's own, account-bound follow-back button can be clicked.
(()=>{
 const api=globalThis.XAssistantRuntime,T=globalThis.XAssistantTasks,policy=globalThis.XAssistantServicePolicy;
 const MODULE='followback',KEY='xAssistantFollowbackRuntimeV1',LEDGER='xAssistantFollowbackLedgerV1';
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
 let session=null;
 function checkOwner(account){
  if(globalThis.XAssistantDOM.account()!==account)throw fail('ACCOUNT_CHANGED','当前账号改变，回关已停止');
  if(!policy.isFollowbackPage(location.href,account))throw fail('PAGE_CHANGED','不是当前账号的认证关注者页，回关已停止');
  if(document.querySelector('[role="dialog"],[role="alertdialog"],[data-testid="attachments"],[data-testid="pollCreator"]')||all(document,'[contenteditable="true"]').some(e=>globalThis.XAssistantCore.editorText(e).trim())||all(document,'input[type="file"]').some(e=>e.files?.length))throw fail('RESIDUAL_DRAFT','工作页有弹窗或草稿，未执行回关');
 }
 // Only native, visible status alerts; do not treat arbitrary bio text as a platform limit.
 function followRefused(){
  const rejected=/(?:无法.{0,6}关注|不能.{0,6}关注|暂(?:时)?(?:无法|不能)关注|達到.{0,10}跟隨上限|达(?:到|到了).{0,10}(?:关注|操作)(?:数量|人数|次数|频率)?上限|关注.{0,10}(?:上限|过快|过于频繁|限制)|操作(?:过于)?频繁|unable to follow|cannot follow|can[’']t follow|follow(?:ing)? limit|temporarily (?:limited|restricted) from following|rate limit exceeded|フォロー.{0,8}(?:上限|制限|できません))/iu;
  return all(document,'[data-testid="toast"],[role="alert"]').filter(live).some(e=>rejected.test(clean(e.textContent)));
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
 function next(rows,records,account){
  const excluded=new Set();for(const [key,r] of Object.entries(records||{})){if(!['in_flight','confirmed','unknown'].includes(r?.status))continue;excluded.add(key.toLowerCase());if(r.targetId)excluded.add(String(r.targetId));}
  const counts=new Map();for(const r of rows){for(const k of [r.target,r.targetId])counts.set(k,(counts.get(k)||0)+1);}
  return rows.find(r=>!r.followed&&r.target.slice(1)!==account.slice(1)&&!excluded.has(r.target)&&!excluded.has(r.targetId)&&counts.get(r.target)===1&&counts.get(r.targetId)===1);
 }
 const tell=(s,step,until)=>globalThis.XAssistantWorkspace.progress(step,until?{until}:{});
 async function scan(s){
  check(s);
  const surface=await T.waitForPage(()=>list(s.account),{signal:s.signal,timeout:15000});if(!surface)throw fail('FOLLOWBACK_LIST','未核实认证关注者列表或所选标签，未执行回关');
  const records=(await api.storage.get(LEDGER))[LEDGER]?.[s.account]||{};
  for(let i=0;i<5;i++){
   check(s);const mounted=list(s.account);if(!mounted)throw fail('FOLLOWBACK_LIST','认证关注者列表已变化，未执行回关');
   const row=next(rows(mounted),records,s.account);if(row)return {target:row.target,targetId:row.targetId};
   if(recommendation(mounted)){if(window.scrollY>0)window.scrollTo(0,0);break;}
   if(i===4)break;
   const at=window.scrollY;
   window.scrollBy(0,Math.max(300,Math.round(window.innerHeight*.8)));await api.sleep(650,s.signal);check(s);
   if(window.scrollY===at){if(at>0)window.scrollTo(0,0);break;}
  }
  return null;
 }
 async function transact(s,target){
  const bind={module:MODULE,runId:s.runId,account:s.account,target:target.target,targetId:target.targetId};
  let claim,button,clicked=false,clickedAt;
  const settle=(outcome,receipt)=>api.call({kind:'FOLLOWBACK_SETTLE',...bind,claimId:claim.claimId,outcome,...(receipt?{receipt}:{})});
  const valid=()=>{check(s);if(followRefused())throw fail('FOLLOW_LIMIT','X 显示无法关注或操作受限，回关已停止');const row=locate(s.account,target,false);if(!row)throw fail('FOLLOWBACK_ROW_CHANGED','认证关注者行或回关按钮已变化，未操作');return row.button;};
  try{
   await globalThis.XAssistantActions.click({module:MODULE,runId:s.runId,account:s.account,kind:'follow',signal:s.signal,
    beforeClick:async()=>{valid();claim=await api.call({kind:'FOLLOWBACK_RESERVE',...bind});if(!claim?.claimed)throw fail('FOLLOWBACK_SEEN','这个账号已有处理记录，已跳过');},
    validate:()=>{button=valid();},click:()=>{clicked=true;clickedAt=Date.now();button.click();}});
  }catch(e){
   if(!clicked){const release=claim?.claimed?await settle('released'):null;if(['FOLLOWBACK_SEEN','FOLLOWBACK_ROW_CHANGED'].includes(e.code))return release?.nextAt;throw e;}
   // The native click may have succeeded even when its ACK or action lease was lost.
  }
  // Read-only after click, even on Stop. A generic toast, another row, a partial handle,
  // a recycled numeric ID or a pending follow request is never confirmation.
  let ok=false,refused=false,observer,consistent=true;const end=clickedAt+10000;
  const matches=()=>{
   if(followRefused()){refused=true;throw fail('FOLLOW_LIMIT','X 拒绝关注');}
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
   try{await settle('unknown');}catch{}
   throw fail('SEND_UNKNOWN',(refused?'X 提示无法关注或操作受限；':'')+'回关 '+target.target+' 的结果未确认，已暂停且不会自动重试',{submitted:true});
  }
  try{return (await settle('confirmed',{kind:'following',target:target.target,targetId:target.targetId})).nextAt;}
  catch(e){throw fail('FOLLOWBACK_SETTLE_FAILED','已看到 '+target.target+' 的已关注状态，但保存回执未确认，已停止',{submitted:true,confirmed:true});}
 }
 async function loop(s,started){
  await globalThis.XAssistantWorkspace.ready;s.account=globalThis.XAssistantDOM.account();
  check(s);
  const run=await api.runtime(MODULE,'begin',{account:s.account});s.runId=run.runId;started({runId:run.runId,account:s.account});
  let nextAt=run.nextAt;
  for(;;){
   check(s);
   // The background samples one persistent 55–70 s deadline; tick once, never catch up.
   if(!Number.isFinite(nextAt)||nextAt<=Date.now())
    nextAt=(await api.call({kind:'FOLLOWBACK_WAIT',module:MODULE,account:s.account,runId:s.runId})).nextAt;
   if(!Number.isFinite(nextAt)||nextAt<=Date.now())throw fail('FOLLOWBACK_SCHEDULE','回关计时未确认，已停止');
   await patch(s,{phase:'waiting',nextAt});tell(s,'等待下一次回关检查',nextAt);
   while(Date.now()<nextAt){await api.sleep(nextAt-Date.now(),s.signal);check(s);}
   await patch(s,{phase:'followback_scan',nextAt:null});tell(s,'正在检查认证关注者');
   const target=await scan(s);nextAt=null;if(target){tell(s,'正在核对回关 '+target.target);nextAt=await transact(s,target);}
  }
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
 globalThis.XAssistantFollowbackDriver={start,stop,isRunning:()=>!!session};
})();
