// Only dismiss; never approve permissions, challenges, purchases or unknown sends.
(()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const dialogs=()=>[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(d=>!d.querySelector('[role="dialog"],[role="alertdialog"]'));
 const draftPattern=/保存[^。！？\n]*(?:草稿|帖子|推文)|Save[^.!?\n]*(?:draft|post|tweet)|Discard[^.!?\n]*(?:draft|post|tweet)|放弃[^。！？\n]*(?:草稿|帖子|推文)/i;
 // Quoted posts and editor contents are not confirmation-sheet instructions.
 const isDraftPrompt=d=>!d.querySelector('[contenteditable="true"],[data-testid="tweetText"]')&&draftPattern.test(d.textContent||'');
 async function dismiss(){
  const deadline=Date.now()+10000,clicked=new WeakSet();
  let actions=0,sawDialog=false,emptyPolls=0;
  for(let poll=0;poll<100&&Date.now()<deadline;poll++){
   const ds=dialogs();
   // Closing a composer can briefly unmount it before a draft sheet appears.
   if(!ds.length){if(!sawDialog||++emptyPolls>=3)return true;await sleep(100);continue;}
   sawDialog=true;emptyPolls=0;
   const prompts=ds.filter(isDraftPrompt);if(prompts.length>1||(!prompts.length&&ds.length!==1))return false;
   const d=prompts[0]||ds[0],buttons=[...d.querySelectorAll('button,[role="button"]')];
   // The only destructive choice allowed here is discarding an unsent draft.
   const discard=d.querySelector('[data-testid="confirmationSheetCancel"]');
   const draftPrompt=isDraftPrompt(d);
   const close=d.querySelector('[data-testid="app-bar-close"]')||buttons.find(b=>/^(关闭|取消|Close|Cancel)$/i.test((b.getAttribute('aria-label')||b.textContent||'').trim()));
   const drop=draftPrompt?buttons.find(b=>/^(放弃|舍弃|丢弃|不保存|放弃草稿|舍弃草稿|丢弃草稿|放弃帖子|Discard|Discard draft|Discard post|Don[’']t save|Do not save)$/i.test((b.textContent||'').trim())):null;
   // A save prompt must select discard, never Cancel (which can reopen the draft).
   const button=draftPrompt?drop:(close||discard);
   if(!button){
    // X first mounts an empty/loading shell; it is not a failed cancellation.
    if((d.textContent||'').trim()&&!d.querySelector('[role="progressbar"]'))return false;
   }else if(!clicked.has(button)&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'){
    if(actions++>=6)return false;
    clicked.add(button);button.click();
   }
   // Wait for the DOM transition instead of hammering the same close button.
   await sleep(100);
  }
  return false;
 }
 let pending=null;
 function cancel(){
  if(!pending)pending=dismiss().finally(()=>{pending=null;});
  return pending;
 }
 globalThis.XAssistantPopup={cancel};
})();
