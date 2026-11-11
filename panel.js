import './time-policy.js';
import './interaction-preferences.js';
import {verifyCredential} from './deepseek-direct.mjs';
import {collectFollowing} from './following.mjs';
import {splitPostingPaste,parsePostingPackage,classifyPostingImport,cleanPostingPublishText,postingImages} from './posting-copy.mjs';
const $=id=>document.getElementById(id);let state,editing=null,busy=false,lastRows=null,postingCopies=null,importPreview=null;
async function send(kind,extra={}){const r=await chrome.runtime.sendMessage({kind,...extra});if(!r?.ok)throw Error(r?.error||'后台未响应');return r.state;}
function note(text,tone='info'){$('message').textContent=text;$('message').dataset.tone=tone;if(tone==='error')$('message').scrollIntoView({block:'nearest'});}
// DOM dialog, not window.confirm(): Ego suppresses native prompts from background tabs.
function confirmLibraryChange(message,buttonText){
 const dialog=$('library-confirm'),cancel=$('library-confirm-cancel'),accept=$('library-confirm-accept');
 if(dialog.open)return Promise.resolve(false);
 $('library-confirm-description').textContent=message;accept.textContent=buttonText;
 return new Promise((resolve,reject)=>{
  let approved=false;
  const finish=()=>{cleanup();resolve(approved);};
  const dismiss=()=>{approved=false;if(dialog.open)dialog.close();};
  // A visible extension page can receive a real click while Chromium reports
  // hasFocus() false. The trusted click on this modal is the consent evidence.
  const agree=e=>{if(e.isTrusted&&!document.hidden){approved=true;dialog.close();}};
  function cleanup(){cancel.removeEventListener('click',dismiss);accept.removeEventListener('click',agree);dialog.removeEventListener('close',finish);window.removeEventListener('pagehide',dismiss);}
  cancel.addEventListener('click',dismiss);accept.addEventListener('click',agree);dialog.addEventListener('close',finish);window.addEventListener('pagehide',dismiss);
  try{dialog.showModal();cancel.focus();}catch(e){cleanup();reject(e);}
 });
}
function action(fn){return async event=>{if(event?.type==='submit')event.preventDefault();if(busy){note('正在处理，请稍候');return;}busy=true;document.querySelector('main').setAttribute('aria-busy','true');try{await fn(event);}catch(e){note(e.message,'error');}finally{busy=false;document.querySelector('main').removeAttribute('aria-busy');}};}
function renderLogs(){
 const module=$('log-module').value,ai={posting:'AI_POST',interaction:'AI_REPLY',notifications:'AI_NOTIFICATION_REPLY'};
 const logs=(state?.logs||[]).filter(entry=>!module||entry.module===module||entry.message.startsWith(module+' ·')||entry.message.startsWith(ai[module]+' ·'));
 $('logs').replaceChildren(...logs.map(l=>{const e=document.createElement('div');e.textContent=`${new Date(l.time).toLocaleString()} · ${l.message}`;return e;}));
}
$('log-module').onchange=renderLogs;
$('stop-all').onclick=async()=>{try{await send('STOP_ALL');note('已请求停止全部模块；已提交的请求无法撤回，发送结果未知时仍需人工核对');}catch(error){note(error.message,'error');}};
const imageSource=image=>image?.startsWith('data:')?image:chrome.runtime.getURL(image);
function resetEditor(){$('editor').reset();$('rowid').value='';$('text').required=true;editing=null;$('editor-status').textContent='新文案保存后默认启用；停用后不会被发帖模块选中。';}
function editCopy(row){editing=structuredClone(row);$('rowid').value=row.id;$('text').value=row.text;$('text').required=!postingImages(row).length;$('editor-details').open=true;$('editor').scrollIntoView({behavior:'smooth'});}
function filterCopies(rows){
 const query=$('library-search').value.trim().toLowerCase();
 return rows.filter(row=>!query||[row.text,row.id,row.newsId,...row.sourceUrls||[]].join(' ').toLowerCase().includes(query));
}
function invalidateImport(message='导入内容已变化，请重新检查并预览。'){importPreview=null;$('import-apply').disabled=true;$('import-rows').replaceChildren();$('import-summary').textContent=message;}
function appendImages(box,row){
 for(const [i,value] of postingImages(row).entries()){
  const video=value.startsWith('data:video/mp4;'),media=document.createElement(video?'video':'img');
  media.className='copy-image';
  if(video){
   media.muted=true;media.loop=true;media.autoplay=true;media.playsInline=true;media.controls=true;
   media.setAttribute('aria-label','文案 '+row.id+' 的动图 '+(i+1));
  }else{media.alt='文案 '+row.id+' 的配图 '+(i+1);media.loading='lazy';}
  media.src=imageSource(value);box.append(media);
 }
}
function appendCopyDetails(box,row){
 appendImages(box,row);
 const details=document.createElement('small');details.textContent=[row.newsId&&'新闻 '+row.newsId,row.variantId&&'文案版本 '+row.variantId,row.imageAssetId&&'配图资产 '+row.imageAssetId].filter(Boolean).join(' · ');if(details.textContent)box.append(details);
 if(row.sourceUrls?.length){const links=document.createElement('div');links.className='copy-sources';for(const [i,url] of row.sourceUrls.entries()){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='来源 '+(i+1);links.append(link);}box.append(links);}
}
function removeImageCaption(text,sourceUrls){return cleanPostingPublishText(text,sourceUrls);}
function renderCopies(next){
 if(postingCopies&&next.revision<postingCopies.revision)return;
 if(importPreview&&next.revision!==importPreview.revision)invalidateImport('文案库已更新，请重新预览后导入。');
 postingCopies=next;$('count').textContent=next.rows.length+' 条';
 const enabled=next.rows.filter(row=>row.enabled).length;$('library-summary').textContent='启用 '+enabled+' 条 · 停用 '+(next.rows.length-enabled)+' 条';
 const filtered=filterCopies(next.rows);$('library-filter-count').textContent='显示 '+filtered.length+' / '+next.rows.length+' 条';
 const signature=JSON.stringify(filtered);if(signature===lastRows)return;lastRows=signature;
 $('rows').replaceChildren(...filtered.map(r=>{
  const box=document.createElement('div');box.className='row';box.dataset.status=r.enabled?'enabled':'disabled';
  const info=document.createElement('small');info.textContent=(r.enabled?'启用':'停用')+' · '+r.id;
  const p=document.createElement('p');p.textContent=r.text;box.append(info,p);appendCopyDetails(box,r);
  const bar=document.createElement('div');bar.className='bar';
  const controls=[['编辑',()=>editCopy(r)],[r.enabled?'停用':'启用',async()=>{await applyCopyOp({action:'upsert',id:r.id,expected:r,row:{...r,enabled:!r.enabled}});note(r.enabled?'文案已停用':'文案已启用');}]];
  if(postingImages(r).length&&r.text.trim())controls.push(['移除配图',async()=>{const row={...r,text:removeImageCaption(r.text,r.sourceUrls)};delete row.image;delete row.images;delete row.imageAssetId;await applyCopyOp({action:'upsert',id:r.id,expected:r,row});note('配图和发布正文中的配图说明、来源链接已移除，文案启停状态不变');}]);
  controls.push(['删除',async()=>{if(await confirmLibraryChange('将删除这条文案。取消不会更改文案库。','删除文案')){await applyCopyOp({action:'delete',id:r.id,expected:r});note('文案已删除');}}]);
  for(const [label,fn] of controls){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.onclick=action(fn);bar.append(button);}box.append(bar);return box;
 }));
}
async function refreshCopies(){renderCopies(await send('POST_COPIES_GET'));}
async function applyCopyOp(op,expectedRevision=postingCopies?.revision){
 if(!postingCopies)throw Error('发帖文案库尚未加载');
 try{const updated=await send('POST_COPIES_OP',{op:{...op,expectedRevision}});renderCopies(updated);return updated;}
 catch(error){if(/已变化|其他窗口/.test(error.message))await refreshCopies();throw error;}
}
$('library-search').oninput=()=>{if(postingCopies)renderCopies(postingCopies);};
$('editor').onsubmit=action(async()=>{
 const id=$('rowid').value||'copy_'+crypto.randomUUID(),original=editing;
 const row={...original,id,text:$('text').value,enabled:original?.enabled??true};
 await applyCopyOp({action:'upsert',id,expected:original,row});resetEditor();note(original?'文案已保存；启停状态不变':'文案已保存并启用');
});
$('cancel').onclick=resetEditor;
$('bulk-add').onclick=action(async()=>{
 const texts=splitPostingPaste($('bulk-text').value,$('bulk-mode').value);
 if(!texts.length)throw Error('请先粘贴文案');if(!postingCopies)throw Error('发帖文案库尚未加载');
 if(postingCopies.rows.length+texts.length>5000)throw Error('发帖文案库最多 5000 条');
 const expectedRevision=postingCopies.revision,rows=[...postingCopies.rows,...texts.map(text=>({id:'copy_'+crypto.randomUUID(),text,enabled:true}))];
 await applyCopyOp({action:'replace',rows},expectedRevision);$('bulk-text').value='';note('已添加并启用 '+texts.length+' 条文案');
});
$('clear').onclick=action(async()=>{
 if(!postingCopies)throw Error('发帖文案库尚未加载');if(!postingCopies.rows.length){note('发帖文案库已经是空的');return;}
 const original=postingCopies;if(!await confirmLibraryChange('将清空当前 '+original.rows.length+' 条发帖文案。此操作不影响互动或回帖。请先导出 JSON 留底。','清空文案库'))return;
 await applyCopyOp({action:'clear'},original.revision);resetEditor();note('发帖文案库已清空');
});
async function validateImportImages(rows){
 for(const image of new Set(rows.flatMap(postingImages))){
  if(image.startsWith('data:video/mp4;')){
   await new Promise((resolve,reject)=>{
    const video=document.createElement('video');video.preload='metadata';
    const finish=valid=>{clearTimeout(timer);video.onloadedmetadata=video.onerror=null;video.removeAttribute('src');valid?resolve():reject(Error('导入动图无法解码，文案库未更改'));};
    const timer=setTimeout(()=>finish(false),5000);
    video.onloadedmetadata=()=>finish(video.videoWidth>0&&video.videoHeight>0&&video.duration>0&&Number.isFinite(video.duration));
    video.onerror=()=>finish(false);video.src=image;
   });
   continue;
  }
  const response=await fetch(imageSource(image));if(!response.ok)throw Error('导入配图不可读取，文案库未更改');
  const bitmap=await createImageBitmap(await response.blob());const valid=bitmap.width>0&&bitmap.height>0;bitmap.close();if(!valid)throw Error('导入配图无法解码，文案库未更改');
 }
}
async function previewImport(){
 invalidateImport();if(!postingCopies)throw Error('发帖文案库尚未加载');
 const input=$('import-text').value;if(!input.trim())throw Error('请先选择 JSON 文件或粘贴文案包');
 const revision=postingCopies.revision,rows=parsePostingPackage(input),summary=classifyPostingImport(postingCopies.rows,input);
 await validateImportImages(rows);if($('import-text').value!==input||postingCopies.revision!==revision)throw Error('导入内容或文案库已变化，请重新预览');
 importPreview={...summary,rows,revision,source:input};
 $('import-summary').textContent='新增 '+summary.added+' 条 · 重复 '+summary.duplicate+' 条 · 冲突 '+summary.conflicts.length+' 条。'+(summary.conflicts.length?'同 ID 内容不同，已阻止导入。':'新增文案默认启用；已发布及结果未知的文案仍停用。');
 $('import-apply').disabled=!!summary.conflicts.length||!summary.added;
 $('import-rows').replaceChildren(...rows.slice(0,30).map(row=>{const box=document.createElement('div');box.className='import-row';const p=document.createElement('p');p.textContent=(summary.conflicts.includes(row.id)?'冲突':'导入项')+' · '+row.id+' · '+(row.enabled?'启用':'停用')+'\n'+row.text;box.append(p);appendImages(box,row);return box;}));
 if(rows.length>30){const p=document.createElement('p');p.textContent='预览前 30 条；本次共 '+rows.length+' 条，全部都会校验。';$('import-rows').append(p);}
}
$('import-preview').onclick=action(previewImport);
$('import-text').oninput=()=>invalidateImport();
$('import-file').onchange=action(async()=>{invalidateImport();const file=$('import-file').files?.[0];if(!file)return;if(file.size>33*1024*1024)throw Error('JSON 文件超过 33 MB，请拆分文案包');$('import-text').value=await file.text();await previewImport();});
$('import-apply').onclick=action(async()=>{
 const preview=importPreview;if(!preview||preview.conflicts.length||!preview.added)throw Error('请先检查并预览无冲突的文案包');
 if(postingCopies?.revision!==preview.revision){invalidateImport('文案库已更新，请重新预览。');throw Error('文案库已变化，请重新预览');}
 // Commit the original package, not normalized preview rows: terminal legacy
 // status must still be available when the backend applies creation defaults.
 await applyCopyOp({action:'merge',rows:preview.source},preview.revision);invalidateImport('导入完成。');$('import-text').value='';$('import-file').value='';note('已合并导入 '+preview.added+' 条文案，跳过 '+preview.duplicate+' 条重复');
});
async function portableCopies(rows){
 const convert=async value=>{
  if(value.startsWith('data:'))return value;
  const response=await fetch(chrome.runtime.getURL(value));if(!response.ok)throw Error('无法导出配图：'+value);
  const blob=await response.blob();if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>5*1024*1024||!blob.size)throw Error('配图文件无效：'+value);
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('配图读取失败'));reader.readAsDataURL(blob);});
 };
 return Promise.all(rows.map(async row=>row.images?{...row,images:await Promise.all(row.images.map(convert))}:row.image?{...row,image:await convert(row.image)}:{...row}));
}
$('export').onclick=action(async()=>{
 if(!postingCopies)throw Error('发帖文案库尚未加载');const rows=await portableCopies(postingCopies.rows);
 const payload={schema:'sacred-plan-content-package',version:1,createdAt:new Date().toISOString(),rows};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='sacred-plan-posting-copies.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('已导出文案库（不含 API 密钥）');
});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 if(changes.app?.newValue){state=changes.app.newValue;renderLogs();}
 if(changes.xAssistantPostingCopiesV1){if(changes.xAssistantPostingCopiesV1.newValue)renderCopies(changes.xAssistantPostingCopiesV1.newValue);else refreshCopies().catch(e=>note(e.message,'error'));}
 if(changes.xAssistantFollowedV1||changes.xAssistantFollowingScanV1)renderFollowing();
});
send('GET').then(s=>{state=s;renderLogs();}).catch(e=>note(e.message,'error'));
refreshCopies().catch(e=>note(e.message,'error'));
async function renderFollowing(){const data=await chrome.storage.local.get(['xAssistantFollowedV1','xAssistantFollowingScanV1']);const scan=data.xAssistantFollowingScanV1||{},rows=Object.values(data.xAssistantFollowedV1?.handles||{});$('following-status').textContent=scan.message||'尚未读取';$('following-count').textContent=`已关注库 ${rows.length} 个账号（历史合并）`;$('following-read').disabled=!!scan.active;$('following-stop').disabled=!scan.active;$('following-list').textContent=rows.slice(-30).map(r=>r.handle).join(' · ');}
$('following-stop').onclick=async()=>{try{const s=(await chrome.storage.local.get('xAssistantFollowingScanV1')).xAssistantFollowingScanV1||{};await chrome.storage.local.set({xAssistantFollowingScanV1:{...s,active:false,message:'已请求停止读取'}});}catch(e){note(e.message);}};
$('following-read').onclick=action(async()=>{
 const tabs=await chrome.tabs.query({url:'https://x.com/*',currentWindow:true});const tab=tabs.find(t=>t.id===state?.tabId)||tabs.find(t=>t.active)||tabs[0];if(!tab)throw Error('请先打开已登录的 X 标签页');
 const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const href=document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');return href&&/^\/[A-Za-z0-9_]{1,15}$/.test(href)?href:null;}});
 const own=result[0]?.result;if(!own)throw Error('无法核对登录账号，请先打开 X 正常页面');
 const scanId=crypto.randomUUID();await chrome.storage.local.set({xAssistantFollowingScanV1:{active:true,scanId,message:'正在打开自己的关注列表'}});
 try{const page=await chrome.tabs.create({url:'https://x.com'+own+'/following',active:true});
 for(let i=0;i<100;i++){const t=await chrome.tabs.get(page.id);if(t.status==='complete')break;await new Promise(r=>setTimeout(r,100));}
 await chrome.scripting.executeScript({target:{tabId:page.id},func:collectFollowing,args:[own,scanId]});
 }catch(e){await chrome.storage.local.set({xAssistantFollowingScanV1:{active:false,scanId,message:'读取失败：'+e.message}});throw e;}
});
$('following-export').onclick=action(async()=>{const data=(await chrome.storage.local.get('xAssistantFollowedV1')).xAssistantFollowedV1||{handles:{}};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='x-following-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
renderFollowing();

function navigate(){const hash=location.hash||'#ai-settings';document.querySelectorAll('.sidebar nav a').forEach(a=>{if(a.getAttribute('href')===hash)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});if(hash==='#logs'){const block=$('logs-section');block.querySelector('details').open=true;block.scrollIntoView();}else if(['#library','#following','#ai-settings','#time-settings','#interaction-settings','#followback-settings'].includes(hash)&&location.hash)document.querySelector(hash).scrollIntoView();}
window.addEventListener('hashchange',navigate);navigate();

const API_KEY_STORAGE='xAssistantDeepSeekKeyV1';
async function keyStatus(){const d=await chrome.storage.local.get(API_KEY_STORAGE),saved=!!d[API_KEY_STORAGE];$('api-status').dataset.state=saved?'saved':'empty';$('api-status').textContent=saved?'已保存本地密钥 · 启动前会再次检查 API 认证。':'尚未配置密钥 · 请先验证并保存。';$('api-key').placeholder=saved?'已保存；如需更换，请粘贴新密钥':'粘贴 API Key';$('api-remove').disabled=!saved;}
$('api-form').onsubmit=action(async()=>{const value=$('api-key').value.trim();if(value.length<16||value.length>256||/\s/.test(value))throw Error('密钥格式无效');$('api-status').dataset.state='checking';$('api-status').textContent='正在验证 API 密钥…';try{await verifyCredential(value);}catch(e){$('api-status').dataset.state='error';$('api-status').textContent=e.message+'；新密钥未保存';throw e;}await chrome.storage.local.set({[API_KEY_STORAGE]:value});await chrome.storage.local.set({xAssistantAIStatusV1:{error:null,time:Date.now()}});$('api-key').value='';await keyStatus();note('密钥已验证并保存。输入框已清空以隐藏密钥，重启无需重填。');});
$('api-remove').onclick=action(async()=>{await chrome.storage.local.remove(API_KEY_STORAGE);await keyStatus();note('插件密钥已删除');});
keyStatus().catch(()=>note('无法读取密钥配置状态'));

const timing = globalThis.XAssistantTimePolicy;
let timingDirty = false, timingSaved = timing.normalize();
function renderTiming(config) {
 const values=timing.normalize(config);
 timingSaved=values;
 $('time-fields').replaceChildren(...Object.entries(timing.fields).filter(([,field])=>!field.legacy).map(([name,field])=>{
  const row=document.createElement('div');row.className='time-row';
  const title=document.createElement('label');title.htmlFor=`time-${name}-min`;title.textContent=field.label;row.append(title);
  for(const side of field.range?['min','max']:['min']){
   const label=document.createElement('label');label.className='time-value';label.textContent=field.range?(side==='min'?'最短':'最长'):'时长';
   const input=document.createElement('input');input.type='number';input.required=true;input.min=field.floor;input.max=field.ceiling;input.step=1;
   input.id=`time-${name}-${side}`;input.value=values[name][side];input.setAttribute('aria-label',`${field.label} ${label.textContent}（秒）`);label.append(input);row.append(label);
  }
  return row;
 }));
 timingDirty=false;
}
$('time-form').addEventListener('input',()=>{timingDirty=true;$('time-status').textContent='有未保存的时间设置';});
$('time-form').onsubmit=action(async()=>{
 const config=Object.fromEntries(Object.entries(timing.fields).map(([name,field])=>{
  if(field.legacy)return [name,timingSaved[name]];
  const min=Number($(`time-${name}-min`).value),max=field.range?Number($(`time-${name}-max`).value):min;return [name,{min,max}];
 }));
 const saved=await send('TIME_SAVE',{config:timing.normalize(config)});renderTiming(saved);$('time-status').textContent='时间设置已保存；下一次计时生效';
});
$('time-reset').onclick=()=>{renderTiming({});timingDirty=true;$('time-status').textContent='已填入默认值，点击保存后生效';};
send('TIME_GET').then(config=>{if(!timingDirty)renderTiming(config);$('time-status').textContent='已读取本地时间配置';}).catch(error=>{$('time-status').textContent=error.message;});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'&&changes[timing.KEY]&&!timingDirty){renderTiming(changes[timing.KEY].newValue);$('time-status').textContent='已同步最新时间配置';}
});

// Interaction preferences are edited here; neither setting starts a module.
function bindInteractionSetting(key,id,label,describe,defaultEnabled=true){
 const button=$(id+'-toggle'),status=$(id+'-status');
 if(!button||!status)return;
 let revision=0;
 function render(value){
  const enabled=defaultEnabled?value!==false:value===true;
  button.setAttribute('aria-checked',String(enabled));
  button.textContent=label+'：'+(enabled?'开启':'关闭');
  status.textContent=describe(enabled);
 }
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes[key]){revision++;render(changes[key].newValue);}
 });
 const initialRevision=revision;
 chrome.storage.local.get(key).then(data=>{
  if(revision===initialRevision)render(data[key]);
  button.disabled=false;
 }).catch(()=>{button.textContent='读取失败';status.textContent='无法读取'+label+'设置，请刷新设置页。';});
 button.onclick=async()=>{
  if(button.disabled)return;
  const initial=revision,enabled=button.getAttribute('aria-checked')!=='true';
  button.disabled=true;
  try{
   await chrome.storage.local.set({[key]:enabled});
   if(revision===initial)render(enabled);
  }catch{status.textContent=label+'设置保存失败，请重试。';}
  finally{button.disabled=false;}
 };
}
bindInteractionSetting('xAssistantFriendSearchV1','interaction-search','搜索时间线互动',enabled=>'当前来源：'+(enabled?'关键词搜索结果（留空用默认 AI 话题）':'X 首页时间线'));
bindInteractionSetting('xAssistantAutoFollowV1','interaction-follow','自动关注',()=>'');
bindInteractionSetting('xAssistantFollowbackSweepV1','followback-sweep','完整遍历回关',enabled=>enabled?'已开启：回关模块将从顶部扫到列表末尾，完成后自动关闭。':'已关闭：回关模块按常规持续检查。',false);

// Slider commits independently of unsaved keywords; retain the old threshold
// as a fallback for profiles that have not moved the slider since upgrading.
function bindInteractionFilters(){
 const prefs=globalThis.XAssistantInteractionPrefs,form=$('interaction-filters'),keywords=$('interaction-keywords'),
  range=$('interaction-views'),value=$('interaction-views-value'),button=$('interaction-filters-save'),
  status=$('interaction-filters-status'),viewStatus=$('interaction-views-status');
 const local=chrome.storage.local;
 let saved=prefs.normalize(),storedViews,keywordRevision=0,viewRevision=0,dirty=false;
 let previewing=false,savingViews=false,pendingViews=null;
 const effectiveViews=()=>prefs.effectiveViews(saved,storedViews);
 const showValue=()=>{
  value.textContent='大于 '+Number(range.value).toLocaleString('zh-CN')+' 次';
  range.setAttribute('aria-valuetext',value.textContent);
 };
 const renderViews=()=>{range.value=String(effectiveViews());showValue();};
 const renderKeywords=()=>{keywords.value=saved.keywords.join('\n');};
 keywords.oninput=()=>{dirty=true;status.textContent='有未保存的关键词';};
 range.oninput=()=>{previewing=true;showValue();viewStatus.textContent='';};
 const cancelPreview=()=>{if(previewing){previewing=false;if(!savingViews)renderViews();}};
 range.onblur=range.onpointercancel=cancelPreview;
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  const list=changes[prefs.KEY],views=changes[prefs.VIEWS_KEY];
  if(list){
   keywordRevision++;saved=prefs.normalize(list.newValue);
   if(!dirty)renderKeywords();
  }
  if(views){viewRevision++;storedViews=views.newValue;}
  if((list||views)&&!previewing&&!savingViews)renderViews();
 });
 local.get([prefs.KEY,prefs.VIEWS_KEY]).then(data=>{
  if(!keywordRevision)saved=prefs.normalize(data[prefs.KEY]);
  if(!viewRevision)storedViews=data[prefs.VIEWS_KEY];
  renderKeywords();renderViews();keywords.disabled=range.disabled=button.disabled=false;
  status.textContent=viewStatus.textContent='';
 }).catch(()=>{status.textContent='读取关键词失败，请刷新设置页。';viewStatus.textContent='读取曝光门槛失败。';});
 range.onchange=async()=>{
  if(range.disabled)return;
  previewing=false;
  const next=Number(range.value);
  if(!prefs.validViews(next)){renderViews();viewStatus.textContent='请选择有效的曝光量档位。';return;}
  pendingViews=next;
  if(savingViews)return;
  savingViews=true;viewStatus.textContent='正在保存曝光门槛…';
  let failed=false;
  while(pendingViews!==null){
   const threshold=pendingViews,initial=viewRevision;pendingViews=null;
   try{
    if(threshold!==effectiveViews()){
     await local.set({[prefs.VIEWS_KEY]:threshold});
     if(viewRevision===initial)storedViews=threshold;
    }
    failed=false;
   }catch{failed=true;}
  }
  savingViews=false;
  if(!previewing)renderViews();
  viewStatus.textContent=failed?'保存失败，仍以之前保存的门槛为准。':'曝光门槛已生效';
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled)return;
  let next;
  try{next={...saved,keywords:prefs.parseKeywords(keywords.value)};}
  catch(error){status.textContent=error.message;return;}
  const initial=keywordRevision,changed=JSON.stringify(next.keywords)!==JSON.stringify(saved.keywords);
  keywords.disabled=button.disabled=true;
  try{
   if(changed)await local.set({[prefs.KEY]:next,[prefs.INDEX_KEY]:0});
   if(keywordRevision===initial)saved=next;
   dirty=false;renderKeywords();status.textContent='关键词已保存';
  }catch{status.textContent='保存关键词失败，请重试。';}
  finally{keywords.disabled=button.disabled=false;}
 };
}
bindInteractionFilters();

// Read-only counters from the interaction driver; never triggers a task.
function renderInteractionDiagnostics(state){
 const d=state?.diagnostics,node=$('interaction-diagnostics');
 if(!d){node.textContent='互动筛选统计：新版开始互动后记录。';return;}
 const labels={self:'自身帖子',confirmed:'已确认成功',uncertain:'结果待核对',retry_cooldown:'暂时退避',author_confirmed:'历史同作者筛选',author_blocked:'作者限制回复',unrelated:'旧主题筛选',no_text:'无可核对正文或媒体',low_exposure:'曝光不足或不可读',already_following:'历史已关注筛选',follow_unknown:'历史关注状态筛选',incomplete_text:'正文未完整展开',unchanged_mismatch:'正文未变的安全跳过',ai_error:'AI生成失败',ai_skip:'历史AI跳过',media_library:'纯媒体使用文案库',content_length_library:'AI 正文过长使用文案库',followback_suffix:'已加回关尾句',follower_greeting:'历史已关注问候',non_follower_greeting:'历史未关注问候',follower_library:'已关注文案库',non_follower_library:'未关注文案库',unknown_relation_library:'关系未知文案库',send_failed:'发送前失败',unknown:'发送结果未知'};
 const group=counts=>Object.entries(counts||{}).map(([key,count])=>`${labels[key]||key} ${count}`).join(' · ')||'暂无记录';
 node.textContent=`互动筛选统计 · 本次进程已检查 ${d.seen||0} 条。筛选排除：${group(d.skips)}。尝试结果：${group(d.outcomes)}。同一帖子不同原因分别计数；未提交失败可稍后重试。`;
}
chrome.storage.local.get('xAssistantRuntimeV1').then(d=>renderInteractionDiagnostics(d.xAssistantRuntimeV1)).catch(()=>{$('interaction-diagnostics').textContent='互动统计读取失败，请刷新设置页';});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantRuntimeV1)renderInteractionDiagnostics(changes.xAssistantRuntimeV1.newValue);});
