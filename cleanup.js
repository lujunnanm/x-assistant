// Deletes at most one verified low-view original post every 10–30 seconds.
(()=>{
 const root=document.getElementById('x-assistant-float');if(!root||root.dataset.cleanupReady)return;root.dataset.cleanupReady='1';
 const api=globalThis.XAssistantRuntime,core=globalThis.XAssistantCore,clean=globalThis.XAssistantCleanupCore;
 const start=root.querySelector('[data-a="clean-start"]'),stop=root.querySelector('[data-a="clean-stop"]'),section=start.closest('section'),KEY='xAssistantCleanupV1';
 const output=document.createElement('div');output.className='status';output.dataset.status='cleanup';output.setAttribute('role','status');output.textContent='低曝光清理已停止 · 仅删除1天前且展现低于50的原创帖子';section.append(output);
 let control=null,runId=null,runPromise=Promise.resolve(),mirror=null;
 const patch=value=>api.runtime('cleanup','patch',{runId,patch:value});
 const read=async()=> (await chrome.storage.local.get(KEY))[KEY]||{};
 const show=text=>(output.textContent=text,!/下次清理/.test(text)&&section.style.setProperty('--progress',0));
 const selfHandle=()=>document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.slice(1).toLowerCase()||'';
 const onOwnProfile=handle=>location.pathname.toLowerCase()==='/'+handle&&!location.search;
 const visible=element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden';};
 const clickNative=button=>{button.scrollIntoView({block:'center',behavior:'instant'});button.focus?.({preventScroll:true});button.click();};
 const wait=async(fn,signal,label,count=120)=>{for(let i=0;i<count;i++){api.check(signal);const value=fn();if(value)return value;await api.sleep(100,signal);}throw Error(label+'超时');};
 const postInfo=(article,self)=>{
  const own=[...article.querySelectorAll('time')].map(time=>{const link=time.closest('a[href*="/status/"]');if(!link)return null;const match=new URL(link.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);return match&&match[1].toLowerCase()===self?{time,link,author:match[1],id:match[2]}:null;}).find(Boolean);if(!own)return null;
  const analytics=article.querySelector(`a[href$="/status/${own.id}/analytics"]`),viewLabel=analytics?.getAttribute('aria-label')||analytics?.textContent||'';
  const social=article.querySelector('[data-testid="socialContext"]')?.textContent||'',body=article.innerText||'';
  return {article,id:own.id,author:own.author,url:own.link.href.split('?')[0],text:(article.querySelector('[data-testid="tweetText"]')?.innerText||'（无文本内容）').trim(),postedAt:own.time.getAttribute('datetime'),views:clean.parseViews(viewLabel),viewLabel,isPinned:/Pinned|置顶/i.test(body),isReply:/Replying to|回复\s*@/i.test(body),isRepost:/Reposted|转帖了|转发了/i.test(social),isArticle:!!article.querySelector('a[href*="/i/article"],a[href*="/article/"]'),isPromoted:/Promoted|推广/i.test(body)};
 };
 const candidates=(self,now)=>[...document.querySelectorAll('article[data-testid="tweet"]')].map(article=>postInfo(article,self)).filter(post=>clean.eligible(post,{self,now})).sort((a,b)=>Date.parse(a.postedAt)-Date.parse(b.postedAt));
 const findCandidate=async(self,signal)=>{
  for(let screen=0;screen<=6;screen++){
   api.check(signal);const candidate=candidates(self,Date.now())[0];if(candidate)return candidate;
   if(screen<6){show(`本屏无目标，滚动第 ${screen+1}/6 屏`);const before=scrollY;scrollBy({top:Math.max(650,innerHeight*.9),behavior:'smooth'});await api.sleep(1200,signal);if(scrollY===before){scrollTo({top:0,behavior:'instant'});break;}}
  }
  return null;
 };
 const deletePost=async(post,self,signal)=>{
  api.check(signal);if(document.querySelector('[role="dialog"],[role="alertdialog"]'))throw Error('页面已有弹窗，请先处理后再启动');if(!post.article.isConnected)throw Error('候选帖子已移出页面');
  const current=postInfo(post.article,self);if(!clean.eligible(current,{self,now:Date.now()})||current.id!==post.id)throw Error('删除前条件复核失败');
  const carets=[...post.article.querySelectorAll('[data-testid="caret"]')].filter(visible);if(carets.length!==1)throw Error('未找到唯一帖子菜单');
  const existingMenus=new Set([...document.querySelectorAll('[role="menu"]')].filter(visible));
  clickNative(carets[0]);const menu=await wait(()=>[...document.querySelectorAll('[role="menu"]')].find(m=>visible(m)&&!existingMenus.has(m)&&[...m.querySelectorAll('[role="menuitem"]')].some(i=>/^(删除|Delete)$/i.test((i.textContent||'').trim()))),signal,'打开帖子菜单');
  const deletes=[...menu.querySelectorAll('[role="menuitem"]')].filter(item=>/^(删除|Delete)$/i.test((item.textContent||'').trim()));if(deletes.length!==1){clickNative(carets[0]);throw Error('未找到唯一删除选项');}
  clickNative(deletes[0]);const dialog=await wait(()=>clean.deleteDialog(document),signal,'打开删除确认');
  const confirms=[...dialog.querySelectorAll('[data-testid="confirmationSheetConfirm"]')].filter(button=>visible(button)&&!button.disabled);if(confirms.length!==1)throw Error('未找到唯一删除确认按钮');
  if(selfHandle()!==self||!onOwnProfile(self)||!clean.eligible(postInfo(post.article,self),{self,now:Date.now()}))throw Error('确认删除前账号或帖子条件变化');
  const oldToasts=new Set([...document.querySelectorAll('[data-testid="toast"]')].map(t=>t.textContent));
  await patch({phase:'deleting',rowId:post.id,text:post.text,submittedAt:new Date().toISOString(),receipt:null});api.check(signal);clickNative(confirms[0]);
  const confirmed=await wait(()=>!dialog.isConnected&&[...document.querySelectorAll('[data-testid="toast"]')].some(t=>!oldToasts.has(t.textContent)&&/已删除|已刪除|(?:post|tweet) (?:was |has been )?deleted/i.test(t.textContent||'')),signal,'等待删除回执');
  if(!confirmed)throw Error('删除结果未知');const latest=await read();await patch({phase:'confirmed',completed:(latest.completed||0)+1,receipt:{kind:'confirmed',id:post.id,views:post.views,postedAt:post.postedAt,at:new Date().toISOString()},error:null});
 };
 const countdown=async(deadline,signal)=>{const duration=Math.max(1,deadline-Date.now());while(Date.now()<deadline){api.check(signal);const remaining=Math.max(0,deadline-Date.now());section.style.setProperty('--progress',1-remaining/duration);output.textContent=`下次清理 ${(remaining/1000).toFixed(1)} 秒`;await api.sleep(Math.min(100,remaining),signal);}section.style.setProperty('--progress',0);};
 const render=state=>{if(!state?.active){start.disabled=false;stop.disabled=true;if(!control)show(['unknown','deleting'].includes(state?.phase)?'上次删除结果未知，请先核对平台记录':state?.error||'低曝光清理已停止');return;}start.disabled=true;stop.disabled=false;if(!control)output.textContent=`下次清理 ${(Math.max(0,(state.nextAt||Date.now())-Date.now())/1000).toFixed(1)} 秒 · 运行于另一个 X 标签页`;};
 const stopLoop=async()=>{control?.abort();await api.runtime('cleanup','stop');await runPromise;section.style.setProperty('--progress',0);show('低曝光清理已结束；已确认的删除无法撤回');start.disabled=false;stop.disabled=true;};
 const launch=async(resume=false)=>{
  if(control)return;if(!navigator.locks)throw Error('浏览器不支持执行锁');
  const own=new AbortController();control=own;const signal=own.signal;start.disabled=true;stop.disabled=false;runId=null;
  const existing=await read(),lockOptions=resume||existing?.active?{ifAvailable:true}:{steal:true};
  runPromise=navigator.locks.request('x-assistant-low-view-cleanup',lockOptions,async lock=>{
   if(!lock)throw Error('清理正在另一个 X 标签页运行');const self=selfHandle();if(!self)throw Error('无法核对登录账号');if(!onOwnProfile(self))throw Error('请在自己的个人资料“帖子”页启动清理');
   const state=await api.runtime('cleanup','begin',{resume,account:'/'+self});runId=state.runId;let deadline=resume&&Number.isFinite(state.nextAt)?state.nextAt:Date.now()+Math.round(core.randomSeconds(10,30)*1000);
   while(!signal.aborted){if(deadline<Date.now()-60000)deadline=Date.now()+Math.round(core.randomSeconds(10,30)*1000);await patch({phase:'waiting',nextAt:deadline});await countdown(deadline,signal);if(selfHandle()!==self||!onOwnProfile(self))throw Error('账号或页面发生变化，已停止');const candidate=await findCandidate(self,signal);if(candidate){show(`正在删除 ${candidate.views} 展现 · ${candidate.id}`);await deletePost(candidate,self,signal);}else show('六次滚屏未找到符合条件的帖子');deadline=Date.now()+Math.round(core.randomSeconds(10,30)*1000);}
  }).catch(async error=>{if(!signal.aborted&&error.name!=='AbortError'){show('低曝光清理已停止：'+error.message);if(runId){try{await patch({error:error.message});await api.runtime('cleanup','stop');}catch{}}}}).finally(async()=>{if(control===own)control=null;render(await read());});
 };
 start.disabled=false;stop.disabled=true;start.onclick=async()=>{try{const self=selfHandle(),account='/'+self;if(await api.review('cleanup',account))await launch(false);}catch(error){show(error.message);}};stop.onclick=()=>stopLoop().catch(error=>show(error.message));
 read().then(state=>{if(state.active)launch(true);else render(state);}).catch(error=>show(error.message));
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes[KEY])return;const state=changes[KEY].newValue;if(!state?.active)control?.abort();render(state);});
 mirror=setInterval(()=>{if(!control)read().then(render).catch(()=>{});},1000);window.addEventListener('pagehide',()=>{control?.abort();clearInterval(mirror);},{once:true});
 window.addEventListener('x-assistant-invalidate',()=>control?.abort(),{once:true});
})();
