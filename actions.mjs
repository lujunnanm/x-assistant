// These functions run inside X through chrome.scripting. Each one targets one
// canonical post/author, clicks at most once, and reads the resulting DOM state.
export async function submitCurrentReply(url,text){
 let clicked=false;
 try{
  const expected=new URL(url);
  if(location.origin!==expected.origin)throw Error('当前页面不在 X');
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'));
  if(dialogs.length!==1)throw Error('未找到唯一回复弹窗，请先填入并审阅草稿');
  const dialog=dialogs[0],editor=dialog.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');
  if(!editor)throw Error('回复编辑器未就绪');
  const actual=editor.textContent.replace(/\r\n/g,'\n'),wanted=text.replace(/\r\n/g,'\n');
  if(actual!==wanted)throw Error('弹窗文案与面板文案不一致，未发送');
  const matched=[...dialog.querySelectorAll('a[href]')].some(a=>{try{return new URL(a.href).pathname===expected.pathname;}catch{return false;}});
  if(!matched){
   const author='/'+expected.pathname.split('/')[1].toLowerCase();
   const authorMatched=[...dialog.querySelectorAll('a[href]')].some(a=>{try{return new URL(a.href).pathname.toLowerCase()===author;}catch{return false;}});
   if(!authorMatched)throw Error('无法核对回复目标，未发送');
  }
  const buttons=[...dialog.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');
  if(buttons.length!==1)throw Error('未找到唯一可用的回复按钮');
  buttons[0].click();clicked=true;
  for(let i=0;i<150;i++){
   if(!document.contains(dialog))return {status:'verified',clicked,message:'回复已提交，弹窗已关闭'};
   await new Promise(r=>setTimeout(r,100));
  }
  return {status:'unknown',clicked,message:'已点击回复，但页面未返回明确结果；已锁定，禁止自动重试'};
 }catch(e){return {status:clicked?'unknown':'failed',clicked,message:e.message};}
}

export async function likeOriginalPost(url,act=true){
 let clicked=false;
 try{
  const expected=new URL(url);
  if(location.origin!==expected.origin||location.pathname!==expected.pathname)throw Error('当前页不是所选原帖');
  if(document.querySelector('[role="dialog"]'))throw Error('请先处理页面弹窗');
  let articles=[];
  for(let i=0;i<100;i++){
   articles=[...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>[...a.querySelectorAll('a[href]')].some(l=>{try{return l.querySelector('time')&&new URL(l.href).pathname===expected.pathname;}catch{return false;}}));
   if(articles.length===1)break;
   await new Promise(r=>setTimeout(r,100));
  }
  if(articles.length!==1)throw Error('原帖未加载或不唯一');
  const article=articles[0];
  if(article.querySelectorAll('[data-testid="unlike"]').length===1)return {status:'skipped',clicked,message:'原帖已经点赞，已跳过'};
  const buttons=[...article.querySelectorAll('[data-testid="like"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');
  if(buttons.length!==1)throw Error('未找到唯一可用的点赞按钮');
  if(!act)return {status:'pending',clicked,message:'已确认原帖当前未点赞，可以重试'};
  const button=buttons[0];button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});
  if(typeof PointerEvent==='function'&&button.dispatchEvent){
   const common={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};
   button.dispatchEvent(new PointerEvent('pointerdown',common));button.dispatchEvent(new MouseEvent('mousedown',common));
   button.dispatchEvent(new PointerEvent('pointerup',{...common,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...common,buttons:0}));
  }
  button.click();clicked=true;
  for(let i=0;i<100;i++){
   if(article.querySelectorAll('[data-testid="unlike"]').length===1)return {status:'verified',clicked,message:'点赞成功并已回读按钮状态'};
   await new Promise(r=>setTimeout(r,100));
  }
  return {status:'unknown',clicked,message:'已点击点赞，但状态未能确认；已锁定，禁止自动重试'};
 }catch(e){return {status:clicked?'unknown':'failed',clicked,message:e.message};}
}

export async function followAuthorOnProfile(author,act=true){
 let clicked=false;
 try{
  if(location.origin!=='https://x.com'||location.pathname.toLowerCase()!=='/'+author.toLowerCase())throw Error('当前页不是所选作者主页');
  if(document.querySelector('[role="dialog"]'))throw Error('请先处理页面弹窗');
  const label=b=>(b.getAttribute('aria-label')||'').trim(),own=b=>label(b).toLowerCase().endsWith('@'+author.toLowerCase());
  let all=[],following=[],buttons=[];
  for(let i=0;i<100;i++){
   all=[...document.querySelectorAll('button')].filter(own);
   following=all.filter(b=>/^(取消关注|正在关注|Following|Unfollow)\s/i.test(label(b)));
   buttons=all.filter(b=>/^(关注|回关|Follow|Follow back)\s/i.test(label(b))&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
   if(following.length===1||buttons.length===1)break;
   await new Promise(r=>setTimeout(r,100));
  }
  if(following.length===1)return {status:'skipped',clicked,message:'作者已经关注，已跳过'};
  if(buttons.length!==1)throw Error('未找到唯一且明确属于作者的关注按钮');
  if(!act)return {status:'pending',clicked,message:'已确认作者当前未关注，可以重试'};
  const button=buttons[0];button.scrollIntoView({block:'center'});button.focus?.({preventScroll:true});
  if(typeof PointerEvent==='function'&&button.dispatchEvent){
   const common={bubbles:true,cancelable:true,view:window,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};
   button.dispatchEvent(new PointerEvent('pointerdown',common));button.dispatchEvent(new MouseEvent('mousedown',common));
   button.dispatchEvent(new PointerEvent('pointerup',{...common,buttons:0}));button.dispatchEvent(new MouseEvent('mouseup',{...common,buttons:0}));
  }
  button.click();clicked=true;
  for(let i=0;i<100;i++){
   const now=[...document.querySelectorAll('button')].filter(own).filter(b=>/^(取消关注|正在关注|Following|Unfollow)\s/i.test(label(b)));
   if(now.length===1)return {status:'verified',clicked,message:'关注成功并已回读按钮状态'};
   await new Promise(r=>setTimeout(r,100));
  }
  return {status:'unknown',clicked,message:'已点击关注，但状态未能确认；已锁定，禁止自动重试'};
 }catch(e){return {status:clicked?'unknown':'failed',clicked,message:e.message};}
}
