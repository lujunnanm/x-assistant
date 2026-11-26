// Posting library reads and the posting retry clock. No module here clicks or submits.
import {normalizePostingCopies,eligiblePostingCopies,postingMediaIssue} from '../posting-copy.mjs';
import {POST_SCHEDULE_KEY} from '../posting-schedule.mjs';
import {K,read,fail} from './context.mjs';

export const POST_RATE_DELAY=30*60*1000;
export const POST_TEMPORARY_RETRY=2000;

export const getPostCopies=async()=>normalizePostingCopies(await read(K.POST_COPIES));
export const getEligiblePostingRows=async()=>eligiblePostingCopies((await getPostCopies()).rows);

export const postRateDeadline=schedule=>Math.max(0,Number(schedule?.rateLimitedUntil)||0);
export const postRetryDeadline=schedule=>Math.max(postRateDeadline(schedule),Number(schedule?.temporaryRetryUntil)||0);

export async function postingCopyStamp(row){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(row)));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

const nativeNotSent=(receipt,reason)=>receipt?.kind==='not_sent'&&receipt?.evidence==='x_create_result'&&receipt?.reason===reason;
export const nativePostRateLimit=receipt=>nativeNotSent(receipt,'rate_limit')&&[88,429].includes(receipt?.code);
export const nativePostTemporaryReject=receipt=>nativeNotSent(receipt,'temporary_rejection')&&receipt?.code===130;

export function nativePostSuccess(receipt,account){
 if(typeof receipt?.postId!=='string'||!/^[1-9]\d{0,23}$/.test(receipt.postId)||typeof receipt.url!=='string')return false;
 try{
  const url=new URL(receipt.url);
  return url.origin==='https://x.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&
   url.pathname.toLowerCase()===account.toLowerCase()+'/status/'+receipt.postId&&url.href===receipt.url;
 }catch{return false;}
}

export async function assertPostingCooldown(account){
 const schedule=(await read(POST_SCHEDULE_KEY))?.[account?.toLowerCase()],deadline=postRetryDeadline(schedule),now=Date.now();
 if(deadline<=now)return;
 const limited=postRateDeadline(schedule)>now;
 throw fail(limited?'X 发帖限流冷却中，原文案会保留到期重试':'X 已明确拒绝本次提交，原文案等待重试',
  {code:limited?'POST_RATE_WAIT':'POST_RETRY_WAIT',retryAt:deadline,submitted:false});
}

export function postingUnavailable(rows){
 const enabled=rows.filter(row=>row.enabled),issues=[...new Set(enabled.map(postingMediaIssue).filter(Boolean).map(issue=>issue.message))];
 const message=!rows.length?'文案库为空，请先添加发帖文案':!enabled.length?'库内文案均已停用，请在文案库启用至少一条':
  '已启用文案暂无可发条目：'+issues.join('；')+'；原条目已保留，请在文案库编辑或重新采集';
 return fail(message,{code:enabled.length?'POST_LIBRARY_NOT_READY':'POST_LIBRARY_EMPTY'});
}

export async function assertPostingReady(){
 const {rows}=await getPostCopies();
 if(!eligiblePostingCopies(rows).length)throw postingUnavailable(rows);
}
