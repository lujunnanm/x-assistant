// Optional readback of X's existing inline-composer request, not a send path.
(() => {
 const hostSelector=':scope > [data-sacred-post-watch]';
 function create({document,button,account,text,parentId=null,mediaCount=0,timeout=15000}){
  try{
   if(typeof globalThis.chrome?.dom?.openOrClosedShadowRoot!=='function'||!button?.isConnected||
    button.getAttribute('data-testid')!=='tweetButtonInline'||typeof text!=='string'||
    !Number.isInteger(mediaCount)||mediaCount<0||mediaCount>4||!/^\/[a-z0-9_]{1,15}$/i.test(account||''))return null;
   const path=document.defaultView.location.pathname;
   if(parentId!==null&&(!/^[1-9]\d{0,19}$/.test(parentId)||!new RegExp('^/[a-z0-9_]{1,15}/status/'+parentId+'$','i').test(path)))return null;
   const owner=account.toLowerCase(),mains=[...document.querySelectorAll('[data-testid="primaryColumn"]')];
   const controls=mains.length===1?[...mains[0].querySelectorAll('[data-testid="tweetButtonInline"]')].filter(n=>
    n.isConnected&&!n.closest('article,[role="dialog"],[role="alertdialog"],[hidden],[inert],[aria-hidden="true"]')):[];
   if(controls.length!==1||controls[0]!==button)return null;
   const hosts=()=>[...document.documentElement.querySelectorAll(hostSelector)],old=new Set(hosts());
   document.defaultView.dispatchEvent(new Event('sacred-post-watch'));
   const fresh=hosts().filter(n=>!old.has(n));if(fresh.length!==1)return null;
   const host=fresh[0],port=chrome.dom.openOrClosedShadowRoot(host)?.firstElementChild;if(!port)return null;
   const close=()=>port.dispatchEvent(new Event('sacred-post-end'));
   for(const [key,value] of Object.entries({account:owner,text,...(parentId?{parent:parentId}:{}),'media-count':mediaCount,timeout}))port.setAttribute('data-'+key,String(value));
   port.dispatchEvent(new Event('sacred-post-arm'));
   if(port.getAttribute('data-armed')!=='1'){close();return null;}
   const poll=()=>{
    if(!host.isConnected||document.defaultView.location.pathname!==(parentId?path:'/home')||
     document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase()!==owner)return null;
    let result;try{result=JSON.parse(port.getAttribute('data-result'));}catch{return null;}
    if(result?.evidence!=='x_create_result'||(result.parentId||null)!==parentId)return null;
    if(result.kind==='confirmed'&&typeof result.postId==='string'&&/^[1-9]\d{0,19}$/.test(result.postId)&&result.url==='https://x.com'+owner+'/status/'+result.postId)
     return {kind:'confirmed',evidence:'x_create_result',...(parentId?{parentId}:{}),postId:result.postId,url:result.url};
    if(result.kind==='not_sent'&&(result.reason==='rate_limit'&&result.code===88||result.reason==='temporary_rejection'&&result.code===130))
     return {kind:'not_sent',evidence:'x_create_result',...(parentId?{parentId}:{}),reason:result.reason,code:result.code,...(Number.isFinite(result.retryAt)&&result.retryAt>0?{retryAt:result.retryAt}:{})};
    return null;
   };
   return {poll,close};
  }catch{return null;}
 }
 globalThis.XAssistantPostingNative={create};
})();
