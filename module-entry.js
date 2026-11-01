// All starts navigate through observed X navigation links, never overwrite inline drafts.
(()=>{
 const root=document.getElementById('x-assistant-float'),api=globalThis.XAssistantRuntime;
 const account=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
 async function enter(module,signal){
  const self=account();if(!/^\/[A-Za-z0-9_]{1,15}$/.test(self||''))throw Error('账号未加载完成');
  const target=module==='cleanup'?self:'/home';
  if(document.querySelector('[role="dialog"],[role="alertdialog"]')&&!await globalThis.XAssistantPopup.cancel())throw Error('无法取消弹窗，已停止');
  if([...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim()))throw Error('页面存在未发送的内联草稿，请先处理');
  if(location.pathname.toLowerCase()!==target.toLowerCase()||location.search){
   const link=document.querySelector(module==='cleanup'?'[data-testid="AppTabBar_Profile_Link"]':'[data-testid="AppTabBar_Home_Link"]');
   if(!link)throw Error('未找到工作页面入口');link.click();
   for(let i=0;i<150&&(location.pathname.toLowerCase()!==target.toLowerCase()||location.search);i++)await api.sleep(100,signal);
   if(location.pathname.toLowerCase()!==target.toLowerCase()||location.search)throw Error('工作页面切换失败');
  }
  api.check(signal);if(account()!==self)throw Error('账号发生变化');return self;
 }
 globalThis.XAssistantEntry={enter,account};
 let entering=false;
 root.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(b?.dataset.a!=='clean-start'||b.disabled)return;
  event.preventDefault();event.stopImmediatePropagation();if(entering)return;entering=true;
  try{if(globalThis.XAssistantScheduler?.active())throw Error('请先关闭协同总开关再清理');const self=account();if(!await api.review('cleanup',self))return;await api.runtime('cleanup','prepare',{account:self});await enter('cleanup');await b.onclick?.();}
  catch(e){root.querySelector('[data-status="cleanup"]').textContent=e.message;}finally{entering=false;}
 },true);
})();
