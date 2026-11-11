// V3-style posting library: a row is either enabled or disabled.
// Legacy draft/ready/published/unknown fields are accepted only for migration
// and are removed from the normalized row.
export const POSTING_IMAGE_MAX_BYTES=5*1024*1024;
export const POSTING_MAX_IMAGES=4;
export const POSTING_LIBRARY_MAX_BYTES=32*1024*1024;
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(id);
const body=text=>typeof text==='string'?text.replace(/\r\n?/g,'\n'):null;
export const normalizePostingText=text=>body(text)?.replace(/\u00a0/g,' ').trim();
const imageCaption=/^[（(]\s*AI\s*概念配图\s*[)）]$/iu,standaloneUrl=/^https?:\/\/\S+$/iu;
export function cleanPostingPublishText(value,sourceUrls=[]){
 const text=body(value);if(text===null)return null;
 const sources=new Set(sourceUrls.map(url=>{try{return new URL(url).href;}catch{return String(url);}}));
 const lines=text.split('\n'),remove=new Set();
 for(let i=0;i<lines.length;i++){
  if(imageCaption.test(lines[i].trim())){
   remove.add(i);let j=i+1;
   while(j<lines.length&&!lines[j].trim()){remove.add(j);j++;}
   if(j<lines.length&&standaloneUrl.test(lines[j].trim()))remove.add(j);
   continue;
  }
  const candidate=lines[i].trim();
  if(standaloneUrl.test(candidate))try{if(sources.has(new URL(candidate).href))remove.add(i);}catch{}
 }
 const result=lines.filter((_,i)=>!remove.has(i));
 while(result.length&&!result.at(-1).trim())result.pop();
 return result.join('\n');
}

export function validatePostingImage(image){
 if(typeof image!=='string')throw Error('配图必须为受支持的图片数据或插件图片路径');
 if(/^post-images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(image))return image;
 const match=/^data:(image\/(?:jpeg|png|webp|gif)|video\/mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!match||match[2].length%4)throw Error('附件仅支持 JPEG、PNG、WebP、GIF 和 MP4 动图');
 const size=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
 if(size<1||size>POSTING_IMAGE_MAX_BYTES)throw Error('单张配图必须在 1 字节至 5 MB 之间');
 const head=atob(match[2].slice(0,32));
 const valid=match[1]==='image/jpeg'?head.charCodeAt(0)===255&&head.charCodeAt(1)===216&&head.charCodeAt(2)===255:
  match[1]==='image/png'?head.startsWith('\x89PNG\r\n\x1a\n'):
  match[1]==='image/gif'?/^GIF8[79]a/.test(head):
  match[1]==='video/mp4'?head.length>=16&&head.slice(4,8)==='ftyp':
  head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';
 if(!valid)throw Error('附件内容与声明的媒体类型不符');
 return image;
}
export const postingImages=row=>row?.images??(row?.image?[row.image]:[]);
const iso=(value,label)=>{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))throw Error(label+'必须为有效 ISO 时间');
 return new Date(value).toISOString();
};
const migratedEnabled=raw=>{
 if(raw?.status==='draft')return true;
 if(raw?.status==='published'||raw?.status==='unknown')return false;
 return raw?.enabled===undefined?true:raw.enabled;
};
export function validatePostingCopies(rows){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('发帖文案库最多 5000 条');
 const ids=new Set();
 const result=rows.map((raw,i)=>{
  const id=raw?.id,enabled=migratedEnabled(raw);let sourceUrls;
  if(raw.sourceUrls!==undefined){
   if(!Array.isArray(raw.sourceUrls)||raw.sourceUrls.length>20)throw Error('来源链接最多 20 个');
   sourceUrls=[...new Set(raw.sourceUrls.map(value=>{let url;try{url=new URL(value);}catch{throw Error('来源链接无效');}if(typeof value!=='string'||value.length>2048||url.protocol!=='https:'||url.username||url.password)throw Error('来源链接必须为无凭据的 HTTPS 链接');return url.href;}))];
  }
  const text=cleanPostingPublishText(raw?.text,sourceUrls);
  if(!validId(id)||ids.has(id)||text===null||text.length>10000||typeof enabled!=='boolean')
   throw Error('第 '+(i+1)+' 条发帖文案无效：需唯一 ID、有效原文及启停状态');
  const row={id,text,enabled};ids.add(id);
  if(raw.image!==undefined&&raw.image!=='')row.image=validatePostingImage(raw.image);
  if(raw.images!==undefined){
   if(row.image||!Array.isArray(raw.images)||!raw.images.length||raw.images.length>POSTING_MAX_IMAGES)throw Error('配图最多 4 张，不能同时使用 image 和 images');
   row.images=raw.images.map(validatePostingImage);
  }
  if(!text.trim()&&!postingImages(row).length)throw Error('第 '+(i+1)+' 条发帖文案无效：需要正文或图片');
  if(sourceUrls!==undefined)row.sourceUrls=sourceUrls;
  if(raw.newsId!==undefined){if(typeof raw.newsId!=='string'||!raw.newsId.trim()||raw.newsId.length>200||/[\x00-\x1f]/.test(raw.newsId))throw Error('新闻 ID 无效');row.newsId=raw.newsId.trim();}
  if(raw.variantId!==undefined||raw.candidateId!==undefined){
   if(raw.variantId!==undefined&&raw.candidateId!==undefined&&raw.variantId!==raw.candidateId)throw Error('variantId 与 candidateId 不一致');
   const variant=raw.variantId??raw.candidateId;
   if(!validId(variant)||!row.newsId)throw Error('稿件变体需有效 variantId 和 newsId');
   row.variantId=variant;
  }
  if(raw.imageAssetId!==undefined){if(!validId(raw.imageAssetId))throw Error('配图资产 ID 无效');row.imageAssetId=raw.imageAssetId;}
  if(raw.createdAt!==undefined&&raw.createdAt!=='')row.createdAt=iso(raw.createdAt,'createdAt');
  return row;
 });
 if(new TextEncoder().encode(JSON.stringify({revision:0,rows:result})).length>POSTING_LIBRARY_MAX_BYTES)throw Error('文案与配图总量超过 32 MB；请先导出并删除不再使用的条目，原文案库未更改');
 return result;
}
export function normalizePostingCopies(raw){
 if(raw==null)return {revision:0,rows:[]};
 if(!Number.isSafeInteger(raw.revision)||raw.revision<0)throw Error('发帖文案库版本无效');
 return {revision:raw.revision,rows:validatePostingCopies(raw.rows)};
}
// Creation defaults are separate from storage normalization: explicit manual
// stops on existing rows must survive editing, reads and extension reloads.
function newPostingCopies(raw){
 return validatePostingCopies(raw).map((row,i)=>({...row,enabled:!['published','unknown'].includes(raw[i]?.status)}));
}
export function parsePostingPackage(raw){
 if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{throw Error('导入内容不是有效 JSON');}}
 if(!Array.isArray(raw)&&(!raw||typeof raw!=='object'||raw.schema&&raw.schema!=='sacred-plan-content-package'||raw.version!==undefined&&raw.version!==1))throw Error('不支持此文案包格式或版本');
 return newPostingCopies(Array.isArray(raw)?raw:raw.rows);
}
export function classifyPostingImport(existing,incoming){
 const rows=validatePostingCopies(existing).slice(),input=parsePostingPackage(incoming),conflicts=[];let added=0,duplicate=0;
 for(const row of input){
  const byId=rows.find(old=>old.id===row.id);
  const sameContent=old=>normalizePostingText(old.text)===normalizePostingText(row.text)&&JSON.stringify(postingImages(old))===JSON.stringify(postingImages(row));
  if(byId){if(JSON.stringify(byId)===JSON.stringify(row)){duplicate++;continue;}conflicts.push(row.id);continue;}
  if(rows.some(old=>row.newsId&&old.newsId===row.newsId&&(!old.variantId||!row.variantId||old.variantId===row.variantId)||sameContent(old))){duplicate++;continue;}
  rows.push(row);added++;
 }
 return {rows:validatePostingCopies(rows),added,duplicate,conflicts};
}
export function postingCopyOperation(raw,op){
 const state=normalizePostingCopies(raw);
 if(!op||typeof op!=='object'||Array.isArray(op)||op.expectedRevision!==state.revision)throw Error('发帖文案库已变化，请刷新后重试');
 let rows=state.rows;
 switch(op.action){
  case 'merge':{
   const result=classifyPostingImport(rows,op.rows);if(result.conflicts.length)throw Error('导入 ID 冲突：'+result.conflicts.slice(0,5).join('、')+'；原文案库未更改');rows=result.rows;break;
  }
  case 'replace':{
   const existing=new Set(rows.map(row=>row.id)),fresh=newPostingCopies(op.rows);
   rows=validatePostingCopies(op.rows).map((row,i)=>existing.has(row.id)?row:fresh[i]);break;
  }
  case 'clear':rows=[];break;
  case 'upsert':{
   const old=rows.find(r=>r.id===op.id)??null,expected=op.expected==null?null:validatePostingCopies([op.expected])[0];
   if(JSON.stringify(old)!==JSON.stringify(expected))throw Error('文案已在其他窗口修改');
   const row=(old?validatePostingCopies:newPostingCopies)([op.row])[0];if(row.id!==op.id)throw Error('文案 ID 不一致');
   rows=old?rows.map(r=>r.id===row.id?row:r):[...rows,row];break;
  }
  case 'delete':{
   const old=rows.find(r=>r.id===op.id)??null,expected=op.expected==null?null:validatePostingCopies([op.expected])[0];
   if(!old||JSON.stringify(old)!==JSON.stringify(expected))throw Error('文案已在其他窗口修改');
   rows=rows.filter(r=>r.id!==op.id);break;
  }
  default:throw Error('未知发帖文案操作');
 }
 return {revision:state.revision+1,rows:validatePostingCopies(rows)};
}
function validateTimelineSourceIdentity(post,label,allowEmpty=false){
 const id=post?.id,author=post?.author,text=body(post?.text);
 if(!/^\d+$/.test(id||'')||!/^[A-Za-z0-9_]{1,15}$/.test(author||'')||text===null||!allowEmpty&&!text.trim())throw Error(label+'没有可改写的有效正文');
 let url;try{url=new URL(post.url);}catch{throw Error(label+'链接无效');}
 const path=url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
 if(url.origin!=='https://x.com'||url.username||url.password||url.search||url.hash||!path||path[1].toLowerCase()!==author.toLowerCase()||path[2]!==id)
  throw Error(label+'链接与正文身份不匹配');
 if(text.length>16000)throw Error(label+'正文过长，无法安全改写');
 return {id,author,text,url:url.href};
}
function normalizeTimelineImageUrl(value){
 let url;try{if(typeof value==='string'&&value.length<=2048)url=new URL(value);}catch{}
 const path=url?.pathname.match(/^\/media\/([A-Za-z0-9_-]{1,100})(?:\.(jpe?g|png|webp|gif))?$/);
 const ext=url?.searchParams.get('format')??path?.[2];
 if(url?.origin!=='https://pbs.twimg.com'||url.username||url.password||url.hash||!path||!['jpg','jpeg','png','webp','gif'].includes(ext))throw Error('不是受支持的 X 原生图片链接');
 return 'https://pbs.twimg.com/media/'+path[1]+'?format='+(ext==='jpeg'?'jpg':ext)+'&name=large';
}
function timelineSourceWithMedia(post,label){
 const urls=post?.imageUrls;
 if(urls!==undefined&&(!Array.isArray(urls)||urls.length>POSTING_MAX_IMAGES))throw Error('每帖最多复制 4 张图片');
 const videos=post?.videoUrls;
 if(videos!==undefined&&(!Array.isArray(videos)||videos.length>4))throw Error('每帖最多 4 个视频链接');
 const gifs=post?.gifUrls;
 if(gifs!==undefined&&(!Array.isArray(gifs)||gifs.length>POSTING_MAX_IMAGES))throw Error('动图列表无效');
 const gifUrls=[...new Set((gifs||[]).map(value=>{
  if(typeof value!=='string'||value.length>2048||!/^https:\/\/video\.twimg\.com\/tweet_video\/[A-Za-z0-9_-]{1,128}\.mp4(?:\?tag=\d+)?$/.test(value))throw Error('不是受支持的 X 原生动图链接');
  return value.split('?')[0];
 }))];
 const imageUrls=[...new Set(urls?.map(normalizeTimelineImageUrl)||[])];
 const source=validateTimelineSourceIdentity(post,label,imageUrls.length>0||gifUrls.length>0||videos?.length>0);
 const videoUrls=[...new Set((videos||[]).map(value=>{
  let url;try{if(typeof value==='string'&&value.length<=2048)url=new URL(value);}catch{}
  const path=url?.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/video\/([1-4])$/);
  if(url?.origin!=='https://x.com'||url.username||url.password||url.search||url.hash||!path||path[1].toLowerCase()!==source.author.toLowerCase()||path[2]!==source.id)throw Error('视频链接与帖子身份不匹配');
  return source.url+'/video/'+path[3];
 }))];
 if(imageUrls.length)source.imageUrls=imageUrls;
 if(videoUrls.length)source.videoUrls=videoUrls;
 if(gifUrls.length)source.gifUrls=gifUrls;
 return source;
}
export const timelinePostingImageUrls=source=>[...new Set([...(source.rootPost?.imageUrls||[]),...(source.imageUrls||[])])];
export const timelinePostingAttachmentUrls=source=>[...timelinePostingImageUrls(source),...new Set([...(source.rootPost?.gifUrls||[]),...(source.gifUrls||[])])];
export const timelinePostingVideoUrls=source=>[...new Set([...(source.rootPost?.videoUrls||[]),...(source.videoUrls||[])])];
export function validateTimelinePostingSource(post){
 const source=timelineSourceWithMedia(post,'该帖子');
 if(post?.rootPost!==undefined){
  const rootPost=timelineSourceWithMedia(post.rootPost,'评论所属帖子');
  if(rootPost.id===source.id)throw Error('评论与所属帖子身份相同');
  source.rootPost=rootPost;
 }
 if(timelinePostingAttachmentUrls(source).length>POSTING_MAX_IMAGES)throw Error('原帖与评论合计超过 4 个图片或动图附件，未加入文案库');
 return source;
}
export const timelineRewriteRowId=id=>'timeline_ai_'+id;
export function timelineRewriteSourceId(row){
 const generated=/^timeline_ai_(\d+)$/.exec(row?.id||'');if(generated)return generated[1];
 const value=row?.sourceUrls?.[0];if(typeof value!=='string')return null;
 try{const url=new URL(value),match=url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)$/);return url.origin==='https://x.com'&&!url.search&&!url.hash?match?.[1]||null:null;}catch{return null;}
}
export const timelineRewriteFingerprint=text=>(normalizePostingText(text)||'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
export const isSpacedRewriteStyle=style=>style==='reaction'||style==='verify';
export function formatTimelineRewriteText(value,style){
 const text=body(value);if(text===null)return null;
 const lines=[];
 for(const raw of text.split('\n')){
  const line=raw.trim();if(!line)continue;
  const locale=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)?'zh':'en';
  const parts=typeof Intl?.Segmenter==='function'?[...new Intl.Segmenter(locale,{granularity:'sentence'}).segment(line)].map(part=>part.segment.trim()).filter(Boolean):[line];
  for(const part of parts){
   if(lines.length&&/^[\p{P}\p{S}\s]+$/u.test(part))lines[lines.length-1]+=(/^\s/.test(part)?'':' ')+part;
   else lines.push(part);
  }
 }
 return lines.join(isSpacedRewriteStyle(style)?'\n\n':'\n');
}
export function appendTimelineRewrite(raw,post,rewrittenText,createdAt=new Date().toISOString(),images=[],style){
 const state=normalizePostingCopies(raw),source=validateTimelinePostingSource(post),text=formatTimelineRewriteText(rewrittenText,style),rowId=timelineRewriteRowId(source.id);
 const existing=state.rows.find(row=>row.id===rowId||timelineRewriteSourceId(row)===source.id);
 if(existing)return {library:state,row:existing,added:false};
 const attachments=timelinePostingAttachmentUrls(source);
 if(!Array.isArray(images)||images.length!==attachments.length)throw Error('图片或动图未全部读取，未加入文案库');
 if(attachments.some((url,i)=>url.startsWith('https://video.twimg.com/')?!images[i]?.startsWith?.('data:video/mp4;'):url.includes('?format=gif&')&&!images[i]?.startsWith?.('data:image/gif;')))throw Error('动图格式不匹配，未加入文案库');
 if(source.text.trim()){
  if(!text?.trim())throw Error('DeepSeek 未返回有效改写文案');
  if(timelineRewriteFingerprint(text)===timelineRewriteFingerprint(source.text))throw Error('DeepSeek 未实质改写原文，未加入文案库');
  if(source.rootPost&&timelineRewriteFingerprint(text)===timelineRewriteFingerprint(source.rootPost.text))throw Error('DeepSeek 只复制了所属帖子，未融合评论观点');
 }
 const videoUrls=timelinePostingVideoUrls(source),bodyText=source.text.trim()?text:'';
 // Append after AI formatting; video permalinks are publishable content, not source-only metadata.
 const publishText=[bodyText,...videoUrls].filter(Boolean).join('\n\n');
 const row={id:rowId,text:publishText,enabled:true,sourceUrls:[source.url,...(source.rootPost?[source.rootPost.url]:[])],createdAt,
  ...(images.length===1?{image:images[0]}:images.length?{images}:{})};
 const library={revision:state.revision+1,rows:validatePostingCopies([...state.rows,row])};
 return {library,row:library.rows.at(-1),added:true};
}
export function eligiblePostingCopies(rows){return validatePostingCopies(rows).filter(row=>row.enabled);}
export function splitPostingPaste(text,mode='lines'){
 const input=body(text);if(!input?.trim())return [];
 if(!['lines','separator'].includes(mode))throw Error('粘贴分隔方式无效');
 const parts=mode==='lines'?input.split('\n'):input.split(/^\s*---\s*$/m);
 const rows=parts.map(part=>part.trim()).filter(Boolean);
 if(rows.length>5000||rows.some(t=>t.length>10000))throw Error('批量文案数量或单条长度超限');
 return rows;
}
