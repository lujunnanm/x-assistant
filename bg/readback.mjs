// Read-only platform readback for an uncertain send. A temporary background tab
// opens the account's own profile (posts) or replies list; the injected sampler
// only reads and scrolls. It never clicks, types or calls an X API.

// Injected into the readback tab. Must be self-contained.
export function sampleOwnCards(owner){
 if(location.origin!=='https://x.com')return {waiting:true};
 const self=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
 if(!self)return {waiting:true};
 if(self!==owner)return {stop:'当前登录账号与核对账号不一致'};
 const main=document.querySelector('[data-testid="primaryColumn"]');
 if(!main)return {waiting:true};
 const cards=[...main.querySelectorAll('article[data-testid="tweet"]')].filter(a=>!a.parentElement?.closest('article'));
 const empty=!!main.querySelector('[data-testid="emptyState"]');
 const failed=[...main.querySelectorAll('[data-testid="error-detail"],[data-testid="retry"]')].some(n=>!n.closest('article'));
 if(failed)return {stop:'资料页显示加载错误'};
 if(!cards.length&&!empty)return {waiting:true};
 const rows=[];
 for(const card of cards){
  const own=sel=>[...card.querySelectorAll(sel)].filter(n=>n.closest('article')===card&&!n.closest('[data-testid="quoteTweet"]'));
  const link=own('time')[0]?.closest('a[href]'),m=link?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,24})\/?$/);
  if(!m)continue;
  const at=Date.parse(own('time')[0].getAttribute('datetime')||'');
  const textNode=own('[data-testid="tweetText"]')[0];
  rows.push({id:m[2],author:'/'+m[1].toLowerCase(),at:Number.isFinite(at)?at:null,
   text:(textNode?.innerText||textNode?.textContent||'').trim(),
   truncated:!!own('[data-testid="tweet-text-show-more-link"]').length,
   media:!!own('[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"]').length,
   pinned:/pinned|置顶|已置顶|固定/i.test(own('[data-testid="socialContext"]')[0]?.innerText||'')});
 }
 const el=document.scrollingElement||document.documentElement,bottom=el.scrollTop+innerHeight>=el.scrollHeight-6;
 if(!bottom)window.scrollBy({top:Math.max(1,Math.floor(innerHeight*.75)),behavior:'instant'});
 return {rows,bottom,empty};
}

// X shows links as shortened display text and emoji as images, so compare the
// words only: drop link-like tokens, emoji and whitespace differences.
export function normalizeForMatch(text){
 return String(text||'')
  .replace(/\S*(?:https?:\/\/|www\.|\.[a-z]{2,}\/)\S*/gi,' ')
  .replace(/\S+…/g,' ')
  .replace(/[\p{Extended_Pictographic}‍️]/gu,'')
  .replace(/\s+/g,' ').trim();
}

const CLOCK_SKEW=2*60000,OLD_ENOUGH=30*60000,MEDIA_WINDOW=15*60000;

// Pure matcher: does this card prove the uncertain send was published?
export function matchesSend(row,{account,text,since,kind}){
 if(row.author!==account.toLowerCase()||!Number.isFinite(row.at)||row.at<since-CLOCK_SKEW||row.pinned)return false;
 const want=normalizeForMatch(text),got=normalizeForMatch(row.text);
 if(!want)return kind==='post'&&row.media&&row.at<=since+MEDIA_WINDOW; // Media-only post.
 if(got===want)return true;
 return row.truncated&&got.length>=20&&want.startsWith(got.replace(/…$/,'').trim());
}

// Enough of the timeline was read to say the send is absent (not merely unseen).
export function coveredSince(rows,{account,since,bottom,empty}){
 if(empty||bottom)return true;
 return rows.filter(r=>r.author===account.toLowerCase()&&!r.pinned&&Number.isFinite(r.at)&&r.at<since-OLD_ENOUGH).length>=2;
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function readbackOwn({account,kind,text,since,windowId},{tabs=chrome.tabs,scripting=chrome.scripting,wait=pause,now=Date.now,timeout=75000}={}){
 const owner=account.toLowerCase(),url='https://x.com'+owner+(kind==='reply'?'/with_replies':'');
 const tab=await tabs.create({url,active:false,...(Number.isInteger(windowId)?{windowId}:{})});
 const start=now(),seen=new Map();
 try{
  for(let step=0;now()-start<timeout&&step<40;step++){
   await wait(step?1500:3000);
   let sample;
   try{sample=(await scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:sampleOwnCards,args:[owner]}))[0]?.result;}
   catch{continue;} // Still loading or navigating.
   if(!sample||sample.waiting)continue;
   if(sample.stop)return {status:'inconclusive',reason:sample.stop};
   for(const row of sample.rows)seen.set(row.id,row);
   const found=[...seen.values()].find(row=>matchesSend(row,{account:owner,text,since,kind}));
   if(found)return {status:'found',id:found.id,url:'https://x.com'+owner+'/status/'+found.id};
   if(coveredSince([...seen.values()],{account:owner,since,bottom:sample.bottom,empty:sample.empty}))return {status:'absent'};
  }
  return {status:'inconclusive',reason:'资料页未在限定时间内读完'};
 }finally{
  try{await tabs.remove(tab.id);}catch{} // Already closed by the user.
 }
}
