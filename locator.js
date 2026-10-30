(()=>{
  if(globalThis.__xAssistantLocator)return;
  globalThis.__xAssistantLocator=true;
  function visible(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[aria-hidden="true"]');}
  function usable(el){if(!visible(el)||el.disabled||el.getAttribute('aria-disabled')==='true')return false;const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top && (top===el||el.contains(top));}
  function locate(type){
    if(document.querySelector('[role="dialog"]'))return {ok:false,message:'存在弹窗，请关闭后重试'};
    if(document.querySelector('[data-testid="loginButton"]'))return {ok:false,message:'检测到登录入口，请检查登录状态'};
    let target,url=null;
    if(type==='post'){
      const nodes=[...document.querySelectorAll('[data-testid="SideNav_NewTweet_Button"]')].filter(usable);
      if(nodes.length!==1)return {ok:false,message:`发帖入口匹配 ${nodes.length} 个，拒绝猜测`};target=nodes[0];
    }else{
      const match=location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
      if(!match)return {ok:false,message:'评论定位请先打开具体帖子详情页（/用户名/status/数字）'};
      const articles=[...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>[...a.querySelectorAll('a[href]')].some(link=>link.querySelector('time') && new URL(link.href).pathname.match(/\/status\/(\d+)/)?.[1]===match[1]));
      if(articles.length!==1)return {ok:false,message:`目标帖子匹配 ${articles.length} 个，拒绝猜测`};
      const nodes=[...articles[0].querySelectorAll('[data-testid="reply"]')].filter(usable);
      if(nodes.length!==1)return {ok:false,message:`回复按钮匹配 ${nodes.length} 个，请把目标按钮滚动到可见区域`};target=nodes[0];url=location.origin+location.pathname;
    }
    const r=target.getBoundingClientRect();
    const marker=document.createElement('div');marker.style.cssText=`position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;outline:3px solid #16a34a;pointer-events:none;z-index:2147483647;border-radius:6px;`;document.documentElement.append(marker);setTimeout(()=>marker.remove(),1800);
    return {ok:true,message:'唯一目标已定位并绿框标记（未点击）',url,selector:target.getAttribute('data-testid')};
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(sender.id===chrome.runtime.id&&msg.kind==='LOCATE'){try{reply(locate(msg.type));}catch(e){reply({ok:false,message:e.message});}}});
})();
