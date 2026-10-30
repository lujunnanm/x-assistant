// Runs on the selected profile, reads only. Never presses social controls.
export function readProfileReview(author){
 try{
  if(location.origin!=='https://x.com'||location.pathname.toLowerCase()!=='/'+author.toLowerCase())throw Error('当前页面不是所选作者主页');
  if(document.querySelector('[role="dialog"]'))throw Error('请关闭页面弹窗');
  const labels=[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||'');
  const match=labels.filter(l=>l.toLowerCase().endsWith('@'+author.toLowerCase())&&/^(关注|回关|正在关注|取消关注|Follow|Follow back|Following|Unfollow)\s/i.test(l));
  const status=match.length===1?(/^(正在关注|取消关注|Following|Unfollow)\s/i.test(match[0])?'已关注':'未关注'):'无法确定';
  const seen=new Set(),posts=[];
  for(const a of document.querySelectorAll('article[data-testid="tweet"]')){
   const link=[...a.querySelectorAll('a[href]')].find(x=>x.querySelector('time'));if(!link)continue;
   const u=new URL(link.href),parts=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
   if(u.origin!=='https://x.com'||!parts||parts[1].toLowerCase()!==author.toLowerCase()||seen.has(parts[2]))continue;
   seen.add(parts[2]);posts.push({url:u.origin+u.pathname,text:(a.querySelector('[data-testid="tweetText"]')?.textContent||'（无文本内容）').slice(0,1500)});
  }
  for(let i=posts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[posts[i],posts[j]]=[posts[j],posts[i]];}
  return {status,posts:posts.slice(0,2),author};
 }catch(e){return {error:e.message};}
}
