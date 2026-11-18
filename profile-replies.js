// Due-driven original discovery over native profile links; reply transactions keep their existing ledger.
(()=>{
 const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
 const D=globalThis.XAssistantDOM,T=globalThis.XAssistantTasks;
 let heldVisit=null;
 const DAY=86400000,AUDIT_INTERVAL=6*3600000;
 const originalTime=(id,checkpoint)=>Number.isFinite(checkpoint.postedAt)?checkpoint.postedAt:
  Number(BigInt(id)>>22n)+1288834974657; // Older checkpoints only stored the X Snowflake ID.
 async function scan(options){
  const {signal,account}=options,owner=account.toLowerCase(),until=options.until||Date.now();
  const primary=()=>document.querySelector('[data-testid="primaryColumn"]');
  const rows=()=>{const c=primary();return c?D.rows(owner).filter(r=>c.contains(r.article)):[];};
  const busy=()=>[...(primary()?.querySelectorAll('[role="progressbar"]')||[])].some(n=>!n.closest('article,form,[data-testid="inline_reply_offscreen"]'));
  const profileBound=()=>!!primary()?.querySelector('[data-testid="UserProfileHeader_Items"]') &&
    (rows().some(r=>r.author.toLowerCase()===owner.slice(1))||!!primary()?.querySelector('[data-testid="emptyState"]'));
  let expected=location.pathname;
  const guard=()=>{T.check(signal);globalThis.XAssistantWorkspace?.check(signal);if(D.account()!==owner)throw new T.TaskError('ACCOUNT_CHANGED','账号变化');if(location.pathname.toLowerCase()!==expected.toLowerCase())throw new T.TaskError('PAGE_CHANGED','页面已切换');};
  const scrollY=()=>Number(window.scrollY??document.scrollingElement?.scrollTop)||0;
  const scrollTo=top=>window.scrollTo({top:Math.max(0,top),behavior:'instant'});
  const go=async(atTop=true)=>{
   const oldY=scrollY(),onProfile=location.pathname.toLowerCase()===owner,oldIds=onProfile?new Set(rows().map(r=>r.id)):new Set();
   // A short profile can keep all cards mounted while scrolling. Record only
   // owned originals already laid out at the document's first viewport. Their
   // absolute top and exact timestamp must still agree after returning to zero.
   const firstLayout=new Map();
   if(atTop&&onProfile&&oldY>=innerHeight*.6&&profileBound())for(const r of rows()){
    const box=r.article.getBoundingClientRect?.(),top=box&&oldY+box.top;
    if(r.article.isConnected!==false&&!r.article.closest?.('[hidden],[inert],[aria-hidden="true"]')&&
      r.author.toLowerCase()===owner.slice(1)&&D.originalPost(r.id,owner)&&Number.isFinite(r.at)&&
      box?.height>0&&Number.isFinite(top)&&top>=0&&top<innerHeight&&!firstLayout.has(r.id))
     firstLayout.set(r.id,{at:r.at,top});
   }
   const oldDetail=!atTop&&!onProfile?new Set(rows().map(r=>r.article)):null;
   guard();
   if(location.pathname.toLowerCase()!==owner){
    if(D.dialogs().length||[...document.querySelectorAll('[contenteditable="true"]')].some(e=>globalThis.XAssistantCore.editorText(e).trim())||document.querySelector('[data-testid="attachments"],[data-testid="pollCreator"]')||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))throw new T.TaskError('RESIDUAL_DRAFT','页面存在草稿');
    const profile=await T.waitForPage(()=>{guard();const a=document.querySelector('[data-testid="AppTabBar_Profile_Link"]');return a?.getAttribute('href')?.toLowerCase()===owner?a:null;},{signal,timeout:7000});
    if(!profile)throw new T.TaskError('PROFILE_NAV_LINK','未找到当前账号原生个人资料链接：'+owner);
    guard();globalThis.XAssistantWorkspace?.expectNavigation(profile.getAttribute('href'));
    profile.click();
    if(!await T.waitForPage(()=>location.pathname.toLowerCase()===owner,{signal,timeout:12000}))throw new T.TaskError('PROFILE_NAV_LINK','页面未进入当前账号资料：'+owner);
    expected=location.pathname;
   }
   guard();if(!atTop)return T.waitForPage(()=>{guard();return profileBound()&&(!oldDetail||rows().some(r=>!oldDetail.has(r.article))||!!primary()?.querySelector('[data-testid="emptyState"]'));},{signal,timeout:15500});
   scrollTo(0);
   return await T.waitForPage(()=>{
    guard();if(!profileBound()||scrollY()>4)return false;
    if(oldY<innerHeight*.6||!oldIds.size)return true;
    const live=rows();
    // scrollTop changes synchronously, but X can leave old bottom cards mounted for seconds.
    if(live.some(r=>!oldIds.has(r.id))||!!primary()?.querySelector('[data-testid="emptyState"]'))return true;
    return !busy()&&live.some(r=>{
     const old=firstLayout.get(r.id),box=r.article.getBoundingClientRect?.();
     return old&&r.article.isConnected!==false&&!r.article.closest?.('[hidden],[inert],[aria-hidden="true"]')&&
      live.filter(other=>other.id===r.id).length===1&&old.at===r.at&&r.author.toLowerCase()===owner.slice(1)&&
      D.originalPost(r.id,owner)&&box?.height>0&&box.top>=0&&box.top<innerHeight&&Math.abs(box.top+scrollY()-old.top)<=4;
    });
   },{signal,timeout:15500});
  };
  const workspace=globalThis.XAssistantWorkspace,singleRound=workspace?.state?.()?.assignment?.singleRound===true;
  const countKey='xAssistantProfileCommentCountsV1',queueKey='xAssistantProfileRetryBatchV1';
  const counts=((await local().get(countKey))[countKey]||{})[owner]||{};
  const saved=((await local().get(queueKey))[queueKey]||{})[owner];
  const queue=saved?.version===2?saved:{version:2,discoveryAt:0,cursor:null};
  const stats={eligible:0,confirmed:0,posts:0,pending:0,visited:0,skipped:0};
  const seen=new Set(),visited=new Set(queue.cursor&&Array.isArray(queue.visited)?queue.visited:[]),recheckTop=new Set(),now=Date.now();
  const valid=(id,c)=>/^\d{1,20}$/.test(id)&&c&&originalTime(id,c)>0&&originalTime(id,c)<=until;
  const dueAt=c=>Number.isFinite(c.nextCheckAt)?c.nextCheckAt:0;
  const known=Object.entries(counts).filter(([id,c])=>valid(id,c)&&(c.lastOutcome==='pending'||originalTime(id,c)>=until-7*DAY));
  const due=new Set(known.filter(([,c])=>dueAt(c)<=now).map(([id])=>id));
  const save=async()=>{
   for(const [key,value] of [[countKey,counts],[queueKey,queue]]){
    const data=(await local().get(key))[key]||{};await local().set({[key]:{...data,[owner]:value}});
   }
  };
  const nextDue=()=>Math.min(queue.discoveryAt||Date.now()+300000,...Object.entries(counts)
   .filter(([id,c])=>valid(id,c)&&(c.lastOutcome==='pending'||originalTime(id,c)>=until-7*DAY)).map(([,c])=>dueAt(c)||Date.now()+300000));
  const finish=async(reason,{complete=false,delay=15000,sample,...extra}={})=>{
   queue.visited=queue.cursor?[...visited]:[];
   await save();
   await local().set({xAssistantProfileScanLast:{account:owner,at:Date.now(),phase:reason,stats,postIds:[...seen]}});
   return {complete,rest:!complete,reason,stats,queuePending:['profile_batch','profile_cursor','profile_seek'].includes(reason),nextWakeAt:Math.max(Date.now()+delay,nextDue()),...(sample?{sample:true}:{}),...extra};
  };
  const defer=(c,reason)=>{
   c.idlePasses=Math.min(3,(c.idlePasses||0)+1);c.nextCheckAt=Date.now()+[300000,900000,1800000][c.idlePasses-1];
   c.lastReason=reason;
  };
  const visitRoot=async(row,existingTrip=null)=>{
   row={...row}; // Preserve the selected identity while X replaces/recycles profile cards.
   guard();const c=counts[row.id]||{postedAt:row.at,lastOutcome:'pending'},count=Number.isInteger(row.replyCount)?row.replyCount:null;
   counts[row.id]=c;visited.add(row.id);c.checkedAt=Date.now();c.observed=count;delete c.coverageRetry;delete c.rescanAt;
   if(!existingTrip&&count===0&&c.lastOutcome!=='pending'){c.nextCheckAt=Date.now()+1800000;stats.skipped++;return null;}
   if(!existingTrip&&!workspace?.openOwnOriginal){defer(c,'原生原创帖导航不可用');stats.pending++;return null;}
   let trip=existingTrip,result;
   try{
    if(!trip){
     const live=rows().find(r=>r.id===row.id&&r.at===row.at&&r.author===row.author&&D.originalPost(r.id,owner));
     if(!live){defer(c,'原生原创帖卡片已卸载，保留待查');stats.pending++;return null;}
     workspace.progress?.('检查到期原创帖 '+row.id);
     trip=await workspace.openOwnOriginal(live,{signal,deadline:options.yieldAt});expected=location.pathname;
    }
    if(existingTrip)stats.resumed=(stats.resumed||0)+1;else stats.visited++;
    result=await globalThis.XAssistantNotifications.scan({...options,threadPath:owner+'/status/'+row.id,rootId:row.id,
     expectedCommentCount:count,returnToHome:false,retryOriginal:true,recheckTop:!existingTrip&&(recheckTop.has(row.id)||c.recheckTop===true)});
    if(result.reason==='trial_sample_unknown')throw Object.assign(new T.TaskError('SEND_UNKNOWN','单轮回复结果未知，保留当前详情并等待核对'),{submitted:true,preserveDrafts:true});
    if(result.reason==='page_changed'){heldVisit=null;return result;}
    if(result.evidence?.retainView===true){
     heldVisit={owner,runId:options.runId,signal,path:owner+'/status/'+row.id,row,trip};
    }else{
     heldVisit=null;await trip.returnToSource();expected=location.pathname;guard();
     if(!Number.isInteger(result.finalCommentCount)){
      const matches=rows().filter(r=>r.id===row.id&&r.author.toLowerCase()===owner.slice(1)&&r.at===row.at&&D.originalPost(r.id,owner));
      if(matches.length===1&&Number.isInteger(matches[0].replyCount))result={...result,finalCommentCount:matches[0].replyCount};
     }
    }
   }catch(error){
    heldVisit=null;expected=location.pathname;
    if(!trip&&['TARGET_UPDATED','TARGET_MISMATCH'].includes(error.code)&&location.pathname.toLowerCase()===owner){
     defer(c,error.message);stats.pending++;return null;
    }
    await save();throw error;
   }
   const countUnverified=count===null||!Number.isInteger(result.finalCommentCount);
   const countChanged=!countUnverified&&count!==result.finalCommentCount;
   const completed=result.complete&&!countUnverified&&!countChanged&&!result.stats?.failed&&!result.stats?.aiFailed;
   for(const key of ['eligible','confirmed'])stats[key]+=result.stats?.[key]||0;
   await globalThis.XAssistantRuntime.runtime('notifications','patch',{runId:options.runId,patch:{notificationScanProgress:{completedAt:Date.now(),inspected:1,completedThreads:completed?1:0,cursorAdvanced:result.evidence?.cursorAdvanced===true}}});
   const progressed=!!result.stats?.eligible||!!result.stats?.confirmed||result.evidence?.cursorAdvanced===true;
   c.lastOutcome=completed?'completed':'pending';
   if(result.evidence?.retainView!==true){if(countChanged||countUnverified)c.recheckTop=true;else if(result.evidence?.topChecked===true)c.recheckTop=false;}
   c.resumePending=result.evidence?.resumePending===true;c.lastReason=result.evidence?.retainView===true?result.detail||result.reason:countUnverified?'扫描结束计数未核验':countChanged?'扫描期间评论数变化，下轮补查顶部':result.detail||result.reason;
   if(Number.isInteger(result.finalCommentCount)){c.observed=result.finalCommentCount;if(c.lastOutcome==='completed'){c.handledCount=c.handled=result.finalCommentCount;c.checkpointVersion=3;c.completedAt=Date.now();}}
   if(result.evidence?.retainView===true)c.nextCheckAt=Date.now()+30000;
   else if(c.lastOutcome==='completed'&&Number.isInteger(result.finalCommentCount)){c.idlePasses=0;c.nextCheckAt=Date.now()+AUDIT_INTERVAL;if(progressed)c.lastProgressAt=Date.now();}
   else if(progressed||countChanged||countUnverified){c.idlePasses=0;if(progressed)c.lastProgressAt=Date.now();c.nextCheckAt=Date.now()+60000;}
   else defer(c,c.lastReason);
   if(c.lastOutcome==='pending')stats.pending++;
   queue.visited=[...visited];await save();return result;
  };
  const retained=heldVisit&&heldVisit.owner===owner&&heldVisit.runId===options.runId&&heldVisit.signal===signal&&heldVisit.path===location.pathname.toLowerCase();
  if(heldVisit&&!retained)heldVisit=null; // A different run or route never inherits a Back permit.
  if(retained){
   const result=await visitRoot(heldVisit.row,heldVisit.trip);
   if(result?.evidence?.retainView)return finish('profile_seek',{delay:30000,nextWakeAt:Date.now()+30000});
   if(result?.reason==='page_changed')return finish('page_changed');
   if(result?.sample)return finish(result.reason,{sample:true});
  }
  if(!retained&&!singleRound&&!due.size&&queue.discoveryAt>now)return finish('profile_idle');
  // One native profile visit supplies all pending lookups. Never open cached URLs
  // or restart a full document merely because a saved original is offscreen.
  const resume=retained?null:queue.cursor;
  if(!await go(retained?false:!resume))return finish('PAGE_NOT_READY',{delay:30000});
  if(resume){
   const waiting=resume.waiting,sameView=waiting&&location.pathname.toLowerCase()===owner&&
    waiting.document===(globalThis.performance?.timeOrigin??null)&&Math.abs(scrollY()-waiting.y)<=4;
   if(sameView){
    const changed=await T.waitForPage(()=>{guard();return profileBound()&&rows().map(r=>r.id).join(',')!==waiting.ids;},{signal,timeout:1500});
    if(!changed){
     waiting.rounds=(waiting.rounds||0)+1;
     if(waiting.rounds>=2){queue.cursor=null;queue.discoveryAt=Date.now()+300000;for(const id of due)if(!visited.has(id))defer(counts[id],'个人资料分页未装载新卡片，延后定位');return finish('profile_pending');}
     queue.discoveryAt=Date.now()+30000;return finish('profile_cursor',{delay:30000});
    }
    delete resume.waiting; // The previous native scroll painted while this worker rested.
   }else{
    scrollTo(resume.y);
    const restored=await T.waitForPage(()=>{guard();return profileBound()&&rows().some(r=>r.id===resume.id&&r.at===resume.at&&D.originalPost(r.id,owner));},{signal,timeout:4000});
    if(!restored){queue.cursor=null;if(!await go())return finish('PAGE_NOT_READY',{delay:30000});}
    else if(resume.advance){
     const sig=rows().map(r=>r.id).join(',');window.scrollBy(0,Math.max(600,innerHeight*.8));
     const changed=await T.waitForPage(()=>{guard();return rows().map(r=>r.id).join(',')!==sig;},{signal,timeout:1500});
     if(!changed){resume.waiting={y:scrollY(),ids:sig,document:globalThis.performance?.timeOrigin??null};queue.discoveryAt=Date.now()+30000;return finish('profile_cursor',{delay:30000});}
    }
   }
  }
  queue.discoveryAt=Date.now()+300000;
  const saveCursor=(list,advance)=>{
   const anchor=[...list].reverse().find(r=>r.author.toLowerCase()===owner.slice(1)&&Number.isFinite(r.at)&&D.originalPost(r.id,owner));
   queue.cursor=anchor?{id:anchor.id,at:anchor.at,y:scrollY(),advance}:null;
  };
  let last='',stable=0,ended=false,unavailable=false;
  for(let page=0;page<6;page++){
   guard();if(!profileBound()){unavailable=true;break;}
   const list=rows(),eligible=[];
   for(const r of list){
    if(r.author.toLowerCase()!==owner.slice(1)||!Number.isFinite(r.at)||r.at>until||!D.originalPost(r.id,owner))continue;
    if(r.at<until-DAY&&!counts[r.id])continue;
    seen.add(r.id);stats.posts=seen.size;
    const old=counts[r.id],count=Number.isInteger(r.replyCount)?r.replyCount:null;
    const changed=old&&count!==null&&Number.isInteger(old.observed)&&count!==old.observed;
    const c=counts[r.id]||{postedAt:r.at,observed:count,lastOutcome:count===0?'no_comments':'pending',nextCheckAt:0};
    counts[r.id]=c;c.postedAt=r.at;
    if(changed){c.nextCheckAt=Date.now();c.idlePasses=0;recheckTop.add(r.id);}
    const handled=Number.isInteger(c.handledCount)?c.handledCount:c.handled;
    if(['completed','unchanged','no_comments'].includes(c.lastOutcome)&&count!==null&&count===handled&&!changed&&Date.now()-(c.completedAt||0)<AUDIT_INTERVAL){
     c.nextCheckAt=Math.max(dueAt(c),(c.completedAt||0)+AUDIT_INTERVAL);stats.skipped++;continue;
    }
    if(visited.has(r.id)||dueAt(c)>Date.now()){stats.skipped++;continue;}
    const box=r.article.getBoundingClientRect?.();if(!(box?.height>0&&box.bottom>0&&box.top<innerHeight))continue;
    eligible.push(r);
   }
   // Overdue work gets its turn before recently active hot posts. New/changed
   // originals still enter immediately, but cannot monopolize every pass.
   eligible.sort((a,b)=>dueAt(counts[a.id])-dueAt(counts[b.id])||(counts[a.id].checkedAt||0)-(counts[b.id].checkedAt||0));
   for(const row of eligible){
    if(visited.has(row.id))continue;
    saveCursor(rows(),false);
    const result=await visitRoot(row);
    if(result?.evidence?.retainView)return finish('profile_seek',{delay:30000,nextWakeAt:Date.now()+30000});
    if(result?.reason==='page_changed')return finish('page_changed');
    if(result?.sample)return finish(result.reason,{sample:true});
    if(!profileBound()){unavailable=true;break;}
    if(stats.visited>=5){
     const list=rows(),doc=document.scrollingElement||document.documentElement;
     const bottom=doc&&Number.isFinite(doc.scrollHeight)&&scrollY()+innerHeight>=doc.scrollHeight-8;
     if(!bottom||list.some(r=>!visited.has(r.id)&&counts[r.id]&&dueAt(counts[r.id])<=Date.now()&&D.originalPost(r.id,owner))){
      saveCursor(list,false);queue.discoveryAt=Date.now()+15000;return finish('profile_batch',{delay:15000});
     }
     break;
    }
   }
   if(unavailable)break;
   const current=rows(),signature=current.map(r=>r.id).join(',');stable=signature===last?stable+1:0;last=signature;
   const older=current.filter(r=>r.author.toLowerCase()===owner.slice(1)&&r.at<until-DAY).length;
   const needOld=[...due].some(id=>!seen.has(id)&&!visited.has(id));
   const doc=document.scrollingElement||document.documentElement;
   const bottom=doc&&Number.isFinite(doc.scrollHeight)&&scrollY()+innerHeight>=doc.scrollHeight-8;
   if(!busy()&&(stable>=2||bottom||older>=3&&!needOld)){ended=true;break;}
   saveCursor(current,true);
   if(page===5)break;
   const sig=current.map(r=>r.id).join(',');window.scrollBy(0,Math.max(600,innerHeight*.8));
   const changed=await T.waitForPage(()=>{guard();return rows().map(r=>r.id).join(',')!==sig;},{signal,timeout:1500});
   if(!changed&&queue.cursor){
    queue.cursor.waiting={y:scrollY(),ids:sig,document:globalThis.performance?.timeOrigin??null};
    queue.discoveryAt=Date.now()+30000;return finish('profile_cursor',{delay:30000});
   }
  }
  if(unavailable)return finish('PAGE_NOT_READY',{delay:30000});
  if(ended){
   queue.cursor=null;
   for(const id of due)if(!seen.has(id)&&!visited.has(id)){defer(counts[id],'本轮个人主页未找到原生卡片，保留后续定位');stats.pending++;}
  }else if(queue.cursor){
   queue.discoveryAt=Date.now()+30000;
   return finish('profile_cursor',{delay:30000});
  }
  // Only visit mentions after this bounded profile pass; inaccessible old roots
  // remain due later rather than starving fresh notifications indefinitely.
  guard();workspace?.progress?.('检查通知提及');
  const mentions=await globalThis.XAssistantNotifications.scan({...options,mentionsOnly:true,returnToHome:false});
  for(const key of ['eligible','confirmed'])stats[key]+=mentions.stats?.[key]||0;
  return finish(mentions.sample?mentions.reason:stats.pending?'profile_pending':'profile_idle',
   {complete:!stats.pending&&mentions.complete===true,sample:mentions.sample});
 }
 globalThis.XAssistantProfileReplies={scan};
})();
