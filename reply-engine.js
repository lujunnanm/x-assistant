// One reply transaction shared by proactive interaction and notifications.
// A late API response can never send; a click with an unknown receipt is never retried.
(() => {
  const T=globalThis.XAssistantTasks, D=globalThis.XAssistantDOM;
  async function sendOnce({module,runId,row,text,account,signal,deadline=Infinity,detailInline=false,requireAddressed=false,validate=()=>{},patch,onBeforeSubmit=async()=>{},onConfirmed=async()=>{},onDuplicate=async()=>{},checkReply,onHold}) {
    let submitted=false,confirmed=false,receipt=null,dialog=null,editor=null,standalone=false,inserted=false;
    const blockedVideo=()=>module==='notifications'?D.replyVideoOnly?.(row):D.replyHasVideo?.(row);
    const guard=()=>{
      T.check(signal,deadline);
      globalThis.XAssistantWorkspace?.check(signal);
      if(D.account()!==account.toLowerCase())throw new T.TaskError('ACCOUNT_CHANGED','账号发生变化，已停止');
      if(blockedVideo())throw new T.TaskError('VIDEO_POST','目标评论只有无法读取的视频，未发送');
      validate(row);
    };
    const wait=(probe,timeout=10000)=>T.waitForPage(probe,{signal,deadline,timeout});
    try {
      guard();
      if(D.dialogs().length)throw new T.TaskError('RESIDUAL_POPUP','页面已有弹窗，跳过当前评论');
      if(!detailInline||requireAddressed){
        const locate=()=>D.relocate(row,account.toLowerCase(),requireAddressed);
        const current=detailInline?await wait(locate):locate();
        if(!current)throw new T.TaskError('TARGET_UPDATED','目标帖子已更新，请重新扫描');
        row=current;
      }
      if(detailInline){
        globalThis.XAssistantWorkspace?.progress?.('核对目标详情和原生行内回复框');
        const live=await wait(()=>{const found=D.detailReply(row);return found?.article?.isConnected?found:null;},15000);
        if(!live)throw new T.TaskError('INLINE_EDITOR_NOT_READY','目标详情未出现可核验的回复框：'+JSON.stringify(D.detailReply(row,true)));
        // The source was verified before navigation. Pin the now-verified
        // full detail body; a later edit must not pass by sharing its prefix.
        row={...row,text:live.text,clipped:false,article:live.article};
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
      let sendButtons,clickedAt=null,secondClick=false;
      const notification=module==='notifications'&&detailInline,tracked=notification&&typeof checkReply==='function'&&typeof onHold==='function';
      const cleanOwned=()=>{
        const safe=()=>D.account()===account.toLowerCase()&&!D.dialogs().length&&!document.querySelector('[role="alertdialog"]')&&bound()&&editor.isConnected!==false&&
          globalThis.XAssistantWorkspace?.canCleanComposer?.()!==false&&!document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')&&
          ![...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length)&&
          ![...document.querySelectorAll('[contenteditable="true"]')].some(e=>e!==editor&&globalThis.XAssistantCore.editorText(e).trim());
        const body=()=>globalThis.XAssistantCore.editorText(editor);
        if(editor.isConnected===false&&![...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))return;
        if(body().trim()){
          const fail=()=>Object.assign(new T.TaskError('RESIDUAL_DRAFT','已记录本次结果；编辑框发生变化，保留现场'),{preserveDrafts:true});
          T.check(signal,deadline);globalThis.XAssistantWorkspace?.check(signal);
          if(!inserted||!safe()||body()!==expected)throw fail();
          editor.focus();if(!safe()||body()!==expected||document.activeElement!==editor&&!editor.contains?.(document.activeElement))throw fail();
          const range=document.createRange(),sel=document.getSelection();range.selectNodeContents(editor);sel.removeAllRanges();sel.addRange(range);
          if(!safe()||body()!==expected)throw fail();
          document.execCommand('delete',false);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
          if(body().trim())throw fail();
        }
      };
      const denial=()=>{const r=receipt?.nativeResult;return r?.kind==='not_sent'&&r.evidence==='x_create_result'&&r.parentId===row.id?r:null;};
      const canRetry=()=>{const r=denial();return !receipt.poll()&&r?.code===130&&r.reason==='temporary_rejection'&&!(r.retryAt>Date.now());};
      const click=async retry=>{
        try {
        await globalThis.XAssistantActions.click({module,runId,account,kind:'reply',signal,
          beforeClick:async()=>{
            guard();
            if(retry&&!canRetry())throw new T.TaskError('RETRY_RECHECK','原拒绝回执已变化');
            await patch({phase:'submitting',text,...(tracked?{rowId:row.id}:{}),submittedAt:new Date().toISOString()});
            await onBeforeSubmit();
            await T.sleep(500,signal,deadline);
          },
          validate:()=>{
            guard();
            if(!bound())throw new T.TaskError('TARGET_MISMATCH','提交前回复目标已变化');
            if(globalThis.XAssistantCore.editorText(editor)!==expected)throw new T.TaskError('EDITOR_READBACK','提交前回复正文已变化');
            sendButtons=ready();
            if(sendButtons.length!==1)throw new T.TaskError('SEND_BUTTON','提交前发送按钮已变化');
            if(retry){if(!canRetry())throw new T.TaskError('RETRY_RECHECK','重新发送前凭证已变化');receipt.close();}
            receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account,text,setInterval,clearInterval,
              ...(notification?{native:globalThis.XAssistantPostingNative?.create({document,button:sendButtons[0],account,text,parentId:row.id,timeout:45000}),
              replyTarget:{primary:()=>document.querySelector('[data-testid="primaryColumn"]'),matchesParent:id=>D.directChildOf?.(id,row.id)===true}}:{})});
            guard();
          },
          click:()=>{submitted=true;if(retry)secondClick=true;clickedAt=Date.now();sendButtons[0].click();},
        });
      }catch(error){if(!submitted||!receipt)throw error;if(retry&&!secondClick)return false;}return true;
      };
      const verify=async()=>{
        globalThis.XAssistantWorkspace?.progress?.('核对 X 发送回执');
        const end=clickedAt+15000,remaining=()=>Math.max(0,end-Date.now());
        let seen=await T.waitForPage(()=>receipt.poll()||(tracked&&(receipt.hint||denial())?{check:true}:null),{timeout:remaining()});
        if(seen?.kind==='confirmed')return seen;
        if(tracked&&denial())return receipt.poll()||denial();
        if(tracked&&!receipt.refusal){globalThis.XAssistantWorkspace?.progress?.('独立打开原评论，核对本人回复');
          const checked=await checkReply().catch(()=>null);
          if(checked?.kind==='confirmed'&&checked.parentId===row.id)return checked;
          if(!denial()&&remaining()>0)await T.waitForPage(()=>receipt.poll()||denial(),{timeout:remaining()});
        }
        return notification?(receipt.poll()||receipt.atDeadline?.()):null;
      };
      await click(false);let result=await verify();
      if(tracked&&result?.kind==='not_sent'&&canRetry()){
        globalThis.XAssistantWorkspace?.progress?.('已确认未发；1 秒后重试一次');
        await T.sleep(1000,signal,deadline);T.check(signal,deadline);
        if(canRetry()&&await click(true))result=await verify();
        else result=receipt.poll()||denial();
      }
      if(notification&&result?.kind==='rejected'&&result.reason==='duplicate'&&result.evidence==='x_notice'){
        // Persist target-specific suppression before cleanup/Back. Do not call
        // onConfirmed: X rejected this submission and proved no new reply ID.
        await onDuplicate(result);
        cleanOwned();
        return {action:'skip',skipReason:'platform_duplicate',postId:row.id,receipt:result};
      }
      if(tracked&&result?.kind!=='confirmed'){
        const finalDenial=denial();
        // Generic or absent evidence never releases the claim. The generated
        // text remains in durable storage even after its verified editor is cleared.
        const reason=finalDenial?.code===130?'temporary_rejection':finalDenial?.code===88?'rate_limit':'pending_readback';
        await onHold(reason,finalDenial);cleanOwned();
        if(reason==='rate_limit'||result?.reason==='rate_limit')throw Object.assign(new T.TaskError('RATE_LIMIT','X 已明确限流'),{httpStatus:429,retryAt:finalDenial?.retryAt});
        return {action:'skip',skipReason:reason,postId:row.id};
      }
      if(result?.kind!=='confirmed')throw new T.TaskError('SEND_UNKNOWN',result?.message||'回复提交结果未知，请核对');
      confirmed=true;
      await onConfirmed(result);
      await patch({phase:'confirmed',receipt:result});
      if(tracked)cleanOwned();
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
    if((module==='notifications'?D.replyVideoOnly?.(row):D.replyHasVideo?.(row)))return {action:'skip',text:'',postId:row.id,skipReason:'video_post'};
    const claim=await api.call({kind:'REPLY_CLAIM',...binding});
    if(!claim.claimed)throw new T.TaskError('REPLY_ALREADY_CLAIMED','此评论已由其他模块处理或结果待核对，已跳过');
    let held=false,duplicateReceipt=null,confirmedReceipt=null,releaseComposer,failure=null;
    const settle=(outcome,receipt)=>api.call({kind:'REPLY_SETTLE',...binding,claimId:claim.claimId,outcome,...(receipt?{receipt}:{})});
    try {
      // Quarantined/claimed targets never even open their detail page.
      if(options.detailInline)await options.prepareTarget?.();
      const prepared=await options.prepareReply?.();
      if(prepared){
        if(prepared.postId!==row.id||!['send_reply','skip'].includes(prepared.action))throw new T.TaskError('AI_PROTOCOL','AI 未返回当前目标的有效回复');
        if(prepared.action==='skip'){await settle('released');return prepared;}
        if(typeof prepared.text!=='string'||!prepared.text.trim())throw new T.TaskError('AI_PROTOCOL','AI 回复正文为空');
        options={...options,text:prepared.text,row:typeof prepared.sourceText==='string'?{...row,text:prepared.sourceText,clipped:false}:row};
        const validate=options.validate;
        options.validate=current=>{validate?.(current);prepared.validatePrepared?.();};
      }
      if(!options.detailInline)releaseComposer=globalThis.XAssistantWorkspace?.beginComposer();
      const recovery=module==='notifications'&&options.detailInline&&options.rootId&&options.onHold?{
        checkReply:()=>api.call({kind:'REPLY_READBACK',...binding,claimId:claim.claimId,author:row.author.toLowerCase(),root:options.rootId}),
        onHold:async(reason,receipt)=>{
          if(reason==='pending_readback')await api.call({kind:'REPLY_SETTLE',...binding,claimId:claim.claimId,outcome:'unknown',
            deferred:{author:row.author,root:options.rootId,text:options.text}});
          else await settle('released',receipt);
          held=true;await options.onHold(reason,receipt,options.text);
          await options.patch({phase:'notification_scan',submittedAt:null});
        }
      }:{};
      const args={...options,...recovery,onDuplicate:async receipt=>{
        await settle('duplicate_skipped',receipt);duplicateReceipt=receipt;
        await options.onDuplicate?.(receipt);
        await options.patch({phase:'notification_scan',submittedAt:null});
      },onConfirmed:async receipt=>{confirmedReceipt=receipt;await options.onConfirmed?.(receipt);}};
      const result=await sendOnce(args);
      if(duplicateReceipt||held)return result;
      await settle('confirmed',result);
      if(/^\/compose\/(?:post|tweet)\/?$/.test(globalThis.location?.pathname||'')){
        // Read-only grace for X's own SPA transition after confirmed success.
        // Never close or retry an already submitted composer.
        await T.waitForPage(()=>!/^\/compose\/(?:post|tweet)\/?$/.test(location.pathname),{timeout:3000});
      }
      return result;
    }catch(error){
      failure=error;
      if(held){error.heldReply=true;error.preserveDrafts=true;throw error;}
      if(duplicateReceipt){error.duplicateSkipped=true;error.preserveDrafts=true;throw error;}
      try{await settle(confirmedReceipt?'confirmed':error.submitted?'unknown':'released',confirmedReceipt);}
      catch{error.message+='；跨模块发送记录待核对，不会自动重发';}
      if(confirmedReceipt){error.submitted=true;error.confirmed=true;}
      throw error;
    }finally{releaseComposer?.({submitted:!!failure?.submitted||!!confirmedReceipt,confirmed:!!confirmedReceipt,reason:failure?.message});}
  }
  globalThis.XAssistantReplyEngine={send};
})();
