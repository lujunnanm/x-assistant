import {translationLanguage} from './copy-translation.mjs';
import {POSTING_MAX_IMAGES,normalizePostingCopies,validatePostingCopies,formatTimelineRewriteText,timelineRewriteFingerprint} from './posting-copy.mjs';
import {normalizeZhihuImageUrl} from './zhihu-images.mjs';

export const zhihuRewriteRowId=id=>'zhihu_ai_'+id;
export function zhihuRewriteSourceId(row){
 return row.id?.match(/^zhihu_ai_(\d+)$/)?.[1]||row.sourceUrls?.map(url=>url.match(/^https:\/\/www\.zhihu\.com\/question\/\d+\/answer\/(\d+)$/)?.[1]).find(Boolean)||null;
}
export function validateZhihuSource(raw){
 const {id,questionId,question,text,url}=raw||{},images=raw?.imageUrls;
 if(typeof id!=='string'||!/^\d{1,30}$/.test(id)||typeof questionId!=='string'||!/^\d{1,30}$/.test(questionId)||url!==`https://www.zhihu.com/question/${questionId}/answer/${id}`)throw Error('知乎回答地址或身份无效');
 if(typeof question!=='string'||!question.trim()||question.length>4000)throw Error('未读取到有效的知乎问题');
 if(typeof text!=='string'||!text.trim()||text.length>60000)throw Error('回答为空或超过 60000 字符，未加入文案库');
 if(images!==undefined&&(!Array.isArray(images)||images.length>30))throw Error('知乎回答图片列表无效或超过 30 张');
 const imageUrls=[...new Set((images||[]).map(normalizeZhihuImageUrl))];
 return {id,questionId,url,question:question.trim(),text:text.trim(),...(imageUrls.length?{imageUrls}:{})};
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
 const existing=state.rows.find(row=>zhihuRewriteSourceId(row)===post.id);
 if(existing)return {library:state,row:existing,added:false};
 const text=formatTimelineRewriteText(rewritten.text,rewritten.style),fingerprint=timelineRewriteFingerprint(text);
 if(!text.trim()||!targetLanguage&&[post.text,post.question].some(value=>timelineRewriteFingerprint(value)===fingerprint))throw Error('未获得问题与回答融合后的有效改写');
 const indexes=validateZhihuRewriteImages(rewritten,post.imageUrls?.length||0);
 if(!Array.isArray(images)||images.length!==indexes.length)throw Error('知乎配图未全部读取，未加入文案库');
 const row={id:zhihuRewriteRowId(post.id),text,enabled:true,sourceUrls:[post.url,`https://www.zhihu.com/question/${post.questionId}`],createdAt,
  ...(images.length===1?{image:images[0]}:images.length?{images}:{})};
 const library={revision:state.revision+1,rows:validatePostingCopies([...state.rows,row])};
 return {library,row:library.rows.at(-1),added:true};
}
