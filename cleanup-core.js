(function(root){
 function parseViews(label){
  const raw=String(label||'').replace(/,/g,'');
  const match=raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(万|億|亿|K|M|B)?\s*(?:次查看|次觀看|views?)/i);
  if(!match)return null;
  const unit=String(match[2]||'').toLowerCase(),mult={万:1e4,億:1e8,亿:1e8,k:1e3,m:1e6,b:1e9}[unit]||1;
  return Math.round(Number(match[1])*mult);
 }
 function eligible(post,{self,now=Date.now()}={}){
  const at=Date.parse(post?.postedAt||'');
  return !!post&&String(post.author||'').toLowerCase()===String(self||'').toLowerCase()&&Number.isFinite(at)&&now-at>86400000&&Number.isFinite(post.views)&&post.views<50&&!post.isPinned&&!post.isReply&&!post.isRepost&&!post.isArticle&&!post.isPromoted;
 }
 function deleteDialog(document){
  const matches=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(d=>{
   const heading=d.querySelector('[role="heading"],h1,h2')?.textContent?.trim()||'';
   return /^(?:删除帖子|刪除貼文|Delete (?:post|Tweet))[？?]?$/i.test(heading)&&d.querySelector('[data-testid="confirmationSheetConfirm"]');
  });
  return matches.length===1?matches[0]:null;
 }
 root.XAssistantCleanupCore={parseViews,eligible,deleteDialog};
})(globalThis);
