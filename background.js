// Service worker entry: message routing and browser event wiring only.
// Logic lives in bg/: commands (serialized), replies/rewrite (network, never hold the queue).
import {BOUNDARY_ALARM,WATCHDOG_ALARM,RESTART_ALARM} from './managed-service.mjs';
import {FOLLOW_QUEUE_ALARM} from './interaction-follow-queue.mjs';
import {K,serial,errorResponse,fail,isPanel,isPage} from './bg/context.mjs';
import {managed,followQueue,scheduleFollowQueue,runFollowQueue} from './bg/services.mjs';
import {workspace,hello} from './bg/workspace.mjs';
import {forgetTab,stopTab} from './bg/ledgers.mjs';
import {COMMANDS,stopAll} from './bg/commands.mjs';
import {aiCheck,aiReply} from './bg/replies.mjs';
import {timelineRewriteStatus,rewriteTimelinePost,zhihuRewriteStatus,rewriteZhihuAnswer} from './bg/rewrite.mjs';
import {recover} from './bg/recover.mjs';
import {checkLiveReply,reviewDeferred} from './bg/reply-readback.mjs';
import {autoReview,AUTO_REVIEW_ALARM} from './bg/auto-review.mjs';

async function handle(msg,sender){
 const panel=isPanel(sender),page=isPage(sender);
 if(!panel&&!page)throw fail('无效消息来源');
 if(msg.kind==='PING')return null;
 if(msg.kind==='WORKSPACE_HELLO'&&page)return hello(msg,sender);
 if(msg.kind==='STOP_ALL'&&panel)return stopAll();
 const documentId=page&&(msg.kind!=='RUNTIME'||msg.action!=='get')?await workspace(msg,sender):null;
 const command=Object.hasOwn(COMMANDS,msg.kind)?COMMANDS[msg.kind]:null;
 if(!command||command.from==='panel'&&!panel||command.from==='page'&&!page)throw fail('未知或未授权命令');
 return command.run(msg,{sender,documentId,auth:{owner:sender.tab?.id,runId:msg.runId,documentId}});
}

const reply=(task,respond,toError=errorResponse)=>{
 let pending;try{pending=Promise.resolve(task());}catch(e){pending=Promise.reject(e);} // Queue synchronously, as received.
 pending.then(state=>respond({ok:true,state})).catch(e=>respond(toError(e)));
 return true;
};
const plainError=e=>({ok:false,error:e.message,code:e.code});

// Network-bound work runs outside the mutation queue so liveness and storage stay responsive.
const DIRECT={
 REPLY_READBACK:checkLiveReply,
 AI_CHECK:(msg,sender)=>aiCheck(msg,sender),
 AI_REPLY:(msg,sender)=>aiReply(msg,sender),
 AI_NOTIFICATION_REPLY:(msg,sender)=>aiReply(msg,sender)
};
const REWRITE={
 TIMELINE_REWRITE_STATUS:(msg,sender)=>serial(()=>timelineRewriteStatus(msg,sender)),
 TIMELINE_REWRITE_ADD:(msg,sender)=>rewriteTimelinePost(msg,sender),
 ZHIHU_REWRITE_STATUS:(msg,sender)=>serial(()=>zhihuRewriteStatus(msg,sender)),
 ZHIHU_REWRITE_ADD:(msg,sender)=>rewriteZhihuAnswer(msg,sender)
};

chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 const kind=msg?.kind;
 if(kind==='PING'){
  respond(isPanel(sender)||isPage(sender)?{ok:true,state:null}:{ok:false,error:'无效消息来源'});return false;
 }
 // A work-page wake has no storage mutations or action authority.
 if(kind==='WORKER_WAKE'){
  if(!isPage(sender)||!Number.isFinite(msg.ms)||msg.ms<=0||msg.ms>15000){respond({ok:false,error:'唤醒请求无效'});return false;}
  setTimeout(()=>respond({ok:true,state:null}),Math.ceil(msg.ms));return true;
 }
 if(kind==='AI_POST'){respond({ok:false,error:'发帖已改为文案库原文发送，不再调用 AI 发帖'});return false;}
 if(Object.hasOwn(DIRECT,kind))return reply(()=>DIRECT[kind](msg,sender),respond);
 if(Object.hasOwn(REWRITE,kind))return reply(()=>REWRITE[kind](msg,sender),respond,plainError);
 return reply(()=>serial(()=>handle(msg||{},sender)),respond);
});

chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener(()=>serial(recover).catch(console.error));
chrome.runtime.onStartup.addListener(()=>serial(recover).catch(console.error));
chrome.tabs.onRemoved?.addListener((id,info)=>serial(async()=>{await managed.removed(id,info);await forgetTab(id);}).catch(console.error));
chrome.tabs.onReplaced?.addListener((added,removed)=>serial(async()=>{await managed.replaced(added,removed);await forgetTab(removed);}).catch(console.error));
chrome.tabs.onUpdated?.addListener((id,change)=>{
 if(change.url&&!/^https:\/\/x\.com\//.test(change.url))serial(async()=>{await stopTab(id);await managed.updated(id,change);}).catch(console.error);
});
chrome.alarms.onAlarm?.addListener(alarm=>{
 if(alarm.name===FOLLOW_QUEUE_ALARM){runFollowQueue();return;}
 if(alarm.name===AUTO_REVIEW_ALARM){autoReview().catch(console.error);reviewDeferred().catch(console.error);return;}
 if([BOUNDARY_ALARM,WATCHDOG_ALARM,RESTART_ALARM].includes(alarm.name))serial(()=>managed.reconcile()).catch(console.error);
});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area!=='local')return;
 const toggle=changes[K.AUTO_FOLLOW],service=changes[K.MANAGED_SERVICE],run=changes[K.RUNTIME_INTERACTION];
 if(toggle&&toggle.newValue!==false)followQueue.resume().catch(console.error);
 const control=s=>JSON.stringify([s?.enabled,s?.selected?.interaction,s?.account]);
 if(toggle||service&&control(service.oldValue)!==control(service.newValue)||run&&run.oldValue?.active!==run.newValue?.active)scheduleFollowQueue(Date.now()+100);
 if(changes[K.FRIEND_SEARCH])serial(()=>managed.reconcile()).catch(console.error);
});

// Uncertain posting/reply results are checked against the platform once a minute.
chrome.alarms.create?.(AUTO_REVIEW_ALARM,{periodInMinutes:1});
