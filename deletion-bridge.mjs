// Only the caller-created deletion task tab is touched. No background listener,
// general command channel, site postMessage, or fallback to the active tab.
const err=(code,message)=>Object.assign(Error(message),{code});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function exact(raw,want){try{const u=new URL(raw);return u.origin==='https://x.com'&&u.pathname.toLowerCase()===want;}catch{return false;}}
function probe(target,recover=false){
 if(location.origin!=='https://x.com')return null;
 const api=globalThis.XAssistantDeletionDOM,d=globalThis.document,path=location.pathname.toLowerCase(),account=api?.account()??null;
 const nav=globalThis.performance?.getEntriesByType?.('navigation')?.[0],http=nav?.responseStatus;
 const visible=n=>!n.closest?.('article,#x-assistant-float,[hidden],[aria-hidden="true"]')&&(!n.getClientRects||n.getClientRects().length>0);
 const nodes=q=>[...(d?.querySelectorAll?.(q)??[])].filter(visible);
 const gate=/^\/(?:i\/flow\/(?:login|signup|challenge)|login|account\/(?:access|locked)|challenge)(?:\/|$)/i.test(path)||
  nodes('input[type="password"],[data-testid="loginButton"],iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],[id*="captcha"]').length>0;
 const warning=/rate limit|too many requests|try again later|something went wrong|verify (?:your|you are)|unusual activity|challenge|temporarily restricted|sign in to [xX]|log in to [xX]|达到.*限制|超出.*限制|频率限制|稍后再试|出了点问题|出错了|验证身份|请登录|認証が必要|しばらくして/iu;
 const sign=/^(?:log in|sign in|登录|登入|ログイン)$/iu;
 const short=!account&&d?.body?.innerText;
 const verificationShell=!account&&typeof short==='string'&&!short.trim()&&!!d?.querySelector?.('script[src*="/cdn-cgi/challenge-platform/"],script[src*="challenges.cloudflare.com/"],script[src*="hcaptcha.com/"],script[src*="recaptcha/"],iframe[src*="/cdn-cgi/challenge-platform/"]');
 const blocked=gate||verificationShell||(typeof short==='string'&&short.length<=500&&!d.querySelector?.('article')&&warning.test(short))||(typeof http==='number'&&http>=400)||nodes('[role="alert"],[data-testid="error-detail"],[data-testid="error-message"],[data-testid="emptyState"],main h1,main h2').some(n=>warning.test(n.innerText||n.textContent||''))||
  (!account&&nodes('a[href="/login"],a[href="/i/flow/login"],button,[role="button"]').some(n=>sign.test((n.innerText||n.textContent||'').trim())));
 const row=!blocked&&target?api?.inspect(target)??null:null;
 // Strictly a completed empty HTTP 200 top-level navigation, not just an unmounted account link.
 const blank=!!target&&!blocked&&!account&&d?.readyState==='complete'&&typeof d.body?.innerText==='string'&&!d.body.innerText.trim()&&http===200&&nav.name===location.href&&
  location.href==='https://x.com'+target.account+'/status/'+target.id&&!nodes('button,[role="button"],input,iframe,form,article,[role="dialog"],[role="progressbar"],[aria-busy="true"],canvas').length;
 if(recover&&blank){location.reload();return {path,account,row:null,blocked:false,blank:true,reloading:true};}
 return {path,account,row,blocked,blank};
}
// Serialized into the extension's isolated world by chrome.scripting. No free variables.
function connectOnce(name,target){
 const port=chrome.runtime.connect({name}),controller=new AbortController();
 let stage='idle',accept,reject;
 const stop=()=>{controller.abort();reject?.(Error('确认连接已关闭'));};
 const timer=setTimeout(()=>{stop();try{port.disconnect();}catch{}},35000);
 port.onDisconnect.addListener(()=>{clearTimeout(timer);stop();});
 port.onMessage.addListener(msg=>{
  if(msg?.type==='ack'&&stage==='requested'){stage='authorized';accept();return;}
  if(msg?.type!=='start'||stage!=='idle')return;
  stage='started';
  (async()=>{
   const api=globalThis.XAssistantDeletionDOM;
   const receipt=await api.remove(target,{signal:controller.signal,beforeConfirm:fresh=>{
    if(stage!=='started'||controller.signal.aborted)throw Error('删除确认已失效');
    stage='requested';
    return new Promise((res,rej)=>{accept=res;reject=rej;port.postMessage({type:'before',fresh});});
   }});
   if(!controller.signal.aborted)port.postMessage({type:'done',receipt});
  })().catch(()=>{try{port.postMessage({type:'failed'});}catch{}});
 });
}

export function createDeletionBridge({tabId,account,assertLive}){
 if(!Number.isInteger(tabId)||tabId<0||typeof account!=='string'||!/^\/?[A-Za-z0-9_]{1,15}$/.test(account)||typeof assertLive!=='function')throw err('DELETE_BRIDGE','删除标签或账号无效');
 const owner='/'+account.replace(/^\//,'').toLowerCase(),api=globalThis.chrome;
 let closed=false,lock=null,inProgress=null;
 function local(signal){if(closed||signal?.aborted)throw err('CANCELLED','删除已停止');}
 async function guard(signal){local(signal);if(await assertLive()===false)throw err('CANCELLED','删除任务已失效');local(signal);}
 async function read(target,doc,recover=false){
  const result=await api.scripting.executeScript({target:{tabId,...(doc?{documentIds:[doc]}:{frameIds:[0]})},func:probe,args:[target??null,recover]});
  const r=result?.length===1?result[0]:null;return r?.frameId===0&&r.documentId&&(!doc||r.documentId===doc)?r:null;
 }
 async function currentAccount(){
  await guard();const end=Date.now()+12000;
  do{
   await guard();let r;try{r=await read(null);}catch(e){if(!/cannot access|no frame|removed|navigat|frame with id/i.test(e.message))throw e;}
   if(r?.result?.blocked)throw err('X_ACCESS_BLOCKED','X 要求登录、验证或提示访问受限，需人工处理；未重试');
   if(r?.result?.account){await guard();return r.result.account;}
   if(Date.now()<end)await pause(220);
  }while(Date.now()<end);
  throw err('ACCOUNT_UNAVAILABLE','X 页面未就绪，无法核对当前账号');
 }
 async function inspect(id){
  if(inProgress)throw err('DELETE_BUSY','上一笔删除尚未结束');
  lock=null;
  if(typeof id!=='string'||!/^\d{1,20}$/.test(id))throw err('INVALID_TARGET','帖子编号无效');
  if(await currentAccount()!==owner)throw err('ACCOUNT_CHANGED','删除页账号不符');
  const path=owner+'/status/'+id,target={account:owner,id};await guard();
  await api.tabs.update(tabId,{url:'https://x.com'+path});
  let end=Date.now()+18000,blankDoc=null,emptySince=0,reloaded=null,sawAccount=false;
  do{
   await guard();const tab=await api.tabs.get(tabId);
   if([tab.url,tab.pendingUrl].some(url=>url&&/^https:\/\/x\.com\/(?:i\/flow\/(?:login|signup|challenge)|login|account\/(?:access|locked)|challenge)(?:[/?#]|$)/i.test(url)))throw err('X_ACCESS_BLOCKED','X 要求登录或验证；未重试');
   if(exact(tab.url,path)&&(!tab.pendingUrl||exact(tab.pendingUrl,path))){
    let r;try{r=await read(target);}catch(e){if(!/no frame|removed|navigat|frame with id/i.test(e.message))throw e;}
    if(r?.result?.blocked)throw err('X_ACCESS_BLOCKED','X 显示验证、访问受限或错误；已停止，需人工处理');
    if(r?.result?.account&&r.result.account!==owner)throw err('ACCOUNT_CHANGED','删除页账号变化');
    if(r?.result?.path===path&&r.result.account===owner)sawAccount=true;
    if(r?.result?.path===path&&r.result.blank&&r.documentId!==reloaded){
     if(blankDoc!==r.documentId){blankDoc=r.documentId;emptySince=Date.now();}
     if(Date.now()-emptySince>=3000){
      if(reloaded)throw err('ACCOUNT_UNAVAILABLE','只读重载后资料页仍是空壳，已停止');
      await guard(); // Execute the final shell check and reload in the exact same document.
      const fresh=await read(target,blankDoc,true);
      if(fresh?.result?.blocked)throw err('X_ACCESS_BLOCKED','X 访问受限，需人工处理；未重试');
      if(fresh?.result?.account&&fresh.result.account!==owner)throw err('ACCOUNT_CHANGED','重载前账号变化');
      if(fresh?.result?.reloading){reloaded=blankDoc;end=Date.now()+18000;emptySince=0;blankDoc=null;sawAccount=false;}
     }
    }else{blankDoc=null;emptySince=0;}
    if(r?.result?.path===path&&r.result.account===owner&&r.result.row?.id===id){
     await guard();lock={path,doc:r.documentId,id,text:r.result.row.text};return r.result.row;
    }
   }
   if(Date.now()<end)await pause(250);
  }while(Date.now()<end);
  if(!sawAccount)throw err('ACCOUNT_UNAVAILABLE','详情页未能核对登录账号；未执行删除');
  return null; // Missing proof / inaccessible detail is not a deletion receipt.
 }
 async function remove(row,{beforeConfirm,signal}={}){
  await guard(signal);
  if(inProgress||!lock||!row||row.account!==owner||row.id!==lock.id||row.text!==lock.text||typeof beforeConfirm!=='function')throw err('TARGET_CHANGED','删除目标未核对或已经使用');
  const {doc,path}=lock;lock=null;
  const target={account:owner,id:row.id,text:row.text},name='x-delete-once:'+crypto.randomUUID();
  return new Promise((resolve,reject)=>{
   let port=null,ended=false,before=false,acked=false,timer;
   const disconnect=()=>{try{port?.disconnect();}catch{}};
   const finish=(error,value)=>{if(ended)return;ended=true;inProgress=null;
    clearTimeout(timer);api.runtime.onConnect.removeListener(attach);signal?.removeEventListener('abort',cancel);disconnect();
    if(error){if(acked)error.submitted=true;reject(error);}else resolve(value);};
   const cancel=()=>finish(err('CANCELLED','删除已停止'));
   inProgress=cancel;
   const attach=candidate=>{
    if(candidate.name!==name)return;
    const s=candidate.sender;
    if(ended||port||s?.id!==api.runtime.id||s?.frameId!==0||s?.tab?.id!==tabId||s?.documentId!==doc||!exact(s?.url,path)){try{candidate.disconnect();}catch{}return;}
    port=candidate;
    port.onDisconnect.addListener(()=>finish(err('DELETE_CONNECTION','删除确认通道已断开')));
    port.onMessage.addListener(msg=>{
     (async()=>{
      if(ended)return;
      if(msg?.type==='before'&&!before){
       before=true;const fresh=msg.fresh;
       if(!fresh||fresh.id!==target.id||fresh.account!==owner||fresh.text!==target.text)throw err('TARGET_CHANGED','确认前目标变化');
       await guard(signal);await beforeConfirm(fresh);await guard(signal);
       if(ended)return;
       acked=true;port.postMessage({type:'ack'});return;
      }
      const r=msg?.receipt;
      if(msg?.type==='done'&&r?.id===target.id&&((acked&&['deleted','unknown','skipped'].includes(r.status))||(!before&&r.status==='skipped'))){finish(null,r);return;}
      throw err('DELETE_PROTOCOL','无法核对删除结果');
     })().catch(e=>finish(e));
    });
    guard(signal).then(()=>{if(!ended)port.postMessage({type:'start'});}).catch(e=>finish(e));
   };
   api.runtime.onConnect.addListener(attach);signal?.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>finish(err('DELETE_TIMEOUT','删除核验超时')),32000);
   if(signal?.aborted){cancel();return;}
   api.scripting.executeScript({target:{tabId,documentIds:[doc]},func:connectOnce,args:[name,target]}).catch(e=>finish(e));
  });
 }
 function close(){closed=true;lock=null;inProgress?.();}
 return {currentAccount,inspect,remove,close};
}
