// Only the dedicated profile tab is scrolled. Never click a card or call an X API.
function sampleProfile(owner,first){
 const path=location.pathname.replace(/\/$/,'').toLowerCase();
 if(location.href==='about:blank')return {waiting:true};
 if(location.origin!=='https://x.com'||path!==owner)return first?{waiting:true}:{stop:'专用页已离开该账号的资料页'};
 const api=globalThis.XAssistantDeletionDOM,account=api?.account();
 if(!account)return {waiting:true};
 if(account!==owner)return {stop:'当前登录账号已改变'};
 if(document.querySelector('[role="dialog"],[role="alertdialog"]'))return {stop:'资料页出现弹窗，已停止扫描'};
 const mains=document.querySelectorAll('[data-testid="primaryColumn"]');
 if(mains.length!==1)return {waiting:true};
 const main=mains[0],q=(node,sel)=>[...node.querySelectorAll(sel)];
 if(q(main,'[data-testid="error-detail"],[data-testid="retry"],[data-testid="errorBoundary"],[role="alert"],button,[role="button"]').some(n=>{
  if(n.closest('article'))return false;
  return ['error-detail','retry','errorBoundary'].includes(n.dataset?.testid)||/^(?:retry|try again|重试|重試|再试一次|再試一次|やりなおす|再試行)$/i.test((n.innerText||'').trim())||n.getAttribute('role')==='alert'&&/error|failed|wrong|rate.?limit|失败|出错|错误|上限|エラー/i.test(n.innerText||'');
 }))return {stop:'资料页显示加载错误或重试提示'};
 const el=document.scrollingElement||document.documentElement,y=el.scrollTop,h=el.scrollHeight,v=innerHeight;
 if(!Number.isFinite(y)||!(h>0&&v>0))return {waiting:true};
 if(first&&y>8){window.scrollTo({top:0,behavior:'instant'});return {waiting:true};}
 const busy=q(main,'[role="progressbar"],[aria-busy="true"]').some(n=>!n.closest('article,form,[hidden]'));
 const cards=q(main,'article[data-testid="tweet"]').filter(a=>!a.parentElement?.closest('article')&&!a.closest('[hidden],[role="dialog"]'));
 const empty=!!main.querySelector('[data-testid="emptyState"]'),header=!!main.querySelector('[data-testid="UserName"],[data-testid="UserProfileHeader_Items"],[data-testid="UserProfileHeader_Description"]');
 if(first&&!header||!cards.length&&!empty)return {waiting:true,busy};
 const rows=api.scan(owner),unverified=[],sign=[];
 for(const card of cards){
  // Raw text is a discovery clue, never permission to delete. Do not bind a quoted timestamp/body.
  const ownNodes=sel=>q(card,sel).filter(n=>n.closest('article')===card&&!n.closest('[data-testid="quoteTweet"],[role="link"]:not(a)'));
  const a=ownNodes('time')[0]?.closest('a[href]'),m=a?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,19})\/?$/);
  if(!m)continue;sign.push(m[2]);if('/'+m[1].toLowerCase()!==owner)continue;
  const by=ownNodes('[data-testid="User-Name"]')[0],txt=ownNodes('[data-testid="tweetText"]')[0];
  if(!by||!txt||!q(by,'a[href]').some(n=>n.getAttribute('href')?.replace(/\/$/,'').toLowerCase()===owner))continue;
  const text=(txt.innerText||txt.textContent||'').trim();if(text)unverified.push({id:m[2],text});
 }
 const bottom=y+v>=h-6;
 if(!bottom&&!busy)window.scrollBy({top:Math.max(1,Math.floor(v*.75)),behavior:'instant'});
 return {rows,unverified,busy,bottom,y,h,sign:sign.join(','),empty,cardCount:cards.length};
}
const abort=()=>Object.assign(Error('扫描已取消'),{name:'AbortError'});
function bounded(work,ms,signal){
 return new Promise((resolve,reject)=>{
  let ended=false;
  const done=(fn,v)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);fn(v);};
  const cancel=()=>done(reject,abort()),timer=setTimeout(()=>done(reject,Error('扫描标签页响应超时')),ms);
  if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});
  Promise.resolve().then(work).then(v=>done(resolve,v),e=>done(reject,e));
 });
}
const sample=async(tabId,owner,first)=>{
 const result=await chrome.scripting.executeScript({target:{tabId},func:sampleProfile,args:[owner,first]});return result[0]?.result;
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function scanOwnTimeline({tabId,account,signal,onProgress},env={}){
 if(!Number.isInteger(tabId)||tabId<0||!/^\/[a-z0-9_]{1,15}$/i.test(account||''))throw Error('需指定合法账号和专用资料标签页');
 const owner=account.toLowerCase(),now=env.now||Date.now,read=env.sample||sample,sleep=env.wait||wait;
 const start=now(),rows=new Map(),clues=new Map(),conflicts=new Set();
 let steps=0,last='',stableSince=null,ready=false,pendingSince=null,stuckSince=null;
 const progress=()=>({steps,verified:rows.size,unverified:clues.size});
 const output=(coverage,complete=false)=>({rows:[...rows.values()],unverified:[...clues.values()],coverage,complete});
 try{
  while(steps<800&&now()-start<12*60000){
   if(signal?.aborted)throw abort();
   let page;
   try{page=await bounded(()=>read(tabId,owner,!ready),10000,signal);}
   catch(error){
    if(!ready&&now()-start<16000&&/frame.*(?:removed|not found)|cannot access contents|document.*navigat/i.test(error?.message||''))page={waiting:true};
    else throw error;
   }
   steps++;
   if(!page||page.stop)return output(page?.stop||'当前页面不可读取');
   if(page.waiting||page.busy){pendingSince??=now();if(now()-pendingSince>=20000)return output('资料页未就绪或持续加载超时，仅覆盖此前已读部分');}else pendingSince=null;
   if(page.waiting){stableSince=null;stuckSince=null;last='';}
   else{
    ready=true;
    const priorCount=rows.size+clues.size;
    for(const clue of page.unverified||[]){
     if(!/^[1-9]\d{0,19}$/.test(clue.id)||!clue.text||rows.has(clue.id))continue;
     if(!clues.has(clue.id)||clues.get(clue.id).text.length<clue.text.length)clues.set(clue.id,{id:clue.id,text:clue.text});
    }
    for(const row of page.rows||[]){
     if(row.account!==owner||'/'+row.author?.toLowerCase()!==owner||!row.text||!row.owned||row.original!==true||row.isReply!==false||row.isQuote!==false||row.isRepost!==false||!/^[1-9]\d{0,19}$/.test(row.id))continue;
     if(rows.has(row.id)&&rows.get(row.id).text!==row.text)conflicts.add(row.id);
     if(conflicts.has(row.id)){rows.delete(row.id);clues.set(row.id,{id:row.id,text:row.text});}else{rows.set(row.id,row);clues.delete(row.id);}
    }
    const signature=[page.y,page.h,page.sign,page.empty,rows.size,clues.size].join('|');
    if(!page.bottom&&!page.busy&&signature===last){stuckSince??=now();if(now()-stuckSince>=18000)return output('时间线未继续滚动，尚未确认资料页底部');}else stuckSince=null;
    if(page.bottom&&!page.busy&&(page.cardCount>0||page.empty)&&signature===last&&priorCount===rows.size+clues.size){
     stableSince??=now();if(now()-stableSince>=5500)return output('已读到本次 X 资料页可加载内容的稳定底部；不代表完整账号历史',true);
    }else stableSince=null;
    last=signature;
   }
   await onProgress?.(progress());
   await bounded(()=>sleep(page.bottom?900:650),3000,signal);
  }
  return output('已达到扫描时长或页数上限，仅覆盖已加载内容');
 }catch(error){if(signal?.aborted||error?.name==='AbortError')return output('扫描已取消，仅保留此前已读部分');return output('扫描中断，仅覆盖此前已读部分：'+String(error?.message||error).slice(0,180));}
}
