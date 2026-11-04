(function(root){
 function parseViews(label){
  const raw=String(label||'').replace(/,/g,'');
  const match=raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(万|億|亿|K|M|B)?\s*(?:次查看|次觀看|views?)/i);
  if(!match)return null;
  const unit=String(match[2]||'').toLowerCase(),mult={万:1e4,億:1e8,亿:1e8,k:1e3,m:1e6,b:1e9}[unit]||1;
  return Math.round(Number(match[1])*mult);
 }
 function randomSeconds(min,max,randomValue){
  min=Number(min);max=Number(max);
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min)throw Error('随机时间范围无效');
  if(min===max)return min; // Fixed remaining cooldown: preserve milliseconds, do not quantize.
  min=Math.ceil(Number(min)*100);max=Math.floor(Number(max)*100);if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min)throw Error('随机时间范围无效');
  const value=randomValue===undefined?crypto.getRandomValues(new Uint32Array(1))[0]/4294967296:Number(randomValue);
  if(!Number.isFinite(value)||value<0||value>=1)throw Error('随机值无效');
  return (min+Math.floor(value*(max-min+1)))/100;
 }
 function formatSeconds(seconds){return Number(seconds).toFixed(2);}
 function editorText(node){const blocks=node?.querySelectorAll?.('[data-contents="true"] > [data-block="true"]');const text=blocks?.length?[...blocks].map(block=>block.textContent||'').join('\n'):(node?.innerText??node?.textContent??'');return String(text).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/\n+$/,'');}
 function autoFollowEnabled(value){return value!==false;}
 function highExposure(views,minimum=5000){return Number.isFinite(views)&&views>minimum;}
 function friendshipRelated(text){
  const value=String(text||'').normalize('NFKC');
  return /(?:#?蓝\s*v\s*(?:交友|互动)|#?(?:真诚交友|交友圈|交友|互关互赞|互关|回关)|交(?:个)?朋友|浇朋友|(?:真诚)?浇友|互浇|互关|有\s*关\s*必\s*回|关注必回|回关|蓝\s*朋友|认识新朋友|寻找新朋友|想认识.{0,8}朋友|愿意认识.{0,8}朋友|(?:^|\W)(?:make new friends?|looking for (?:new )?friends?|let'?s connect|follow back|mutuals?)(?:\W|$)|#?(?:makefriends|newfriends|followback|mutuals|友達募集|相互フォロー|フォロバ))/iu.test(value);
 }
 function friendshipCandidate(text,views,minimum=500){
  return Number.isFinite(views)&&views>=minimum&&friendshipRelated(text);
 }
 function interactionSkipReason(info,{self,record,authors,now=Date.now()}={}){
  if(info.author.toLowerCase()===self)return 'self';
  if(record?.reply==='verified')return 'confirmed';
  if(['unknown','in_flight'].includes(record?.reply))return 'uncertain';
  if(Number.isFinite(record?.retryAt)&&record.retryAt>now)return 'retry_cooldown';
  if(authors?.has(info.author.toLowerCase()))return 'author_confirmed';
  if(!Number.isFinite(info.views))return 'views_missing';
  if(info.views<500)return 'low_views';
  if(!friendshipRelated(info.text))return 'unrelated';
  return null;
 }
 function interactionPage(path){try{const u=new URL(path,'https://x.com');return u.origin==='https://x.com'&&(u.pathname==='/home'||(u.pathname==='/search'&&!!u.searchParams.get('q')&&(!u.searchParams.get('f')||['top','live'].includes(u.searchParams.get('f')))));}catch{return false;}}
 root.XAssistantCore={interactionSkipReason,parseViews,interactionPage,autoFollowEnabled,highExposure,friendshipRelated,friendshipCandidate,randomSeconds,formatSeconds,editorText};
})(globalThis);
