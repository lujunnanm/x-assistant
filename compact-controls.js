// Presentation adapters: keep original persistence, guards and cleanup handlers.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root)return;
 const master=root.querySelector('.master-control');
 const follow=root.querySelector('[data-setting="auto-follow"]');
 if(master&&follow){
  const original=follow.closest('label');original.hidden=true;
  const button=document.createElement('button');button.className='follow-button';button.type='button';button.setAttribute('role','switch');button.dataset.a='follow-toggle';
  const sync=()=>{if(button.disabled!==follow.disabled)button.disabled=follow.disabled;button.setAttribute('aria-checked',String(follow.checked));button.textContent=follow.checked?'关注':'不关注';button.setAttribute('aria-label','自动关注：'+(follow.checked?'开启':'关闭')); };
  button.addEventListener('click',()=>{if(follow.disabled)return;follow.click();sync();});
  follow.addEventListener('change',sync);new MutationObserver(sync).observe(follow,{attributes:true,attributeFilter:['disabled','checked']});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantAutoFollowV1)queueMicrotask(sync);});
  master.append(button);sync();
 }
 const icon=root.querySelector('[data-module="interaction"] .module-icon');
 if(icon){
  const button=document.createElement('button');button.className=icon.className+' friend-search-toggle';
  button.innerHTML=icon.innerHTML;button.type='button';button.setAttribute('role','switch');
  button.setAttribute('aria-label','交友话题搜索');button.dataset.a='friend-search';icon.replaceWith(button);
  const key='xAssistantFriendSearchV1';
  const sync=value=>{button.setAttribute('aria-checked',String(value===true));button.title=value?'交友搜索已开启':'交友搜索已关闭';};
  chrome.storage.local.get(key).then(d=>sync(d[key]));
  button.addEventListener('click',async()=>{button.disabled=true;try{await chrome.storage.local.set({[key]:button.getAttribute('aria-checked')!=='true'});}finally{button.disabled=false;}});
  chrome.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c[key])sync(c[key].newValue);});
 }
})();
