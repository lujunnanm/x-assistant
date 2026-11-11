// Site markup lives here, not in scheduling or retry policy.
(() => {
  const threadRecords=new Map();
  const sourceMedia=record=>({...Object.fromEntries(['imageUrls','videoUrls','gifUrls'].filter(key=>Array.isArray(record?.[key])&&record[key].length<=4&&record[key].every(url=>typeof url==='string'&&url.length<=2048)).map(key=>[key,[...record[key]]])),...(record?.missingGif===true?{missingGif:true}:{})});
  const ingestThreadRecords=records=>{
    for(const r of records){
      if(!/^\d+$/.test(r.id)||!/^\d+$/.test(r.root)||! /^[A-Za-z0-9_]{1,15}$/.test(r.author))continue;
      const text=typeof r.text==='string'&&r.text.trim()&&r.text.length<=16000?r.text:null;
      threadRecords.set(r.id,{id:r.id,root:r.root,author:r.author.toLowerCase(),replyCount:r.replyCount,safeOriginal:r.safeOriginal===true,parent:r.parent,parentAuthor:r.parentAuthor,text,...sourceMedia(r)});
    }
  };
  globalThis.window?.addEventListener?.('message',event=>{
    if(event.source!==window||event.origin!=='https://x.com'||event.data?.type!=='SACRED_THREAD_METADATA_V1'||!Array.isArray(event.data.records))return;
    ingestThreadRecords(event.data.records);
  });
  globalThis.window?.postMessage?.({type:'SACRED_THREAD_METADATA_REQUEST'},'https://x.com');
  const ownsOriginal=(id,owner)=>{
    const comment=threadRecords.get(id),root=comment&&threadRecords.get(comment.root);
    if(comment&&comment.id!==comment.root&&comment.parent===comment.root&&/^[A-Za-z0-9_]{1,15}$/.test(comment.parentAuthor||'')){
      return comment.parentAuthor.toLowerCase()===String(owner).replace(/^\//,'').toLowerCase();
    }
    if(!comment||!root||comment.id===root.id||root.parent||root.id!==root.root)return null;
    return root.author===String(owner).replace(/^\//,'').toLowerCase();
  };
  const originalPost=(id,owner)=>{
    const r=threadRecords.get(id);
    return !!r&&r.id===r.root&&!r.parent&&r.author===String(owner).replace(/^\//,'').toLowerCase();
  };
  const deletableOriginal=(id,owner)=>originalPost(id,owner)&&threadRecords.get(id)?.safeOriginal===true;
  const inThread=(id,rootId)=>threadRecords.get(id)?.root===rootId&&id!==rootId;
  const directChildOf=(id,rootId)=>/^\d+$/.test(rootId||'')&&threadRecords.get(id)?.parent===rootId;
  // Nested replies can belong to the same conversation without commenting
  // directly on the owner's original post. Keep direct-child ownership distinct.
  const directOnOwnOriginal=(id,owner)=>{
    const record=threadRecords.get(id);if(!record||record.id===record.root||record.parent!==record.root)return false;
    if(threadRecords.has(record.root)&&!originalPost(record.root,owner))return false;
    return ownsOriginal(id,owner)===true;
  };
  // Observability only: metadata is not a mounted card, a target or authority to reply.
  const loadedDirectChildren=rootId=>{
    if(!/^\d+$/.test(rootId||''))return 0;
    let count=0;for(const r of threadRecords.values())if(r.id!==rootId&&r.root===rootId&&r.parent===rootId)count++;
    return count;
  };
  const normalize = value => String(value || '').replace(/(?:(?:https?:\/\/)?pic\.x\.com\/[A-Za-z0-9]+\s*)+$/,'').replace(/\s+/g,' ').trim();
  const account = () => document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
  const dialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(d => !d.querySelector('[role="dialog"],[role="alertdialog"]'));
  // A quote card can precede the expanded post's footer. Never borrow a time
  // or body from that card, even when it happens to match the requested row.
  function ownPart(card,node){
    if(card.parentElement?.closest('article')||node.closest('article')!==(card.matches('article')?card:null)||node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
    const embed=node.closest('[role="link"]:not(a),[data-testid="quoteTweet"],[data-testid="card.wrapper"]');
    return !embed||embed===card||!card.contains(embed);
  }
  // Edited posts on their canonical detail surface can show a native /history
  // time instead of a permalink. It is read-only evidence, never a navigation
  // target: public statusStamp(), post(), and list/deletion paths stay strict.
  function stampFor(article,detail=false){
    if(!article.matches('article'))return null;
    let result=null;
    for(const time of article.querySelectorAll('time')){
      const link=time.closest('a[href]');
      if(!link||link.closest('article')!==article||!ownPart(article,time))continue;
      const m=link.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(\/history)?$/);
      if(!m||m[3]&&!detail)continue;
      if(result)return null;
      if(m[3]){
        const handle='/'+m[1].toLowerCase(),canonical='https://x.com'+handle+'/status/'+m[2];
        if(globalThis.location?.href?.toLowerCase()!==canonical||link.href.toLowerCase()!==canonical+'/history'||time.closest('[data-testid="tweetText"]'))return null;
        const headers=[...article.querySelectorAll('[data-testid="User-Name"]')].filter(h=>ownPart(article,h)&&!h.closest('[data-testid="tweetText"]'));
        if(headers.length!==1)return null;
        const profiles=[...headers[0].querySelectorAll('a[href]')].filter(a=>ownPart(article,a)&&/^\/[a-z0-9_]{1,15}$/i.test(a.getAttribute('href')||''));
        if(!profiles.length||!profiles.every(a=>a.href.toLowerCase()==='https://x.com'+handle)||
          !profiles.some(a=>a.textContent.trim().toLowerCase()==='@'+m[1].toLowerCase()))return null;
      }
      result={time,link,author:m[1],id:m[2]};
    }
    return result&&Number.isFinite(Date.parse(result.time.dateTime))?result:null;
  }
  const statusStamp=article=>stampFor(article);
  function statusText(card){
    const bodies=[...card.querySelectorAll('[data-testid="tweetText"]')].filter(e=>ownPart(card,e));
    return bodies.length>1?null:(bodies[0]?.textContent||'');
  }
  function post(article, owner = account()) {
    const stamp=statusStamp(article);if(!stamp)return null;
    const {author,id,time}=stamp,text=statusText(article);if(text===null)return null;
    const replyLabels=[...article.querySelectorAll('div[dir]')].filter(e =>
      /^(回复\s|Replying to\s)/i.test(e.textContent) && e.textContent.length < 250 && !e.querySelector('[data-testid="tweetText"]'));
    const replyRecipients=[...new Set(replyLabels.flatMap(e=>[...e.querySelectorAll('a[href]')]
      .map(a=>a.getAttribute('href')?.toLowerCase()).filter(h=>/^\/[a-z0-9_]{1,15}$/.test(h||''))))];
    const thread=threadRecords.get(id),root=thread&&thread.id!==thread.root?threadRecords.get(thread.root):null;
    const isComment=!!(thread&&thread.id!==thread.root)||replyRecipients.length>0;
    const rootPost=root&&root.id===root.root&&!root.parent&&(root.text||root.imageUrls?.length||root.videoUrls?.length||root.gifUrls?.length||root.missingGif)?{id:root.id,author:root.author,text:root.text||'',url:`https://x.com/${root.author}/status/${root.id}`,...sourceMedia(root)}:null;
    const ownOriginalComment=ownsOriginal(id,owner);
    const detail=globalThis.location?.pathname?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
    // Detail pages omit "Replying to". Require both account-bound page identity
    // and verified conversation metadata; recommendation cards never qualify.
    const ownThreadComment=!!detail&&('/'+detail[1]).toLowerCase()===owner&&
      ownOriginalComment===true&&inThread(id,detail[2]);
    const addressed=replyRecipients.includes(owner)||ownThreadComment;
    const directComment=addressed&&ownOriginalComment===true;
    const quoteHandles = [...article.querySelectorAll('[role="link"]:not(a)')].flatMap(q => [...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase()));
    const replyButton=article.querySelector('[data-testid="reply"]');
    const countText=(replyButton?.getAttribute?.('aria-label')||replyButton?.textContent||'').trim();
    const exactCount=countText.match(/^([0-9][0-9,]*)\s*(?:回复|repl(?:y|ies)|件の返信|$)/i);
    const replyCount=exactCount?Number(exactCount[1].replace(/,/g,'')):threadRecords.get(id)?.replyCount??null;
    const clipped=[...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some(e=>ownPart(article,e));
    return {article, id, author, replyCount, text, clipped, time:time.dateTime, at:Date.parse(time.dateTime), addressed, directComment, ownOriginalComment, replyRecipients, quoteHandles, isComment, rootPost, ...(thread?.author===author.toLowerCase()?sourceMedia(thread):{}),url:`https://x.com/${author}/status/${id}`};
  }
  const rows = owner => [...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>!a.closest('[role="dialog"]')).map(a=>post(a,owner)).filter(Boolean);
  function relocate(row, owner, requireAddressed=false) {
    const matches=rows(owner).filter(r=>r.article.isConnected && r.id===row.id && r.author.toLowerCase()===row.author.toLowerCase() && r.time===row.time && normalize(r.text)===normalize(row.text) && (!requireAddressed || r.addressed));
    return matches.length===1 ? matches[0] : null;
  }
  function matches(dialog, row) {
    const sameText = text => {
      const actual=normalize(text), expected=normalize(row.text);
      return actual===expected || (row.quoteHandles||[]).some(h=>actual===expected+' x.com/'+h+'/st…');
    };
    const cards=[...dialog.querySelectorAll('article[data-testid="tweet"]')];
    const contexts=cards.length ? cards : [dialog];
    return contexts.filter(card=> {
      const stamp=statusStamp(card),text=statusText(card);
      if(text===null||stamp&&(stamp.id!==row.id||stamp.author.toLowerCase()!==row.author.toLowerCase()))return false;
      // A fallback composer may have one unlinked author timestamp. Multiple
      // clocks, especially multiple status links, cannot use that fallback.
      const times=[...card.querySelectorAll('time')].filter(t=>ownPart(card,t));
      const time=stamp?.time||(times.length===1&&!times[0].closest('a[href]')?times[0]:null);
      return Number.isFinite(Date.parse(row.time)) && time?.getAttribute('datetime')===row.time && sameText(text) &&
        [...card.querySelectorAll('a[href]')].some(a=>{
          if(!ownPart(card,a)||a.closest('[data-testid="tweetText"]'))return false;
          try{const u=new URL(a.href);return u.origin==='https://x.com'&&!u.search&&!u.hash&&u.pathname.toLowerCase()==='/'+row.author.toLowerCase();}catch{return false;}
        });
    }).length===1;
  }
  function replyEditor(root) {
    // X may put the test id on the Draft wrapper instead of the textbox.
    if(!root)return null;
    const known=[...root.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"],[data-testid="tweetTextarea_0"] [contenteditable="true"]')];
    const editors=known.length?known:[...root.querySelectorAll('[role="textbox"][contenteditable="true"]')];
    return editors.length===1?editors[0]:null;
  }
  function standaloneReply(row) {
    if(!/^\/compose\/(?:post|tweet)\/?$/.test(globalThis.location?.pathname||'')||dialogs().length)return null;
    const main=document.querySelector('[data-testid="primaryColumn"]')||document.querySelector('main,[role="main"]');
    const editor=replyEditor(main);
    if(!editor || (editor.closest('article,[data-testid="tweetText"]')))return null;
    // The reply button we actually clicked must have navigated to a standalone
    // reply composer. A bare /compose/post, quote composer, or background feed
    // with an unrelated editor must never qualify as a reply.
    let scope=editor.parentElement;
    while(scope&&main.contains(scope)){
      if(scope.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]').length===1 &&
        scope.querySelectorAll('time').length===1 && matches(scope,row)){
        const recipient=[...scope.querySelectorAll('[dir],button,[role="button"]')].some(node=>{
          if(node.closest('article,[data-testid="tweetText"],[contenteditable="true"]')||node.querySelector('article,[data-testid="tweetText"],[contenteditable="true"]'))return false;
          const label=normalize(node.textContent);
          if(label.length>180||!/^(?:Replying to(?:\s|$)|(?:正在)?回[复覆](?:给|給)?\s*|返信先[：:]?\s*)/i.test(label))return false;
          const exact=new RegExp('@'+row.author+'(?![A-Za-z0-9_])','i');
          return exact.test(label)||[...node.querySelectorAll('a[href]')].some(a=>a.getAttribute('href')?.toLowerCase()==='/'+row.author.toLowerCase());
        });
        if(recipient)return {dialog:scope,editor,standalone:true};
      }
      if(scope===main)break;scope=scope.parentElement;
    }
    return null;
  }
  const articleSelector='article[data-testid="tweet"]', editorSelector='[contenteditable="true"]', inlineSelector='[data-testid="tweetButtonInline"]';
  const excluded='[hidden],[inert],[aria-hidden="true"],[role="dialog"],[role="alertdialog"]';
  function detailReply(row,diagnose=false) {
    // Never infer reply ownership from a global tweetTextarea_0. Both the status
    // permalink and the immediately preceding tweet in the primary column must
    // identify the selected body/author/timestamp; the inline action must say Reply.
    const path=globalThis.location?.pathname||'',meta={path,reason:'route'};
    const fail=reason=>diagnose?{...meta,reason}:null;
    const status=path.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if(!status||status[2]!==row.id||status[1].toLowerCase()!==row.author.toLowerCase())return fail('route');
    meta.dialogs=dialogs().length;if(meta.dialogs)return fail('dialog');
    const mains=[...document.querySelectorAll('[data-testid="primaryColumn"]')].filter(e=>!e.closest(excluded));
    if(mains.length!==1)return fail('primary:'+mains.length);
    const main=mains[0],available=e=>!e.closest(excluded);
    const cards=[...main.querySelectorAll(articleSelector)].filter(available);
    if(diagnose){meta.idMatches=0;meta.linkMatches=0;meta.timeMatches=0;}
    let editedDetail=false,targetText;
    const targets=cards.filter(a=>{
      const stamp=stampFor(a,true);
      if(!stamp||stamp.id!==row.id)return false;
      if(diagnose)meta.idMatches++;
      if(stamp.author.toLowerCase()!==row.author.toLowerCase())return false;
      if(diagnose)meta.linkMatches++;
      if(stamp.time.dateTime!==row.time)return false;
      if(diagnose)meta.timeMatches++;
      const text=statusText(a),expected=normalize(row.text),actual=normalize(text);
      // A native "Show more" source card is only a prefix preview. The status
      // route, id, author and timestamp above still have to bind exactly.
      if(text===null||actual!==expected&&!(row.clipped===true&&expected.length>=20&&actual.startsWith(expected)))return false;
      editedDetail=stamp.link.getAttribute('href').endsWith('/history');targetText=text;return true;
    });
    meta.cards=cards.length;meta.target=targets.length;
    if(targets.length!==1)return fail('target');
    const editors=[...main.querySelectorAll(editorSelector)].filter(e=>available(e)&&!e.closest('article'));
    const buttons=[...main.querySelectorAll(inlineSelector)].filter(e=>available(e)&&!e.closest('article'));
    meta.editors=editors.length;meta.buttons=buttons.length;
    if(editors.length!==1||buttons.length!==1)return fail('controls');
    const editor=editors[0],button=buttons[0],target=targets[0];
    const roots=[...main.querySelectorAll('[data-testid="inline_reply_offscreen"]')].filter(available);
    meta.inline=roots.length;
    if(roots.length!==1)return fail('reply_wrapper');
    const scope=roots[0],cell=scope.closest('[data-testid="cellInnerDiv"]');
    const parents=cell&&[...cell.querySelectorAll(articleSelector)].filter(available);
    if(!parents||parents.length!==1||parents[0]!==target||!(target.compareDocumentPosition(scope)&4))return fail('not_adjacent');
    if(!scope.contains(editor)||!scope.contains(button)||scope.querySelector(articleSelector)||replyEditor(scope)!==editor)return fail('unbound');
    const label=normalize(button.textContent)||normalize(button.getAttribute('aria-label'));
    if(!/^(?:reply|回复|回覆|返信)(?:する)?$/i.test(label))return fail('not_reply');
    if(diagnose)return {...meta,reason:'ready'};
    return {dialog:scope,editor,button,article:target,editedDetail,text:targetText};
  }
  let previousRead=null;
  function beginDetailRead({id,path,runId,signal}={}){
    let port=null,closed=false,stop;
    const stats=()=>{const [ticks=0,frames=0,pending=0]=(port?.getAttribute('data-stats')||'').split(',').map(Number);return {ticks,frames,pending};};
    const end=()=>{if(closed)return;closed=true;stop?.abort();signal?.removeEventListener('abort',end);
      port?.dispatchEvent(new Event('sacred-detail-read-end'));if(previousRead===end)previousRead=null;};
    end.stats=stats;
    const W=globalThis.XAssistantWorkspace,R=globalThis.XAssistantRuntime;
    const can=()=>{try{
      const a=W?.state?.().assignment,owner=account();
      if(!signal||signal.aborted||!runId||!document.hidden||!/^\d+$/.test(id)||!owner||a?.account?.toLowerCase()!==owner||
        a.module!=='notifications'||W.active()!=='notifications'||location.pathname!==path||path.toLowerCase()!==owner+'/status/'+id||dialogs().length)return false;
      W.check(signal);return true;
    }catch{return false;}};
    if(!can()||typeof globalThis.chrome?.dom?.openOrClosedShadowRoot!=='function')return end;
    previousRead?.();
    document.dispatchEvent(new Event('sacred-detail-read-bridge'));
    const host=document.querySelector('[data-sacred-detail-clock]');
    port=host&&chrome.dom.openOrClosedShadowRoot(host)?.firstElementChild;
    if(!port)return end;
    previousRead=end;stop=new AbortController();signal.addEventListener('abort',end,{once:true});
    const until=Date.now()+12000;
    void(async()=>{try{
      for(let i=0;i<48&&!closed&&Date.now()<until&&can();i++){
        port.dispatchEvent(new Event('sacred-detail-read-pulse'));
        await R.sleep(250,stop.signal);
      }
    }catch{}finally{end();}})();
    return end;
  }
  globalThis.XAssistantDOM = {statusStamp,statusText,beginDetailRead,normalize,account,dialogs,replyEditor,standaloneReply,detailReply,post,rows,relocate,matches,ingestThreadRecords,ownsOriginal,originalPost,deletableOriginal,inThread,directChildOf,directOnOwnOriginal,loadedDirectChildren};
})();
