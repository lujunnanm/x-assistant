// Serialized by chrome.scripting; keep all browser dependencies inside this function.
export async function fillReplyDraft(url,text){
 try {
  if(location.origin!=='https://x.com'||location.pathname!=='/home')throw Error('请回到 X 主页后重试');
  if(document.querySelector('[role="dialog"]'))throw Error('已有弹窗，未覆盖现有草稿');
  const expected=new URL(url).pathname;
  const permalink=a=>[...a.querySelectorAll('a[href]')].find(l=>l.querySelector('time'));
  const articles=[...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>{
    const link=permalink(a);return link&&new URL(link.href).pathname===expected;
  });
  if(articles.length!==1)throw Error('目标帖子已移出已加载范围或不唯一，请重新选帖');
  const sourceText=articles[0].querySelector('[data-testid="tweetText"]')?.textContent;
  const sourceTime=articles[0].querySelector('time')?.getAttribute('datetime');
  const buttons=articles[0].querySelectorAll('[data-testid="reply"]');
  if(buttons.length!==1)throw Error('回复气泡不唯一');
  const button=buttons[0];button.scrollIntoView({block:'center'});
  await new Promise(r=>setTimeout(r,200));
  if(!button.isConnected||button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('回复气泡不可用');
  const rect=button.getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
  if(!top||!(top===button||button.contains(top)))throw Error('回复气泡被遮挡');
  button.click();
  let dialog,editor;
  for(let n=0;n<200;n++){
    const ds=[...document.querySelectorAll('[role="dialog"]')].filter(d=>!d.querySelector('[role="dialog"]'));
    if(ds.length===1){dialog=ds[0];editor=dialog.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');if(editor)break;}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!editor)throw Error('回复弹窗未就绪，未填入');
  const matched=[...dialog.querySelectorAll('a[href]')].some(a=>new URL(a.href).pathname===expected);
  const authorPath='/'+expected.split('/')[1];
  const sameAuthor=[...dialog.querySelectorAll('a[href]')].some(a=>new URL(a.href).pathname===authorPath);
  const normalized=v=>(v||'').replace(/(?:(?:https?:\/\/)?pic\.x\.com\/[A-Za-z0-9]+\s*)+$/,'').replace(/\s+/g,' ').trim();
  const sameContent=sourceText&&sourceTime&&normalized(dialog.querySelector('[data-testid="tweetText"]')?.textContent)===normalized(sourceText)&&dialog.querySelector('time')?.getAttribute('datetime')===sourceTime;
  if(!matched&&!(sameAuthor&&sameContent))throw Error('无法核对弹窗中的原帖链接，未填入；请手动核对');
  if(editor.textContent.trim())throw Error('弹窗已有草稿，未覆盖');
  editor.focus();
  const clipboard=new DataTransfer();clipboard.setData('text/plain',text);
  editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,400));
  editor=dialog.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');
  if(editor.textContent.replace(/\r\n/g,'\n')!==text.replace(/\r\n/g,'\n'))throw Error('填入内容回读不一致，请检查草稿；未提交');
  return {message:'草稿已填入并回读核对，请在 X 弹窗检查后手动点击「回复」；尚未发送'};
 }catch(e){return {error:e.message};}
}
