// Site markup lives here, not in scheduling or retry policy.
(() => {
  const threadRecords=new Map(),clippedSources=new WeakMap();
  const sourceMedia=record=>({...Object.fromEntries(['imageUrls','videoUrls','gifUrls'].filter(key=>Array.isArray(record?.[key])&&record[key].length<=4&&record[key].every(url=>typeof url==='string'&&url.length<=2048)).map(key=>[key,[...record[key]]])),...(record?.missingGif===true?{missingGif:true}:{})});
  const videoSources=record=>Array.isArray(record.videoUrls)&&record.videoUrls.length<=4&&Array.isArray(record.videoSources)&&record.videoSources.length<=4?record.videoSources.filter(v=>
    typeof v?.url==='string'&&v.url.length<=2048&&record.videoUrls.includes(v.url)&&Array.isArray(v.urls)&&v.urls.length>0&&v.urls.length<=16&&v.urls.every(url=>typeof url==='string'&&url.length<=2048&&
    /^https:\/\/video\.twimg\.com\/(?:amplify_video|ext_tw_video)\/\d+\/vid\/[A-Za-z0-9_./-]+\.mp4(?:\?tag=\d+)?$/.test(url))).map(v=>({url:v.url,urls:[...v.urls]})):[];
  const ingestThreadRecords=records=>{
    for(const r of records){
      if(!/^\d+$/.test(r.id)||!/^\d+$/.test(r.root)||! /^[A-Za-z0-9_]{1,15}$/.test(r.author))continue;
      const text=typeof r.text==='string'&&r.text.trim()&&r.text.length<=16000?r.text:null;
      const mediaTextUrls=Array.isArray(r.mediaTextUrls)&&r.mediaTextUrls.length<=4&&r.mediaTextUrls.every(url=>typeof url==='string'&&/^https:\/\/t\.co\/[A-Za-z0-9]{1,128}$/.test(url))?[...new Set(r.mediaTextUrls)]:[];
      const replyTextPrefix=r.id!==r.root&&/^\d+$/.test(r.parent||'')&&typeof r.replyTextPrefix==='string'&&r.replyTextPrefix.length<=1024&&/^(?:@[A-Za-z0-9_]{1,15}\s+)+$/.test(r.replyTextPrefix)&&text?.startsWith(r.replyTextPrefix)?r.replyTextPrefix:'';
      threadRecords.set(r.id,{id:r.id,root:r.root,author:r.author.toLowerCase(),replyCount:r.replyCount,safeOriginal:r.safeOriginal===true,parent:r.parent,parentAuthor:r.parentAuthor,text,mediaTextUrls,replyTextPrefix,videoSources:videoSources(r),...sourceMedia(r)});
    }
  };
  globalThis.window?.addEventListener?.('message',event=>{
    if(event.source!==window||event.origin!=='https://x.com'||event.data?.type!=='SACRED_THREAD_METADATA_V1'||!Array.isArray(event.data.records))return;
    ingestThreadRecords(event.data.records);
  });
  globalThis.window?.postMessage?.({type:'SACRED_THREAD_METADATA_REQUEST'},'https://x.com');
  function postingVideoSources(url){
    const m=typeof url==='string'&&url.match(/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/video\/([1-4])$/);
    if(!m)return [];
    const r=threadRecords.get(m[2]);if(!r||r.author!==m[1].toLowerCase())return [];
    const source=r.videoSources.find(v=>v.url.toLowerCase()===url.toLowerCase());return source?[...source.urls]:[];
  }
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
  const threadIdentity=id=>{const r=threadRecords.get(id);return r?{id:r.id,root:r.root,author:r.author,parent:r.parent||null}:null;};
  const inBranch=(id,ancestorId,rootId=threadRecords.get(ancestorId)?.root)=>{
    const ancestor=threadRecords.get(ancestorId);
    if(!ancestor||ancestor.root!==rootId||id===ancestorId)return false;
    const seen=new Set();let record=threadRecords.get(id);
    while(record&&record.root===rootId&&!seen.has(record.id)){
      if(record.id===ancestorId)return true;
      seen.add(record.id);record=threadRecords.get(record.parent);
    }
    return false;
  };
  const loadedBranchIds=(ancestorId,rootId=threadRecords.get(ancestorId)?.root)=>
    [...threadRecords.keys()].filter(id=>inBranch(id,ancestorId,rootId));
  const hasOwnReply=(id,owner)=>{
    const target=threadRecords.get(id),author=String(owner||'').replace(/^\//,'').toLowerCase();
    if(!target||!/^[a-z0-9_]{1,15}$/.test(author))return false;
    for(const r of threadRecords.values())if(r.id!==id&&r.parent===id&&r.root===target.root&&r.author===author)return true;
    return false;
  };
  // Nested replies can belong to the same conversation without commenting
  // directly on the owner's original post. Keep direct-child ownership distinct.
  const directOnOwnOriginal=(id,owner)=>{
    const record=threadRecords.get(id);if(!record||record.id===record.root||record.parent!==record.root)return false;
    if(threadRecords.has(record.root)&&!originalPost(record.root,owner))return false;
    return ownsOriginal(id,owner)===true;
  };
  // Observability only: metadata is not a mounted card, a target or authority to reply.
  const loadedThreadIds=rootId=>[...threadRecords.values()].filter(r=>r.id!==rootId&&r.root===rootId).map(r=>r.id);
  const loadedDirectChildren=rootId=>{
    if(!/^\d+$/.test(rootId||''))return 0;
    let count=0;for(const r of threadRecords.values())if(r.id!==rootId&&r.root===rootId&&r.parent===rootId)count++;
    return count;
  };
  const normalize = value => String(value || '').replace(/(?:(?:https?:\/\/)?pic\.x\.com\/[A-Za-z0-9]+\s*)+$/,'').replace(/\s+/g,' ').trim();
  const unavailableVideo=record=>!!(record?.videoUrls?.length||record?.gifUrls?.length||record?.missingGif);
  function replyTextMatches(record,visible){
    const actual=normalize(visible);
    if(!actual&&!record.imageUrls?.length&&!unavailableVideo(record))return false;
    const candidates=[record.text];
    if(record.replyTextPrefix)candidates.push(record.text.slice(record.replyTextPrefix.length));
    for(const candidate of candidates){
      let expected=normalize(candidate);
      while(expected!==actual){
        // Only proven hidden recipients and own trailing attachment tokens
        // vary. Never strip arbitrary mentions/links or accept partial bodies.
        const tail=expected.match(/(?:^|\s)(https:\/\/t\.co\/[A-Za-z0-9]{1,128})$/);
        if(!tail||!record.mediaTextUrls.includes(tail[1]))break;
        expected=expected.slice(0,tail.index).trimEnd();
      }
      if(expected===actual)return true;
      // X can omit display_text_range for media-only replies. An empty body
      // may still carry its exact parent mention plus owned attachment tokens.
      // Do not erase arbitrary mentions or captions to manufacture a match.
      if(!actual&&record.id!==record.root&&typeof record.parentAuthor==='string'&&
        threadRecords.get(record.parent)?.author===record.parentAuthor.toLowerCase()&&
        expected.toLowerCase()==='@'+record.parentAuthor.toLowerCase())return true;
    }
    return false;
  }
  const textRecordKey=record=>JSON.stringify([record.id,record.author,record.root,record.parent||null,record.parentAuthor||null,record.text,record.replyTextPrefix,record.mediaTextUrls]);
  function detailTextMatches(row,visible){
    if(!row||typeof visible!=='string')return false;
    const expected=normalize(row.text),actual=normalize(visible);
    if(actual===expected)return true;
    if(row.clipped!==true||!expected||!actual.startsWith(expected))return false;
    if(expected.length>=20)return true;
    // A two-character native preview is common, but is not enough evidence by
    // itself. Bind it to the full native record already seen with this source
    // row; later metadata must not silently authorize a changed target body.
    const proof=clippedSources.get(row),record=threadRecords.get(row.id);
    return !!proof&&!!record&&proof.id===row.id&&proof.author===row.author.toLowerCase()&&
      proof.time===row.time&&proof.preview===expected&&proof.record===textRecordKey(record)&&
      replyTextMatches(record,visible);
  }
  function replyContext(row,owner){
    const live=detailReply(row),target=threadRecords.get(row.id);
    if(!live||!target||target.author!==row.author.toLowerCase()||
      !(target.text||target.imageUrls?.length||unavailableVideo(target))||!replyTextMatches(target,live.text))return null;
    const branch=[],seen=new Set();let record=target;
    while(record){
      if(seen.has(record.id)||branch.length>=34||record.root!==target.root||
        !(record.text||record.imageUrls?.length||unavailableVideo(record)))return null;
      seen.add(record.id);
      branch.unshift({id:record.id,author:record.author,text:record.id===row.id?live.text:record.text||'',parentId:record.parent||null,
        ...(record.imageUrls?.length?{imageUrls:[...record.imageUrls]}:{}),...(unavailableVideo(record)?{videoUnavailable:true}:{})});
      if(record.id===target.root){if(record.parent)return null;break;}
      if(!record.parent)return null;
      record=threadRecords.get(record.parent);
    }
    if(!branch.length||branch[0].id!==target.root||branch.reduce((n,r)=>n+r.text.length,0)>64000)return null;
    return {version:1,root:branch[0],history:branch.slice(1,-1),target:branch[branch.length-1]};
  }
  function replyHasImages(row){
    const target=threadRecords.get(row.id),seen=new Set();let record=target?.author===row.author.toLowerCase()?target:null;
    while(record&&record.root===target.root&&!seen.has(record.id)&&seen.size<34){
      if(record.imageUrls?.length)return true;
      seen.add(record.id);if(record.id===target.root)break;record=threadRecords.get(record.parent);
    }
    return false;
  }
  function replyHasVideo(row){
    const target=threadRecords.get(row.id),seen=new Set();let record=target?.author===row.author.toLowerCase()?target:null;
    // Follow only this target's actual ancestors, never neighboring comments.
    while(record&&record.root===target.root&&!seen.has(record.id)&&seen.size<34){
      if(record.videoUrls?.length||record.gifUrls?.length||record.missingGif)return true;
      seen.add(record.id);if(record.id===target.root)break;record=threadRecords.get(record.parent);
    }
    const article=detailReply(row)?.article||row.article,stamp=article?.isConnected&&statusStamp(article);
    return !!stamp&&stamp.id===row.id&&stamp.author.toLowerCase()===row.author.toLowerCase()&&
      [...article.querySelectorAll('[data-testid="videoPlayer"]')].some(node=>node.closest('article')===article&&!node.closest('[hidden],[inert],[aria-hidden="true"]'));
  }
  const replyVideoOnly=row=>replyHasVideo(row)&&!normalize(row?.text)&&!replyHasImages(row);
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
  let detailBinding=null;
  function ownDetailRoot(owner){
    const path=globalThis.location?.pathname||'',detail=path.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
    const record=detail&&threadRecords.get(detail[2]);
    if(!record||record.id===record.root||record.author!==detail[1].toLowerCase()||
      !originalPost(record.root,owner)||!inBranch(record.id,record.root,record.root)){
      detailBinding=null;return null;
    }
    const key=[path,owner,record.id,record.author,record.root].join('|');
    // The expanded target can unmount while its replies virtualize. Keep only
    // an already-proven binding for this exact route/account/native identity.
    if(detailBinding?.key===key)return detailBinding.root;
    detailBinding=null;
    const excluded='[hidden],[inert],[aria-hidden="true"],[role="dialog"],[role="alertdialog"]';
    const mains=[...document.querySelectorAll('[data-testid="primaryColumn"]')].filter(n=>!n.closest(excluded));
    if(mains.length!==1)return null;
    const cards=[...mains[0].querySelectorAll('article[data-testid="tweet"]')].filter(a=>{
      if(a.isConnected===false||a.closest(excluded))return false;
      const stamp=stampFor(a,true),text=statusText(a);
      return stamp?.id===record.id&&stamp.author.toLowerCase()===record.author&&text!==null&&replyTextMatches(record,text);
    });
    if(cards.length!==1)return null;
    detailBinding={key,root:record.root};return record.root;
  }
  function post(article, owner = account(), detailRoot=ownDetailRoot(owner)) {
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
    const ownThreadComment=ownOriginalComment===true&&
      (!!detail&&('/'+detail[1]).toLowerCase()===owner&&inThread(id,detail[2])||
       !!detailRoot&&inThread(id,detailRoot));
    const addressed=replyRecipients.includes(owner)||ownThreadComment;
    const directComment=addressed&&directOnOwnOriginal(id,owner);
    const ownThread=ownOriginalComment===true;
    const quoteHandles = [...article.querySelectorAll('[role="link"]:not(a)')].flatMap(q => [...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase()));
    const replyButton=article.querySelector('[data-testid="reply"]');
    const countText=(replyButton?.getAttribute?.('aria-label')||replyButton?.textContent||'').trim();
    const exactCount=countText.match(/^([0-9][0-9,]*)\s*(?:回复|repl(?:y|ies)|件の返信|$)/i);
    const replyCount=exactCount?Number(exactCount[1].replace(/,/g,'')):threadRecords.get(id)?.replyCount??null;
    const clipped=[...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some(e=>ownPart(article,e));
    const row={article, id, author, replyCount, text, clipped, time:time.dateTime, at:Date.parse(time.dateTime), addressed, directComment, ownThread, ownOriginalComment, replyRecipients, quoteHandles, isComment, rootPost, ...(thread?.author===author.toLowerCase()?sourceMedia(thread):{}),url:`https://x.com/${author}/status/${id}`};
    const preview=normalize(text),original=thread&&threadRecords.get(thread.root);
    if(clipped&&preview&&preview.length<20&&thread?.author===author.toLowerCase()&&
      original&&original.id===original.root&&!original.parent&&(thread.id===original.id||inBranch(thread.id,original.id))&&
      [thread.text,thread.replyTextPrefix?thread.text?.slice(thread.replyTextPrefix.length):null]
        .some(value=>typeof value==='string'&&normalize(value).length>preview.length&&normalize(value).startsWith(preview))){
      clippedSources.set(row,{id,author:author.toLowerCase(),time:row.time,preview,record:textRecordKey(thread)});
    }
    return row;
  }
  const rows = (owner=account()) => {const root=ownDetailRoot(owner);return [...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>!a.closest('[role="dialog"]')).map(a=>post(a,owner,root)).filter(Boolean);};
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
      const text=statusText(a);
      // A native "Show more" source card is only a prefix preview. The status
      // route, id, author and timestamp above still have to bind exactly.
      if(!detailTextMatches(row,text))return false;
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
      const r=threadRecords.get(id),childPath=r&&'/'+r.author+'/status/'+r.id;
      const ownedPath=owner&&path?.toLowerCase()===owner+'/status/'+id||
        r&&path?.toLowerCase()===childPath&&originalPost(r.root,owner)&&inBranch(id,r.root);
      if(!signal||signal.aborted||!runId||!document.hidden||!/^\d+$/.test(id)||!owner||a?.account?.toLowerCase()!==owner||
        a.module!=='notifications'||W.active()!=='notifications'||location.pathname!==path||!ownedPath||dialogs().length)return false;
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
  globalThis.XAssistantDOM = {postingVideoSources,replyContext,replyHasImages,replyHasVideo,replyVideoOnly,statusStamp,statusText,beginDetailRead,normalize,account,dialogs,replyEditor,standaloneReply,detailTextMatches,detailReply,post,rows,relocate,matches,ingestThreadRecords,ownsOriginal,originalPost,deletableOriginal,inThread,inBranch,descendantOf:inBranch,loadedBranchIds,threadIdentity,directChildOf,hasOwnReply,directOnOwnOriginal,loadedDirectChildren,loadedThreadIds};
})();
