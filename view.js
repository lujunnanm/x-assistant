(()=>{
 if(document.getElementById('x-assistant-float'))return;
 const root=document.createElement('aside');root.id='x-assistant-float';root.innerHTML=`
 <header><strong><img class="brand-icon" src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="">神圣计划</strong><button class="close" data-a="hide" aria-label="收起控制台" aria-expanded="true" title="收起控制台">—</button></header>
 <section data-module="interaction"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10 10 0 0 1-10 10H3l2-5A10 10 0 1 1 22 12Z"/><path d="M8 12h.1M12 12h.1M16 12h.1"/></svg></span><b>互动</b><label class="follow-option"><input type="checkbox" data-setting="auto-follow" checked disabled>自动关注</label><span class="state-lamp" role="status" data-state="off">已停止</span><div class="status" data-status="interaction" role="status" hidden>互动模块已停止</div></section>
 <section data-module="posting"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 21 1-6L18 3l5 5L11 20Z M15 6l5 5"/></svg></span><b>发帖</b><span class="state-lamp" role="status" data-state="off">已停止</span></section>
 <section data-module="notifications"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10 10 0 0 1-10 10H3l2-5A10 10 0 1 1 22 12Z"/><path d="M8 12h.1M12 12h.1M16 12h.1"/></svg></span><b>回帖</b><span class="state-lamp" role="status" data-state="off">已停止</span><div class="status" data-status="notifications" role="status" hidden>回帖已停止</div></section>
 <section data-module="followback"><span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 20v-1a7 7 0 0 1 12-5M15 15.5l2.2 2.2L22 13"/></svg></span><b>回关</b><span class="state-lamp" role="status" data-state="off">已停止</span></section>
`;document.documentElement.append(root);
root.dataset.build=chrome.runtime.getManifest().version;

 const invalidate=message=>window.dispatchEvent(new CustomEvent('x-assistant-invalidate',{detail:{reason:message}}));
 window.addEventListener('x-assistant-invalidate',event=>{const message=event.detail?.reason||'扩展已更新，请刷新页面';root.querySelectorAll('button').forEach(button=>button.disabled=true);root.querySelectorAll('[role="status"]').forEach(status=>status.textContent=message);},{once:true});
 // A sleeping MV3 worker may miss one heartbeat. Stop only on repeated failures.
 let heartbeatFailures=0,heartbeatPending=false;
 const heartbeat=setInterval(async()=>{
  if(heartbeatPending)return;
  heartbeatPending=true;let timeout;
  try{
   await Promise.race([globalThis.XAssistantRuntime.call({kind:'PING'}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('后台响应超时')),4000);})]);
   heartbeatFailures=0;
  }catch(error){
   if(globalThis.XAssistantRuntime.retired()){clearInterval(heartbeat);return;}
   if(++heartbeatFailures>=3){clearInterval(heartbeat);invalidate(/Extension context invalidated/i.test(error.message)?'扩展已更新，请刷新当前 X 页面':'后台连续 3 次连接失败，已安全停止。请刷新页面后重试');}
  }finally{clearTimeout(timeout);heartbeatPending=false;}
 },30000);
 window.addEventListener('x-assistant-invalidate',()=>clearInterval(heartbeat),{once:true});
 window.addEventListener('pagehide',()=>clearInterval(heartbeat),{once:true});
 const timerRenders=[];
 root.querySelectorAll('section').forEach(section=>{
 const posting=section.dataset.module==='posting',notification=section.dataset.module==='notifications';
 const timer=document.createElement('div');timer.className='countdown';timer.innerHTML='<span>—</span>';section.insertBefore(timer,section.querySelector('.state-lamp'));
 const sync=()=>{
  const output=section.querySelector('.status'),text=output?.textContent?.trim()||'',lamp=section.querySelector('.state-lamp');
  const routine=/^(?:互动|发帖|回帖|回关|清理)?(?:模块)?已停止(?:\s*·.*)?$/.test(text);
  const error=/(?:异常|失败|错误|无法|未知|超时|中断|断开|不一致|未确认|未成功|不匹配|已更新|未找到|请刷新|失效|未配置|余额|额度|安全停止)/.test(text.replace('（并非发送失败）',''));
  // Scheduler ownership outranks stale driver steps while a module has yielded.
  const yielding=!!lamp&&lamp.dataset.state!=='on'&&(!posting||lamp.dataset.state==='off');
  const showDetail=!lamp||error;
  if(output)output.hidden=!showDetail;
  if(lamp){lamp.dataset.quiet=String(showDetail);lamp.setAttribute('aria-hidden',String(showDetail&&root.dataset?.workspace!=='managed'));}
  const match=text.match(/(?:下次(?:发帖|回帖|回关|清理|检查)\s*|下一条\s*·?\s*|等待下一帖\s*·?\s*|·\s*)([0-9]+(?:\.[0-9]+)?)\s*秒/);
  const liveSeconds=match&&(!yielding||notification&&/\b下一条\b|下一条/u.test(text))?Number(match[1]):null;
  const deadlineSeconds=section.dataset?.nextAt&&Number.isFinite(Number(section.dataset.nextAt))?Math.max(0,(Number(section.dataset.nextAt)-Date.now())/1000):null;
  const remaining=liveSeconds??deadlineSeconds;
  const seconds=remaining===null?null:Math.ceil(remaining);
  const value=seconds===null?'—':seconds>=60?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:String(seconds);
  if(timer.querySelector('span').textContent!==value)timer.querySelector('span').textContent=value;
  timer.setAttribute('aria-label',seconds===null?'暂无倒计时':`剩余 ${seconds} 秒`);

  if(root.dataset?.workspace!=='managed')section.title=error||!yielding?text:lamp?.textContent||text;
 };new MutationObserver(sync).observe(section,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-state','data-next-at']});sync();
 timerRenders.push(sync);
 });
 const countdownTick=setInterval(()=>{if(!document.hidden&&root.dataset.collapsed!=='true')timerRenders.forEach(sync=>sync());},1000);
 window.addEventListener('x-assistant-invalidate',()=>clearInterval(countdownTick),{once:true});
 window.addEventListener('pagehide',()=>clearInterval(countdownTick),{once:true});
})();
