// Only dismiss; never approve permissions, challenges, purchases or unknown sends.
(()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const dialogs=()=>[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(d=>!d.querySelector('[role="dialog"],[role="alertdialog"]'));
 const draftPattern=/保存[^。！？\n]*(?:草稿|帖子|推文)|Save[^.!?\n]*(?:draft|post|tweet)|Discard[^.!?\n]*(?:draft|post|tweet)|放弃[^。！？\n]*(?:草稿|帖子|推文)/i;
 const isDraftPrompt=d=>draftPattern.test(d.textContent||'');
 async function cancel(){
  for(let step=0;step<6;step++){
   const ds=dialogs();if(!ds.length)return true;
   const prompts=ds.filter(isDraftPrompt);if(prompts.length>1||(!prompts.length&&ds.length!==1))return false;
   const d=prompts[0]||ds[0],buttons=[...d.querySelectorAll('button,[role="button"]')];
   // The only destructive choice allowed here is discarding an unsent draft.
   const discard=d.querySelector('[data-testid="confirmationSheetCancel"]');
   const text=(d.textContent||'');
   const draftPrompt=isDraftPrompt(d);
   const close=d.querySelector('[data-testid="app-bar-close"]')||buttons.find(b=>/^(关闭|取消|Close|Cancel)$/i.test((b.getAttribute('aria-label')||b.textContent||'').trim()));
   const drop=draftPrompt?buttons.find(b=>/^(放弃|舍弃|丢弃|不保存|放弃草稿|舍弃草稿|丢弃草稿|放弃帖子|Discard|Discard draft|Discard post|Don[’']t save|Do not save)$/i.test((b.textContent||'').trim())):null;
   // A save prompt must select discard, never Cancel (which can reopen the draft).
   const button=draftPrompt?drop:(close||discard);if(!button)return false;
   button.click();await sleep(250);
  }
  return dialogs().length===0;
 }
 globalThis.XAssistantPopup={cancel};
})();
