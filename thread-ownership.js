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
    const eligible=()=>{const path=location.pathname,m=path.match(/^\/([a-z0-9_]{1,15})\/status\/\d+$/i);
      return document.hidden&&!!m&&document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase()==='/'+m[1].toLowerCase()&&
        !document.querySelector('[role="dialog"],[role="alertdialog"]');};
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
  const sourceMedia=(legacy,id,author)=>{
    const media=legacy.extended_entities?.media??legacy.entities?.media;
    if(!Array.isArray(media))return {};
    const imageUrls=[],videoUrls=[],gifUrls=[];let missingGif=false;
    for(const [index,item] of media.entries()){
      // Quoted/borrowed media must never be attributed to this post.
      if(item.source_status_id_str&&String(item.source_status_id_str)!==String(id))continue;
      if(item.type==='photo'&&typeof item.media_url_https==='string')imageUrls.push(item.media_url_https);
      if(item.type==='video')videoUrls.push(`https://x.com/${author}/status/${id}/video/${index+1}`);
      if(item.type==='animated_gif'){
        const variants=item.video_info?.variants;
        const gif=Array.isArray(variants)&&variants.find(v=>v?.content_type==='video/mp4'&&/^https:\/\/video\.twimg\.com\/tweet_video\/[A-Za-z0-9_-]{1,128}\.mp4(?:\?tag=\d+)?$/.test(v.url||''));
        if(gif)gifUrls.push(gif.url);else missingGif=true;
      }
    }
    return {imageUrls,videoUrls,...(gifUrls.length?{gifUrls}:{}),...(missingGif?{missingGif:true}:{})};
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
        const r={id:String(id),root:String(legacy.conversation_id_str),author,
          safeOriginal:legacy.is_quote_status===false&&!legacy.quoted_status_id_str&&!node.quoted_status_result&&!legacy.retweeted_status_result&&!node.retweeted_status_result&&!legacy.retweeted_status_id_str,
          replyCount:Number.isInteger(legacy.reply_count)?legacy.reply_count:null,
          parent:legacy.in_reply_to_status_id_str||null,parentAuthor:legacy.in_reply_to_screen_name||null,
          text:sourceText(node,legacy),...sourceMedia(legacy,id,author)};
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
  const op=url=>{try{const u=new URL(url,location.origin);return u.origin==='https://x.com'&&u.origin===location.origin&&!u.search&&!u.hash&&/^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/DeleteTweet$/.test(u.pathname)?u.href:null;}catch{return null;}};
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
    const req=args[0],init=args[1];let attempt,body;
    try{attempt=deleteStart(init?.method??req?.method??'GET',req?.url??req);
      if(attempt){body=init?.body;if(body===undefined&&typeof req?.clone==='function')body=req.clone().text().catch(()=>null);}
    }catch{attempt=null;}
    const response=await original.apply(this,args);
    if(attempt)try{
      if(op(response.url)===attempt.endpoint&&response.status>=200&&response.status<300){
        const clone=response.clone();Promise.resolve(body).then(async b=>{if(onlyId(b,attempt.w.id))recordDelete(attempt,response.status,response.url,await clone.json());}).catch(()=>{});
      }
    }catch{}
    if(relevant(response.url))try{response.clone().json().then(consume).catch(()=>{});}catch{}
    return response;
  };
  if(globalThis.XMLHttpRequest){
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,requests=new WeakMap();
    XMLHttpRequest.prototype.open=function(...args){
      requests.delete(this);
      const endpoint=String(args[0]).toUpperCase()==='POST'?op(args[1]):null;
      if(endpoint)requests.set(this,{endpoint,sent:false});
      if(relevant(args[1]))this.addEventListener('load',()=>{
        try{consume(this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
      },{once:true});
      return open.apply(this,args);
    };
    if(typeof send==='function')XMLHttpRequest.prototype.send=function(body){
      try{const req=requests.get(this),attempt=req&&!req.sent&&deleteStart('POST',req.endpoint);if(req)req.sent=true;
        if(attempt&&onlyId(body,attempt.w.id))this.addEventListener('load',()=>{
          try{if(requests.get(this)===req)recordDelete(attempt,this.status,this.responseURL,this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
        },{once:true});
      }catch{}
      return send.apply(this,arguments);
    };
  }
})();
