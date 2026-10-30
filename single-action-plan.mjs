// Pure planning only. Unknown observations fail closed, never trigger an action.
export function singleActionPlan({liked,following,replyStatus}){
 if(![true,false].includes(liked)||![true,false].includes(following))throw Error('互动状态未知，请重新检查');
 if(!['present','absent_verified','unknown'].includes(replyStatus))throw Error('回复状态无效');
 return {
  like:liked?'skip':'execute',
  follow:following?'skip':'execute',
  reply:replyStatus==='present'?'skip':replyStatus==='absent_verified'?'execute':'manual_check'
 };
}

// A loaded timeline is not a complete reply history. It can establish presence,
// but cannot establish absence without a complete, authoritative listing.
export function classifyVisibleReply(replies, account, text){
 if(!Array.isArray(replies)||!account||!text)throw Error('缺少回复核查信息');
 return replies.some(r=>r?.author?.toLowerCase()===account.toLowerCase()&&r?.text===text)?'present':'unknown';
}
