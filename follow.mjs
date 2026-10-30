// Read-only author control inspection. Never clicks a follow/unfollow button.
export function locateAuthorFollow(url){
 try {
  const expected=new URL(url),author=expected.pathname.split('/')[1];
  if(location.origin!==expected.origin||location.pathname!==expected.pathname)throw Error('当前页不是原帖详情页');
  if(document.querySelector('[role="dialog"]'))throw Error('请先处理现有弹窗');
  const articles=[...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>{
    const link=[...a.querySelectorAll('a[href]')].find(l=>l.querySelector('time'));
    return link&&new URL(link.href).pathname===expected.pathname;
  });
  if(articles.length!==1)throw Error('原帖未加载或不唯一，请稍后重试');
  const buttons=[...articles[0].querySelectorAll('button')];
  const label=b=>(b.getAttribute('aria-label')||'').trim();
  const own=b=>label(b).toLowerCase().endsWith('@'+author.toLowerCase());
  if(buttons.some(b=>own(b)&&/^(取消关注|正在关注|Following|Unfollow)\s/i.test(label(b))))return {message:'作者已关注，跳过；未点击任何按钮'};
  const matches=buttons.filter(b=>own(b)&&/^(关注|回关|Follow|Follow back)\s/i.test(label(b)));
  if(matches.length!==1)return {message:'原帖内未找到唯一且明确属于作者的关注按钮；未使用侧栏推荐按钮'};
  const b=matches[0];b.scrollIntoView({block:'center'});
  if(b.disabled||b.getAttribute('aria-disabled')==='true')throw Error('作者关注按钮不可用');
  const old=b.style.outline;b.style.outline='3px solid #16a34a';setTimeout(()=>{b.style.outline=old;},5000);
  return {message:'已绿框标记作者 @'+author+' 的关注按钮，请你手动点击；插件未关注'};
 }catch(e){return {error:e.message};}
}
