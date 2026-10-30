(()=>{
  if(location.origin!=='https://x.com'||location.pathname!=='/home')return {ok:false,message:'请在绑定的 X 标签页打开主页'};
  if(document.querySelector('[role="dialog"]'))return {ok:false,message:'请先关闭页面弹窗'};
  const main=document.querySelector('[data-testid="primaryColumn"]');
  const tabs=[...(main?.querySelectorAll('[role="tab"][aria-selected="true"]')||[])];
  if(tabs.length!==1||!['为你推荐','For you'].includes(tabs[0].textContent.trim()))return {ok:false,message:'请先手动选中主页「为你推荐 / For you」标签'};
  const seen=new Set(),posts=[];
  for(const article of main.querySelectorAll('article[data-testid="tweet"]')){
    const link=[...article.querySelectorAll('a[href]')].find(a=>a.querySelector('time'));
    if(!link)continue;
    const u=new URL(link.href,location.origin);
    if(u.origin!=='https://x.com'||!/^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(u.pathname))continue;
    const id=u.pathname.match(/\/status\/(\d+)/)[1];if(seen.has(id))continue;seen.add(id);
    posts.push({url:u.origin+u.pathname.replace(/\/$/,''),text:(article.querySelector('[data-testid="tweetText"]')?.textContent||'（媒体帖或没有文字）').slice(0,1500)});
    if(posts.length===30)break;
  }
  return {ok:true,posts,message:`已读取 ${posts.length} 条已加载帖子；未自动滚动或执行互动`};
})();
