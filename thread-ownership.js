// Observe responses already requested by X; never issue extra authenticated requests.
(() => {
  // Chrome pauses real animation frames in hidden tabs. Remember their native
  // handles from document_start; without a private extension pulse they keep
  // exactly their native schedule. Never spoof visibility or foreground a tab.
  function enableReadFrames(){
    const native=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
    if(typeof native!=='function'||typeof cancel!=='function')return;
    const pending=new Map();
    window.requestAnimationFrame=function(callback){
      if(!document.hidden||typeof callback!=='function')return native.call(window,callback);
      const frame={callback,done:false};
      const id=native.call(window,time=>{if(frame.done)return;frame.done=true;pending.delete(id);callback.call(window,time);});
      pending.set(id,frame);
      if(pending.size>128)pending.delete(pending.keys().next().value); // untracked ones remain native
      return id;
    };
    window.cancelAnimationFrame=function(id){const frame=pending.get(id);if(frame)frame.done=true;pending.delete(id);return cancel.call(window,id);};
    const eligible=()=>{const m=location.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d+)$/i);
      if(!document.hidden||!m||document.querySelector('[role="dialog"],[role="alertdialog"]'))return false;
      const owner=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
      if(owner==='/'+m[1].toLowerCase())return true;
      // A nested read is allowed only along native parent metadata to our own
      // original. Matching conversation IDs alone cannot authorize a branch.
      let row=cache.get(m[2]);const root=row&&cache.get(row.root),seen=new Set();
      if(!row||row.author.toLowerCase()!==m[1].toLowerCase()||!root||root.id!==root.root||root.parent||owner!=='/'+root.author.toLowerCase())return false;
      while(row&&row.id!==root.id){
        if(seen.has(row.id)||row.root!==root.id)return false;
        seen.add(row.id);row=cache.get(row.parent);
      }
      return row?.id===root.id;
    };
    let close=null;
    document.addEventListener('sacred-detail-read-bridge',()=>{
      if(!eligible()||!document.documentElement)return;
      close?.();
      // A page script can see this host but not its closed root or pulse target.
      // Only the extension's isolated world can resolve it via chrome.dom.
      const host=document.createElement('span');host.setAttribute('data-sacred-detail-clock','');host.hidden=true;
      const port=document.createElement('span');host.attachShadow({mode:'closed'}).append(port);
      const path=location.pathname,end=Date.now()+12500;
      let ticks=0,frames=0,last=-Infinity;
      const publish=()=>{port.setAttribute('data-stats',[ticks,frames,pending.size].join(','));};
      const done=()=>{clearTimeout(timer);host.remove();port.removeEventListener('sacred-detail-read-pulse',pulse);if(close===done)close=null;};
      const pulse=()=>{
        if(Date.now()>=end||!eligible()||location.pathname!==path||ticks>=48){done();return;}
        if(Date.now()-last<100)return;
        last=Date.now();ticks++;
        const time=performance.now();
        // Snapshot before running callbacks: an animation requesting its next
        // frame cannot execute it again within the same pulse.
        for(const [id,frame] of [...pending].slice(0,32)){
          if(!pending.has(id))continue;
          if(!eligible()||location.pathname!==path||Date.now()>=end)break;
          frame.done=true;pending.delete(id);cancel.call(window,id);frames++;
          try{frame.callback.call(window,time);}catch(e){globalThis.reportError?.(e);}
        }
        publish();
      };
      const timer=setTimeout(done,12500);
      close=done;port.addEventListener('sacred-detail-read-pulse',pulse);port.addEventListener('sacred-detail-read-end',done,{once:true});
      publish();document.documentElement.append(host);
    });
  }
  enableReadFrames();
  const cache=new Map();
  function publish(records){if(records.length)window.postMessage({type:'SACRED_THREAD_METADATA_V1',records},location.origin);}
  const sourceText=(node,legacy)=>{
    const values=[node.note_tweet?.note_tweet_results?.result?.text,legacy.full_text,legacy.text];
    return values.find(value=>typeof value==='string'&&value.trim()&&value.length<=16000)||null;
  };
  const replyPrefix=(legacy,text)=>{
    // X moves leading reply recipients out of tweetText. Keep the raw body;
    // only publish the hidden prefix proven by both display range and entities.
    const range=legacy.display_text_range,mentions=legacy.entities?.user_mentions;
    if(!/^\d+$/.test(legacy.in_reply_to_status_id_str||'')||typeof text!=='string'||
       text!==legacy.full_text&&text!==legacy.text||!Array.isArray(range)||range.length!==2||
       !range.every(Number.isInteger)||range[0]<=0||range[0]>1024||range[1]<range[0]||range[1]>text.length||!Array.isArray(mentions))return {};
    const prefix=text.slice(0,range[0]);
    if(!/^(?:@[A-Za-z0-9_]{1,15}\s+)+$/.test(prefix))return {};
    for(const m of prefix.matchAll(/@([A-Za-z0-9_]{1,15})/g)){
      if(!mentions.some(e=>e?.screen_name===m[1]&&e.indices?.[0]===m.index&&e.indices?.[1]===m.index+m[0].length))return {};
    }
    return {replyTextPrefix:prefix};
  };
  const sourceMedia=(legacy,id,author)=>{
    const media=legacy.extended_entities?.media??legacy.entities?.media;
    if(!Array.isArray(media))return {};
    const imageUrls=[],videoUrls=[],videoSources=[],gifUrls=[],mediaTextUrls=[];let missingGif=false;
    for(const [index,item] of media.entries()){
      // Quoted/borrowed media must never be attributed to this post.
      if(item.source_status_id_str&&String(item.source_status_id_str)!==String(id))continue;
      // X hides its own attachment token in the rendered body. Keep the raw
      // text intact; reply comparison may ignore only these exact media URLs.
      if(['photo','video','animated_gif'].includes(item.type)&&/^https:\/\/t\.co\/[A-Za-z0-9]{1,128}$/.test(item.url||'')&&mediaTextUrls.length<4&&!mediaTextUrls.includes(item.url))mediaTextUrls.push(item.url);
      if(item.type==='photo'&&typeof item.media_url_https==='string')imageUrls.push(item.media_url_https);
      if(item.type==='video'){
        const url=`https://x.com/${author}/status/${id}/video/${index+1}`;videoUrls.push(url);
        // Read only X's own already-requested response. These short-lived URLs
        // prove a composer's embedded clip; they are not saved in the copy library.
        const variants=item.video_info?.variants;
        const urls=Array.isArray(variants)?[...new Set(variants.filter(v=>v?.content_type==='video/mp4'&&typeof v.url==='string'&&v.url.length<=2048&&
          /^https:\/\/video\.twimg\.com\/(?:amplify_video|ext_tw_video)\/\d+\/vid\/[A-Za-z0-9_./-]+\.mp4(?:\?tag=\d+)?$/.test(v.url)).map(v=>v.url))].slice(0,16):[];
        if(urls.length)videoSources.push({url,urls});
      }
      if(item.type==='animated_gif'){
        const variants=item.video_info?.variants;
        const gif=Array.isArray(variants)&&variants.find(v=>v?.content_type==='video/mp4'&&/^https:\/\/video\.twimg\.com\/tweet_video\/[A-Za-z0-9_-]{1,128}\.mp4(?:\?tag=\d+)?$/.test(v.url||''));
        if(gif)gifUrls.push(gif.url);else missingGif=true;
      }
    }
    return {imageUrls,videoUrls,...(videoSources.length?{videoSources}:{}),...(mediaTextUrls.length?{mediaTextUrls}:{}),...(gifUrls.length?{gifUrls}:{}),...(missingGif?{missingGif:true}:{})};
  };
  function consume(data){
    const records=[],seen=new Set();
    function visit(node){
      if(!node||typeof node!=='object'||seen.has(node))return;
      seen.add(node);
      const legacy=node.legacy||node,user=node.core?.user_results?.result;
      const author=user?.legacy?.screen_name||user?.core?.screen_name||node.user?.screen_name;
      const id=node.rest_id||node.id_str;
      if(id&&legacy.conversation_id_str&&author){
        const text=sourceText(node,legacy);
        const r={id:String(id),root:String(legacy.conversation_id_str),author,
          safeOriginal:legacy.is_quote_status===false&&!legacy.quoted_status_id_str&&!node.quoted_status_result&&!legacy.retweeted_status_result&&!node.retweeted_status_result&&!legacy.retweeted_status_id_str,
          replyCount:Number.isInteger(legacy.reply_count)?legacy.reply_count:null,
          parent:legacy.in_reply_to_status_id_str||null,parentAuthor:legacy.in_reply_to_screen_name||null,
          text,...replyPrefix(legacy,text),...sourceMedia(legacy,id,author)};
        cache.set(r.id,r);records.push(r);
      }
      for(const value of Object.values(node))if(value&&typeof value==='object')visit(value);
    }
    visit(data);publish(records);
    while(cache.size>10000)cache.delete(cache.keys().next().value);
  }
  const relevant=url=>{try{const u=new URL(url,location.origin);return u.origin===location.origin&&u.pathname.includes('/i/api/');}catch{return false;}};
  window.addEventListener?.('message',e=>{
    if(e.source===window&&e.origin===location.origin&&e.data?.type==='SACRED_THREAD_METADATA_REQUEST')publish([...cache.values()]);
  });
  // Private one-shot readback: the isolated deletion driver arms a closed-root
  // port, then clicks X's actual confirmation. Only network traffic initiated by
  // X after that click can provide a receipt. Nothing here constructs a request.
  let armed=null;
  globalThis.document?.addEventListener?.('sacred-delete-watch',()=>{
    const route=/^\/(\w{1,15})\/status\/([1-9]\d{0,19})$/i.exec(location.pathname);
    const confirm=document.querySelectorAll('[data-testid="confirmationSheetConfirm"]');
    if(location.origin!=='https://x.com'||!route||confirm.length!==1||
       document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase()!=='/'+route[1].toLowerCase())return;
    const host=document.createElement('span'),port=document.createElement('span');host.hidden=true;
    host.setAttribute('data-sacred-delete-watch','');host.attachShadow({mode:'closed'}).append(port);
    const now=()=>performance.now(),watch={id:route[2],port,clicked:null,opened:now()};
    const onClick=e=>{if(armed===watch&&watch.clicked===null&&now()-watch.opened<=1000&&e.composedPath().includes(confirm[0]))watch.clicked=now();};
    const close=()=>{if(armed===watch)armed=null;window.removeEventListener('click',onClick,true);clearTimeout(timer);host.remove();};
    const timer=setTimeout(close,11000);window.addEventListener('click',onClick,true);
    port.addEventListener('sacred-delete-end',close,{once:true});port.addEventListener('sacred-delete-arm',()=>{armed=watch;},{once:true});
    document.documentElement.append(host);
  });
  const writeOp=(url,name)=>{try{const u=new URL(url,location.origin);return u.origin==='https://x.com'&&u.origin===location.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(?:CreateTweet|DeleteTweet)$/.test(u.pathname)&&u.pathname.endsWith('/'+name)?u.href:null;}catch{return null;}};
  const op=url=>writeOp(url,'DeleteTweet');
  const postOp=url=>writeOp(url,'CreateTweet');
  const inlineButton='[data-testid="tweetButtonInline"]',postEditor='[data-testid="tweetTextarea_0"][contenteditable="true"],[data-testid="tweetTextarea_0"] [contenteditable="true"]';
  const currentAccount=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
  const exactText=text=>typeof text==='string'?text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/\n+$/,''):null;
  const composerText=e=>{const blocks=e.querySelectorAll('[data-contents="true"] > [data-block="true"]');return exactText(blocks.length?[...blocks].map(b=>b.textContent||'').join('\n'):e.innerText??e.textContent??'');};
  const postRoute=()=>location.origin==='https://x.com'&&location.pathname==='/home';
  const postAccount=/^\/[a-z0-9_]{1,15}$/;
  const statusId=/^[1-9]\d{0,19}$/;
  const requestWindow=2500;
  let postWatch=null;
  window.addEventListener?.('sacred-post-watch',event=>{
    event.stopImmediatePropagation?.();
    if(!postRoute()||postWatch||!globalThis.document)return;
    const account=currentAccount();
    if(!postAccount.test(account||'')||document.querySelector('[role="dialog"],[role="alertdialog"]'))return;
    const primary=document.querySelectorAll('[data-testid="primaryColumn"]');
    if(primary.length!==1)return;
    const main=primary[0],excluded='article,[role="dialog"],[role="alertdialog"],[hidden],[inert],[aria-hidden="true"]';
    const live=n=>n.isConnected&&!n.closest(excluded);
    const buttons=[...main.querySelectorAll(inlineButton)].filter(live),editors=[...main.querySelectorAll(postEditor)].filter(live);
    if(buttons.length!==1||editors.length!==1)return;
    const [button]=buttons,[editor]=editors;
    let composer=editor.parentElement;
    while(composer&&composer!==main&&!composer.contains(button))composer=composer.parentElement;
    if(!composer||composer===main||composer.querySelector('article,[data-testid="inline_reply_offscreen"],[data-testid="quoteTweet"],[data-testid="pollOptions"],[data-testid="tweetText"]'))return;
    const host=document.createElement('span'),port=document.createElement('span');host.hidden=true;
    host.setAttribute('data-sacred-post-watch','');host.attachShadow({mode:'closed'}).append(port);
    const watch={account,port,opened:performance.now(),clicked:null,requestCount:0};
    const stop=()=>{if(postWatch===watch)postWatch=null;window.removeEventListener('click',onClick,true);clearTimeout(timer);clearTimeout(watch.releaseError);host.remove();};
    const onClick=e=>{
      if(postWatch!==watch||watch.clicked!==null||performance.now()-watch.opened>1000||e.composedPath()[0]!==button||
        !postRoute()||currentAccount()!==account||!live(button)||!live(editor)||!composer.contains(button)||!composer.contains(editor)||composerText(editor)!==watch.text)return;
      watch.clicked=performance.now();watch.clickedAt=Date.now();
    };
    const timer=setTimeout(stop,47000);window.addEventListener('click',onClick,true);
    port.addEventListener('sacred-post-end',stop,{once:true});
    port.addEventListener('sacred-post-arm',()=>{
      const text=port.getAttribute('data-text'),count=port.getAttribute('data-media-count'),timeout=Number(port.getAttribute('data-timeout'));
      if(postWatch||port.getAttribute('data-account')!==account||typeof text!=='string'||text.length>50000||
        composerText(editor)!==exactText(text)||!/^\d$/.test(count||'')||Number(count)>4||(!text.trim()&&count==='0')||
        !Number.isFinite(timeout)||timeout<1000||timeout>45000){stop();return;}
      Object.assign(watch,{text:exactText(text),mediaCount:Number(count),timeout});
      postWatch=watch;port.setAttribute('data-armed','1');
    },{once:true});
    document.documentElement.append(host);
  },true);
  const postStart=(method,url)=>{
    const w=postWatch;
    if(w?.clicked==null||String(method).toUpperCase()!=='POST')return null;
    const elapsed=performance.now()-w.clicked,endpoint=postOp(url);
    if(!endpoint||elapsed<0||elapsed>w.timeout)return null;
    if(++w.requestCount!==1){w.port.removeAttribute('data-result');return null;}
    return elapsed<=requestWindow&&postRoute()&&currentAccount()===w.account?{w,endpoint}:null;
  };
  const object=o=>o&&typeof o==='object'&&!Array.isArray(o);
  const matchingPost=(body,w)=>{
    if(typeof body!=='string'||body.length>128000)return false;
    try{
      const v=JSON.parse(body)?.variables;
      // Fail closed on new variables until known to describe a single original post.
      if(!object(v)||!Object.keys(v).every(k=>['tweet_text','dark_request','media','semantic_annotation_ids','disallowed_reply_options','reply_options','possibly_sensitive','nullcast'].includes(k))||
        exactText(v.tweet_text)!==w.text||('dark_request' in v&&v.dark_request!==false)||('nullcast' in v&&v.nullcast!==false))return false;
      if(v.media==null)return w.mediaCount===0;
      const items=v.media.media_entities;
      return object(v.media)&&Object.keys(v.media).every(k=>['media_entities','possibly_sensitive'].includes(k))&&Array.isArray(items)&&
        items.length===w.mediaCount&&items.every(m=>object(m)&&statusId.test(m.media_id)&&typeof m.media_id==='string')&&new Set(items.map(m=>m.media_id)).size===items.length;
    }catch{return false;}
  };
  const postingRetryAt=(header,limited)=>{
    const now=Date.now(),after=header?.('retry-after')?.trim(),reset=limited?header?.('x-rate-limit-reset')?.trim():null;
    const times=[/^\d+$/.test(after||'')?now+Number(after)*1000:Date.parse(after||''),/^\d+$/.test(reset||'')?Number(reset)*1000:NaN];
    return Math.max(0,...times.filter(n=>Number.isFinite(n)&&n>now&&n<=now+14*86400000));
  };
  const recordPost=(a,status,url,payload,header)=>{
    const w=a.w,valid=()=>postWatch===w&&w.requestCount===1&&performance.now()-w.clicked<=w.timeout&&postRoute()&&currentAccount()===w.account;
    if(!valid()||postOp(url)!==a.endpoint||!object(payload))return;
    const data=payload.data,created=data?.create_tweet,node=created?.tweet_results?.result;
    const saved=node?.__typename==='TweetWithVisibilityResults'?node.tweet:node;
    const id=saved?.rest_id,legacy=saved?.legacy,user=saved?.core?.user_results?.result;
    const author=user?.core?.screen_name??user?.legacy?.screen_name;
    const freshId=typeof id==='string'&&statusId.test(id)?Number(BigInt(id)>>22n)+1288834974657:NaN;
    if(status>=200&&status<300&&[payload,data,created,created?.tweet_results,node,saved,legacy].every(noErrors)&&
      saved.__typename==='Tweet'&&typeof author==='string'&&('/'+author.toLowerCase())===w.account&&legacy.conversation_id_str===id&&
      !legacy.in_reply_to_status_id_str&&!legacy.quoted_status_id_str&&!legacy.is_quote_status&&!saved.quoted_status_result&&
      !legacy.retweeted_status_result&&!saved.retweeted_status_result&&freshId>=w.clickedAt-5000&&freshId<=Date.now()+5000){
      w.port.setAttribute('data-result',JSON.stringify({kind:'confirmed',evidence:'x_create_result',postId:id,url:'https://x.com'+w.account+'/status/'+id}));
      return;
    }
    const error=Array.isArray(payload.errors)&&payload.errors.length===1&&!('error' in payload)?payload.errors[0]:null;
    const nullCreate=object(data)&&Object.keys(data).length===1&&data.create_tweet===null;
    const reason=error?.code===88&&(status===429||status===200)&&(data==null||nullCreate)?'rate_limit':
      error?.code===130&&(status===200||status===503)&&nullCreate&&typeof error.message==='string'&&/^Over capacity[.!]?$/i.test(error.message.trim())?'temporary_rejection':null;
    if(!reason)return;
    // A generic response or failed transport does not prove a write was rejected.
    // This is provisional. The isolated driver waits its original receipt window;
    // another native request anywhere in that interval revokes this evidence.
    const retryAt=postingRetryAt(header,reason==='rate_limit');
    clearTimeout(w.releaseError);
    w.releaseError=setTimeout(()=>{
      if(valid())w.port.setAttribute('data-result',JSON.stringify({kind:'not_sent',evidence:'x_create_result',reason,code:error.code,...(retryAt?{retryAt}:{})}));
    },Math.max(0,requestWindow-(performance.now()-w.clicked))+1);
  };
  const deleteStart=(method,url)=>{
    const w=armed;if(!w||w.clicked===null||performance.now()-w.clicked>2500||String(method).toUpperCase()!=='POST')return null;
    const endpoint=op(url);return endpoint?{w,endpoint}:null;
  };
  const onlyId=(body,id)=>{
    if(typeof body!=='string'||body.length>16384)return false;
    try{const v=JSON.parse(body)?.variables;return v&&v.tweet_id===id&&Object.keys(v).every(k=>k==='tweet_id'||k==='dark_request')&&(!('dark_request'in v)||v.dark_request===false);}catch{return false;}
  };
  const noErrors=o=>o&&!Array.isArray(o)&&typeof o==='object'&&(!('errors'in o)||Array.isArray(o.errors)&&o.errors.length===0)&&!('error'in o);
  const recordDelete=(a,status,url,data)=>{
    if(armed!==a.w||performance.now()-a.w.clicked>9500||op(url)!==a.endpoint||!Number.isInteger(status)||status<200||status>299)return;
    const d=data?.data,v=d?.delete_tweet,r=v?.tweet_results;
    if([data,d,v,r].every(noErrors)&&(!('result'in r)||noErrors(r.result)&&(!r.result.rest_id||r.result.rest_id===a.w.id)&&!r.result.__typename?.match(/Error|Unavailable|Tombstone/i)))
      a.w.port.setAttribute('data-confirmed','1');
  };
  const original=window.fetch;
  window.fetch=async function(...args){
    const req=args[0],init=args[1];let attempt,post,body;
    try{const method=init?.method??req?.method??'GET',url=req?.url??req;
      attempt=deleteStart(method,url);post=postStart(method,url);
      if(attempt||post){body=init?.body;if(body===undefined&&typeof req?.clone==='function')body=req.clone().text().catch(()=>null);}
    }catch{attempt=null;post=null;}
    const response=await original.apply(this,args);
    if(attempt)try{
      if(op(response.url)===attempt.endpoint&&response.status>=200&&response.status<300){
        const clone=response.clone();Promise.resolve(body).then(async b=>{if(onlyId(b,attempt.w.id))recordDelete(attempt,response.status,response.url,await clone.json());}).catch(()=>{});
      }
    }catch{}
    if(post)try{
      if(postOp(response.url)===post.endpoint){
        const clone=response.clone();Promise.resolve(body).then(async b=>{if(matchingPost(b,post.w))recordPost(post,response.status,response.url,await clone.json(),key=>response.headers?.get(key));}).catch(()=>{});
      }
    }catch{}
    if(relevant(response.url))try{response.clone().json().then(consume).catch(()=>{});}catch{}
    return response;
  };
  if(globalThis.XMLHttpRequest){
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,requests=new WeakMap();
    XMLHttpRequest.prototype.open=function(...args){
      requests.delete(this);
      const endpoint=String(args[0]).toUpperCase()==='POST'?(op(args[1])||postOp(args[1])):null;
      if(endpoint)requests.set(this,{endpoint,sent:false});
      if(relevant(args[1]))this.addEventListener('load',()=>{
        try{consume(this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
      },{once:true});
      return open.apply(this,args);
    };
    if(typeof send==='function')XMLHttpRequest.prototype.send=function(body){
      try{const req=requests.get(this),attempt=req&&!req.sent&&deleteStart('POST',req.endpoint),post=req&&!req.sent&&postStart('POST',req.endpoint);if(req)req.sent=true;
        if(attempt&&onlyId(body,attempt.w.id))this.addEventListener('load',()=>{
          try{if(requests.get(this)===req)recordDelete(attempt,this.status,this.responseURL,this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
        },{once:true});
        if(post&&matchingPost(body,post.w))this.addEventListener('load',()=>{
          try{if(requests.get(this)===req)recordPost(post,this.status,this.responseURL,this.responseType==='json'?this.response:JSON.parse(this.responseText),key=>this.getResponseHeader?.(key));}catch{}
        },{once:true});
      }catch{}
      return send.apply(this,arguments);
    };
  }
})();
