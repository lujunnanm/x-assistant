// Read only the selected Zhihu answer or the canonical article page.
(()=>{
 const ANSWER='.AnswerItem',ARTICLE='article.Post-Main';
 const owned=(card,selector,owner)=>[...card.querySelectorAll(selector)].filter(node=>node.closest(owner)===card);
 const sourceKey=(type,id)=>`${type}:${id}`;
 const imageUrls=(rich,card,owner)=>{
  const urls=[];
  for(const image of rich?.querySelectorAll?.('img')||[]){
   if(image.closest(owner)!==card)continue;
   const candidates=['data-original','data-actualsrc','src'].map(name=>image.getAttribute(name)).filter(Boolean);
   const url=candidates.map(value=>{try{return new URL(value,location.href);}catch{return null;}}).find(value=>value?.protocol==='https:'&&/^(?:pic|pica|picb|picx|pic[1-4])\.zhimg\.com$/.test(value.hostname)&&/\.(?:jpe?g|png|webp|gif)$/i.test(value.pathname));
   if(url&&!urls.includes(url.origin+url.pathname))urls.push(url.origin+url.pathname);
  }
  return urls;
 };
 const readAnswer=card=>{
  const urls=owned(card,'meta[itemprop="url"]',ANSWER).map(node=>node.getAttribute('content'));
  urls.push(...owned(card,'.ContentItem-title a[href]',ANSWER).map(node=>node.getAttribute('href')));
  const matches=urls.map(value=>{try{return new URL(value,location.href).href.match(/^https:\/\/www\.zhihu\.com\/question\/(\d+)\/answer\/(\d+)(?:[?#].*)?$/);}catch{return null;}}).filter(Boolean);
  const ids=[...new Set(matches.map(m=>m[1]+'/'+m[2]))];if(ids.length!==1)return null;
  const [questionId,id]=ids[0].split('/');
  if(card.getAttribute('name')&&card.getAttribute('name')!==id)return null;
  let meta;try{meta=JSON.parse(card.getAttribute('data-zop')||'{}');}catch{meta={};}
  const heading=owned(card,'.ContentItem-title',ANSWER)[0];
  const sameQuestion=location.pathname.match(/^\/question\/(\d+)(?:\/|$)/)?.[1]===questionId;
  const question=(heading?.innerText||heading?.textContent||meta.title||(sameQuestion?document.querySelector('h1')?.textContent:'')||'').trim();
  const rich=owned(card,'.RichContent-inner .RichText',ANSWER)[0],images=imageUrls(rich,card,ANSWER);
  return {sourceType:'answer',sourceKey:sourceKey('answer',id),id,questionId,question,text:(rich?.innerText||rich?.textContent||'').trim(),url:`https://www.zhihu.com/question/${questionId}/answer/${id}`,...(images.length?{imageUrls:images}:{})};
 };
 const articleIdentity=card=>{
  let current;try{current=new URL(location.href);}catch{return null;}
  const path=current.origin==='https://zhuanlan.zhihu.com'&&current.pathname.match(/^\/p\/(\d+)\/?$/);if(!path)return null;
  const meta=document.querySelector('meta[property="og:url"]');
  const ownedValues=owned(card,'meta[itemprop="url"]',ARTICLE).map(node=>node.getAttribute('content')).filter(Boolean),ownedIds=[];
  for(const value of ownedValues){
   let url;try{url=new URL(value,location.href);}catch{continue;}
   const match=url.origin==='https://zhuanlan.zhihu.com'&&url.pathname.match(/^\/p\/(\d+)\/?$/);if(match)ownedIds.push(match[1]);
  }
  const uniqueOwned=[...new Set(ownedIds)];if(uniqueOwned.length!==1||uniqueOwned[0]!==path[1])return null;
  const values=[location.href,meta?.getAttribute?.('content')||meta?.content,...ownedValues];
  const ids=[];
  for(const value of values.filter(Boolean)){
   let url;try{url=new URL(value,location.href);}catch{continue;}
   const match=url.origin==='https://zhuanlan.zhihu.com'&&url.pathname.match(/^\/p\/(\d+)\/?$/);if(match)ids.push(match[1]);
  }
  const unique=[...new Set(ids)];return unique.length===1&&unique[0]===path[1]?path[1]:null;
 };
 const readArticle=card=>{
  const id=articleIdentity(card);if(!id)return null;
  const heading=owned(card,'.Post-Title',ARTICLE)[0];
  const rich=owned(card,'.Post-RichTextContainer .RichText',ARTICLE)[0]||owned(card,'.Post-RichTextContainer',ARTICLE)[0];
  const images=imageUrls(rich,card,ARTICLE);
  return {sourceType:'article',sourceKey:sourceKey('article',id),id,question:(heading?.innerText||heading?.textContent||'').trim(),text:(rich?.innerText||rich?.textContent||'').trim(),url:`https://zhuanlan.zhihu.com/p/${id}`,...(images.length?{imageUrls:images}:{})};
 };
 const kind=card=>card?.matches?.(ARTICLE)?'article':card?.matches?.(ANSWER)?'answer':null;
 const read=card=>kind(card)==='article'?readArticle(card):kind(card)==='answer'?readAnswer(card):null;
 const collapsed=card=>owned(card,'.RichContent.is-collapsed',ANSWER).length>0;
 async function fullRow(card,initial){
  if(initial?.sourceType==='answer'&&collapsed(card)){
   const more=owned(card,'button.ContentItem-more',ANSWER).find(button=>/阅读全文|展开全文/.test(button.textContent));
   if(!more||more.disabled)throw Error('回答未完整展示，请先在知乎展开全文');
   more.click();
   for(let i=0;i<80&&collapsed(card);i++){
    await new Promise(resolve=>setTimeout(resolve,100));
    if(!card.isConnected)throw Error('回答页面已变化，请重试');
   }
   if(collapsed(card))throw Error('回答全文加载未完成，请稍后重试');
  }
  const row=read(card),noun=initial?.sourceType==='article'?'文章':'回答';
  if(!card.isConnected||!row||row.sourceKey!==initial?.sourceKey)throw Error(`${noun}页面已变化，请重试`);
  if(!row.question||!row.text)throw Error(initial?.sourceType==='article'?'文章标题或正文尚未加载':'问题或回答正文尚未加载');
  return row;
 }
 globalThis.XAssistantZhihu={selector:`${ANSWER},${ARTICLE}`,read,fullRow,actions:card=>{const owner=kind(card)==='article'?ARTICLE:ANSWER;return owner?owned(card,'.ContentItem-actions',owner)[0]:null;}};
})();
