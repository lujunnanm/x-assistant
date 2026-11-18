// Page identity and task ownership are separate: a task may visit its own detail pages.
(() => {
 const names=['posting','interaction','notifications','followback'];
 const normalize=value=>{const u=new URL(value,'https://x.com');if(u.origin!=='https://x.com')throw Error('工作区仅支持 X 页面');return u.pathname+u.search;};
 const account=value=>/^\/[A-Za-z0-9_]{1,15}$/.test(value||'')?value.toLowerCase():null;
 function searchList(value){
  try{const u=new URL(value,'https://x.com'),q=u.searchParams.get('q');
   return u.origin==='https://x.com'&&u.pathname==='/search'&&u.searchParams.getAll('q').length===1&&q?.trim()&&q.length<=120&&
    !/[\u0000-\u001f\u007f]/u.test(q)&&u.searchParams.getAll('f').length<=1&&['','top','live'].includes(u.searchParams.get('f')||'')?u:null;
  }catch{return null;}
 }
 function moduleFor(url,self,{homeInteraction=false}={}){
  const path=new URL(url,'https://x.com').pathname.toLowerCase();
  if(globalThis.XAssistantServicePolicy?.isFollowbackPage(url,self))return 'followback';
  if(path==='/home')return homeInteraction?'interaction':'posting';
  if(path==='/search')return 'interaction';
  if(path==='/notifications'||path.startsWith('/notifications/'))return 'notifications';
  if(account(self)&&path===account(self))return 'notifications';
  return null;
 }
 function createGuard({module,url,self,now=Date.now}){
  if(!names.includes(module)||!account(self))throw Error('工作区或账号无效');
  let expected=normalize(url),pending=null,composers=0,seenComposer=null,heldResult=null;
  const owner=account(self);
  function check(url,currentAccount){
   if(account(currentAccount)!==owner)throw Object.assign(Error('账号发生变化，当前模块已停止'),{code:'ACCOUNT_CHANGED'});
   if(module==='followback'&&!globalThis.XAssistantServicePolicy.isFollowbackPage(url,owner))
    throw Object.assign(Error('工作页已离开本账号的认证关注者名单，回关已暂停'),{code:'PAGE_CHANGED'});
   const current=normalize(url);
   if(pending&&now()>pending.until)pending=null;
   if(pending&&current===pending.path){expected=current;pending=null;return;}
   if(current===expected){seenComposer=null;heldResult=null;return;}
   if(composers&&/^\/compose\/(?:post|tweet)(?:\?|$)/.test(current)){seenComposer=current;return;}
   // The click was made in this exact composer. X can leave it open after an
   // error. Block all further actions but keep the platform reason and draft.
   if(heldResult&&heldResult.path===current)throw Object.assign(Error(heldResult.message),{code:heldResult.code,submitted:true,confirmed:heldResult.confirmed,preserveDrafts:true});
   heldResult=null;
   throw Object.assign(Error('页面已切换，当前模块已暂停；回到工作页面后手动启动'),{code:'PAGE_CHANGED'});
  }
  function expectNavigation(path,url,currentAccount){check(url,currentAccount);pending={path:normalize(path),until:now()+15000};}
  function expectNativeSearch(path,url,currentAccount){
   check(url,currentAccount);
   const target=searchList(path);
   if(module!=='interaction'||pending||composers||heldResult||!searchList(expected)||!target||normalize(target.href)===expected)return false;
   expectNavigation(target.href,url,currentAccount);return true;
  }
  function beginComposer(){
   if(!composers){seenComposer=null;heldResult=null;}
   composers++;let done=false;
   return (result={})=>{
    if(done)return;done=true;composers--;
    if(!composers&&seenComposer&&result.submitted){
     const confirmed=result.confirmed===true;
     heldResult={path:seenComposer,confirmed,code:confirmed?'CONFIRMED_COMPOSER_OPEN':'SEND_UNKNOWN',
      message:confirmed?'回复已确认；编辑页仍打开，请查看工作页（不会重复回复）':'回复结果未确认，保留编辑页且不会重发：'+(result.reason||'请核对平台记录')};
    }
   };
  }
  return {check,expectNavigation,expectNativeSearch,beginComposer,account:owner,module,expected:()=>expected};
 }
 globalThis.XAssistantWorkspacePolicy={moduleFor,createGuard,normalize,searchList,names};
})();
