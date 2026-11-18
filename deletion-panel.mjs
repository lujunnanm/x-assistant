import {classifyFriendship} from './deletion-topic.mjs';
import {scanOwnTimeline} from './deletion-scan.mjs';
import {createDeletionBridge} from './deletion-bridge.mjs';
import {verifyOwnLinks} from './deletion-links.mjs';
import {runDeletionPlan} from './deletion-engine.mjs';
const $=id=>document.getElementById(id),pause=ms=>new Promise(r=>setTimeout(r,ms));
const PREVIEW='sacredDeletionPreviewV1',LEDGER='sacredDeletionLedgerV1:',VALID=/^\/[a-z0-9_]{1,15}$/;
const tags=new Set('蓝v交友 蓝v浇友 蓝v浇朋友 蓝v交友浇友串门互关 认识新朋友 交朋友 有关必回 关注必回 蓝v互关 蓝v扩列 蓝友互关 真诚交友 诚信交友 交个朋友 浇朋友 浇个朋友 浇友 互浇 互关 互粉 长期互粉 诚信互关 交友 真诚互粉 交友扩列 相互フォロー 友達募集 followforfollow followback makefriends lookingformutuals'.split(' '));
function tagHit(text){return Array.from(text.normalize('NFKC').toLowerCase().matchAll(/[#＃]([\p{L}\p{N}_]+)/gu),x=>x[1]).some(x=>tags.has(x));}
const label=(text)=>{const c=classifyFriendship(text);return c==='match'?'match':tagHit(text)?'tag':c;};
const panelTab=await chrome.tabs.getCurrent();
let snapshot=null,worker=null,controller=null,busy=false,plan=null,bridge=null,lastReport=null;
const selected=new Set(),say=s=>{$('status').textContent=s;};
const logKey=o=>LEDGER+o;
async function activeOff(){const a=await chrome.storage.local.get(['xAssistantManagedServiceV1','xAssistantPostingV1','xAssistantRuntimeV1','xAssistantNotificationsRuntimeV1']);if(a.xAssistantManagedServiceV1?.enabled!==false||a.xAssistantManagedServiceV1?.trial||[a.xAssistantPostingV1,a.xAssistantRuntimeV1,a.xAssistantNotificationsRuntimeV1].some(v=>v?.active))throw Error('删除前请先关闭总开关，等其他任务结束。');}
async function ownTab(){
 if(worker!==null){try{const t=await chrome.tabs.get(worker);if(t.id===worker&&t.url?.startsWith('https://x.com/'))return worker;}catch{}worker=null;}
 worker=(await chrome.tabs.create({url:'https://x.com/home',active:false})).id;return worker;
}
async function actor(tab,signal){
 const until=Date.now()+24000;while(Date.now()<until){if(signal?.aborted)throw Error('已取消');let a;try{a=(await chrome.scripting.executeScript({target:{tabId:tab},func:()=>globalThis.XAssistantDeletionDOM?.account()}))[0]?.result;}catch{}
 if(typeof a==='string'&&VALID.test(a))return a;await pause(250);}throw Error('无法核对登录账号。请先在 Ego 登录 X，再重新扫描。');
}
function controls(v){busy=v;for(const k of ['scan','tagged','export-plan','verify-links'])$(k).disabled=v;for(const c of document.querySelectorAll('[data-post]'))c.disabled=v;$('stop').disabled=!v;$('prepare').disabled=v||!selected.size;}
function list(el,rows,allow){el.replaceChildren();for(const r of rows){const box=document.createElement('div');box.className='delete-row';const line=document.createElement('label');if(allow){const c=document.createElement('input');c.type='checkbox';c.dataset.post=r.id;c.checked=selected.has(r.id);c.disabled=busy;c.onchange=()=>{if(c.checked)selected.add(r.id);else selected.delete(r.id);counts();};line.append(c);}
 const txt=document.createElement('span');txt.textContent=r.text;line.append(txt);const a=document.createElement('a');a.href='https://x.com'+snapshot.account+'/status/'+r.id;a.target='_blank';a.rel='noopener noreferrer';a.textContent='查看原帖 '+r.id;box.append(line,a);el.append(box);}}
function counts(){if(!snapshot)return;$('summary').textContent='@'+snapshot.account.slice(1)+' · 已核实本人原创 '+snapshot.rows.length+' 条 · 已选 '+selected.size+' 条 · '+snapshot.coverage;$('prepare').disabled=busy||!selected.size;}
function render(reset=false){if(!snapshot)return;if(reset){selected.clear();for(const r of snapshot.rows){const c=label(r.text);if(c==='match'||c==='tag'&&$('tagged').checked)selected.add(r.id);}}
 list($('matched'),snapshot.rows.filter(r=>['match','tag'].includes(label(r.text))),true);list($('review'),snapshot.rows.filter(r=>label(r.text)==='review'),true);list($('others'),snapshot.rows.filter(r=>label(r.text)==='other'),true);list($('unverified'),snapshot.unverified.filter(r=>label(r.text)!=='other'),false);counts();}
async function ledgerUI(){if(!snapshot)return;const k=logKey(snapshot.account),r=(await chrome.storage.local.get(k))[k]?.records||{};const all=Object.values(r);$('status-ledger').textContent='本机删除记录：已确认 '+all.filter(v=>v.status==='deleted').length+' 条，结果待核对 '+all.filter(v=>v.status!=='deleted').length+' 条。';}
function exportJSON(){if(!snapshot)return;const url=URL.createObjectURL(new Blob([JSON.stringify({account:snapshot.account,at:snapshot.at,coverage:snapshot.coverage,candidates:snapshot.rows.filter(r=>label(r.text)!=='other'||selected.has(r.id)).map(r=>({...r,selected:selected.has(r.id)})),unverified:snapshot.unverified.filter(r=>label(r.text)!=='other'),result:lastReport},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='删帖清单-'+snapshot.account.slice(1)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
$('export-plan').onclick=exportJSON;
$('scan').onclick=async()=>{if(busy)return;controls(true);snapshot=null;selected.clear();plan=null;for(const id of ['matched','review','others','unverified','summary','progress'])$(id).replaceChildren();controller=new AbortController();
 try{say('正在核对登录账号…');const id=await ownTab(),account=await actor(id,controller.signal);await chrome.tabs.update(id,{url:'https://x.com'+account,active:true});let ready=false;for(let i=0;i<80;i++){if(controller.signal.aborted)throw Error('已停止');try{ready=(await chrome.scripting.executeScript({target:{tabId:id},func:a=>location.pathname.toLowerCase()===a&&globalThis.XAssistantDeletionDOM?.account()===a,args:[account]}))[0]?.result;}catch{}if(ready)break;await pause(200);}if(!ready)throw Error('资料页未加载，请重新扫描');say('正在读取 @'+account.slice(1)+' 的资料页…');
 const result=await scanOwnTimeline({tabId:id,account,signal:controller.signal,onProgress:v=>{$('progress').textContent='扫描中：已核实 '+v.verified+' 条，待核实 '+v.unverified+' 条。';}});
 snapshot={account,at:Date.now(),...result};await chrome.storage.local.set({[PREVIEW]:snapshot});render(true);await ledgerUI();say('扫描结束。请核对清单；此步骤没有删除任何帖子。');$('progress').textContent=result.coverage;
 }catch(e){say(e.message);}finally{controller=null;controls(false);try{const tab=worker!==null&&await chrome.tabs.get(worker);if(tab?.active&&panelTab?.id)await chrome.tabs.update(panelTab.id,{active:true});}catch{}}};
$('tagged').onchange=()=>{if(!snapshot)return;for(const r of snapshot.rows)if(label(r.text)==='tag'){if($('tagged').checked)selected.add(r.id);else selected.delete(r.id);}render();};
$('verify-links').onclick=async()=>{if(busy||!snapshot){say('请先扫描一次本人资料页。');return;}const urls=$('own-links').value.trim().split(/\s+/).filter(Boolean);if(!urls.length)return;
 controls(true);controller=new AbortController();try{say('只读核验补充链接，不会删除。');const before=snapshot;
 const check=await verifyOwnLinks({account:before.account,urls,signal:controller.signal,onProgress:q=>{$('progress').textContent='已核验 '+q.done+'/'+q.total+'，已识别原创 '+q.verified+'。';}});
 const rows=new Map(before.rows.map(r=>[r.id,r])),unverified=new Map(before.unverified.map(r=>[r.id,r]));for(const row of check.rows){rows.set(row.id,row);unverified.delete(row.id);}for(const row of check.unverified)if(!rows.has(row.id))unverified.set(row.id,{...row,text:unverified.get(row.id)?.text||row.text||''});
 snapshot={...before,rows:[...rows.values()],unverified:[...unverified.values()],at:Date.now(),coverage:before.coverage.split('；链接补查')[0]+'；链接补查：'+check.coverage};await chrome.storage.local.set({[PREVIEW]:snapshot});render(true);say('补查结束。请核对更新后的固定清单；未删除任何内容。');$('own-links').value='';
 }catch(e){say(e.message);}finally{controller=null;controls(false);}};
$('stop').onclick=()=>controller?.abort();
$('prepare').onclick=async()=>{if(busy||!snapshot||!selected.size)return;try{await activeOff();const posts=snapshot.rows.filter(r=>selected.has(r.id)).map(({id,text})=>({id,text}));if(!posts.length)throw Error('没有可删除的已核实帖子');
 plan={id:crypto.randomUUID(),account:snapshot.account,posts};$('confirm-summary').textContent='永久删除 @'+plan.account.slice(1)+' 的 '+posts.length+' 条已勾选原创；不能撤销。请输入 @'+plan.account.slice(1)+' 以确认这份固定清单。';$('confirm-account').value='';$('approve').disabled=true;$('confirm-dialog').showModal();
 }catch(e){say(e.message);}};
$('confirm-account').oninput=()=>{$('approve').disabled=!plan||$('confirm-account').value.trim().toLowerCase()!=='@'+plan.account.slice(1);};
$('cancel-confirm').onclick=()=>{plan=null;$('confirm-dialog').close();};
$('approve').onclick=async e=>{e.preventDefault();if(busy||!plan)return;const fixed=plan;if($('confirm-account').value.trim().toLowerCase()!=='@'+fixed.account.slice(1)){say('请输入清单所属的完整 @账号');return;}plan=null;$('confirm-dialog').close();controls(true);controller=new AbortController();let written=0;
 try{await activeOff();const tabId=await ownTab();if(await actor(tabId,controller.signal)!==fixed.account)throw Error('账号有变化，请重新扫描');const assertLive=async()=>{if(controller?.signal.aborted||!controller)throw Error('已停止');await activeOff();};
 bridge=createDeletionBridge({tabId,account:fixed.account,assertLive});say('正在按已确认清单删除；请保持此管理页打开。');const k=logKey(fixed.account);
 lastReport=await runDeletionPlan({plan:fixed,confirmedPlanId:fixed.id,signal:controller.signal,adapter:{...bridge,readLedger:async()=>(await chrome.storage.local.get(k))[k],writeLedger:async(_a,v)=>{await chrome.storage.local.set({[k]:v});written=Object.values(v.records).filter(r=>r.planId===fixed.id&&r.status==='deleted').length;$('progress').textContent='已确认删除 '+written+' / '+fixed.posts.length+' 条。';}}});
 await chrome.storage.local.set({sacredDeletionLastRun:{account:fixed.account,planId:fixed.id,at:Date.now(),...lastReport}});say((lastReport.stopped?'已停止':'已结束')+'：本次确认删除 '+lastReport.deleted+' 条，跳过 '+lastReport.skipped+' 条，结果未知 '+lastReport.unknown+' 条。'+(lastReport.reason?' 原因：'+lastReport.reason:''));
 }catch(e){say('已停止：'+e.message);}finally{bridge?.close();bridge=null;controller=null;controls(false);await ledgerUI();}};
window.addEventListener('pagehide',()=>{controller?.abort();bridge?.close();},{once:true});
controls(false);const prev=(await chrome.storage.local.get(PREVIEW))[PREVIEW];if(prev&&VALID.test(prev.account)&&Array.isArray(prev.rows)&&Array.isArray(prev.unverified)){snapshot=prev;render(true);await ledgerUI();say('显示上次预览，不会自动删除。');}else say('先扫描本人原创帖；扫描不会删除内容。');
