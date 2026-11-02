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
 const section=root.querySelector('[data-module="cleanup"]');
 const start=section?.querySelector('[data-a="clean-start"]'),stop=section?.querySelector('[data-a="clean-stop"]');
 if(start&&stop){
  start.hidden=true;stop.hidden=true;
  const button=document.createElement('button');button.type='button';button.className='cleanup-toggle';button.dataset.a='clean-toggle';button.setAttribute('role','switch');
  const sync=()=>{const active=!stop.disabled;const disabled=start.disabled&&stop.disabled;if(button.disabled!==disabled)button.disabled=disabled;button.setAttribute('aria-checked',String(active));const text=active?'停止':'开始';if(button.textContent!==text)button.textContent=text;button.title=section.querySelector('[data-status="cleanup"]')?.textContent||'';};
  button.addEventListener('click',()=>{if(button.disabled)return;(!stop.disabled?stop:start).click();sync();});
  section.querySelector('.row').append(button);
  new MutationObserver(sync).observe(section,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});sync();
 }
})();
