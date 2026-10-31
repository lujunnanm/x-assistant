// Only clean a dialog opened by this run; never discard arbitrary/user drafts.
(function(root){
 async function cleanup({dialog,submitted,expectedText,editorText,clearEditor,hasDialog,sleep}){
  if(submitted)return false;
  if(!dialog||!dialog.isConnected)return !hasDialog();
  const editor=dialog.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');
  if(dialog.querySelector('[data-testid="attachments"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="pollOptions"]'))return false;
  const text=editorText(editor);
  if(text){
   if(!expectedText||text!==editorText({innerText:expectedText}))return false;
   await clearEditor(editor);if(editorText(editor))return false;
  }
  const close=dialog.querySelector('[data-testid="app-bar-close"]')||[...dialog.querySelectorAll('button')].find(b=>/^(关闭|Close)$/i.test(b.getAttribute('aria-label')||''));
  if(!close)return false;
  close.click();
  for(let i=0;i<40;i++){if(!dialog.isConnected&&!hasDialog())return true;await sleep(50);}
  return false;
 }
 root.XAssistantReplyCleanup={cleanup};
})(globalThis);
