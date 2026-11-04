// Pure eligibility and outcome policy. Legacy batchSeen never blocks a new window.
(() => {
  const DAY=86400000;
  const recent=(at,now=Date.now())=>Number.isFinite(at)&&at>=now-DAY&&at<=now;
  const confirmed=(record,prior)=>['confirmed','previously_processed'].includes(record?.status)||prior?.reply==='verified';
  const uncertain=(record,prior)=>['in_flight','unknown'].includes(record?.status)||['in_flight','unknown'].includes(prior?.reply);
  function reason(row,{account,now=Date.now(),until=now,record,prior,attempted=new Set()}) {
    if(row.author.toLowerCase()==='grok')return 'grok';
    if(row.author.toLowerCase()===account.replace(/^\//,'').toLowerCase())return 'self';
    if(!row.addressed)return 'not_addressed';
    if(!recent(row.at,now))return 'outside_24h';
    if(row.at>until)return 'newer_than_window';
    if(!row.text.trim())return 'empty';
    if(confirmed(record,prior))return 'already_replied';
    if(record?.status==='skipped_issue')return 'skipped_issue';
    if(uncertain(record,prior))return 'unknown_send';
    if(attempted.has(row.id))return 'attempted_this_window';
    return null;
  }
  const newestFirst=rows=>rows.filter(r=>Number.isFinite(r.at)).sort((a,b)=>b.at-a.at);
  globalThis.XAssistantNotificationPolicy={DAY,recent,confirmed,uncertain,reason,newestFirst};
})();
