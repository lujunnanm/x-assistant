// Branch-bound text and owned photos. Both are quoted data, never instructions.
import {createAIError} from './ai-recovery.mjs';
import {normalizeTimelineImageUrl} from './posting-copy.mjs';
const id=value=>typeof value==='string'&&/^\d+$/.test(value);
export function normalizeReplyImages(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>4)throw createAIError('invalid_input');
  try{return [...new Set(value.map(normalizeTimelineImageUrl))];}
  catch{throw createAIError('invalid_input');}
}
function item(value){
  if(!value||!id(value.id)||!/^[A-Za-z0-9_]{1,15}$/.test(value.author)||typeof value.text!=='string'||value.text.length>16000||value.parentId!==null&&!id(value.parentId))throw createAIError('invalid_input');
  const imageUrls=normalizeReplyImages(value.imageUrls);
  const videoUnavailable=value.videoUnavailable===true;
  if(!value.text.trim()&&!imageUrls.length&&!videoUnavailable)throw createAIError('invalid_input');
  return {id:value.id,author:value.author.toLowerCase(),text:value.text,parentId:value.parentId,
    ...(imageUrls.length?{imageUrls}:{}),...(videoUnavailable?{videoUnavailable:true}:{})};
}
export function normalizeReplyContext(value,post){
  if(value?.version!==1||!Array.isArray(value.history)||value.history.length>32)throw createAIError('invalid_input');
  const root=item(value.root),target=item(value.target),history=value.history.map(item);
  if(root.parentId!==null||target.id!==post.id||target.text!==post.text)throw createAIError('invalid_input');
  if(root.id===target.id){
    if(history.length||JSON.stringify(root)!==JSON.stringify(target))throw createAIError('invalid_input');
  }else{
    const seen=new Set([root.id]);let previous=root.id;
    for(const row of [...history,target]){
      if(seen.has(row.id)||row.parentId!==previous)throw createAIError('invalid_input');
      seen.add(row.id);previous=row.id;
    }
  }
  if([root,...history,target].reduce((n,r)=>n+r.text.length,0)>64000)throw createAIError('invalid_input');
  // Own replies are attached from account-bound, confirmed local ledgers only.
  return {version:1,root,history,target};
}
export function confirmedReplyHistory(context,account,processed={},notifications={},claims={}){
  const owner=String(account).toLowerCase(),branch=[context.root,...context.history,context.target];
  const seen=new Set(branch.filter(r=>'/'+r.author===owner).map(r=>r.text));
  const replies=[];
  for(const row of branch){
    const p=processed[row.id],n=notifications[row.id];
    const candidates=[];
    if(p?.reply==='verified'&&(p.account?.toLowerCase()===owner||!p.account&&claims[row.id]?.status==='confirmed'))candidates.push(p.replyText);
    if(n?.status==='confirmed')candidates.push(n.text);
    for(const text of candidates){
      if(typeof text!=='string'||!text.trim()||text.length>1000||seen.has(text))continue;
      seen.add(text);replies.push({toPostId:row.id,text});
    }
  }
  return replies.slice(-32);
}
