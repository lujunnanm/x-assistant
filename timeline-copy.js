// Adds one native-sized control to every post and comment on X.
(()=>{
 const ARTICLE='article[data-testid="tweet"]',BUTTON='[data-sacred-copy-post]',MORE='[data-testid="tweet-text-show-more-link"]';
 const owns=(node,article)=>node?.closest?.(ARTICLE)===article;
 const actionGroup=article=>[...article.querySelectorAll('[role="group"]')].find(group=>owns(group,article)&&
  ['[data-testid="reply"]','[data-testid="retweet"],[data-testid="unretweet"]','[data-testid="like"],[data-testid="unlike"]']
   .every(selector=>[...group.querySelectorAll(selector)].some(node=>owns(node,article))));
 const rowFor=article=>globalThis.XAssistantDOM?.post?.(article)||null;
 const photoUrls=(article,row)=>{
  const photos=new Map();
  for(const node of article.querySelectorAll('[data-testid="tweetPhoto"]')){
   if(!owns(node,article)||node.closest('[role="link"]:not(a),[data-testid="quoteTweet"],[data-testid="card.wrapper"],[data-testid="videoPlayer"],[hidden],[inert],[aria-hidden="true"]'))continue;
   const link=node.closest('a[href]'),href=link?.getAttribute('href')||'';
   const match=href.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/photo\/([1-4])$/);
   if(!match||match[1].toLowerCase()!==row.author.toLowerCase()||match[2]!==row.id)continue;
   const sources=[...new Set([...node.querySelectorAll('img')].map(img=>img.getAttribute('src')).filter(url=>url?.startsWith('https://pbs.twimg.com/media/')))];
   const index=Number(match[3]);
   if(sources.length!==1||photos.has(index)&&photos.get(index)!==sources[0])throw Error('有配图尚未加载，请打开帖子详情后重试');
   photos.set(index,sources[0]);
  }
  const ordered=[...photos].sort(([a],[b])=>a-b);
  if(ordered.some(([index],i)=>index!==i+1))throw Error('配图没有全部加载，请打开帖子详情后重试');
  return ordered.map(([,url])=>url);
 };
 const mediaFor=(article,row)=>{
  const imageUrls=row.imageUrls??(article?photoUrls(article,row):[]);
  const players=article?[...article.querySelectorAll('[data-testid="videoPlayer"]')]
   .filter(node=>owns(node,article)&&!node.closest('[role="link"]:not(a),[data-testid="quoteTweet"],[data-testid="card.wrapper"],[hidden],[inert],[aria-hidden="true"]')):[];
  const media=players.map((node,i)=>{
   const href=node.closest('a[href]')?.getAttribute('href')||'',match=href.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/video\/([1-4])$/);
   if(match&&(match[1].toLowerCase()!==row.author.toLowerCase()||match[2]!==row.id))throw Error('视频或动图与帖子身份不匹配');
   const gif=[...(node.querySelectorAll?.('video,video source')||[])]
    .map(el=>el.currentSrc||el.getAttribute('src')||'').find(url=>/^https:\/\/video\.twimg\.com\/tweet_video\/[A-Za-z0-9_-]{1,128}\.mp4(?:\?tag=\d+)?$/.test(url));
   return {gif,video:gif?null:row.url+'/video/'+(match?.[3]||i+1)};
  });
  const gifs=media.map(item=>item.gif).filter(Boolean);
  const gifUrls=[...new Set([...(row.gifUrls||[]),...gifs].map(url=>url.split('?')[0]))];
  if(row.missingGif&&gifUrls.length<=(row.gifUrls?.length||0))throw Error('动图文件尚未加载，请打开帖子详情后重试');
  const videoUrls=row.videoUrls??media.map(item=>item.video).filter(Boolean);
  return {...(imageUrls.length?{imageUrls}:{}),...(videoUrls.length?{videoUrls}:{}),...(gifUrls.length?{gifUrls}:{})};
 };
 const rootWithMedia=root=>{
  if(!root)return null;
  const mounted=[...document.querySelectorAll(ARTICLE)].map(article=>({article,row:rowFor(article)})).filter(({row})=>row?.id===root.id&&row.author.toLowerCase()===root.author.toLowerCase());
  return {...root,...mediaFor(mounted.length===1?mounted[0].article:null,root)};
 };
 const label=(button,text,state)=>{const comment=button.dataset.comment==='true',message=state==='ready'?(comment?'融合评论与所属帖子后加入发帖文案库':'DeepSeek 重写后加入发帖文案库'):state==='saved'?(comment?'评论融合改写稿已加入发帖文案库':'DeepSeek 改写稿已加入发帖文案库'):state==='busy'?(comment?'DeepSeek 正在融合评论与所属帖子':'DeepSeek 正在重写帖子正文'):state;if(button.textContent!==text)button.textContent=text;button.dataset.state=state;button.setAttribute('aria-label',message);button.title=message;};
 const buttonsFor=id=>[...document.querySelectorAll(BUTTON)].filter(button=>button.dataset.postId===id);
 let latestRevision=-1,statusScheduled=false,statusRunning=false,closed=false;const statusPending=new Set();
 const libraryState=(button,saved)=>{
  if(saved){button.dataset.librarySaved='true';button.disabled=true;label(button,'✓','saved');return;}
  if(button.dataset.librarySaved==='true'){delete button.dataset.librarySaved;button.disabled=false;label(button,'+','ready');}
 };
 const syncStatus=async()=>{
  statusScheduled=false;if(statusRunning||closed)return;statusRunning=true;
  try{while(statusPending.size&&!closed){
   const ids=[...statusPending].slice(0,500);for(const id of ids)statusPending.delete(id);
   try{
    const state=await globalThis.XAssistantRuntime.call({kind:'TIMELINE_REWRITE_STATUS',ids});
    if(!closed&&Number.isSafeInteger(state.revision)&&state.revision>=latestRevision){
     latestRevision=state.revision;const saved=new Set(state.existing),requested=new Set(ids);
     // One DOM traversal per batch, not one traversal per post.
     for(const button of document.querySelectorAll(BUTTON))if(requested.has(button.dataset.postId))libraryState(button,saved.has(button.dataset.postId));
    }
   }catch{} // Server-side dedup remains authoritative if this read fails.
  }}finally{statusRunning=false;}
 };
 const checkStatus=id=>{if(closed)return;statusPending.add(id);if(!statusScheduled&&!statusRunning){statusScheduled=true;queueMicrotask(syncStatus);}};
 const fullRow=async(article,row)=>{
  const more=article.querySelector(MORE);if(!more)return row;
  if(!owns(more,article)||!more.matches('button[type="button"]')||more.disabled||more.closest('a,form,[role="link"],[hidden],[inert],[aria-hidden="true"]'))throw Error('帖子全文无法安全展开');
  more.click();
  for(let i=0;i<30;i++){
   await new Promise(resolve=>setTimeout(resolve,100));
   if(!article.isConnected)throw Error('展开全文时页面已变化');
   const current=rowFor(article);if(current?.id===row.id&&!article.querySelector(MORE)&&current.text!==row.text&&current.text?.trim())return current;
  }
  throw Error('帖子全文未能展开');
 };
 async function copy(event){
  event.preventDefault();event.stopPropagation();
  if(!event.isTrusted||this.disabled)return;
  const article=this.closest(ARTICLE),row=rowFor(article),id=this.dataset.postId;
  if(!row||row.id!==id)return label(this,'!','帖子已变化，请重试');
  this.disabled=true;label(this,'···','busy');
  try{
   const complete=await fullRow(article,row);
   if(!article.isConnected||rowFor(article)?.id!==id)throw Error('帖子已变化，请重试');
   const media=mediaFor(article,complete),rootPost=rootWithMedia(complete.rootPost),text=globalThis.XAssistantDOM.normalize?.(complete.text)===''?'':complete.text;
   const imageCount=new Set([...(rootPost?.imageUrls||[]),...(media.imageUrls||[])]).size;
   const gifCount=new Set([...(rootPost?.gifUrls||[]),...(media.gifUrls||[])]).size;
   if(!text?.trim()&&!imageCount&&!gifCount&&!media.videoUrls?.length&&!rootPost?.videoUrls?.length)throw Error('该帖子没有可复制的正文、图片、动图或视频');
   if(text?.trim()&&complete.isComment&&!complete.rootPost)throw Error('未找到评论所属帖子，请打开该评论详情后重试');
   const result=await globalThis.XAssistantRuntime.call({kind:'TIMELINE_REWRITE_ADD',post:{id:complete.id,author:complete.author,text,url:complete.url,...(rootPost?{rootPost}:{}),...media}});
   if(Number.isSafeInteger(result.revision))latestRevision=Math.max(latestRevision,result.revision);
   for(const live of buttonsFor(id)){libraryState(live,true);live.title=result.added?(gifCount?'已保存动图至文案库（已启用）':imageCount?'已保存 '+imageCount+' 张配图至文案库（已启用）':'文案已加入发帖文案库（已启用）'):'该帖子或评论已在重写文案库中';}
  }catch(error){const live=article.querySelector(BUTTON)||this;if(live.dataset.postId===id&&live.dataset.librarySaved!=='true')label(live,'!','入库失败：'+(error?.message||'未知错误'));}
  finally{const live=article.querySelector(BUTTON)||this;if(live.isConnected&&live.dataset.postId===id&&live.dataset.librarySaved!=='true')live.disabled=false;}
 }
 function install(article){
  if(!article?.isConnected)return;
  const row=rowFor(article),group=actionGroup(article),old=article.querySelector(BUTTON);
  if(!row||!group){old?.remove();return;}
  if(old?.dataset.postId===row.id){old.dataset.comment=String(row.isComment===true);return;}
  old?.remove();
  const button=document.createElement('button');button.type='button';button.dataset.sacredCopyPost='';button.dataset.postId=row.id;button.dataset.comment=String(row.isComment===true);button.className='x-assistant-copy-post';
  label(button,'+','ready');button.addEventListener('click',copy);group.append(button);checkStatus(row.id);
 }
 const pending=new Set();let scheduled=false;
 function enqueue(node){
  if(closed||node?.nodeType!==1)return;
  const article=node.matches?.(ARTICLE)?node:node.closest?.(ARTICLE);if(article)pending.add(article);
  for(const child of node.querySelectorAll?.(ARTICLE)||[])pending.add(child);
  if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;for(const article of pending)install(article);pending.clear();});}
 }
 const observer=new MutationObserver(records=>{for(const record of records){
  // Button text mutations are ours, not new X posts. Never feed them back into status reads.
  if(record.target.closest?.(BUTTON))continue;
  enqueue(record.target);for(const node of record.addedNodes||[])enqueue(node);
 }});
 observer.observe(document.documentElement,{subtree:true,childList:true});enqueue(document.documentElement);
 globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantPostingCopiesV1)for(const button of document.querySelectorAll(BUTTON))checkStatus(button.dataset.postId);});
 const stop=()=>{closed=true;observer.disconnect();pending.clear();statusPending.clear();};
 globalThis.window?.addEventListener('pagehide',stop,{once:true});
 globalThis.window?.addEventListener('x-assistant-invalidate',stop,{once:true});
})();
