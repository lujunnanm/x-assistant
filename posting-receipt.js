// Observe before clicking: X may reuse an existing toast or remove it quickly.
(function(root){
 const notices='[data-testid="toast"],[role="alert"],[role="status"]';
 const success=/帖子已发送|Post sent|Your post was sent|Your Tweet was sent/i;
 const duplicate=/already (?:said|sent|posted)|duplicate|你已经说过|已(?:经)?发送过|你已(?:经)?发过了|你已(?:經)?發過了|重复的帖子|重复内容|重复发布/i;
 // For inline notification replies only. A denial is a skip, never a success receipt.
 const replyDuplicate=/^(?:(?:哇哦|哇喔)[！!，,]\s*)?(?:你已[经經]?[发發][过過]了?|你已[经經]?[发發][布佈送][过過](?:了|这条帖子|這則貼文)?|(?:you(?: have|'ve)? already (?:said that|posted (?:that|this)|sent (?:that|this)))|duplicate content)[.!。！]?$/iu;
 const replySuccess=/^(?:(?:(?:你的|您的)?(?:帖子|回复|貼文|回覆)(?:已(?:经|經)?(?:发送|發送|发布|發佈))|已发布|Your (?:post|reply|tweet) was sent|Post sent)[。！.!]?\s*(?:查看|View)?)[。.!]?$/iu;
 const inlineError=/^(?:出错了[，,]\s*别担心[，,]\s*让我们再试一次|出錯了[，,]\s*別擔心[，,]\s*讓我們再試一次|something went wrong(?:[,.!]?\s*(?:but don['’]t fret.*|please try again))?)[。.!！]?$/iu;
 const rejected=/达到.*限制|超过.*限制|速率限制|频率限制|操作(?:过于)?频繁|请求过于频繁|rate limit|too many requests|HTTP\s*429/i;
 const generic=/Something went wrong|出错了|出了点问题|發生錯誤|发生错误|問題が発生/i;
 // X adds empty editor blocks around mentions; compare nonempty lines, not their spacing.
 // Keep punctuation, mentions, inline spaces and nonempty line boundaries significant.
 const receiptText=value=>typeof value==='string'?value.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim().split('\n').filter(line=>line.trim()).join('\n'):'';
 function create({document,MutationObserver,account,text,hasMedia=false,native=null,replyTarget=null,now=Date.now,setInterval,clearInterval}){
  const inline=()=>replyTarget?.primary?.()?.querySelectorAll?.('span,[dir="auto"]')||[];
  const banner=()=>[...inline()].filter(e=>!e.children?.length&&!e.closest?.('article,[contenteditable="true"],#x-assistant-float')&&inlineError.test((e.textContent||'').trim()));
  const oldBanner=new Map(banner().map(e=>[e,e.textContent]));
  const baseline=new Map([...document.querySelectorAll(notices)].map(e=>[e,e.textContent]));
  const oldPosts=new Set([...document.querySelectorAll('article time')].map(e=>e.closest('a')?.href));
  const startedAt=now(),expectedText=receiptText(text);let result=null,hint=null,refusal=null,observer,timer;
  const scan=()=>{
   if(result)return result;
   const observed=native?.poll();
   if(observed?.kind==='confirmed')return result=observed;
   if(replyTarget&&!hint){const e=banner().find(n=>oldBanner.get(n)!==n.textContent);if(e)hint=e.textContent.trim().slice(0,320);}
   if(observed?.kind==='not_sent'&&!replyTarget)return null;
   for(const e of document.querySelectorAll(notices)){
    // Never read our own overlay's status as a platform receipt.
    if(e.closest?.('#x-assistant-float'))continue;
    const raw=e.textContent||'';if(baseline.get(e)===raw)continue;
    const message=raw.trim();
    if(replyTarget&&e.closest?.('article,[contenteditable="true"]'))continue;
    if((replyTarget?replySuccess:success).test(message)){result={kind:'confirmed',evidence:'x_notice',message};break;}
    if((replyTarget?replyDuplicate:duplicate).test(message)){refusal={kind:'rejected',reason:'duplicate',evidence:'x_notice',message};continue;}
    if(rejected.test(message)){refusal??={kind:'rejected',...(replyTarget?{reason:'rate_limit'}:{}),evidence:'x_notice',message};continue;}
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
      (!replyTarget||replyTarget.matchesParent(id))&&date>=(hint?startedAt:startedAt-5000)&&date<=now()+5000&&receiptText(body.innerText)===expectedText){
     result={kind:'confirmed',evidence:'visible_post',url:link.href};break;
    }
   }
   return result;
  };
  observer=new MutationObserver(scan);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  timer=setInterval(scan,100);
  // A known denial stays provisional while X can still issue a native retry.
  const atDeadline=()=>result||native?.poll()||refusal;
  return {poll:scan,atDeadline,close(){observer.disconnect();clearInterval(timer);native?.close();},get result(){return result;},get hint(){return hint;},get nativeResult(){return native?.poll()||null;},get refusal(){return refusal;}};
 }
 root.XAssistantPostingReceipt={create};
})(globalThis);
