// Explicit adapter for the deletion preview/driver. Loading this file performs no action.
(() => {
 'use strict';
 const D=()=>globalThis.XAssistantDOM, all=(root,selector)=>root?[...root.querySelectorAll(selector)]:[];
 const single=list=>list.length===1?list[0]:null;
 const clean=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
 const handle=value=>/^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
 const account=()=>location.origin==='https://x.com'?handle(D()?.account?.()):null;
 const path=()=>location.pathname.replace(/\/$/,'').toLowerCase();
 const articleSelector='article[data-testid="tweet"]',dialogSelector='[role="dialog"],[role="alertdialog"],[data-testid="confirmationSheetDialog"]';
 const menuSelector='[role="menu"],[data-testid="Dropdown"]',successSelector='[data-testid="toast"],[role="status"],[role="alert"]';
 const mounted=n=>n?.isConnected===true&&!n.closest('[hidden]');
 const active=n=>mounted(n)&&!n.disabled&&n.getAttribute('aria-disabled')!=='true'&&!n.closest('[inert],[aria-hidden="true"]');
 const title=n=>clean(n?.innerText||n?.textContent),deleteWord=s=>/^(?:Delete|删除|刪除|削除)$/i.test(s);
 const ownRoute=(owner)=>path()===owner||path()==='/search'||new RegExp('^'+owner+'/status/\\d+$').test(path());
 const metascope=(a,own)=>D()?.deletableOriginal?.(a,own)===true;
 function bound(owner){
  if(!owner||owner!==account()||!ownRoute(owner))return [];
  const main=single(all(document,'[data-testid="primaryColumn"]').filter(mounted));
  const items=[];
  for(const card of all(main,articleSelector)){
   if(!mounted(card)||card.closest(dialogSelector)||card.querySelector('article,[data-testid="quoteTweet"],[data-testid="tweet-text-show-more-link"]'))continue;
   const times=all(card,'time'),time=single(times);
   const route=time?.closest('a[href]')?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
   if(!route||'/'+route[1].toLowerCase()!==owner||!metascope(route[2],owner))continue;
   const authorBox=single(all(card,'[data-testid="User-Name"]')),byline=all(authorBox,'a[href]').some(a=>a.getAttribute('href')?.toLowerCase()===owner);
   const body=single(all(card,'[data-testid="tweetText"]')),text=body&&clean(body.innerText||body.textContent);
   if(!byline||!text)continue;
   const canonical=owner+'/status/'+route[2];
   items.push({card,row:{id:route[2],account:owner,author:owner.slice(1),text,path:canonical,url:'https://x.com'+canonical,owned:true,original:true,isReply:false,isQuote:false,isRepost:false}});
  }
  return items;
 }
 function scan(owner){
  const items=bound(handle(owner)),counts=new Map();for(const {row} of items)counts.set(row.id,1+(counts.get(row.id)||0));
  return items.filter(({row})=>counts.get(row.id)===1).map(({row})=>row);
 }
 function detail(target){
  const owner=handle(target?.account),id=target?.id;
  if(!owner||typeof id!=='string'||!/^\d+$/.test(id)||path()!==owner+'/status/'+id)return null;
  const item=single(bound(owner).filter(r=>r.row.id===id));
  return item&&(target.text===undefined||target.text===item.row.text)?item:null;
 }
 const inspect=target=>detail(target)?.row??null;
 const uniqueOpenMenus=()=>all(document,menuSelector).filter(active);
 const dialogs=()=>all(document,dialogSelector).filter(active);
 const freshDeleteMenu=()=>{
  const candidates=all(document,'[role="menuitem"]').filter(n=>active(n)&&n.closest(menuSelector)&&deleteWord(title(n)));
  return single(candidates);
 };
 const sheet=()=>{
  const controls=all(document,'[data-testid="confirmationSheetConfirm"]').filter(n=>active(n)&&deleteWord(title(n)));
  const confirm=single(controls),dialog=confirm?.closest(dialogSelector);if(!dialog)return null;
  const open=dialogs();if(open.some(n=>n!==dialog&&!n.contains(dialog)&&!dialog.contains(n)))return null;
  const prompt=/^(?:delete (?:post|tweet)|(?:要|确定要|確定要)?(?:删除|刪除)(?:这条|此|這則|這條|這篇|這個|此則)?(?:帖子|推文|貼文)(?:吗|嗎)?|(?:この)?(?:ポスト|ツイート)を削除(?:しますか)?)[?？]$/i;
  // X can name the alertdialog using a plain span instead of a heading. Only
  // accept names from this sheet, never text elsewhere on the page or its body.
  const visible=n=>active(n)&&(!n.checkVisibility||n.checkVisibility({checkVisibilityCSS:true}));
  const labels=[];
  for(const layer of open.filter(n=>n===dialog||n.contains(confirm))){
   const ref=clean(layer.getAttribute('aria-labelledby')),explicit=clean(layer.getAttribute('aria-label'));
   if(ref){
    const named=ref.split(/\s+/).map(id=>document.getElementById(id));
    if(named.some(n=>!n||!layer.contains(n)||!visible(n)))return null;
    labels.push(named.map(title).join(' '));
   }
   if(explicit)labels.push(explicit);
   labels.push(...all(layer,'h1,h2,h3,[role="heading"],[data-testid="confirmationSheetTitle"]').filter(visible).map(title));
  }
  if(!labels.length||!labels.every(s=>prompt.test(s)))return null;
  return {dialog,confirm};
 };
 const message=n=>title(n).replace(/[.!。！]$/,'').trim();
 const successMessage=n=>/^(?:(?:your|the|this) (?:post|tweet) (?:was|has been) deleted|(?:post|tweet) deleted|(?:你的|您的|该|此|這則|這篇)?(?:帖子|推文|貼文)(?:已经|已經|已)(?:被)?(?:删除|刪除)|(?:ポスト|ツイート)を削除しました)$/i.test(message(n));
 const toastSnapshot=()=>new Map(all(document,successSelector).filter(active).map(n=>[n,message(n)]));
 const fail=reason=>{throw Error(reason);};
 const alive=signal=>{if(signal?.aborted)fail('cancelled');};
 async function wait(read,ms,signal){const end=Date.now()+ms;for(;;){alive(signal);const found=read();if(found)return found;const left=end-Date.now();if(left<=0)return null;await new Promise(r=>setTimeout(r,Math.min(left,120)));}}
 // Optional native receipt channel. Old documents or unsupported browsers
 // fall back to the existing fresh-toast path, never to "missing = deleted".
 function watchNative(){
  try{
   if(!globalThis.chrome?.dom?.openOrClosedShadowRoot)return null;
   const list=()=>all(document.documentElement,':scope > [data-sacred-delete-watch]');
   const old=new Set(list());document.dispatchEvent(new Event('sacred-delete-watch'));
   const host=single(list().filter(n=>!old.has(n)));if(!host)return null;
   const port=chrome.dom.openOrClosedShadowRoot(host)?.firstElementChild;if(!port)return null;
   port.dispatchEvent(new Event('sacred-delete-arm'));
   return {seen:()=>port.getAttribute('data-confirmed')==='1',close:()=>port.dispatchEvent(new Event('sacred-delete-end'))};
  }catch{return null;}
 }
 let busy=false;
 async function remove(target,{signal,beforeConfirm}={}){
  const id=target?.id??null;
  if(busy||typeof beforeConfirm!=='function'||typeof target?.text!=='string'||!target.text.trim())return {id,status:'skipped',reason:'busy_or_missing_confirmation_binding'};
  busy=true;let submitted=false,native=null;
  try{
   alive(signal);
   const owner=handle(target.account),route=owner+'/status/'+id;
   // The body often mounts before the native More control, and hydration can
   // replace that card. Only before opening a menu may an identical card rebind.
   const first=await wait(()=>{
    if(!owner||account()!==owner||path()!==route||dialogs().length||uniqueOpenMenus().length)fail('target_changed_or_overlay_open');
    const candidate=detail(target);if(!candidate)return null;
    const caret=single(all(candidate.card,'[data-testid="caret"]').filter(n=>active(n)&&n.closest(articleSelector)===candidate.card));
    if(!caret)return null;
    // No await from identity/button validation to the single native menu click.
    caret.click();return candidate;
   },7000,signal);
   if(!first)fail('missing_unique_target_menu');
   const guard=()=>{alive(signal);const now=detail(target);if(!now||now.card!==first.card)fail('target_changed');return now;};
   const item=await wait(()=>{guard();if(dialogs().length)fail('unexpected_dialog');return freshDeleteMenu();},4500,signal);
   if(!item||freshDeleteMenu()!==item)fail('missing_unique_delete_item');
   guard();item.click();
   const confirm=await wait(()=>{guard();return sheet();},4500,signal);
   if(!confirm)fail('missing_delete_confirmation');
   await beforeConfirm(guard().row);
   const again=sheet();guard();
   if(!again||again.dialog!==confirm.dialog||again.confirm!==confirm.confirm)fail('delete_confirmation_changed');
   const before=toastSnapshot();native=watchNative();
   submitted=true;confirm.confirm.click();
   // Disappearing alone can mean navigation/virtualization; an old toast alone
   // can belong to a previous deletion. Require a fresh successful receipt AND
   // removal of the bound card on the original route, or unmount on navigation.
   const receipt=await wait(()=>{
    const who=account();if(who&&who!==target.account.toLowerCase())fail('account_changed_after_click');
    if(!who)return false; // Account link may temporarily unmount during X navigation.
    const fresh=all(document,successSelector).filter(active).some(n=>successMessage(n)&&before.get(n)!==message(n));
    const nativeOk=native?.seen();if(!fresh&&!nativeOk)return false;
    const gone=!first.card.isConnected&&(path()!==first.row.path||!bound(first.row.account).some(x=>x.row.id===id));
    return gone?(nativeOk?'native_delete_receipt':'fresh_delete_receipt'):false;
   },8000,signal);
   return receipt?{id,status:'deleted',reason:receipt}:{id,status:'unknown',reason:'no_confirmed_delete_receipt'};
  }catch(e){return {id,status:submitted?'unknown':'skipped',reason:String(e?.message||e)};}
  finally{native?.close();busy=false;}
 }
 globalThis.XAssistantDeletionDOM={account,scan,inspect,remove};
})();
