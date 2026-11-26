import {translationLanguage} from './copy-translation.mjs';
import {POSTING_MAX_IMAGES,normalizePostingCopies,validatePostingCopies,formatTimelineRewriteText,timelineRewriteFingerprint} from './posting-copy.mjs';
import {normalizeZhihuImageUrl} from './zhihu-images.mjs';

const ID=/^\d{1,30}$/;
export const zhihuSourceKey=source=>`${source?.sourceType==='article'?'article':'answer'}:${source?.id||''}`;
export function normalizeZhihuSourceKey(value){
 if(typeof value!=='string')return null;
 if(ID.test(value))return 'answer:'+value; // legacy content scripts used bare answer IDs
 const match=value.match(/^(answer|article):(\d{1,30})$/);return match?match[1]+':'+match[2]:null;
}
export const zhihuRewriteRowId=source=>{
 const type=typeof source==='object'&&source?.sourceType==='article'?'article':'answer',id=typeof source==='object'?source?.id:source;
 return type==='article'?'zhihu_article_ai_'+id:'zhihu_ai_'+id;
};
export function zhihuRewriteSourceKey(row){
 const article=row?.id?.match(/^zhihu_article_ai_(\d+)$/)?.[1]||row?.sourceUrls?.map(url=>url.match(/^https:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)$/)?.[1]).find(Boolean);
 if(article)return 'article:'+article;
 const answer=row?.id?.match(/^zhihu_ai_(\d+)$/)?.[1]||row?.sourceUrls?.map(url=>url.match(/^https:\/\/www\.zhihu\.com\/question\/\d+\/answer\/(\d+)$/)?.[1]).find(Boolean);
 return answer?'answer:'+answer:null;
}
export function zhihuRewriteSourceId(row){
 const key=zhihuRewriteSourceKey(row);return key?.startsWith('answer:')?key.slice(7):key;
}
export function validateZhihuSource(raw){
 const {id,questionId,question,text,url}=raw||{},images=raw?.imageUrls,sourceType=raw?.sourceType==='article'?'article':'answer';
 if(raw?.sourceType!==undefined&&raw.sourceType!=='answer'&&raw.sourceType!=='article')throw Error('知乎内容类型无效');
 if(typeof id!=='string'||!ID.test(id))throw Error('知乎内容地址或身份无效');
 if(sourceType==='article'){
  if(raw?.sourceType!=='article'||questionId!==undefined||url!==`https://zhuanlan.zhihu.com/p/${id}`)throw Error('知乎文章地址或身份无效');
 }else if(typeof questionId!=='string'||!ID.test(questionId)||url!==`https://www.zhihu.com/question/${questionId}/answer/${id}`)throw Error('知乎回答地址或身份无效');
 if(typeof question!=='string'||!question.trim()||question.length>4000)throw Error(sourceType==='article'?'未读取到有效的知乎文章标题':'未读取到有效的知乎问题');
 if(typeof text!=='string'||!text.trim()||text.length>60000)throw Error((sourceType==='article'?'文章':'回答')+'为空或超过 60000 字符，未加入文案库');
 if(images!==undefined&&(!Array.isArray(images)||images.length>30))throw Error(`知乎${sourceType==='article'?'文章':'回答'}图片列表无效或超过 30 张`);
 const imageUrls=[...new Set((images||[]).map(normalizeZhihuImageUrl))];
 return {sourceType,id,...(sourceType==='answer'?{questionId}:{}),url,question:question.trim(),text:text.trim(),...(imageUrls.length?{imageUrls}:{})};
}
export function validateZhihuRewriteImages(rewritten,count){
 const indexes=rewritten?.imageIndexes??[];
 if(!Array.isArray(indexes)||indexes.length>POSTING_MAX_IMAGES||indexes.some(index=>!Number.isSafeInteger(index)||index<1||index>count)||new Set(indexes).size!==indexes.length)
  throw Error('DeepSeek 返回的知乎配图选择无效');
 return indexes;
}
export function appendZhihuRewrite(raw,source,rewritten,createdAt=new Date().toISOString(),images=[],language){
 const targetLanguage=translationLanguage(language);
 const post=validateZhihuSource(source),state=normalizePostingCopies(raw);
 const sourceKey=zhihuSourceKey(post),existing=state.rows.find(row=>zhihuRewriteSourceKey(row)===sourceKey);
 if(existing)return {library:state,row:existing,added:false};
 const text=formatTimelineRewriteText(rewritten.text,rewritten.style),fingerprint=timelineRewriteFingerprint(text);
 if(!text.trim()||!targetLanguage&&[post.text,post.question].some(value=>timelineRewriteFingerprint(value)===fingerprint))throw Error(post.sourceType==='article'?'未获得文章标题与正文的有效改写':'未获得问题与回答融合后的有效改写');
 const indexes=validateZhihuRewriteImages(rewritten,post.imageUrls?.length||0);
 if(!Array.isArray(images)||images.length!==indexes.length)throw Error('知乎配图未全部读取，未加入文案库');
 const row={id:zhihuRewriteRowId(post),text,enabled:true,sourceUrls:post.sourceType==='article'?[post.url]:[post.url,`https://www.zhihu.com/question/${post.questionId}`],createdAt,
  ...(images.length===1?{image:images[0]}:images.length?{images}:{})};
 const library={revision:state.revision+1,rows:validatePostingCopies([...state.rows,row])};
 return {library,row:library.rows.at(-1),added:true};
}
