// Observe before clicking: X may reuse an existing toast or remove it quickly.
(function(root){
 const notices='[data-testid="toast"],[role="alert"],[role="status"]';
 const success=/帖子已发送|Post sent|Your post was sent|Your Tweet was sent/i;
 const duplicate=/already (?:said|sent|posted)|duplicate|你已经说过|已(?:经)?发送过|你已(?:经)?发过了|你已(?:經)?發過了|重复的帖子|重复内容|重复发布/i;
 const rejected=/达到.*限制|超过.*限制|速率限制|频率限制|操作(?:过于)?频繁|请求过于频繁|rate limit|too many requests|HTTP\s*429/i;
 const generic=/Something went wrong|出错了|出了点问题|發生錯誤|发生错误|問題が発生/i;
 // X adds empty editor blocks around mentions; compare nonempty lines, not their spacing.
 // Keep punctuation, mentions, inline spaces and nonempty line boundaries significant.
 const receiptText=value=>typeof value==='string'?value.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim().split('\n').filter(line=>line.trim()).join('\n'):'';
 function create({document,MutationObserver,account,text,hasMedia=false,native=null,now=Date.now,setInterval,clearInterval}){
  const baseline=new Map([...document.querySelectorAll(notices)].map(e=>[e,e.textContent]));
  const oldPosts=new Set([...document.querySelectorAll('article time')].map(e=>e.closest('a')?.href));
  const startedAt=now(),expectedText=receiptText(text);let result=null,hint=null,refusal=null,observer,timer;
  const scan=()=>{
   if(result)return result;
   const observed=native?.poll();
   if(observed?.kind==='confirmed')return result=observed;
   if(observed?.kind==='not_sent')return null;
   for(const e of document.querySelectorAll(notices)){
    // Never read our own overlay's status as a platform receipt.
    if(e.closest?.('#x-assistant-float'))continue;
    const raw=e.textContent||'';if(baseline.get(e)===raw)continue;
    const message=raw.trim();
    if(success.test(message)){result={kind:'confirmed',evidence:'x_notice',message};break;}
    if(duplicate.test(message)){refusal={kind:'rejected',reason:'duplicate',evidence:'x_notice',message};continue;}
    if(rejected.test(message)){refusal??={kind:'rejected',evidence:'x_notice',message};continue;}
    // A generic X error is not proof that its write was rejected.
    if(generic.test(message))hint??=message.slice(0,320);
   }
   if(!result&&!refusal&&expectedText&&!hasMedia)for(const a of document.querySelectorAll('article')){
    const time=a.querySelector('time'),link=time?.closest('a'),body=a.querySelector('[data-testid="tweetText"]');
    if(!link||oldPosts.has(link.href)||!body)continue;
    let url;try{url=new URL(link.href);}catch{continue;}
    const date=Date.parse(time.getAttribute('datetime'));
    const id=url.pathname.slice(account.length+'/status/'.length);
    if(url.origin==='https://x.com'&&url.pathname.toLowerCase().startsWith(account.toLowerCase()+'/status/')&&/^\d+$/.test(id)&&
      date>=(hint?startedAt:startedAt-5000)&&date<=now()+5000&&receiptText(body.innerText)===expectedText){
     result={kind:'confirmed',evidence:'visible_post',url:link.href};break;
    }
   }
   return result;
  };
  observer=new MutationObserver(scan);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  timer=setInterval(scan,100);
  // A known denial stays provisional while X can still issue a native retry.
  const atDeadline=()=>result||native?.poll()||refusal;
  return {poll:scan,atDeadline,close(){observer.disconnect();clearInterval(timer);native?.close();},get result(){return result;},get hint(){return hint;},get refusal(){return refusal;}};
 }
 root.XAssistantPostingReceipt={create};
})(globalThis);
