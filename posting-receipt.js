// Observe before clicking: X may reuse an existing toast or remove it quickly.
(function(root){
 const notices='[data-testid="toast"],[role="alert"],[role="status"]';
 const success=/帖子已发送|Post sent|Your post was sent|Your Tweet was sent/i;
 const rejected=/already (?:said|sent|posted)|duplicate|你已经说过|已(?:经)?发送过|重复的帖子|重复内容|重复发布|Something went wrong|出错了|出了点问题|达到.*限制|超过.*限制|rate limit/i;
 function create({document,MutationObserver,account,text,now=Date.now,setInterval,clearInterval}){
  const baseline=new Map([...document.querySelectorAll(notices)].map(e=>[e,e.textContent]));
  const oldPosts=new Set([...document.querySelectorAll('article time')].map(e=>e.closest('a')?.href));
  const startedAt=now();let result=null,observer,timer;
  const scan=()=>{
   if(result)return result;
   for(const e of document.querySelectorAll(notices)){
    // Never read our own overlay's status as a platform receipt.
    if(e.closest?.('#x-assistant-float'))continue;
    const message=e.textContent||'';if(baseline.get(e)===message)continue;
    if(success.test(message)){result={kind:'confirmed',evidence:'x_notice',message};break;}
    if(rejected.test(message)){result={kind:'rejected',evidence:'x_notice',message};break;}
   }
   if(!result)for(const a of document.querySelectorAll('article')){
    const time=a.querySelector('time'),link=time?.closest('a'),body=a.querySelector('[data-testid="tweetText"]');
    if(!link||oldPosts.has(link.href)||!body)continue;
    const url=new URL(link.href),date=Date.parse(time.getAttribute('datetime'));
    if(url.pathname.startsWith(account+'/status/')&&date>=startedAt-5000&&date<=now()+5000&&body.innerText?.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim()===text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim()){
     result={kind:'confirmed',evidence:'visible_post',url:link.href};break;
    }
   }
   return result;
  };
  observer=new MutationObserver(scan);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  timer=setInterval(scan,100);
  return {poll:scan,close(){observer.disconnect();clearInterval(timer);},get result(){return result;}};
 }
 root.XAssistantPostingReceipt={create};
})(globalThis);
