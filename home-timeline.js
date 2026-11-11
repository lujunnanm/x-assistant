// Home tabs share /home. Keep their identity separate from route/worker ownership.
(() => {
 const PREFIX='xAssistantHomeTimelineV1:',ROOT='[data-testid="primaryColumn"]',ROWS='article[data-testid="tweet"], [data-testid="emptyState"]';
 const failure=(code,message)=>Object.assign(Error(message),{code});
 const home=()=>location.pathname==='/home',root=()=>document.querySelector(ROOT);
 const text=value=>String(value||'').replace(/\s+/g,' ').trim();
 const visible=node=>!!node?.isConnected&&!node.closest('[hidden],[inert],[aria-hidden="true"]')&&(!node.getClientRects||node.getClientRects().length>0)&&
  (!globalThis.getComputedStyle||!['none','hidden','collapse'].includes(globalThis.getComputedStyle(node).display)&&!['hidden','collapse'].includes(globalThis.getComputedStyle(node).visibility));
 const rows=()=>[...root()?.querySelectorAll(ROWS)||[]].filter(visible);
 const account=()=>{const value=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');return /^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;};
 const storage=()=>globalThis.XAssistantRuntime?.storage||globalThis.chrome?.storage?.local;
 const descriptor=node=>{
  const label=text(node.innerText||node.textContent);if(!label)return null;
  const href=node.getAttribute('href');let key='label:'+label;
  if(href){try{const url=new URL(href,location.href);if(url.origin!=='https://x.com'||url.pathname!=='/home'||url.search)return null;key='href:'+url.pathname+url.search+url.hash+'|label:'+label;}catch{return null;}}
  return {node,key,label};
 };
 const tabs=()=>[...root()?.querySelectorAll('[role="tablist"] [role="tab"]')||[]].filter(visible).map(descriptor).filter(Boolean);
 const selected=()=>{
  const list=tabs(),active=list.filter(tab=>tab.node.getAttribute('aria-selected')==='true');
  return active.length===1&&list.filter(tab=>tab.key===active[0].key).length===1?active[0]:null;
 };
 let epoch=0,lastKey=null,lastRows=[],lastRoot=null,pending=null,manual=null;
 const invalidate=key=>{epoch++;pending=pending||{old:lastRows.slice(),gone:new Set(),cleared:false};pending.key=key;};
 const sample=()=>{
  const tab=selected();if(!tab)return null;
  if(lastKey!==null&&lastKey!==tab.key)invalidate(tab.key);
  lastKey=tab.key;lastRows=rows();lastRoot=root();return {key:tab.key,label:tab.label,epoch};
 };
 const mutations=records=>{
  if(!home())return;
  const main=root(),inside=node=>!!main&&(node===main||main.contains?.(node));
  // Floating countdowns and unrelated page widgets mutate continuously. Do not
  // scan feed nodes/styles unless the primary column itself was affected.
  records=records.filter(record=>inside(record.target)||record.type==='childList'&&(
   [...record.addedNodes||[]].some(node=>main&&(node===main||node.contains?.(main)))||
   [...record.removedNodes||[]].some(node=>lastRoot&&(node===lastRoot||node.contains?.(lastRoot)))));
  if(!records.length)return;
  // MutationRecord has only oldValue. The next record for the same node gives
  // its intermediate new value, preserving A->B->A without false same-value changes.
  let changed=false;const nextValues=new Map();
  for(let i=records.length-1;i>=0;i--){
   const record=records[i],node=record.target;
   if(record.type!=='attributes'||record.attributeName!=='aria-selected'||!inside(node)||node.getAttribute('role')!=='tab')continue;
   const value=nextValues.has(node)?nextValues.get(node):node.getAttribute('aria-selected');
   if(record.oldValue!==null&&record.oldValue!==value)changed=true;
   nextValues.set(node,record.oldValue);
  }
  if(changed&&lastKey!==null)invalidate(selected()?.key||pending?.key||lastKey);
  if(pending){
   for(const record of records)for(const removed of record.removedNodes||[])for(const old of pending.old)
    if(removed===old||removed.contains?.(old))pending.gone.add(old);
   if(pending.old.length&&pending.old.every(old=>!visible(old)||pending.gone.has(old)))pending.cleared=true;
  }
  sample();
 };
 let observer=null;
 if(typeof globalThis.MutationObserver==='function'&&document.documentElement){
  observer=new MutationObserver(mutations);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-selected']});
 }
 const drain=()=>{const records=observer?.takeRecords?.();if(records?.length)mutations(records);};
 function capture(){
  if(!home())return null;drain();
  const token=sample();if(!token)throw failure('TIMELINE_NOT_READY','首页时间线标签尚未就绪或无法唯一核对');return token;
 }
 function check(token){
  if(!home())return;let actual;try{actual=capture();}catch{}
  if(!token||!actual||actual.key!==token.key||actual.epoch!==token.epoch)throw failure('TIMELINE_CHANGED','首页时间线已切换，取消旧目标并重新扫描');
 }
 const managed=()=>globalThis.XAssistantWorkspace?.state?.().assignment?.module==='interaction';
 // Capture before React handles the native click. Ordinary browsing never saves a preference.
 document.addEventListener?.('click',event=>{
  if(!event.isTrusted||!home()||!managed())return;
  const node=event.target?.closest?.('[role="tab"]');if(!node)return;
  const target=tabs().find(tab=>tab.node===node);if(!target)return;
  const current=sample();if(current?.key===target.key)return;
  invalidate(target.key);manual={key:target.key,account:account()};
 },true);
 const workCheck=signal=>{
  if(signal?.aborted)throw new DOMException('任务已停止','AbortError');
  globalThis.XAssistantRuntime?.check?.(signal);globalThis.XAssistantWorkspace?.check?.(signal);
 };
 const save=async(token,owner)=>{
  if(!owner||account()!==owner)return false;
  const local=storage();if(!local)return false;
  await local.set({[PREFIX+owner]:{version:1,key:token.key,label:token.label}});return true;
 };
 async function ready(signal){
  if(!home())throw failure('TIMELINE_NOT_READY','当前页面不是首页时间线');
  workCheck(signal);
  const probe=()=>{
   workCheck(signal);if(!home())return false;drain();
   const token=sample(),main=root(),content=rows();if(!token||!main||!content.length)return false;
   // X keeps a load-more spinner below already rendered cards. It is not an
   // initial-list loading barrier; only a visible spinner before the list is.
   if([...main.querySelectorAll('[role="progressbar"], [data-testid="spinner"]')].some(node=>visible(node)&&
    !!(node.compareDocumentPosition?.(content[0])&4)))return false;
   if(pending){
    if(pending.key&&pending.key!==token.key)return false;
    if(pending.old.length&&!pending.cleared&&pending.old.some(visible))return false;
   }
   return token;
  };
  const wait=globalThis.XAssistantTasks?.waitForPage;
  const token=wait?await wait(probe,{signal,timeout:15000}):probe();
  if(!token)throw failure('TIMELINE_NOT_READY','首页时间线切换后列表未能确认刷新，请检查工作页');
  check(token);pending=null;
  const request=manual;
  if(request&&request.key===token.key&&managed()){
   await save(token,request.account);check(token);if(manual===request)manual=null;
  }
  return token;
 }
 function noDraft(){
  const editorText=globalThis.XAssistantCore?.editorText||((node)=>node.innerText||node.textContent||'');
  if(document.querySelector('[role="dialog"],[role="alertdialog"],[data-testid="attachments"],[data-testid="pollCreator"]')||
   [...document.querySelectorAll('[contenteditable="true"]')].some(node=>text(editorText(node)))||
   [...document.querySelectorAll('input[type="file"]')].some(node=>node.files?.length))
   throw Object.assign(failure('RESIDUAL_DRAFT','工作页有草稿或弹窗，未自动切换时间线'),{preserveDrafts:true});
 }
 async function enter(signal){
  workCheck(signal);if(!home())throw failure('TIMELINE_NOT_READY','当前页面不是首页时间线');
  // A worker's explicit choice wins over an older saved preference.
  if(manual)return ready(signal);
  const owner=account();if(!owner)throw failure('ACCOUNT_NOT_READY','首页账号尚未就绪');
  drain();sample();const initialEpoch=epoch,initialManual=manual;
  const changed=()=>{drain();sample();return epoch!==initialEpoch||manual!==initialManual;};
  const local=storage(),saved=local?(await local.get(PREFIX+owner))[PREFIX+owner]:null;
  workCheck(signal);if(account()!==owner)throw failure('ACCOUNT_CHANGED','账号发生变化，未切换时间线');
  if(changed())return ready(signal);
  if(!saved)return ready(signal);
  const wait=globalThis.XAssistantTasks?.waitForPage;
  const available=()=>{workCheck(signal);if(account()!==owner)throw failure('ACCOUNT_CHANGED','账号发生变化，未切换时间线');if(changed())return {changed:true};if(!home()||!selected())return false;const matches=tabs().filter(tab=>tab.key===saved.key);return matches.length===1?matches[0]:false;};
  const match=wait?await wait(available,{signal,timeout:15000}):available();
  workCheck(signal);if(changed())return ready(signal);
  if(!match)throw failure(selected()?'TIMELINE_NOT_FOUND':'TIMELINE_NOT_READY','已保存的首页时间线不可用或未加载：'+text(saved.label));
  const token=capture();
  if(token.key!==saved.key){
   if(changed())return ready(signal);
   noDraft();workCheck(signal);sample();invalidate(saved.key);match.node.click();
  }
  return ready(signal);
 }
 async function rememberCurrent(){
  if(!home())return false;let token;try{token=capture();}catch{return false;}
  const owner=account();if(!owner)return false;return save(token,owner);
 }
 globalThis.XAssistantHomeTimeline={capture,check,ready,enter,rememberCurrent};
})();
