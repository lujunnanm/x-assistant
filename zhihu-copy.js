// Lightweight Zhihu collector only: no X modules, scheduling or publishing.
(()=>{
 const ARTICLE='.AnswerItem',BUTTON='[data-sacred-zhihu-copy]';
 const rowFor=card=>globalThis.XAssistantZhihu.read(card);
 const actionGroup=card=>globalThis.XAssistantZhihu.actions(card);
 const label=(button,text,state)=>{
  const message=state==='ready'?'按后台默认语言，将问题与回答融合为推帖入库':state==='saved'?'此回答已加入文案库':state==='busy'?'正在读取全文并按后台默认语言处理':state;
  if(button.textContent!==text)button.textContent=text;
  button.dataset.state=state;button.setAttribute('aria-label',message);button.title=message;
 };
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
    const state=await globalThis.XAssistantRuntime.call({kind:'ZHIHU_REWRITE_STATUS',ids});
    if(!closed&&Number.isSafeInteger(state.revision)&&state.revision>=latestRevision){
     latestRevision=state.revision;const saved=new Set(state.existing),requested=new Set(ids);
     // One DOM traversal per batch, not one traversal per post.
     for(const button of document.querySelectorAll(BUTTON))if(requested.has(button.dataset.postId))libraryState(button,saved.has(button.dataset.postId));
    }
   }catch{} // Server-side dedup remains authoritative if this read fails.
  }}finally{statusRunning=false;}
 };
 const checkStatus=id=>{if(closed)return;statusPending.add(id);if(!statusScheduled&&!statusRunning){statusScheduled=true;queueMicrotask(syncStatus);}};
 async function copy(event){
  event.preventDefault();event.stopPropagation();
  if(!event.isTrusted||this.disabled)return;
  const article=this.closest(ARTICLE),row=rowFor(article),id=this.dataset.postId;
  if(!row||row.id!==id)return label(this,'!','回答已变化，请重试');
  this.disabled=true;label(this,'···','busy');
  try{
   const post=await globalThis.XAssistantZhihu.fullRow(article,row);
   const result=await globalThis.XAssistantRuntime.call({kind:'ZHIHU_REWRITE_ADD',post});
   if(Number.isSafeInteger(result.revision))latestRevision=Math.max(latestRevision,result.revision);
   for(const live of buttonsFor(id))libraryState(live,true);
  }catch(error){const live=article.querySelector(BUTTON)||this;if(live.dataset.postId===id&&live.dataset.librarySaved!=='true')label(live,'!','入库失败：'+(error?.message||'未知错误'));}
  finally{const live=article.querySelector(BUTTON)||this;if(live.isConnected&&live.dataset.postId===id&&live.dataset.librarySaved!=='true')live.disabled=false;}
 }
 function install(article){
  if(!article?.isConnected)return;
  const row=rowFor(article),group=actionGroup(article),old=article.querySelector(BUTTON);
  if(!row||!group){old?.remove();return;}
  if(old?.dataset.postId===row.id){return;}
  old?.remove();
  const button=document.createElement('button');button.type='button';button.dataset.sacredZhihuCopy='';button.dataset.postId=row.id;button.className='x-assistant-copy-post sacred-zhihu-copy';
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
  // Button text mutations are ours, not new answer cards. Never feed them back into status reads.
  if(record.target.closest?.(BUTTON))continue;
  enqueue(record.target);for(const node of record.addedNodes||[])enqueue(node);
 }});
 observer.observe(document.documentElement,{subtree:true,childList:true});enqueue(document.documentElement);
 globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantPostingCopiesV1)for(const button of document.querySelectorAll(BUTTON))checkStatus(button.dataset.postId);});
 const stop=()=>{closed=true;observer.disconnect();pending.clear();statusPending.clear();};
 globalThis.window?.addEventListener('pagehide',stop,{once:true});
 globalThis.window?.addEventListener('x-assistant-invalidate',stop,{once:true});
})();
