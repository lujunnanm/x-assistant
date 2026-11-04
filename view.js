(()=>{
 if(document.getElementById('x-assistant-float'))return;
 const root=document.createElement('aside');root.id='x-assistant-float';root.innerHTML=`
 <header><strong><img class="brand-icon" src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="">神圣计划</strong><button class="close" data-a="hide" aria-label="收起控制台" aria-expanded="true" title="收起控制台">—</button></header>
 <section data-module="interaction"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10 10 0 0 1-10 10H3l2-5A10 10 0 1 1 22 12Z"/><path d="M8 12h.1M12 12h.1M16 12h.1"/></svg></span><b>互动</b><label class="follow-option"><input type="checkbox" data-setting="auto-follow" checked disabled>自动关注</label><span class="state-lamp" role="status" data-state="off">已停止</span><div class="status" data-status="interaction" role="status" hidden>互动模块已停止</div></section>
 <section data-module="posting"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 21 1-6L18 3l5 5L11 20Z M15 6l5 5"/></svg></span><b>发帖</b><span class="state-lamp" role="status" data-state="off">已停止</span></section>
 <section data-module="notifications"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10 10 0 0 1-10 10H3l2-5A10 10 0 1 1 22 12Z"/><path d="M8 12h.1M12 12h.1M16 12h.1"/></svg></span><b>回帖</b><span class="state-lamp" role="status" data-state="off">已停止</span><div class="status" data-status="notifications" role="status" hidden>回帖已停止</div></section>
`;document.documentElement.append(root);
root.dataset.build=chrome.runtime.getManifest().version;
 const aiAlert=document.createElement('div');aiAlert.setAttribute('role','alert');aiAlert.style.cssText='color:#ffb4b4;background:#421f2b;padding:10px;white-space:normal';root.insertBefore(aiAlert,root.children[1]);
 const showAIError=s=>{aiAlert.hidden=!s?.error;aiAlert.textContent=s?.error?'AI 异常：'+s.error+' · 第 '+s.attempt+' 次失败 · '+(s.retrying?'正在重试，尚未发送':'生成失败，尚未发送。请检查网络、API 余额或插件密钥设置。'):'';};
 showAIError(null);chrome.storage.local.get('xAssistantAIStatusV1').then(d=>showAIError(d.xAssistantAIStatusV1));
 chrome.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c.xAssistantAIStatusV1)showAIError(c.xAssistantAIStatusV1.newValue);});

 const invalidate=message=>{window.dispatchEvent(new CustomEvent('x-assistant-invalidate',{detail:{reason:message}}));root.querySelectorAll('button').forEach(button=>button.disabled=true);root.querySelectorAll('[role="status"]').forEach(status=>status.textContent=message);};
 // A sleeping MV3 worker may miss one heartbeat. Stop only on repeated failures.
 let heartbeatFailures=0,heartbeatPending=false;
 const heartbeat=setInterval(async()=>{
  if(heartbeatPending)return;
  heartbeatPending=true;let timeout;
  try{
   const reply=await Promise.race([chrome.runtime.sendMessage({kind:'PING'}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('后台响应超时')),4000);})]);
   if(!reply?.ok)throw Error('后台无有效响应');
   heartbeatFailures=0;
  }catch(error){
   if(++heartbeatFailures>=3){clearInterval(heartbeat);invalidate(/Extension context invalidated/i.test(error.message)?'扩展已更新，请刷新当前 X 页面':'后台连续 3 次连接失败，已安全停止。请刷新页面后重试');}
  }finally{clearTimeout(timeout);heartbeatPending=false;}
 },5000);
 window.addEventListener('pagehide',()=>clearInterval(heartbeat),{once:true});
 root.querySelectorAll('section').forEach(section=>{
 const posting=section.dataset.module==='posting';
 const timer=document.createElement('div');timer.className='countdown';timer.innerHTML='<span>—</span>';section.insertBefore(timer,section.querySelector('.state-lamp'));
 const sync=()=>{
  const output=section.querySelector('.status'),text=output?.textContent?.trim()||'',lamp=section.querySelector('.state-lamp');
  const routine=/^(?:互动|发帖|回帖|清理)?(?:模块)?已停止(?:\s*·.*)?$/.test(text);
  const error=/(?:异常|失败|错误|无法|未知|超时|中断|断开|不一致|未确认|未成功|不匹配|已更新|未找到|请刷新|失效|未配置|余额|额度|安全停止)/.test(text.replace('（并非发送失败）',''));
  // Scheduler ownership outranks stale driver steps while a module has yielded.
  const yielding=!!lamp&&lamp.dataset.state!=='on'&&(!posting||lamp.dataset.state==='off');
  const showDetail=!lamp||error;
  if(output)output.hidden=!showDetail;
  if(lamp){lamp.dataset.quiet=String(showDetail);lamp.setAttribute('aria-hidden',String(showDetail));}
  const match=text.match(/(?:下次(?:发帖|清理|检查)\s*|·\s*)([0-9]+(?:\.[0-9]+)?)\s*秒/),seconds=section.dataset?.nextAt&&Number.isFinite(Number(section.dataset.nextAt))?Math.max(0,(Number(section.dataset.nextAt)-Date.now())/1000):!yielding&&match?Number(match[1]):null;
  const value=seconds===null?'—':seconds>=60?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:seconds.toFixed(1);
  if(timer.querySelector('span').textContent!==value)timer.querySelector('span').textContent=value;
  timer.setAttribute('aria-label',seconds===null?'暂无倒计时':`剩余 ${seconds.toFixed(1)} 秒`);

  section.title=error||!yielding?text:lamp?.textContent||text;
 };new MutationObserver(sync).observe(section,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-state','data-next-at']});sync();
 });
})();
