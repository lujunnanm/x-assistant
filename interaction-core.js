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
  // Candidate matching is based on the complete post body. Hashtags are only
  // one spelling of a topic: the same terms in ordinary sentences, or split
  // by spaces/punctuation, must remain eligible for interaction.
  const compact=value.toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[\s#＃_\-–—·・,，。.!！?？:：;；、|/\\()[\]{}【】「」『』"'“”‘’]+/gu,'');
  const bodyTerms=[
   '蓝v互动','出摊就位','抱团交朋友','真诚互访','蓝v互推','积极回关','浇盆友','出晚摊','浇起来','互粉互串','真诚串门','真诚出摊','蓝宝宝','交友','互关','互粉','回关','求关注','涨粉','增粉','扩列','浇友','互浇','关注必回','有关必回','蓝友','蓝朋友',
   '蓝v交友','蓝v互关','蓝v扩列','蓝v浇友','蓝v互助','蓝v新人','蓝v活人','蓝v涨粉','蓝v串门','蓝v出摊','蓝v抱团','蓝友互关',
   '友達募集','お友達募集','相互フォロー','フォロバ','フォロワー募集','繋がりたい','つながりたい','交流したい','絡み募集中','仲間募集','ブルーバッジ仲間','認証垢相互'
  ];
  if(bodyTerms.some(term=>compact.includes(term.toLowerCase())))return true;
  // Metrics are relevant when discussed in the blue-V/friendship context,
  // not merely because a random post mentions followers or impressions.
  if(/(?:蓝v|蓝朋友|浇友|互浇|互关|交友)/iu.test(compact)&&
     /(?:粉丝量|粉丝目标|涨粉速度|涨粉|多少粉|粉丝\d|\d+粉丝|曝光|浏览量|转化|有效曝光)/iu.test(compact))return true;
  const patterns=[
   /(?:#?蓝\s*v\s*(?:交友圈?|交朋友|互动|日常互动|互关|互粉|互关互赞|诚信互关|关注必回|回关|浇友|浇个朋友|互浇|扩列|互助|涨粉互助|新人(?:报到|报道)?|新号|活人|涨粉|增粉|求关注|求互关|串门(?:互助)?|出摊|抱团|破千|冲(?:千)?粉)|#?蓝友(?:互关|互粉|交友|集合)?|#?(?:真诚交友|诚信交友|交友圈|交友扩列|诚信互关|长期互关|活跃互关|互关互赞|互关互评|互赞互评|互帮互助|互关大队|回关大队|真诚互粉|诚信互粉|互粉|互关|求互关|求关注|求蓝友|回关必回|秒回关|有关必回|有\s*关\s*必\s*回|关注必回|浇友串门)|交(?:个)?朋友|浇(?:个)?朋友|(?:真诚)?浇友|互浇|蓝\s*朋友|认识新朋友|寻找新朋友|想认识.{0,8}朋友|愿意认识.{0,8}朋友|(?:蓝\s*v|互关|交友|浇友).{0,12}(?:串门|出摊)|(?:串门|出摊).{0,12}(?:蓝\s*v|互关|交友|浇友))/iu,
   /(?:^|\W)(?:make new friends?|looking for (?:new )?(?:friends?|mutuals?)|let'?s connect|let'?s be mutuals?|active mutuals?|new mutuals? welcome|new creators?|mutual follows?|mutual support|support each other|follow back|follow me|i follow back|following everyone back|follow for follow|follow train|follow party|follow spree|follow thread|follow chain|follow loop|grow together|connect with (?:new )?(?:me|people|creators)|gain (?:new )?followers?|creator community)(?:\W|$)|#?(?:makefriends|newfriends|followback|followme|ifollowback|followback100|followbackall|followbacknow|followbackteam|followbackinstantly|followbackguaranteed|follow4follow|followforfollow|f4f|followtrain|followparty|followspree|followthread|followchain|followloop|teamfollowback|gainfollowers|gaintrain|growtogether|activemutuals|newmutuals|mutuals|mutualfollow|mutualsupport|mutualfriends|letsconnect|connectwithme|creatorcommunity|creatorsupport|supportsmallcreators|engagementfriends|engagementboost|engagementtrain|bluecheckmutuals|premiumfriends)/iu,
   /#?(?:友達募集|お友達募集|友達募集中|X友募集|仲間募集|ブルバ100|相互フォロー|相互フォロー募集|相互フォロー希望|相互希望|相互募集|相互さん募集|相互垢|相互垢募集|フォロバ|フォロバ100|フォロバします|フォロバ確実|フォロバ必ず|フォロバ希望|フォロバ歓迎|フォロー返し|フォロー返す|フォロー返します|フォロー歓迎|フォローお願いします|フォローしてね|フォローした人全員フォローする|フォローしてくれたアイドル全員フォローする|ファボした人全員フォローする|ファボください|いいねください|いいねしてきたアイドルをフォローする|繋がりたい|つながりたい|Xで繋がりたい|仲良くしてください|仲良くなりたい|交流したい|交流希望|交流しましょう|絡み募集中|絡んでください|ブルーバッジ仲間|青バッジ仲間|認証垢相互|いいねした人全員フォロー|フォロワー募集)/iu,
   /(?:sigueme y te sigo|seguimiento mutuo)|#?(?:맞팔|선팔|소통)/iu
  ];
  return patterns.some(pattern=>pattern.test(value));
 }
 function friendshipCandidate(text){
  return friendshipRelated(text);
 }
 function interactionSkipReason(info,{self,record,authors,now=Date.now()}={}){
  if(info.author.toLowerCase()===self)return 'self';
  if(record?.reply==='verified')return 'confirmed';
  if(record?.reply==='blocked_author')return 'author_blocked';
  if(['unknown','in_flight'].includes(record?.reply))return 'uncertain';
  if(Number.isFinite(record?.retryAt)&&record.retryAt>now)return 'retry_cooldown';
  if(authors?.has(info.author.toLowerCase()))return 'author_confirmed';
  if(!friendshipRelated(info.text))return 'unrelated';
  return null;
 }
 function interactionPage(path){try{const u=new URL(path,'https://x.com');return u.origin==='https://x.com'&&(u.pathname==='/home'||(u.pathname==='/search'&&!!u.searchParams.get('q')&&(!u.searchParams.get('f')||['top','live'].includes(u.searchParams.get('f')))));}catch{return false;}}
 root.XAssistantCore={interactionSkipReason,parseViews,interactionPage,autoFollowEnabled,highExposure,friendshipRelated,friendshipCandidate,randomSeconds,formatSeconds,editorText};
})(globalThis);
