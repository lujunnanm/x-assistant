(()=>{
 const api=globalThis.XAssistantRuntime,core=globalThis.XAssistantCore;
 const KEY='xAssistantNotificationRepliesV1';
 let account,runId,signal,db;
 const read=async()=> (await chrome.storage.local.get(KEY))[KEY]||{};
 const self=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
 const check=s=>{if(s.aborted)throw new DOMException('已停止','AbortError');if(self()?.toLowerCase()!==account.toLowerCase())throw Error('账号变化，停止通知回复');};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const sleep=async(ms,s)=>{for(let end=Date.now()+ms;Date.now()<end;){check(s);await wait(Math.min(100,end-Date.now()));}check(s);};
 const waitFor=async(fn,count=80,delay=100,s=signal)=>{for(let i=0;i<count;i++){check(s);const value=fn();if(value)return value;await sleep(delay,s);}return null;};
 const patch=patch=>api.runtime('notifications','patch',{runId,patch});
 const normalized=v=>(v||'').replace(/\s+/g,' ').trim();
 const clickNative=b=>b.click();
 const innermostDialog=()=>[...document.querySelectorAll('[role="dialog"]')].find(d=>!d.querySelector('[role="dialog"]'));
 let ownedReplyDialog=null,ownedReplyText='',replySubmitted=false;
 const save=async()=>{const all=await read();all[account.toLowerCase()]=db;await chrome.storage.local.set({[KEY]:all});};
 const cleanup=()=>globalThis.XAssistantReplyCleanup.cleanup({dialog:ownedReplyDialog,submitted:replySubmitted,expectedText:ownedReplyText,editorText:core.editorText,hasDialog:()=>!!document.querySelector('[role="dialog"],[role="alertdialog"]'),sleep:wait,clearEditor:async e=>{e.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);document.execCommand('delete',false);await wait(100);}});
 // User-authorized residual reply disposal; never discard an uncertain submission.
 const discardResidual=async()=>{if(replySubmitted)return false;return globalThis.XAssistantPopup.cancel();};
 let yieldDeadline=Infinity;
 const cutoff=()=>{if(Date.now()>=yieldDeadline){const e=Error('回帖已到交接时间');e.name='YieldError';throw e;}};
 const boundedAI=async message=>{
  let timer,onAbort;
  try{return await Promise.race([api.call(message),new Promise((resolve,reject)=>{
   const fail=()=>{const e=Error('回帖已到交接时间');e.name='YieldError';reject(e);};
   if(Number.isFinite(yieldDeadline))timer=setTimeout(fail,Math.max(0,yieldDeadline-Date.now()));
   onAbort=()=>reject(new DOMException('已停止','AbortError'));signal.addEventListener('abort',onAbort,{once:true});
  })]);}finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
 };
 const navigate=async(path)=>{
  check(signal);if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw Error('已有弹窗，通知检查暂停');
  const a=await waitFor(()=>[...document.querySelectorAll('a[href]')].find(a=>a.getAttribute('href')===path),150);
  if(!a)throw Error('通知导航入口不存在：'+path);
  a.click();if(!await waitFor(()=>location.pathname===path,100))throw Error('通知导航失败');
  await sleep(1500,signal);
 };
 const info=a=>{
  const time=a.querySelector('time'),link=time?.closest('a'),m=link?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)$/);
  if(!m)return null;
  const text=a.querySelector('[data-testid="tweetText"]')?.textContent||'';
  // Reply metadata outside tweet text: a mention in the body is not a reply.
  const addressed=[...a.querySelectorAll('div[dir]')].some(e=>/^(回复\s|Replying to\s)/i.test(e.textContent)&&e.textContent.length<250&&!e.querySelector('[data-testid="tweetText"]')&&[...e.querySelectorAll('a[href]')].some(l=>l.getAttribute('href')?.toLowerCase()===account.toLowerCase()));
  return {article:a,id:m[2],author:m[1],text,time:time.dateTime,at:Date.parse(time.dateTime),addressed};
 };
 const relocate=row=>[...document.querySelectorAll('article[data-testid="tweet"]')].map(info).find(current=>current&&current.article.isConnected&&current.id===row.id&&current.author.toLowerCase()===row.author.toLowerCase()&&current.time===row.time&&normalized(current.text)===normalized(row.text)&&current.addressed);
 const recent=(at,now=Date.now())=>Number.isFinite(at)&&at>=now-86400000&&at<=now;
 const requireRecent=row=>{if(!recent(row.at)){const e=Error('评论已超过24小时，跳过');e.name='ExpiredReplyError';throw e;}};
 const excludedAuthor=author=>typeof author==='string'&&author.toLowerCase()==='grok';
 const sendReply=async(info,text,signal)=>{ownedReplyDialog=null;ownedReplyText='';replySubmitted=false;check(signal);cutoff();requireRecent(info);const current=relocate(info);if(!current)throw Error('通知目标已更新，请重新扫描');info=current;if(!info.article.isConnected||info.article.querySelector('time')?.getAttribute('datetime')!==info.time)throw Error('通知目标已更新，请重新扫描');if(document.querySelector('[role="dialog"]'))throw Error('页面已有弹窗');const buttons=[...info.article.querySelectorAll('[data-testid="reply"]')];if(buttons.length!==1)throw Error('未找到唯一回复按钮');clickNative(buttons[0]);const editor=await waitFor(()=>{const opened=innermostDialog();if(opened&&!ownedReplyDialog)ownedReplyDialog=opened;return ownedReplyDialog?.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');},150,100,signal),dialog=ownedReplyDialog;if(!editor||!dialog)throw Error('回复输入框未就绪');const targetMatches=()=>{const cards=[...dialog.querySelectorAll('[data-testid="tweet"]')];return cards.length===1&&[...cards[0].querySelectorAll('a[href]')].some(a=>{try{return new URL(a.href).pathname.toLowerCase()==='/'+info.author.toLowerCase()}catch{return false}})&&normalized(cards[0].querySelector('[data-testid="tweetText"]')?.textContent)===normalized(info.text)&&cards[0].querySelector('time')?.getAttribute('datetime')===info.time;};if(!await waitFor(targetMatches,150,100,signal))throw Error('回复目标核对失败');if(core.editorText(editor).trim())throw Error('回复框已有内容');ownedReplyDialog=dialog;ownedReplyText=text;editor.focus();const data=new DataTransfer();data.setData('text/plain',text);editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));await sleep(350,signal);if(!core.editorText(editor)){editor.focus();document.execCommand('insertText',false,text);}if(core.editorText(editor)!==core.editorText({innerText:text}))throw Error('文案粘贴回读不一致');const send=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');if(send.length!==1)throw Error('未找到唯一发送按钮');if(!targetMatches())throw Error('发送前回复目标已变化');cutoff();await patch({phase:'submitting',text,submittedAt:new Date().toISOString()});check(signal);
 const receipt=globalThis.XAssistantPostingReceipt.create({document,MutationObserver,account,text,setInterval,clearInterval});
 try{requireRecent(info);replySubmitted=true;clickNative(send[0]);const result=await waitFor(()=>receipt.poll(),150,100,signal);if(result?.kind!=='confirmed')throw Error(result?.message||'回复提交结果未知');await patch({phase:'confirmed',receipt:result});ownedReplyDialog=null;replySubmitted=false;return'verified';}finally{receipt.close();}};

 globalThis.XAssistantNotifications={async scan(options){
  ({account,runId,signal}=options);yieldDeadline=options.yieldAt??Infinity;check(signal);
  db=(await read())[account.toLowerCase()]||{since:Date.now()-86400000,records:{},cycles:0};
  if(Object.values(db.records).some(r=>['in_flight','unknown'].includes(r.status)))throw Error('通知回复结果未知，请先人工核对');
  db.since=Date.now()-86400000; // Rolling boundary, not the original installation date.
  db.batchUntil=db.batchUntil||Date.now();
  const yieldToPost=()=>Date.now()>=(options.yieldAt??Infinity);
  if(yieldToPost())return {complete:false};
  const defer=async()=>{db.nextAt=0;await save();options.show('通知回复让位于定时发帖，发帖后继续本轮');};
  const token=await globalThis.XAssistantInteraction.pause();
  try{
   if(location.pathname!=='/home')throw Error('通知循环需在主页启动，以免覆盖当前页面');
   options.show('正在检查通知中的新回复');await save();await patch({phase:'notification_scan'});
   const nav=document.querySelector('[data-testid="AppTabBar_Notifications_Link"]');
   if(!nav)throw Error('没有通知入口');nav.click();
   if(!await waitFor(()=>location.pathname.startsWith('/notifications'),100))throw Error('通知页未就绪');
   if(location.pathname!=='/notifications/mentions')await navigate('/notifications/mentions');
   await sleep(2000,signal);
   const rest=async reason=>{delete db.batchUntil;db.lastChecked=Date.now();db.nextAt=0;await save();options.show(reason+'，本轮休息，等待下个回帖时段');return {complete:false,rest:true,reason};};
   let stable=0,last='';
   for(let screen=0;screen<100;screen++){
    check(signal);if(yieldToPost()){await defer();return {complete:false};}if(location.pathname!=='/notifications/mentions')throw Error('通知页面已变化');
    const rows=[...document.querySelectorAll('article[data-testid="tweet"]')].map(info).filter(Boolean);
    for(const row of rows){
     if(yieldToPost()){await defer();return {complete:false};}
     // Match the account handle, not its display name or mentions in the body.
     // Persist the exclusion so later scheduled windows do not revisit it.
     if(excludedAuthor(row.author)){
      if(!db.records[row.id]){db.records[row.id]={status:'ignored_grok',at:Date.now()};await save();}
      continue;
     }
     if(!row.addressed||row.author.toLowerCase()===account.slice(1).toLowerCase()||!recent(row.at)||row.at>db.batchUntil||!row.text||(db.records[row.id]&&db.records[row.id].status!=='failed'))continue;
     const prior=(await chrome.storage.local.get('xAssistantProcessedV1')).xAssistantProcessedV1?.posts?.[row.id];
     if(prior&&['verified','in_flight','unknown'].includes(prior.reply)){db.records[row.id]={status:'previously_processed'};await save();continue;}
     options.show('DeepSeek 正在回复通知 @'+row.author);
     const generated=await boundedAI({kind:'AI_NOTIFICATION_REPLY',runId,post:{id:row.id,text:row.text}});check(signal);
     if(yieldToPost()){await defer();return {complete:false};}
     if(!recent(row.at))continue;
     if(generated.postId!==row.id)throw Error('通知回复 ID 不匹配');
     if(generated.action==='skip'){db.records[row.id]={status:'skipped'};await save();continue;}
     if(generated.action!=='send_reply')throw Error('通知 AI 返回无效');
     // Persist reservation before any send. Crash/stop never silently retries it.
     db.records[row.id]={status:'in_flight',text:generated.text,at:Date.now()};await save();
     try{
      await sendReply(row,generated.text,signal);
      db.records[row.id].status='confirmed';await save();
      await patch({phase:'notification_scan'});
     }catch(e){
      if(!replySubmitted&&e.name==='ExpiredReplyError'){
       if(!await discardResidual())throw Error('过期评论草稿无法取消，已停止');
       db.records[row.id].status='skipped_expired';await save();await patch({phase:'notification_scan'});options.show(e.message);
      }else if(!replySubmitted&&e.message==='通知目标已更新，请重新扫描'){
       db.records[row.id].status='skipped_updated';await save();
       await patch({phase:'notification_scan'});options.show('通知目标已更新，跳过此评论并继续');
      }else if(!replySubmitted&&(document.querySelector('[role="dialog"],[role="alertdialog"]')||e.name==='YieldError')){
       if(!await discardResidual()){db.records[row.id].status='failed';await save();throw Error('弹窗取消失败，已停止');}
       db.records[row.id].status=e.name==='YieldError'?'failed':'skipped_popup';await save();
       await patch({phase:'notification_scan'});options.show('已取消弹窗，跳过此评论');
       if(e.name==='YieldError'){await defer();return {complete:false};}
      }else{db.records[row.id].status=replySubmitted?'unknown':'failed';await save();if(!replySubmitted)await cleanup();throw e;}
     }
     const replyDelay=core.randomSeconds(10,30);
     options.show(`本条处理结束 · 等待 ${replyDelay.toFixed(1)} 秒后处理下一条`);
     for(let end=Date.now()+replyDelay*1000;Date.now()<end;){if(yieldToPost()){await defer();return {complete:false};}options.show(`本条处理结束 · ${((end-Date.now())/1000).toFixed(1)} 秒`);await sleep(Math.min(100,end-Date.now()),signal);}
    }
    const signature=rows.map(r=>r.id).join(',');stable=signature===last?stable+1:0;last=signature;
    if(rows.length&&rows.every(r=>r.at<Date.now()-86400000))break;
    if(stable>=3){if(document.querySelector('[role="progressbar"]'))return await rest('通知仍在加载，暂未确认有可回复评论');break;}
    window.scrollBy(0,Math.max(600,innerHeight*.8));await sleep(1800,signal);
    if(screen===99)return await rest('本轮扫描达到上限，未将未扫描评论标记为完成');
   }
   delete db.batchUntil;
   db.cycles++;db.lastChecked=Date.now();db.nextAt=0;await save();
   options.show('最近24小时内暂无待回复评论，本轮休息');return {complete:true};
  }catch(e){if(e.name==='YieldError'&&!replySubmitted){await defer();return {complete:false};}throw e;}finally{
   // Never navigate away from a retained draft or after user cancellation.
   if(!signal.aborted&&!document.querySelector('[role="dialog"],[role="alertdialog"]')&&location.pathname.startsWith('/notifications'))await navigate('/home');
   if(!signal.aborted&&location.pathname==='/home')await globalThis.XAssistantInteraction.resume(token);
  }
 },isRecent:recent,discardResidual,shouldIgnore:excludedAuthor,async nextAt(account){return (await read())[account.toLowerCase()]?.nextAt||0;}};
})();
