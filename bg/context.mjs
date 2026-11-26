// Shared service-worker primitives: storage, the single mutation queue, logging and sender checks.
import '../time-policy.js';

export const timing=globalThis.XAssistantTimePolicy;
export const K=Object.freeze({
 APP:'app',
 POST_COPIES:'xAssistantPostingCopiesV1',
 POST_LEDGER:'xAssistantPostingLedgerV1',
 LEGACY_COPY_BACKUP:'xAssistantLegacyCopyBackupV1',
 WORKSPACES:'xAssistantWorkspaceOwnersV1',
 AI_STATUS:'xAssistantAIStatusV2',
 REPLY_CLAIMS:'xAssistantReplyClaimsV1',
 REPLY_MEMORY:'xAssistantReplyMemoryV1',
 FOLLOWBACK_LEDGER:'xAssistantFollowbackLedgerV1',
 FOLLOWBACK_SWEEP:'xAssistantFollowbackSweepV1',
 PROCESSED:'xAssistantProcessedV1',
 FOLLOWED:'xAssistantFollowedV1',
 NOTIFICATION_REPLIES:'xAssistantNotificationRepliesV1',
 COOLDOWNS:'xAssistantCooldownsV1',
 AUTO_FOLLOW:'xAssistantAutoFollowV1',
 LEGACY_FOLLOW_COOLDOWN:'xAssistantFollowCooldownV1',
 MANAGED_SERVICE:'xAssistantManagedServiceV1',
 LEGACY_SCHEDULER:'xAssistantSchedulerV3',
 FOLLOWING_SCAN:'xAssistantFollowingScanV1',
 FRIEND_SEARCH:'xAssistantFriendSearchV1',
 RUNTIME_INTERACTION:'xAssistantRuntimeV1'
});
export const ACCOUNT=/^\/[A-Za-z0-9_]{1,15}$/;
export const AI_MODULES=['posting','interaction','notifications']; // Follow-back never uses AI.

export const read=async key=>(await chrome.storage.local.get(key))[key];
export const write=(key,value)=>chrome.storage.local.set({[key]:value});
export const writeAll=data=>chrome.storage.local.set(data); // One atomic write for coupled records.
export const getTiming=async()=>timing.normalize(await read(timing.KEY));
export const getApp=async()=>({rows:[],logs:[],revision:0,...await read(K.APP)});
export const fail=(message,props={})=>Object.assign(Error(message),props);

// Every storage mutation runs through this queue; network waits never hold it.
let queue=Promise.resolve();
export function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}

export async function log(message){
 const app=await getApp();
 app.logs=[{time:new Date().toISOString(),message},...(app.logs||[])].slice(0,100);
 await write(K.APP,app);
}

export function errorResponse(e){
 let status,retryAt=0,cause=e;
 for(let depth=0;cause&&depth<6;depth++,cause=cause.cause){
  const value=cause.httpStatus??cause.status;
  if(Number.isInteger(value)&&value>=100&&value<=599&&(status===undefined||value===429))status=value;
  if(Number.isFinite(cause.retryAt))retryAt=Math.max(retryAt,cause.retryAt);
 }
 return {ok:false,error:e.message||'任务已停止；未发送',code:e.code,submitted:e.submitted,confirmed:e.confirmed,
  ...(status!==undefined?{httpStatus:status}:{}),...(retryAt>0?{retryAt}:{})};
}

const topFrame=sender=>Number.isInteger(sender.tab?.id)&&(!Number.isInteger(sender.frameId)||sender.frameId===0);
export const activeDocument=sender=>!sender.documentLifecycle||sender.documentLifecycle==='active';
export const isPanel=sender=>sender.url?.split('#')[0]===chrome.runtime.getURL('panel.html');
export const isPage=sender=>topFrame(sender)&&/^https:\/\/x\.com\//.test(sender.url||'');
export const isZhihuPage=sender=>topFrame(sender)&&/^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(sender.url||'')&&activeDocument(sender);
