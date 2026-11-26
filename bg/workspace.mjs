// Page-instance identity: only the live document that said hello may act for its tab.
import {K,read,write,activeDocument,fail} from './context.mjs';
import {managed} from './services.mjs';
import {stopTab} from './ledgers.mjs';

const identity=(msg,sender)=>`${sender.documentId||'instance'}:${msg.instanceId||''}`;

export async function workspace(msg,sender){
 const entry=(await read(K.WORKSPACES))?.[sender.tab.id];
 if(!entry||entry.identity!==identity(msg,sender)||entry.instanceId!==msg.instanceId||!activeDocument(sender))
  throw fail('页面实例已失效，请刷新后重新启动');
 return entry.identity;
}

export async function hello(msg,sender){
 if(typeof msg.instanceId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(msg.instanceId))throw fail('页面实例标识无效');
 if(!activeDocument(sender))throw fail('页面已经离开前台文档');
 const tabId=sender.tab.id,db=await read(K.WORKSPACES)||{},previous=db[tabId],next=identity(msg,sender);
 const greet=async()=>{
  await managed.workspaceHello({tabId,identity:next,documentId:sender.documentId||null});
  return {tabId,assignment:await managed.assignment(tabId)};
 };
 if(previous?.identity===next)return greet();
 if(previous?.retired?.includes(next))throw fail('旧页面实例不能重新接管任务');
 await stopTab(tabId);
 db[tabId]={identity:next,instanceId:msg.instanceId,documentId:sender.documentId||null,
  retired:[...(previous?.retired||[]),...(previous?[previous.identity]:[])],at:Date.now()};
 await write(K.WORKSPACES,db);
 return greet();
}
