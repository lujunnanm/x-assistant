// Only canonical public post URLs may be opened from the review panel.
export function postURL(value){
  const u=new URL(value);
  if(u.origin!=='https://x.com'||u.username||u.password||!/^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(u.pathname))throw Error('请输入有效的 X 帖子链接');
  return u.origin+u.pathname.replace(/\/$/,'');
}

export function prepareReview(posts,rows,random=Math.random){
  if(!Array.isArray(posts)||!posts.length)throw Error('当前页面没有可选帖子，请刷新主页后重试');
  const replies=rows.filter(r=>r.type==='reply'&&r.enabled&&r.text.trim());
  if(!replies.length)throw Error('评论文案库为空或全部停用');
  const post=posts[Math.floor(random()*posts.length)],row=replies[Math.floor(random()*replies.length)];
  return {url:postURL(post.url),excerpt:post.text,reply:row.text,id:row.id};
}
