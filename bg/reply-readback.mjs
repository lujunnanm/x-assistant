// A detail-page read can prove publication. Missing rows, even at bottom, never prove rejection.
import {K,read,isPage,serial} from './context.mjs';
import {KEYS,assertRunOwner} from '../state.mjs';
import {workspace} from './workspace.mjs';
import {managed} from './services.mjs';
const handle=/^\/[a-z0-9_]{1,15}$/,id=/^[1-9]\d{0,19}$/,flight=new Map();
export function sampleTargetReply(q){
 const D=globalThis.XAssistantDOM,owner=q.account,main=document.querySelector('[data-testid="primaryColumn"]');
 if(!D||location.origin!=='https://x.com'||location.pathname.toLowerCase()!==q.path||D.account()!==owner||!main)return null;
 const rows=D.rows(owner).filter(r=>main.contains(r.article)&&r.article.isConnected),n=D.threadIdentity(q.parent);
 if(n?.author!==q.author||n.root!==q.root||!D.originalPost(q.root,owner)||!rows.some(r=>r.id===q.parent&&r.author.toLowerCase()===q.author))return null;
 const text=s=>s?.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
 const exact=r=>text(r.text)===text(q.text)&&r.at>=q.since-1000&&r.at<=q.since+120000&&r.at<=Date.now()+1000;
 const m=rows.filter(r=>D.directChildOf(r.id,q.parent)&&D.threadIdentity(r.id)?.root===q.root&&r.author.toLowerCase()===owner.slice(1)&&!r.clipped&&exact(r));
 const mounted=new Set(rows.map(r=>r.id));
 for(const r of D.receiptChildren?.(q.root,q.parent,owner)||[])if(!mounted.has(r.id)&&exact(r))m.push(r);
 return m.length===1?{kind:'confirmed',evidence:'target_readback',postId:m[0].id,parentId:q.parent,url:'https://x.com'+owner+'/status/'+m[0].id}:null;
}
export async function readTargetReply(q,{tabs=chrome.tabs,scripting=chrome.scripting,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!handle.test(q.account)||!handle.test('/'+q.author)||!id.test(q.root)||!id.test(q.parent)||q.path!=='/'+q.author+'/status/'+q.parent||
    !Number.isFinite(q.since)||!q.text?.trim())return null;
 const url='https://x.com'+q.path,tab=await tabs.create({url,active:false,...(Number.isInteger(q.windowId)?{windowId:q.windowId}:{})});
 let keep=false;
 const address=t=>(t.pendingUrl||t.url||'').toLowerCase(),loading=u=>!u||u==='about:blank';
 try{for(let i=0;i<11;i++){
   await wait(i?800:200);const live=await tabs.get(tab.id);
   const u=address(live);
   if(live.active||live.pinned||!loading(u)&&u!==url){keep=true;return null;}
   if(loading(u))continue;
   try{const [{result}]=await scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:sampleTargetReply,args:[q]});
    if(result?.kind==='confirmed'&&result.parentId===q.parent&&id.test(result.postId)&&result.url==='https://x.com'+q.account+'/status/'+result.postId)return result;
   }catch{} // First paint or account metadata not yet available.
  }return null;
 }finally{try{const t=await tabs.get(tab.id);if(!keep&&!t.active&&!t.pinned&&(address(t)===url||loading(address(t))))await tabs.remove(tab.id);}catch{}}
}
export async function checkLiveReply(msg,sender){
 if(!isPage(sender)||msg.module!=='notifications')throw Error('回执核对来源无效');
 const doc=await workspace(msg,sender),tab=sender.tab.id,account=msg.account?.toLowerCase(),parent=msg.postId;
 const auth=async()=>{
  const r=await read(KEYS.notifications);assertRunOwner(r,{owner:tab,documentId:doc,runId:msg.runId});
  const claim=(await read(K.REPLY_CLAIMS))?.[account]?.[parent];
  if(!r.active||r.phase!=='submitting'||r.rowId!==parent||r.account.toLowerCase()!==account||claim?.owner!==tab||claim.runId!==r.runId||claim.claimId!==msg.claimId||claim.status!=='in_flight')throw Error('提交绑定已变');
  await managed.authorize(tab,'notifications',account);return r;
 };
 const r=await auth(),path=new URL(sender.url).pathname.toLowerCase();if(path!=='/'+msg.author+'/status/'+parent)return null;
 const key=msg.claimId;if(flight.has(key))return flight.get(key);
 const task=readTargetReply({account,parent,root:msg.root,author:msg.author,path,text:r.text,since:Date.parse(r.submittedAt),windowId:sender.tab.windowId}).then(async res=>{await auth();return res;});
 flight.set(key,task);try{return await task;}finally{flight.delete(key);}
}
// Background reconciliation changes only the claim. The page merges the receipt into its
// own DB on its next pass, avoiding a race with a long-running scanner's cached records.
let reviewing=false;
export async function reviewDeferred(){
 if(reviewing)return;reviewing=true;
 try{const s=await read(K.MANAGED_SERVICE),a=s?.account;if(!s?.enabled||!s.selected?.notifications||!a)return;
  const claims=(await read(K.REPLY_CLAIMS))?.[a]||{},item=Object.entries(claims).filter(([,c])=>c.status==='unknown'&&c.deferred?.nextAt<=Date.now()).sort(([,a],[,b])=>a.deferred.nextAt-b.deferred.nextAt)[0];
  if(!item)return;const [parent,c]=item,q=c.deferred,res=await readTargetReply({...q,account:a,parent,path:'/'+q.author+'/status/'+parent}).catch(()=>null);
  await serial(async()=>{const db=await read(K.REPLY_CLAIMS),live=db?.[a]?.[parent];if(live?.status!=='unknown'||live.claimId!==c.claimId||live.deferred?.since!==q.since)return;
   if(res){live.status='confirmed';live.receipt=res;delete live.deferred;}else{live.deferred.nextAt=Date.now()+Math.min(3600000,60000*2**Math.min(6,(q.checks||0)+1));live.deferred.checks=(q.checks||0)+1;}
   await chrome.storage.local.set({[K.REPLY_CLAIMS]:db});});
 }finally{reviewing=false;}
}
