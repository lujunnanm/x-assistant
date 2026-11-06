// One reply transaction shared by proactive interaction and notifications.
// A late API response can never send; a click with an unknown receipt is never retried.
(() => {
  const T=globalThis.XAssistantTasks, D=globalThis.XAssistantDOM;
  async function sendOnce({module,runId,row,text,account,signal,deadline=Infinity,detailInline=false,requireAddressed=false,validate=()=>{},patch,onBeforeSubmit=async()=>{},onConfirmed=async()=>{}}) {
    let submitted=false,confirmed=false,receipt=null,dialog=null,editor=null,standalone=false,inserted=false;
    const guard=()=>{
      T.check(signal,deadline);
      globalThis.XAssistantWorkspace?.check(signal);
      if(D.account()!==account.toLowerCase())throw new T.TaskError('ACCOUNT_CHANGED','账号发生变化，已停止');
      validate(row);
    };
    const wait=(probe,timeout=10000)=>T.waitForPage(probe,{signal,deadline,timeout});
    try {
      guard();
      if(D.dialogs().length)throw new T.TaskError('RESIDUAL_POPUP','页面已有弹窗，跳过当前评论');
      const locate=()=>{
        const found=D.relocate(row,account.toLowerCase(),requireAddressed);
        if(found||!detailInline||requireAddressed)return found;
        // Edited detail cards intentionally lack a navigable list permalink.
        // Bind the original row only to the exact, fully verified detail form.
        const live=D.detailReply(row);
        return live?.editedDetail&&live.article?.isConnected?{...row,article:live.article}:null;
      };
      const current=detailInline?await wait(locate,10000):locate();
      if(!current)throw new T.TaskError('TARGET_UPDATED','目标帖子已更新，请重新扫描'+(detailInline?' · '+JSON.stringify(D.detailReply(row,true)):''));
      row=current;
      if(detailInline){
        globalThis.XAssistantWorkspace?.progress?.('核对目标详情和原生行内回复框');
        const live=await wait(()=>D.detailReply(row),15000);
        if(!live)throw new T.TaskError('INLINE_EDITOR_NOT_READY','目标详情未出现可核验的回复框：'+JSON.stringify(D.detailReply(row,true)));
        dialog=live.dialog;editor=live.editor;
      }else{
        const buttons=[...row.article.querySelectorAll('[data-testid="reply"]')].filter(b=>!b.disabled);
        if(buttons.length!==1)throw new T.TaskError('REPLY_BUTTON','未找到唯一回复按钮');
        await T.sleep(500,signal,deadline);guard();
        if(buttons[0].isConnected===false||buttons[0].disabled)throw new T.TaskError('TARGET_UPDATED','操作目标已更新');
        globalThis.XAssistantWorkspace?.progress?.('等待回复输入框');
        buttons[0].click();
        const opened=await wait(()=>{
          const dialogs=D.dialogs();
          const unavailable=dialogs.find(d=>/(?:屏蔽了你|blocked you)/i.test(d.textContent||'')&&/(?:无法回复|can(?:not|'t) reply)/i.test(d.textContent||''));
          if(unavailable)return{kind:'author_blocked',dialog:unavailable};
          const popup=dialogs.length===1?dialogs[0]:null;
          const match=popup?{dialog:popup,editor:D.replyEditor(popup)}:D.standaloneReply(row);
          if(!match?.editor)return null;
          dialog=match.dialog;standalone=!!match.standalone;
          return {kind:'editor',editor:match.editor};
        },15000);
        if(opened?.kind==='author_blocked'){
          const buttons=[...opened.dialog.querySelectorAll('button,[role="button"]')].filter(b=>/^(?:知道了|明白了|Got it|OK)$/i.test((b.textContent||b.getAttribute?.('aria-label')||'').trim()));
          if(buttons.length!==1)throw new T.TaskError('CLEANUP_FAILED','作者屏蔽提示无法安全关闭');
          await T.sleep(500,signal,deadline);guard();
          if(buttons[0].isConnected===false||buttons[0].disabled)throw new T.TaskError('TARGET_UPDATED','操作目标已更新');
          buttons[0].click();
          await T.waitForPage(()=>!opened.dialog.isConnected&&!D.dialogs().includes(opened.dialog),{signal,deadline,timeout:5000});
          if(opened.dialog.isConnected||D.dialogs().includes(opened.dialog))throw new T.TaskError('CLEANUP_FAILED','作者屏蔽提示无法安全关闭');
          throw new T.TaskError('AUTHOR_BLOCKED','作者已屏蔽当前账号，跳过此帖');
        }
        editor=opened?.editor;
        if(!editor)throw new T.TaskError('EDITOR_NOT_READY','回复输入框未就绪');
      }
      const bound=()=>{
        if(detailInline){const live=D.detailReply(row);return live?.dialog===dialog&&live.editor===editor;}
        if(standalone){const live=D.standaloneReply(row);return live?.dialog===dialog&&live.editor===editor;}
        return D.dialogs().length===1&&D.dialogs()[0]===dialog&&D.replyEditor(dialog)===editor&&D.matches(dialog,row);
      };
      if(!await wait(bound,3000))throw new T.TaskError('TARGET_MISMATCH','回复弹窗与目标不一致');
      // React may briefly retain the previous composer text during navigation.
      // Wait for natural clearing; never overwrite a genuine existing draft.
      if(!await wait(()=>!globalThis.XAssistantCore.editorText(editor).trim(),1500))throw new T.TaskError('RESIDUAL_DRAFT','回复框已有残留内容');
      await T.sleep(500,signal,deadline);guard();
      if(!bound())throw new T.TaskError('TARGET_MISMATCH','输入前回复目标已变化');
      if(editor.isConnected===false||globalThis.XAssistantCore.editorText(editor).trim())throw new T.TaskError('RESIDUAL_DRAFT','输入框已变化或有残留内容');
      editor.focus();
      const data=new DataTransfer();data.setData('text/plain',text);
      inserted=true;editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
      await T.sleep(200,signal,deadline);
      if(!globalThis.XAssistantCore.editorText(editor)){await T.sleep(500,signal,deadline);guard();if(!bound()||globalThis.XAssistantCore.editorText(editor))throw new T.TaskError('EDITOR_READBACK','输入框内容或归属已变化');editor.focus();if(document.activeElement!==editor&&!editor.contains?.(document.activeElement))throw new T.TaskError('EDITOR_READBACK','当前输入位置并非目标回复框');document.execCommand('insertText',false,text);}
      const expected=globalThis.XAssistantCore.editorText({innerText:text});
      if(!await wait(()=>globalThis.XAssistantCore.editorText(editor)===expected,1500))throw new T.TaskError('EDITOR_READBACK','文案粘贴回读不一致');
      const ready=()=>{
        const buttons=detailInline?[D.detailReply(row)?.button]:[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')];
        return buttons.filter(b=>b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
      };
      if(!await wait(()=>ready().length===1,2000))throw new T.TaskError('SEND_BUTTON','发送按钮未就绪');
      // AI generation has completed before send(); allow a full second after
      // verified insertion, regardless of how long opening the composer took.
      await T.sleep(1000,signal,deadline);
      guard();
      if(!bound())throw new T.TaskError('TARGET_MISMATCH','发送前回复目标已变化');
      globalThis.XAssistantWorkspace?.progress?.('等待回复发送许可');
      let sendButtons,clickedAt=null;
      try {
        await globalThis.XAssistantActions.click({module,runId,account,kind:'reply',signal,
          beforeClick:async()=>{
            guard();
            await patch({phase:'submitting',text,submittedAt:new Date().toISOString()});
            await onBeforeSubmit();
            await T.sleep(500,signal,deadline);
          },
          validate:()=>{
            guard();
            if(!bound())throw new T.TaskError('TARGET_MISMATCH','提交前回复目标已变化');
            if(globalThis.XAssistantCore.editorText(editor)!==expected)throw new T.TaskError('EDITOR_READBACK','提交前回复正文已变化');
            sendButtons=ready();
            if(sendButtons.length!==1)throw new T.TaskError('SEND_BUTTON','提交前发送按钮已变化');
            receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account,text,setInterval,clearInterval});
            guard();
          },
          click:()=>{submitted=true;clickedAt=Date.now();sendButtons[0].click();},
        });
      }catch(error){if(!submitted||!receipt)throw error;}
      // Already clicked: ACK loss, stop and midnight permit only bounded readback.
      globalThis.XAssistantWorkspace?.progress?.('核对 X 发送回执');
      const result=await T.waitForPage(()=>receipt.poll(),{timeout:Math.max(0,clickedAt+15000-Date.now())});
      if(result?.kind!=='confirmed')throw new T.TaskError('SEND_UNKNOWN',result?.message||'回复提交结果未知，请核对');
      confirmed=true;
      await onConfirmed(result);
      await patch({phase:'confirmed',receipt:result});
      return result;
    } catch(error) {
      const e=error instanceof Error ? error : new Error(String(error));
      e.submitted=submitted;e.confirmed=confirmed;
      if(detailInline&&(submitted&&!confirmed||D.dialogs().length||editor&&globalThis.XAssistantCore.editorText(editor).trim()||e.code==='RESIDUAL_DRAFT'||e.code==='TARGET_MISMATCH'))e.preserveDrafts=true;
      if(!submitted) {
        const remaining=D.dialogs();
        if(!detailInline&&(remaining.length||standalone)){
          // Never discard a preexisting popup, restored draft, mismatched reply,
          // or edits not made by this transaction, including during late renders.
          const ours=remaining.length===1&&remaining[0]===dialog&&editor&&D.replyEditor(dialog)===editor&&D.matches(dialog,row);
          const body=editor?globalThis.XAssistantCore.editorText(editor):'';
          const safe=ours&&(!body.trim()||inserted&&body===globalThis.XAssistantCore.editorText({innerText:text}));
          if(!safe||globalThis.XAssistantWorkspace?.canCleanComposer?.()===false)e.preserveDrafts=true;
          else if(!await globalThis.XAssistantPopup.cancel()){
            const failure=new T.TaskError('CLEANUP_FAILED','回复草稿或弹窗无法安全取消');failure.submitted=false;failure.cause=e;throw failure;
          }
        }
        // A pre-click stop/deadline must not leave a false submitting/unknown runtime.
        try{await patch({phase:'waiting'});}catch{}
      }
      throw e;
    } finally { receipt?.close(); }
  }
  async function send(options) {
    const {module,runId,account,row}=options,api=globalThis.XAssistantRuntime;
    if(!['interaction','notifications'].includes(module)||!runId)throw Error('回复缺少模块运行凭证');
    globalThis.XAssistantWorkspace?.check(options.signal);
    if(globalThis.document?.hidden&&globalThis.XAssistantWorkspace?.state?.().assignment?.module===module&&!options.detailInline)
      throw new T.TaskError('INLINE_ROUTE_REQUIRED','后台工作页必须先核对目标详情，未打开通用发帖框');
    const binding={module,runId,account,postId:row.id};
    const claim=await api.call({kind:'REPLY_CLAIM',...binding});
    if(!claim.claimed)throw new T.TaskError('REPLY_ALREADY_CLAIMED','此评论已由其他模块处理或结果待核对，已跳过');
    let confirmedReceipt=null,releaseComposer,failure=null;
    const settle=(outcome,receipt)=>api.call({kind:'REPLY_SETTLE',...binding,claimId:claim.claimId,outcome,...(receipt?{receipt}:{})});
    try {
      // Quarantined/claimed targets never even open their detail page.
      if(options.detailInline)await options.prepareTarget?.();
      if(!options.detailInline)releaseComposer=globalThis.XAssistantWorkspace?.beginComposer();
      const args={...options,onConfirmed:async receipt=>{confirmedReceipt=receipt;await options.onConfirmed?.(receipt);}};
      const result=await sendOnce(args);
      await settle('confirmed',result);
      if(/^\/compose\/(?:post|tweet)\/?$/.test(globalThis.location?.pathname||'')){
        // Read-only grace for X's own SPA transition after confirmed success.
        // Never close or retry an already submitted composer.
        await T.waitForPage(()=>!/^\/compose\/(?:post|tweet)\/?$/.test(location.pathname),{timeout:3000});
      }
      return result;
    }catch(error){
      failure=error;
      try{await settle(confirmedReceipt?'confirmed':error.submitted?'unknown':'released',confirmedReceipt);}
      catch{error.message+='；跨模块发送记录待核对，不会自动重发';}
      if(confirmedReceipt){error.submitted=true;error.confirmed=true;}
      throw error;
    }finally{releaseComposer?.({submitted:!!failure?.submitted||!!confirmedReceipt,confirmed:!!confirmedReceipt,reason:failure?.message});}
  }
  globalThis.XAssistantReplyEngine={send};
})();
