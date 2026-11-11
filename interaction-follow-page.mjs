// Injected only into the queue-owned tab; never into the interaction timeline.
export async function interactionFollowPage(row,mode,permit){
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const self=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
 const drafts=()=>!!document.querySelector('[role="dialog"],[role="alertdialog"],[data-testid="attachments"],[data-testid="pollCreator"]')||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.textContent.trim())||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length);
 if(mode==='canNavigate')return {safe:self()===row.account&&!drafts()};
 if(location.href!==row.url||self()!==row.account||drafts())return {state:self()?'invalid':'loading',clicked:false,error:'关注目标、登录账号或页面状态不匹配'};
 const allowed=async()=>{
  const values=await chrome.storage.local.get(['xAssistantManagedServiceV1','xAssistantAutoFollowV1','xAssistantRuntimeV1','xAssistantActionGateV1','xAssistantFollowbackLedgerV1']);
  const s=values.xAssistantManagedServiceV1,r=values.xAssistantRuntimeV1;
  return {ok:s?.enabled&&s.selected?.interaction&&s.account===row.account&&r?.active&&r.account===row.account&&s.workers?.interaction?.tabId===r.owner&&values.xAssistantAutoFollowV1!==false,values};
 };
 const post=()=>[...document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')].map(a=>globalThis.XAssistantDOM?.post(a)).filter(p=>p&&p.id===row.postId&&p.author.toLowerCase()===row.author);
 const posts=post();if(posts.length!==1)return {state:'loading',clicked:false};
 const caret=posts[0].article.querySelector('[data-testid="caret"]');if(!caret)return {state:'loading',clicked:false};
 const own=t=>new RegExp('@'+row.author+'(?![A-Za-z0-9_])','i').test(t);
 const readMenu=()=>{
  const held=globalThis.__sacredFollowQueueMenu,menu=document.querySelector('[role="menu"]');
  if(held?.id!==row.id||held.menu!==menu||!menu)return null;
  const matches=[...menu.querySelectorAll('[role="menuitem"]')].filter(e=>own(e.textContent||'')&&/^(关注|回关|取消关注|Follow back|Follow|Unfollow)\s/i.test(e.textContent.trim()));
  if(matches.length!==1)return null;
  const button=matches[0],match=/^(\d+)-(unfollow|follow)$/.exec(button.getAttribute('data-testid')||'');
  if(button.disabled||button.getAttribute('aria-disabled')==='true')return null;
  const followed=/^(取消关注|Unfollow)\s/i.test(button.textContent.trim());
  if(match&&(match[2]==='unfollow')!==followed)return null;
  return {button,targetId:match?.[1]||null,state:followed?'followed':'unfollowed'};
 };
 const openMenu=async()=>{
  if(readMenu())return;
  if(document.querySelector('[role="menu"]'))throw Error('关注队列菜单已变化');
  caret.click();
  for(let i=0;i<15;i++){
   const menu=document.querySelector('[role="menu"]');
   if(menu){globalThis.__sacredFollowQueueMenu={id:row.id,menu};return;}
   await wait(100);
  }
 };
 if(mode==='prepare'){
  if(!(await allowed()).ok)return {state:'paused'};
  await openMenu();const target=readMenu();
  return target?{state:target.state,targetId:target.targetId}:{state:'loading'};
 }
 if(mode!=='click')throw Error('未知队列操作');
 const auth=await allowed(),gate=auth.values.xAssistantActionGateV1,held=gate?.holder;
 if(!auth.ok)return {state:'paused',clicked:false};
 const target=readMenu(),records=auth.values.xAssistantFollowbackLedgerV1?.[row.account]||{};
 if(records['@'+row.author]||permit.targetId&&Object.values(records).some(r=>r.targetId===permit.targetId))return {state:'invalid',clicked:false,error:'目标已有回关记录'};
 // All final DOM checks and the click are synchronous after the last storage read.
 if(location.href!==row.url||self()!==row.account||drafts()||post().length!==1||!target||target.targetId!==permit.targetId||held?.leaseId!==permit.leaseId||held.runId!==row.id||held.account!==row.account||held.documentId!==permit.documentId||held.kind!=='follow'||held.module!=='interaction'||Date.now()>=held.expiresAt)return {state:'invalid',clicked:false,error:'关注许可或目标已变化'};
 if(target.state==='followed')return {state:'followed',clicked:false};
 target.button.click();
 try{
  for(let i=0;i<20;i++){
   await wait(150);
   if(location.href!==row.url||self()!==row.account)return {state:'unknown',clicked:true};
   if(!document.querySelector('[role="menu"]'))await openMenu();
   if(readMenu()?.state==='followed')return {state:'followed',clicked:true};
  }
 }catch{} // The click happened: observation failure must not authorize a retry.
 return {state:'unknown',clicked:true,error:'关注已点击，未确认结果'};
}
