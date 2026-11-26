// Inline keyword override for the running managed search timeline only.
(()=>{
 const entry=globalThis.XAssistantEntry;
 let form=null,input=null,status=null,observer=null,queued=false,closed=false;
 function build(){
  form=document.createElement('form');form.className='sacred-timeline-search';
  form.innerHTML='<label for="sacred-timeline-keyword">互动搜索词</label><div class="sacred-search-fields"><input id="sacred-timeline-keyword" type="search" maxlength="120" autocomplete="off" placeholder="输入关键词或短语"><button type="submit">应用</button><button type="button" data-reset>恢复后台词</button></div><p role="status">仅影响当前工作页，不覆盖后台关键词。</p>';
  input=form.querySelector('input');status=form.querySelector('[role="status"]');input.value=entry.pageKeyword()||'';
  const apply=(event,text)=>{
   event.preventDefault();
   if(!event.isTrusted||closed||!form.isConnected)return;
   try{
    const keyword=entry.setPageKeyword(text);input.value=keyword||'';
    status.textContent=keyword?'已应用：'+keyword+'。待新结果加载后继续筛选。':'已恢复后台关键词。';
   }catch(error){status.textContent=error.message;}
  };
  form.addEventListener('submit',event=>apply(event,input.value));
  form.querySelector('[data-reset]').addEventListener('click',event=>apply(event,''));
 }
 function mount(){
  if(closed||!entry.searchWorkspace()||location.pathname!=='/search'){form?.remove();return;}
  const columns=[...document.querySelectorAll('[data-testid="primaryColumn"]')].filter(node=>!node.closest('[hidden],[inert],[aria-hidden="true"]'));
  if(columns.length!==1){form?.remove();return;}
  if(!form)build();
  if(form.parentElement!==columns[0])columns[0].prepend(form);
 }
 function sync(){
  if(!closed&&entry.searchWorkspace()){
   if(!observer){
    observer=new MutationObserver(()=>{
     if(queued)return;queued=true;
     requestAnimationFrame(()=>{queued=false;mount();});
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
   }
  }else{
   observer?.disconnect();observer=null;form?.remove();form=input=status=null;
  }
  mount();
 }
 const stop=()=>{closed=true;sync();};
 window.addEventListener('x-assistant-workspace-state',sync);
 window.addEventListener('x-assistant-native-search',()=>{
  if(input&&document.activeElement!==input){input.value=entry.pageKeyword()||'';status.textContent='已跟随 X 搜索，待新结果加载后继续筛选。';}
 });
 window.addEventListener('popstate',mount);
 window.addEventListener('x-assistant-invalidate',stop,{once:true});
 window.addEventListener('pagehide',stop,{once:true});
 sync();
})();
