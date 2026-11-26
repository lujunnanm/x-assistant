// Lightweight Zhihu collector only: no X modules, scheduling or publishing.
(()=>{
 const CARDS='.AnswerItem,article.Post-Main',BUTTON='[data-sacred-zhihu-copy]';
 const rowFor=card=>globalThis.XAssistantZhihu.read(card);
 const actionGroup=card=>globalThis.XAssistantZhihu.actions(card);
 const rowKey=row=>row?.sourceKey||`${row?.sourceType==='article'?'article':'answer'}:${row?.id||''}`;
 const noun=button=>button.dataset.sourceType==='article'?'文章':'回答';
 const label=(button,text,state)=>{
  const article=noun(button)==='文章';
  const message=state==='ready'?(article?'按后台默认语言，将文章标题与正文改写为推帖入库':'按后台默认语言，将问题与回答融合为推帖入库'):state==='saved'?`此${noun(button)}已加入文案库`:state==='busy'?`正在读取${article?'文章':'回答'}全文并按后台默认语言处理`:state;
  if(button.textContent!==text)button.textContent=text;
  button.dataset.state=state;button.setAttribute('aria-label',message);button.title=message;
 };
 const buttonsFor=key=>[...document.querySelectorAll(BUTTON)].filter(button=>button.dataset.sourceKey===key);
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
    const state=await globalThis.XAssistantRuntime.call({kind:'ZHIHU_REWRITE_STATUS',ids});
    if(!closed&&Number.isSafeInteger(state.revision)&&state.revision>=latestRevision){
     latestRevision=state.revision;const saved=new Set(state.existing),requested=new Set(ids);
     // One DOM traversal per batch, not one traversal per post.
     for(const button of document.querySelectorAll(BUTTON))if(requested.has(button.dataset.sourceKey))libraryState(button,saved.has(button.dataset.sourceKey));
    }
   }catch{} // Server-side dedup remains authoritative if this read fails.
  }}finally{statusRunning=false;}
 };
 const checkStatus=key=>{if(closed||!key)return;statusPending.add(key);if(!statusScheduled&&!statusRunning){statusScheduled=true;queueMicrotask(syncStatus);}};
 async function copy(event){
  event.preventDefault();event.stopPropagation();
  if(!event.isTrusted||this.disabled)return;
  const article=this.closest(CARDS),row=rowFor(article),key=this.dataset.sourceKey;
  if(!row||rowKey(row)!==key)return label(this,'!',`${noun(this)}已变化，请重试`);
  this.disabled=true;label(this,'···','busy');
  try{
   const post=await globalThis.XAssistantZhihu.fullRow(article,row);
   const result=await globalThis.XAssistantRuntime.call({kind:'ZHIHU_REWRITE_ADD',post});
   if(Number.isSafeInteger(result.revision))latestRevision=Math.max(latestRevision,result.revision);
   for(const live of buttonsFor(key))libraryState(live,true);
  }catch(error){const live=article?.querySelector(BUTTON)||this;if(live.dataset.sourceKey===key&&live.dataset.librarySaved!=='true')label(live,'!','入库失败：'+(error?.message||'未知错误'));}
  finally{const live=article?.querySelector(BUTTON)||this;if(live.isConnected&&live.dataset.sourceKey===key&&live.dataset.librarySaved!=='true')live.disabled=false;}
 }
 function install(article){
  if(!article?.isConnected)return;
  const row=rowFor(article),group=actionGroup(article),old=article.querySelector(BUTTON);
  if(!row||!group){old?.remove();return;}
  const key=rowKey(row);if(old?.dataset.sourceKey===key){return;}
  old?.remove();
  const button=document.createElement('button');button.type='button';button.dataset.sacredZhihuCopy='';button.dataset.postId=row.id;button.dataset.sourceType=row.sourceType==='article'?'article':'answer';button.dataset.sourceKey=key;button.className='x-assistant-copy-post sacred-zhihu-copy';
  label(button,'+','ready');button.addEventListener('click',copy);group.append(button);checkStatus(key);
 }
 const pending=new Set();let scheduled=false;
 function enqueue(node){
  if(closed||node?.nodeType!==1)return;
  const article=node.matches?.(CARDS)?node:node.closest?.(CARDS);if(article)pending.add(article);
  for(const child of node.querySelectorAll?.(CARDS)||[])pending.add(child);
  if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;for(const article of pending)install(article);pending.clear();});}
 }
 const observer=new MutationObserver(records=>{for(const record of records){
  // Button text mutations are ours, not new answer cards. Never feed them back into status reads.
  if(record.target.closest?.(BUTTON))continue;
  enqueue(record.target);for(const node of record.addedNodes||[])enqueue(node);
 }});
 observer.observe(document.documentElement,{subtree:true,childList:true});enqueue(document.documentElement);
 globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantPostingCopiesV1)for(const button of document.querySelectorAll(BUTTON))checkStatus(button.dataset.sourceKey);});
 const stop=()=>{closed=true;observer.disconnect();pending.clear();statusPending.clear();};
 globalThis.window?.addEventListener('pagehide',stop,{once:true});
 globalThis.window?.addEventListener('x-assistant-invalidate',stop,{once:true});
})();
