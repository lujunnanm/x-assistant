// One reply transaction shared by proactive interaction and notifications.
// A late API response can never send; a click with an unknown receipt is never retried.
(() => {
  const T=globalThis.XAssistantTasks, D=globalThis.XAssistantDOM;
  async function send({row,text,account,signal,deadline=Infinity,requireAddressed=false,validate=()=>{},patch,onBeforeSubmit=async()=>{},onConfirmed=async()=>{}}) {
    let submitted=false, confirmed=false, receipt=null;
    const guard=()=>{
      T.check(signal,deadline);
      if(D.account()!==account.toLowerCase())throw new T.TaskError('ACCOUNT_CHANGED','账号发生变化，已停止');
      validate(row);
    };
    const wait=(probe,timeout=10000)=>T.waitFor(probe,{signal,deadline,timeout});
    try {
      guard();
      if(D.dialogs().length)throw new T.TaskError('RESIDUAL_POPUP','页面已有弹窗，跳过当前评论');
      const current=D.relocate(row,account.toLowerCase(),requireAddressed);
      if(!current)throw new T.TaskError('TARGET_UPDATED','目标帖子已更新，请重新扫描');
      row=current;
      const buttons=[...row.article.querySelectorAll('[data-testid="reply"]')].filter(b=>!b.disabled);
      if(buttons.length!==1)throw new T.TaskError('REPLY_BUTTON','未找到唯一回复按钮');
      buttons[0].click();
      let dialog;
      const editor=await wait(()=>{
        dialog=D.dialogs().find(d=>d.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]'));
        return dialog?.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');
      });
      if(!editor)throw new T.TaskError('EDITOR_NOT_READY','回复输入框未就绪');
      if(!await wait(()=>D.matches(dialog,row),3000))throw new T.TaskError('TARGET_MISMATCH','回复弹窗与目标不一致');
      if(globalThis.XAssistantCore.editorText(editor).trim())throw new T.TaskError('RESIDUAL_DRAFT','回复框已有残留内容');
      editor.focus();
      const data=new DataTransfer();data.setData('text/plain',text);
      editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
      await T.sleep(200,signal,deadline);
      if(!globalThis.XAssistantCore.editorText(editor)){editor.focus();document.execCommand('insertText',false,text);}
      const expected=globalThis.XAssistantCore.editorText({innerText:text});
      if(!await wait(()=>globalThis.XAssistantCore.editorText(editor)===expected,1500))throw new T.TaskError('EDITOR_READBACK','文案粘贴回读不一致');
      const ready=()=>[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');
      if(!await wait(()=>ready().length===1,2000))throw new T.TaskError('SEND_BUTTON','发送按钮未就绪');
      guard();
      if(!D.matches(dialog,row))throw new T.TaskError('TARGET_MISMATCH','发送前回复目标已变化');
      await patch({phase:'submitting',text,submittedAt:new Date().toISOString()});
      await onBeforeSubmit();
      guard();
      if(!D.matches(dialog,row))throw new T.TaskError('TARGET_MISMATCH','提交前回复目标已变化');
      if(globalThis.XAssistantCore.editorText(editor)!==expected)throw new T.TaskError('EDITOR_READBACK','提交前回复正文已变化');
      const sendButtons=ready();
      if(sendButtons.length!==1)throw new T.TaskError('SEND_BUTTON','提交前发送按钮已变化');
      receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account,text,setInterval,clearInterval});
      submitted=true;
      sendButtons[0].click();
      // The work-window deadline only prevents new sends, not receipt confirmation.
      const result=await T.waitFor(()=>receipt.poll(),{signal,timeout:15000});
      if(result?.kind!=='confirmed')throw new T.TaskError('SEND_UNKNOWN',result?.message||'回复提交结果未知，请核对');
      confirmed=true;
      await onConfirmed(result);
      await patch({phase:'confirmed',receipt:result});
      return result;
    } catch(error) {
      const e=error instanceof Error ? error : new Error(String(error));
      e.submitted=submitted;e.confirmed=confirmed;
      if(!submitted) {
        const clean=!D.dialogs().length || await globalThis.XAssistantPopup.cancel();
        if(!clean){const failure=new T.TaskError('CLEANUP_FAILED','回复草稿或弹窗无法安全取消');failure.submitted=false;failure.cause=e;throw failure;}
        // A pre-click stop/deadline must not leave a false submitting/unknown runtime.
        try{await patch({phase:'waiting'});}catch{}
      }
      throw e;
    } finally { receipt?.close(); }
  }
  globalThis.XAssistantReplyEngine={send};
})();
