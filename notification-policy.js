// Pure eligibility and outcome policy. Legacy batchSeen never blocks a new window.
(() => {
  const DAY=86400000,MENTION_WINDOW=7*DAY;
  const recent=(at,now=Date.now())=>Number.isFinite(at)&&at>=now-DAY&&at<=now;
  // Verified comments in the account's own threads remain actionable.
  // Other addressed replies stay actionable for 7 days: a mention whose thread
  // proof has not rendered yet must not be dropped after a single day.
  const inMentionWindow=(at,now=Date.now())=>Number.isFinite(at)&&at>=now-MENTION_WINDOW&&at<=now;
  const inReplyScope=(row,now=Date.now())=>Number.isFinite(row?.at)&&row.at<=now&&(row.directComment||row.ownThread||inMentionWindow(row.at,now));
  // A transient failure (account flicker, cleanup, leftover draft) is retried after
  // 30 minutes, at most 3 times. A blocked author stays skipped.
  const SKIP_RETRY_DELAY=30*60000,SKIP_RETRY_LIMIT=3,PERMANENT_SKIP=['AUTHOR_BLOCKED'];
  const skipBlocks=(record,now=Date.now())=>record?.status==='skipped_issue'&&record.reasonCode!=='RESIDUAL_DRAFT'&&
    (PERMANENT_SKIP.includes(record.reasonCode)||(Number(record.attempts)||1)>=SKIP_RETRY_LIMIT||!(now-Number(record.at)>=SKIP_RETRY_DELAY));
  const confirmed=(record,prior)=>['confirmed','previously_processed'].includes(record?.status)||prior?.reply==='verified';
  const uncertain=(record,prior)=>['in_flight','unknown'].includes(record?.status)||['in_flight','unknown'].includes(prior?.reply);
  function reason(row,{account,now=Date.now(),until=now,record,prior,attempted=new Set()}) {
    if(row.author.toLowerCase()==='grok')return 'grok';
    if(row.author.toLowerCase()===account.replace(/^\//,'').toLowerCase())return 'self';
    if(!row.addressed)return 'not_addressed';
    if(!inReplyScope(row,now))return 'outside_window';
    if(row.at>until)return 'newer_than_window';
    if(!row.text.trim()&&!row.imageUrls?.length)return 'empty';
    if(confirmed(record,prior))return 'already_replied';
    if(skipBlocks(record,now))return 'skipped_issue';
    if(uncertain(record,prior))return 'unknown_send';
    if(attempted.has(row.id))return 'attempted_this_window';
    return null;
  }
  const newestFirst=rows=>rows.filter(r=>Number.isFinite(r.at)).sort((a,b)=>b.at-a.at);
  // Tier keeps the long-standing structure: direct comments on our own post, then other comments
  // inside our own threads, then everything else. Scoring only orders rows inside a tier.
  const tier=r=>(r.ownThread||r.directComment?2:0)+(r.directComment?1:0);
  const QUESTION=/[?？]|怎么|如何|为什么|为啥|咋办|能不能|可不可以|是不是|有没有|哪个|多少钱/;
  const plainLength=text=>[...String(text||'').replace(/https?:\/\/\S+/g,'').replace(/(?:^|\s)@\w{1,15}/g,' ').replace(/\s+/g,'')].length;
  // Ordering only: nothing is excluded here, so every eligible comment is still answered, just in a better order.
  //  fresh        newer comments first (half-life 6 h), the old newest-first rule as a smooth curve
  //  question     a real question beats a drive-by remark
  //  continuation someone answering one of our own replies is an open conversation
  //  substance    a one-word reaction goes later, a developed comment a little earlier; the middle is neutral
  //  spam         follow-for-follow and mutual-boost posts go last
  //  familiar     people we have already replied to before (across posts) come earlier
  //  fairness     each reply sent to the same person in the last 24 h costs a little, so a single
  //               prolific commenter cannot take every slot
  // ctx: {now, owner (handle without @), known(handle)->{n,recent}, parentAuthor(row)->handle|null}
  function replyScore(row,ctx={}){
    const now=Number.isFinite(ctx.now)?ctx.now:Date.now(),text=String(row.text||''),length=plainLength(text);
    const person=ctx.known?.(String(row.author||'').toLowerCase())||{n:0,recent:0};
    const friendship=globalThis.XAssistantCore?.friendshipRelated;
    const parts={
      fresh:40*Math.pow(.5,Math.max(0,now-row.at)/3600000/6),
      question:QUESTION.test(text)?18:0,
      continuation:ctx.owner&&ctx.parentAuthor?.(row)===ctx.owner?16:0,
      substance:length<=4?-12:length>=20?8:0,
      spam:typeof friendship==='function'&&friendship(text)?-35:0,
      familiar:Math.min(18,6*(person.n||0)),
      fairness:-10*Math.min(3,person.recent||0)
    };
    return {score:Object.values(parts).reduce((a,b)=>a+b,0),parts};
  }
  const priorityFirst=(rows,ctx)=>{
    const list=rows.filter(r=>Number.isFinite(r.at));
    if(!ctx)return list.sort((a,b)=>tier(b)-tier(a)||b.at-a.at);
    const scores=new Map(list.map(r=>[r,replyScore(r,ctx).score]));
    return list.sort((a,b)=>tier(b)-tier(a)||scores.get(b)-scores.get(a)||b.at-a.at);
  };
  globalThis.XAssistantNotificationPolicy={DAY,MENTION_WINDOW,recent,inMentionWindow,inReplyScope,skipBlocks,confirmed,uncertain,reason,newestFirst,priorityFirst,replyScore};
})();
