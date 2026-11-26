// "+" collection: X posts/comments and Zhihu answers/articles become posting-library drafts.
// One in-flight generation per source; library writes are serialized and idempotent.
import {translationLanguage,COPY_LANGUAGE_KEY} from '../copy-translation.mjs';
import {validateZhihuSource,zhihuSourceKey,normalizeZhihuSourceKey,zhihuRewriteRowId,zhihuRewriteSourceKey,appendZhihuRewrite} from '../zhihu-copy.mjs';
import {fetchZhihuImages} from '../zhihu-images.mjs';
import {generateTimelineRewrite,generateZhihuRewrite} from '../ai-client.mjs';
import {appendTimelineRewrite,validateTimelinePostingSource,timelinePostingAttachmentUrls,timelineRewriteRowId,timelineRewriteSourceId} from '../posting-copy.mjs';
import {fetchTimelineImages} from '../timeline-images.mjs';
import {K,read,write,serial,fail,isPage,isZhihuPage,activeDocument} from './context.mjs';
import {getPostCopies} from './copies.mjs';

const summary=(added,row,library)=>({added,id:row.id,revision:library.revision,total:library.rows.length});

function statusFor(ids,valid,sourceId){
 if(!Array.isArray(ids)||ids.length>500||!ids.every(valid))return null;
 return async()=>{
  const copies=await getPostCopies(),saved=new Set(copies.rows.map(sourceId).filter(Boolean));
  return {existing:[...new Set(ids)].filter(id=>saved.has(id)),revision:copies.revision};
 };
}

// Shared flight logic: dedupe concurrent clicks, reject a changed source mid-flight.
// sourceOf names the source as sourceId stores it (X: the post ID; Zhihu: "answer:ID" or "article:ID").
function createCollector({rowId,sourceId,sourceOf=post=>post.id,changed,generate,append}){
 const flights=new Map();
 return async post=>{
  const targetLanguage=translationLanguage(await read(COPY_LANGUAGE_KEY)),id=rowId(post),key=sourceOf(post);
  const current=await serial(getPostCopies);
  const existing=current.rows.find(row=>row.id===id||sourceId(row)===key);
  if(existing)return summary(false,existing,current);
  const fingerprint=JSON.stringify([post,targetLanguage]);let entry=flights.get(id);
  if(entry&&entry.fingerprint!==fingerprint)throw fail(changed);
  if(!entry){entry={fingerprint,task:generate(post,targetLanguage)};flights.set(id,entry);}
  try{
   const generated=await entry.task;
   return await serial(async()=>{
    const result=append(await getPostCopies(),post,generated,targetLanguage);
    if(result.added)await write(K.POST_COPIES,result.library);
    return summary(result.added,result.row,result.library);
   });
  }finally{if(flights.get(id)===entry)flights.delete(id);}
 };
}

const collectTimeline=createCollector({
 rowId:post=>timelineRewriteRowId(post.id),sourceId:timelineRewriteSourceId,changed:'帖子正文或翻译选项已变化，请等待当前入库完成',
 generate:(post,language)=>{
  const urls=timelinePostingAttachmentUrls(post);
  return Promise.all([post.text.trim()?generateTimelineRewrite(post,undefined,language):{text:''},urls.length?fetchTimelineImages(urls):[]]);
 },
 append:(library,post,[rewritten,images],language)=>appendTimelineRewrite(library,post,rewritten.text,undefined,images,rewritten.style,language)
});

const collectZhihu=createCollector({
 rowId:zhihuRewriteRowId,sourceId:zhihuRewriteSourceKey,sourceOf:zhihuSourceKey,changed:'回答、文章或翻译选项已变化，请等待当前入库完成',
 generate:async(post,language)=>{
  const rewritten=await generateZhihuRewrite(post,undefined,language);
  return {rewritten,images:await fetchZhihuImages(rewritten.imageIndexes.map(index=>post.imageUrls[index-1]))};
 },
 append:(library,post,{rewritten,images},language)=>appendZhihuRewrite(library,post,rewritten,undefined,images,language)
});

export function timelineRewriteStatus(msg,sender){
 if(!isPage(sender)||!activeDocument(sender))throw fail('无效改写状态请求');
 const task=statusFor(msg.ids,id=>/^\d+$/.test(id||''),timelineRewriteSourceId);
 if(!task)throw fail('帖子 ID 列表无效');
 return task();
}

export function rewriteTimelinePost(msg,sender){
 if(!isPage(sender))throw fail('无效改写请求来源');
 let page;try{page=new URL(sender.url);}catch{throw fail('当前页面无效');}
 if(page.origin!=='https://x.com'||!activeDocument(sender))throw fail('仅可从 X 页面改写帖子或评论');
 return collectTimeline(validateTimelinePostingSource(msg.post));
}

export function zhihuRewriteStatus(msg,sender){
 if(!isZhihuPage(sender))throw fail('无效知乎改写请求来源');
 // Older content scripts send bare answer IDs; current ones send "answer:ID" or "article:ID".
 if(!Array.isArray(msg.ids)||msg.ids.length>500||!msg.ids.every(id=>normalizeZhihuSourceKey(id)))throw fail('知乎内容 ID 列表无效');
 return (async()=>{
  const copies=await getPostCopies(),saved=new Set(copies.rows.map(zhihuRewriteSourceKey).filter(Boolean));
  return {existing:[...new Set(msg.ids)].filter(id=>saved.has(normalizeZhihuSourceKey(id))),revision:copies.revision};
 })();
}

export function rewriteZhihuAnswer(msg,sender){
 if(!isZhihuPage(sender))throw fail('无效知乎改写请求来源');
 return collectZhihu(validateZhihuSource(msg.post));
}
