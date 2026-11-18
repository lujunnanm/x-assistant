// Read only the current answer card; never mix in comments or neighbouring answers.
(()=>{
 const CARD='.AnswerItem';
 const owned=(card,selector)=>[...card.querySelectorAll(selector)].filter(node=>node.closest(CARD)===card);
 const read=(card)=>{
  if(!card)return null;
  const urls=owned(card,'meta[itemprop="url"]').map(node=>node.getAttribute('content'));
  urls.push(...owned(card,'.ContentItem-title a[href]').map(node=>node.getAttribute('href')));
  const matches=urls.map(value=>{try{return new URL(value,location.href).href.match(/^https:\/\/www\.zhihu\.com\/question\/(\d+)\/answer\/(\d+)(?:[?#].*)?$/);}catch{return null;}}).filter(Boolean);
  const ids=[...new Set(matches.map(m=>m[1]+'/'+m[2]))];if(ids.length!==1)return null;
  const [questionId,id]=ids[0].split('/');
  if(card.getAttribute('name')&&card.getAttribute('name')!==id)return null;
  let meta;try{meta=JSON.parse(card.getAttribute('data-zop')||'{}');}catch{meta={};}
  const heading=owned(card,'.ContentItem-title')[0];
  const sameQuestion=location.pathname.match(/^\/question\/(\d+)(?:\/|$)/)?.[1]===questionId;
  const question=(heading?.innerText||heading?.textContent||meta.title||(sameQuestion?document.querySelector('h1')?.textContent:'')||'').trim();
  const rich=owned(card,'.RichContent-inner .RichText')[0];
  const imageUrls=[];
  for(const image of rich?.querySelectorAll?.('img')||[]){
   if(image.closest(CARD)!==card)continue;
   const candidates=['data-original','data-actualsrc','src'].map(name=>image.getAttribute(name)).filter(Boolean);
   const url=candidates.map(value=>{try{return new URL(value,location.href);}catch{return null;}}).find(value=>value?.protocol==='https:'&&/^(?:pic|pica|picb|picx|pic[1-4])\.zhimg\.com$/.test(value.hostname)&&/\.(?:jpe?g|png|webp|gif)$/i.test(value.pathname));
   if(url&&!imageUrls.includes(url.origin+url.pathname))imageUrls.push(url.origin+url.pathname);
  }
  return {id,questionId,question,text:(rich?.innerText||rich?.textContent||'').trim(),url:`https://www.zhihu.com/question/${questionId}/answer/${id}`,...(imageUrls.length?{imageUrls}:{})};
 };
 const collapsed=card=>owned(card,'.RichContent.is-collapsed').length>0;
 async function fullRow(card,initial){
  if(collapsed(card)){
   const more=owned(card,'button.ContentItem-more').find(button=>/阅读全文|展开全文/.test(button.textContent));
   if(!more||more.disabled)throw Error('回答未完整展示，请先在知乎展开全文');
   more.click();
   for(let i=0;i<80&&collapsed(card);i++){
    await new Promise(resolve=>setTimeout(resolve,100));
    if(!card.isConnected)throw Error('回答页面已变化，请重试');
   }
   if(collapsed(card))throw Error('回答全文加载未完成，请稍后重试');
  }
  const row=read(card);
  if(!card.isConnected||row?.id!==initial.id||row.questionId!==initial.questionId)throw Error('回答已变化，请重试');
  if(!row.question||!row.text)throw Error('问题或回答正文尚未加载');
  return row;
 }
 globalThis.XAssistantZhihu={read,fullRow,actions:card=>owned(card,'.ContentItem-actions')[0]};
})();
