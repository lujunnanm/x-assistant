// Read-only preflight before in-place repair. Never closes a popup or clears a draft.
export async function prepareWorkerRepair(tab,account,{module}={}){
 if(new URL(tab.url||'about:blank').origin!=='https://x.com')
  throw Error('原工作页已离开 X，请先在该页返回 X，再点恢复；不会另开页面');
 if(tab.discarded||tab.pendingUrl&&tab.pendingUrl!==tab.url)throw Object.assign(Error('原工作页正在切换或已挂起，请就绪后恢复'),{code:'PAGE_NOT_READY'});
 const [probe]=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>{
  const account=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
  const draft=!!document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')||
   [...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.textContent?.trim())||
   [...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length);
  // Retained hidden modal shells are not an open dialog. Keep actual draft
  // content protected even when hidden, including files still being uploaded.
  const popup=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(e=>{
   const style=getComputedStyle(e);
   return !e.hidden&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&e.getClientRects().length>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);
  });
  return {url:location.href,account,draft,popup,primary:!!document.querySelector('[data-testid="primaryColumn"]')};
 }});
 if(probe?.result?.url!==tab.url||!probe.result.account)throw Object.assign(Error('原工作页账号或页面尚未就绪，请在原页确认后恢复'),{code:'PAGE_NOT_READY'});
 if(probe.result.account!==account)throw Object.assign(Error('原工作页账号或页面发生变化，请在原页确认后恢复'),{code:'ACCOUNT_CHANGED'});
 if(probe.result.draft)throw Object.assign(Error('原工作页有未发送草稿，请先处理后恢复；不会另开页面'),{code:'RESIDUAL_DRAFT'});
 if(probe.result.popup)throw Object.assign(Error('原工作页有打开的弹窗，请先处理；不会自动关闭弹窗或另开页面'),{code:'RESIDUAL_POPUP'});
 if(module==='notifications'&&!probe.result.primary)throw Object.assign(Error('X 主栏尚未就绪，延后只读检查，不刷新页面'),{code:'PAGE_NOT_READY'});
 return {ready:true,url:probe.result.url,account:probe.result.account};
}
