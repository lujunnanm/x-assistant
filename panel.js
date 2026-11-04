import './time-policy.js';
import {verifyCredential} from './deepseek-direct.mjs';
import {collectFollowing} from './following.mjs';
const $=id=>document.getElementById(id);let state,editing=null,busy=false,lastRows=null;
async function send(kind,extra={}){const r=await chrome.runtime.sendMessage({kind,...extra});if(!r?.ok)throw Error(r?.error||'后台未响应');return r.state;}
function note(text,tone='info'){$('message').textContent=text;$('message').dataset.tone=tone;}
function action(fn){return async event=>{if(event?.type==='submit')event.preventDefault();if(busy){note('正在处理，请稍候');return;}busy=true;document.querySelector('main').setAttribute('aria-busy','true');try{await fn(event);}catch(e){note(e.message,'error');}finally{busy=false;document.querySelector('main').removeAttribute('aria-busy');}};}
function render(s){state=s;$('count').textContent=`${s.rows.length} 条`;
$('library-summary').textContent=`发帖 ${s.rows.filter(r=>r.type==='post').length} 条 · 评论 ${s.rows.filter(r=>r.type==='reply').length} 条 · 已启用 ${s.rows.filter(r=>r.enabled).length} 条 · 已配图 ${s.rows.filter(r=>r.image).length} 条`;
$('logs').replaceChildren(...s.logs.map(l=>{const e=document.createElement('div');e.textContent=`${new Date(l.time).toLocaleString()} · ${l.message}`;return e;}));
const signature=JSON.stringify(s.rows);if(signature===lastRows)return;lastRows=signature;
$('rows').replaceChildren(...s.rows.map(r=>{const box=document.createElement('div');box.className='row';const info=document.createElement('small');info.textContent=`${r.type==='post'?'发帖':'评论'} · ${r.enabled?'启用':'停用'} · ${r.id}${r.image?' · 已配图':''}`;const p=document.createElement('p');p.textContent=r.text;box.append(info,p);const bar=document.createElement('div');bar.className='bar';
for(const [label,fn] of [['编辑',()=>{$('editor-details').open=true;editing=structuredClone(r);$('rowid').value=r.id;$('rowtype').value=r.type;$('text').value=r.text;$('editor').scrollIntoView({behavior:'smooth'});}], [r.enabled?'停用':'启用',async()=>render(await send('LIBRARY_OP',{op:{action:'upsert',id:r.id,expected:r,row:{...r,enabled:!r.enabled}}}))],['删除',async()=>{if(confirm('删除这条文案？'))render(await send('LIBRARY_OP',{op:{action:'delete',id:r.id,expected:r}}));}]]){const b=document.createElement('button');b.className='secondary';b.textContent=label;b.onclick=action(fn);bar.append(b);}box.append(bar);return box;}));}
$('editor').onsubmit=action(async e=>{e.preventDefault();const id=$('rowid').value||crypto.randomUUID(),old=state.rows.find(x=>x.id===id);const row={id,type:$('rowtype').value,text:$('text').value,enabled:old?.enabled??true,...(old?.image&&$('rowtype').value==='post'?{image:old.image}:{})};render(await send('LIBRARY_OP',{op:{action:'upsert',id,expected:editing,row}}));$('editor').reset();$('rowid').value='';editing=null;note('条目已保存');});
$('cancel').onclick=()=>{$('editor').reset();$('rowid').value='';editing=null;};
$('import').onchange=action(async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error('文件超过 2 MB');const {validateRows}=await import('./core.mjs');const incoming=validateRows(JSON.parse(await file.text()));const merged=new Map(state.rows.map(r=>[r.id,r]));incoming.forEach(r=>merged.set(r.id,r));render(await send('LIBRARY_OP',{op:{action:'merge',rows:incoming}}));note(`已导入 ${incoming.length} 条，按 ID 合并`);}finally{e.target.value='';}});
$('replace-library').onchange=action(async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error('文件超过 2 MB');const {validateRows}=await import('./core.mjs');const incoming=validateRows(JSON.parse(await file.text()));if(!incoming.length)throw Error('替换文件不能为空');if(!confirm(`将备份并删除现有全部 ${state.rows.length} 条文案（包括评论），替换为 ${incoming.length} 条。确认继续？`))return;const updated=await send('LIBRARY_OP',{op:{action:'replace',rows:incoming,expectedRevision:state.revision}});render(updated);note(`已备份旧文案并替换为 ${updated.rows.length} 条`);}finally{e.target.value='';}});
$('export-backup').onclick=()=>{if(!state.libraryBackup?.rows){note('没有替换备份','error');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(state.libraryBackup.rows,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='x-copy-library-before-replace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state.rows,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='x-copy-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'){if(changes.app)changes.app.newValue&&render(changes.app.newValue);if(changes.xAssistantFollowedV1||changes.xAssistantFollowingScanV1)renderFollowing();}});
send('GET').then(render).catch(e=>note(e.message,'error'));
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

function navigate(){const hash=location.hash||'#ai-settings';document.querySelectorAll('.sidebar nav a').forEach(a=>{if(a.getAttribute('href')===hash)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});if(hash==='#logs'){const block=$('logs-section');block.querySelector('details').open=true;block.scrollIntoView();}else if(['#library','#following','#ai-settings','#time-settings'].includes(hash)&&location.hash)document.querySelector(hash).scrollIntoView();}
window.addEventListener('hashchange',navigate);navigate();

const API_KEY_STORAGE='xAssistantDeepSeekKeyV1';
async function keyStatus(){const d=await chrome.storage.local.get(API_KEY_STORAGE),saved=!!d[API_KEY_STORAGE];$('api-status').dataset.state=saved?'saved':'empty';$('api-status').textContent=saved?'已保存本地密钥 · 启动前会再次检查 API 认证。':'尚未配置密钥 · 请先验证并保存。';$('api-key').placeholder=saved?'已保存；如需更换，请粘贴新密钥':'粘贴 API Key';$('api-remove').disabled=!saved;}
$('api-form').onsubmit=action(async()=>{const value=$('api-key').value.trim();if(value.length<16||value.length>256||/\s/.test(value))throw Error('密钥格式无效');$('api-status').dataset.state='checking';$('api-status').textContent='正在验证 API 密钥…';try{await verifyCredential(value);}catch(e){$('api-status').dataset.state='error';$('api-status').textContent=e.message+'；新密钥未保存';throw e;}await chrome.storage.local.set({[API_KEY_STORAGE]:value});await chrome.storage.local.set({xAssistantAIStatusV1:{error:null,time:Date.now()}});$('api-key').value='';await keyStatus();note('密钥已验证并保存。输入框已清空以隐藏密钥，重启无需重填。');});
$('api-remove').onclick=action(async()=>{await chrome.storage.local.remove(API_KEY_STORAGE);await keyStatus();note('插件密钥已删除');});
keyStatus().catch(()=>note('无法读取密钥配置状态'));

const timing = globalThis.XAssistantTimePolicy;
let timingDirty = false;
function renderTiming(config) {
 const values=timing.normalize(config);
 $('time-fields').replaceChildren(...Object.entries(timing.fields).map(([name,field])=>{
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
  const min=Number($(`time-${name}-min`).value),max=field.range?Number($(`time-${name}-max`).value):min;return [name,{min,max}];
 }));
 const saved=await send('TIME_SAVE',{config:timing.normalize(config)});renderTiming(saved);$('time-status').textContent='时间设置已保存；下一次计时生效';
});
$('time-reset').onclick=()=>{renderTiming({});timingDirty=true;$('time-status').textContent='已填入默认值，点击保存后生效';};
send('TIME_GET').then(config=>{if(!timingDirty)renderTiming(config);$('time-status').textContent='已读取本地时间配置';}).catch(error=>{$('time-status').textContent=error.message;});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'&&changes[timing.KEY]&&!timingDirty){renderTiming(changes[timing.KEY].newValue);$('time-status').textContent='已同步最新时间配置';}
});

// Read-only counters from the interaction driver; never triggers a task.
function renderInteractionDiagnostics(state){
 const d=state?.diagnostics,node=$('interaction-diagnostics');
 if(!d){node.textContent='互动筛选统计：新版开始互动后记录。';return;}
 const labels={self:'自身帖子',confirmed:'已确认成功',uncertain:'结果待核对',retry_cooldown:'暂时退避',author_confirmed:'本轮已回复作者',views_missing:'曝光无法读取',low_views:'曝光不足500',unrelated:'交友语义不符',ai_error:'AI生成失败',ai_skip:'AI主动跳过',send_failed:'发送前失败',unknown:'发送结果未知'};
 const group=counts=>Object.entries(counts||{}).map(([key,count])=>`${labels[key]||key} ${count}`).join(' · ')||'暂无记录';
 node.textContent=`互动筛选统计 · 本次进程已检查 ${d.seen||0} 条。筛选排除：${group(d.skips)}。尝试结果：${group(d.outcomes)}。同一帖子不同原因分别计数；未提交失败可稍后重试。`;
}
chrome.storage.local.get('xAssistantRuntimeV1').then(d=>renderInteractionDiagnostics(d.xAssistantRuntimeV1)).catch(()=>{$('interaction-diagnostics').textContent='互动统计读取失败，请刷新设置页';});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.xAssistantRuntimeV1)renderInteractionDiagnostics(changes.xAssistantRuntimeV1.newValue);});
