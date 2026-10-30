import {readProfileReview} from './profile-review.mjs';
import {locateAuthorFollow} from './follow.mjs';
import {fillReplyDraft} from './draft.mjs';
import {submitCurrentReply,likeOriginalPost,followAuthorOnProfile} from './actions.mjs';
import {newSingleLedger,transitionSingle,recoverSingle} from './single-ledger.mjs';
import {postURL} from './review.mjs';
import builtinLibrary from './builtin-library.mjs';
import {validateRows, interval, pick} from './core.mjs';
const KEY='app', ALARM='x-assistant-loop';
let queue=Promise.resolve();
const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
const initial=()=>({rows:[],config:{min:90,max:150,type:'reply'},running:false,generation:0,bag:[],last:null,nextAt:null,tabId:null,logs:[],current:null});
const applyReplySuffix=s=>{
  if(s.replySuffixV2Applied)return 0;
  let changed=0;
  for(const row of s.rows)if(row.type==='reply'&&!/(?:^|\n)尽快回关\s*$/.test(row.text)){
    row.text=row.text.replace(/\s+$/,'')+'\n尽快回关';changed++;
  }
  s.replySuffixV2Applied=true;return changed;
};
async function get(){return (await chrome.storage.local.get(KEY))[KEY] || initial();}
async function save(s){await chrome.storage.local.set({[KEY]:s});}
function log(s,message){s.logs.unshift({time:new Date().toISOString(),message});s.logs=s.logs.slice(0,100);}
async function schedule(s){s.nextAt=Date.now()+interval(s.config);await save(s);await chrome.alarms.create(ALARM,{when:s.nextAt});}
async function probe(tabId,type){
  const tab=await chrome.tabs.get(tabId);
  if(!/^https:\/\/x\.com\//.test(tab.url||'')) throw Error('授权标签页已离开 X，请重新在 X 页点击扩展图标');
  await chrome.scripting.executeScript({target:{tabId},files:['locator.js']});
  return chrome.tabs.sendMessage(tabId,{kind:'LOCATE',type});
}
async function resolveHome(sender){
  const tabs=await chrome.tabs.query({url:'https://x.com/*',windowId:sender.tab.windowId});
  const homes=tabs.filter(t=>{try{const u=new URL(t.url);return u.origin==='https://x.com'&&u.pathname==='/home';}catch{return false;}});
  const active=homes.filter(t=>t.active);
  if(active.length===1)return active[0].id;
  if(homes.length===1)return homes[0].id;
  if(!homes.length)throw Error('当前窗口未找到 X 主页，请打开 x.com/home');
  throw Error('当前窗口有多个 X 主页，请只保留一个主页后重试');
}
async function readyTab(s,key,url,windowId){
 let tab=null;
 if(s[key])try{tab=await chrome.tabs.get(s[key]);}catch{}
 if(tab)tab=await chrome.tabs.update(tab.id,{url,active:true});
 else tab=await chrome.tabs.create({url,active:true,windowId});
 s[key]=tab.id;
 for(let i=0;i<120;i++){
  const current=await chrome.tabs.get(tab.id);
  if(current.status==='complete'&&current.url&&new URL(current.url).pathname===new URL(url).pathname)return tab.id;
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('目标页面加载超时');
}
async function copyToClipboard(text){
 if(typeof text!=='string'||!text.trim()||text.length>10000)throw Error('复制文本为空或过长');
 const url=chrome.runtime.getURL('offscreen.html');
 const contexts=chrome.runtime.getContexts?await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]}):[];
 if(!contexts.length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['CLIPBOARD'],justification:'将用户选择的评价文案复制到剪贴板并粘贴到 X 回复输入框'});
 const result=await chrome.runtime.sendMessage({kind:'OFFSCREEN_COPY',text});
 if(!result?.ok)throw Error(result?.error||'剪贴板写入失败');
 return result;
}
chrome.action.onClicked.addListener(tab=>{
  serial(async()=>{const s=await get(); if(s.running) throw Error('请先结束当前循环，再绑定其他标签页');s.tabId=/^https:\/\/x\.com\//.test(tab.url||'')?tab.id:null;await save(s);}).finally(()=>chrome.runtime.openOptionsPage()).catch(()=>{});
});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(msg.kind==='OPEN_PANEL'&&sender.tab&&/^https:\/\/x\.com\//.test(sender.url||'')&&['library','following','logs'].includes(msg.section)){chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'#'+msg.section}).then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
  if(msg.kind==='COPY_TEXT'&&/^https:\/\/x\.com\//.test(sender.url||'')){
    copyToClipboard(msg.text).then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if((sender.url||'').split('#')[0]!==chrome.runtime.getURL('panel.html')) return;
  serial(async()=>{
    const s=await get();
    if(msg.kind==='GET') return s;
    if(msg.kind==='TIMELINE') {
      if(s.running)throw Error('请先结束验证循环再选帖');
      s.tabId=await resolveHome(sender);
      const tab=await chrome.tabs.get(s.tabId);
      if(new URL(tab.url||'about:blank').origin!=='https://x.com')throw Error('绑定页面已离开 X');
      const results=await chrome.scripting.executeScript({target:{tabId:s.tabId},files:['timeline.js']});
      const result=results[0]?.result;
      if(!result?.ok)throw Error(result?.message||'未读取到主页，请重新授权后重试');
      s.selectionTabId=s.tabId;log(s,result.message);await save(s);return {...s,timeline:result};
    }
    if(msg.kind==='FILL_DRAFT') {
      if(s.running)throw Error('请先结束验证循环');
      if(s.selectionTabId===undefined||s.selectionTabId!==s.tabId)throw Error('请先自动选帖');
      const url=postURL(msg.url);
      if(typeof msg.text!=='string'||!msg.text.trim()||msg.text.length>10000)throw Error('草稿为空或过长');
      await chrome.tabs.update(s.tabId,{active:true});
      const results=await chrome.scripting.executeScript({target:{tabId:s.tabId},func:fillReplyDraft,args:[url,msg.text]});
      const result=results[0]?.result;
      if(!result?.message)throw Error(result?.error||'未收到草稿回读结果，请检查 X 弹窗，勿重复填入');
      s.lastDraft={url,tabId:s.tabId};log(s,result.message);await save(s);return {...s,draft:result};
    }
    if(msg.kind==='OPEN_ORIGINAL'||msg.kind==='LOCATE_FOLLOW') {
      if(s.running)throw Error('请先结束验证循环');
      if(!s.lastDraft)throw Error('请先成功填入一条草稿');
      const {url,tabId}=s.lastDraft;
      if(msg.kind==='OPEN_ORIGINAL') {
        const checks=await chrome.scripting.executeScript({target:{tabId},func:()=>({dialog:!!document.querySelector('[role="dialog"]')})});
        if(!checks[0]?.result||checks[0].result.dialog)throw Error('请先发送或处理回复弹窗，避免丢失草稿');
        await chrome.tabs.update(tabId,{url,active:true});
        log(s,'已请求打开原帖；这不代表回复发送成功');await save(s);return s;
      }
      const results=await chrome.scripting.executeScript({target:{tabId},func:locateAuthorFollow,args:[url]});
      const result=results[0]?.result;if(!result?.message)throw Error(result?.error||'未取得定位结果');
      log(s,result.message);await save(s);return {...s,follow:result};
    }
    if(msg.kind==='PROFILE_OPEN') {
      if(s.running)throw Error('请先结束验证循环');
      const url=postURL(msg.url),author=new URL(url).pathname.split('/')[1];
      const tab=await chrome.tabs.create({url:'https://x.com/'+author,active:true,windowId:sender.tab.windowId});
      s.reviewProfile={author,tabId:tab.id,postUrl:url};log(s,'已打开作者主页，未执行互动');await save(s);return s;
    }
    if(msg.kind==='PROFILE_READ') {
      if(s.running)throw Error('请先结束验证循环');
      if(!s.reviewProfile)throw Error('请先打开所选作者主页');
      const {tabId,author}=s.reviewProfile;
      const r=await chrome.scripting.executeScript({target:{tabId},func:readProfileReview,args:[author]});
      const profile=r[0]?.result;if(!profile||profile.error)throw Error(profile?.error||'主页尚未加载完成');
      log(s,`作者 @${author}：${profile.status}；读取 ${profile.posts.length} 条，仅供审阅`);await save(s);return {...s,profile};
    }
    if(msg.kind==='EXECUTE_SINGLE') {
      if(s.running)throw Error('请先结束验证循环');
      if(!['reply','like','follow'].includes(msg.action))throw Error('动作无效');
      const url=postURL(msg.url),text=typeof msg.text==='string'?msg.text.trim():'';
      if(!text)throw Error('回复文案为空');
      let ledger=s.singleLedger;
      if(!ledger||ledger.url!==url||ledger.reply!==text)ledger=newSingleLedger({url,reply:text});
      else ledger=recoverSingle(ledger);
      const step=ledger.steps[msg.action];
      if(step==='verified'||step==='skipped'){
        const result={action:msg.action,status:step,message:'该动作已经完成或跳过，未重复执行'};
        s.singleLedger=ledger;s.singleAction=result;await save(s);return s;
      }
      if(step==='unknown'){
        if(msg.action==='reply')throw Error('上次回复结果未知，为避免重复发布已锁定；请先人工核查');
        let check;
        if(msg.action==='like'){
          const tabId=await readyTab(s,'singlePostTabId',url,sender.tab.windowId);
          const r=await chrome.scripting.executeScript({target:{tabId},func:likeOriginalPost,args:[url,false]});check=r[0]?.result;
        }else{
          const author=new URL(url).pathname.split('/')[1],profileUrl='https://x.com/'+author;
          const tabId=await readyTab(s,'singleProfileTabId',profileUrl,sender.tab.windowId);
          const r=await chrome.scripting.executeScript({target:{tabId},func:followAuthorOnProfile,args:[author,false]});check=r[0]?.result;
        }
        if(check?.status==='skipped')ledger=transitionSingle(ledger,msg.action,'verified');
        else if(check?.status==='pending')ledger=transitionSingle(ledger,msg.action,'pending');
        else throw Error(check?.message||'无法重新核查上次动作状态');
        s.singleLedger=ledger;await save(s);
        if(ledger.steps[msg.action]==='verified'){
          const result={action:msg.action,status:'verified',message:'重新核查确认动作已经完成，未重复点击'};
          s.singleAction=result;await save(s);return s;
        }
      }
      if(msg.action==='reply'&&(!s.lastDraft||s.lastDraft.url!==url))throw Error('请先为当前帖子填入并审阅回复草稿');
      ledger=transitionSingle(ledger,msg.action,'in_flight');s.singleLedger=ledger;await save(s);
      let result;
      try{
        if(msg.action==='reply'){
          const r=await chrome.scripting.executeScript({target:{tabId:s.lastDraft.tabId},func:submitCurrentReply,args:[url,text]});
          result=r[0]?.result;
        }else if(msg.action==='like'){
          const tabId=await readyTab(s,'singlePostTabId',url,sender.tab.windowId);
          const r=await chrome.scripting.executeScript({target:{tabId},func:likeOriginalPost,args:[url]});result=r[0]?.result;
        }else{
          const author=new URL(url).pathname.split('/')[1],profileUrl='https://x.com/'+author;
          const tabId=await readyTab(s,'singleProfileTabId',profileUrl,sender.tab.windowId);
          const r=await chrome.scripting.executeScript({target:{tabId},func:followAuthorOnProfile,args:[author]});result=r[0]?.result;
        }
      }catch(e){result={status:'unknown',clicked:true,message:e.message};}
      if(!result?.status)result={status:'unknown',clicked:true,message:'未收到动作回读结果'};
      if(result.status==='failed')ledger=transitionSingle(ledger,msg.action,'pending');
      else if(result.status==='verified')ledger=transitionSingle(ledger,msg.action,'verified');
      else if(result.status==='skipped')ledger=transitionSingle(ledger,msg.action,'skipped');
      else ledger=transitionSingle(ledger,msg.action,'unknown');
      s.singleLedger=ledger;s.singleAction={action:msg.action,status:result.status,message:result.message};
      log(s,`单帖${msg.action}：${result.message}`);await save(s);
      if(result.status==='failed')throw Error(result.message);
      return s;
    }
    if(msg.kind==='ROWS') {s.rows=validateRows(msg.rows);s.bag=[];s.current=null;log(s,'文案库已更新');await save(s);return s;}
    if(msg.kind==='CONFIG') {if(s.running)throw Error('请先结束循环再修改参数');interval(msg.config);if(!['post','reply'].includes(msg.config.type))throw Error('类型无效');s.config={min:Number(msg.config.min),max:Number(msg.config.max),type:msg.config.type};s.bag=[];await save(s);return s;}
    if(msg.kind==='START') {
      if(s.running)return s;
      if(s.tabId===null)throw Error('请先打开 X，在 X 标签页点击扩展图标绑定页面');
      if(!s.rows.some(r=>r.enabled && r.type===s.config.type))throw Error('当前类型文案库为空或全部停用，请先导入');
      const r=await probe(s.tabId,s.config.type);if(!r.ok)throw Error(r.message);
      s.running=true;s.generation++;log(s,'循环开始（验证模式，无公开动作）');await schedule(s);return s;
    }
    if(msg.kind==='STOP') {s.running=false;s.generation++;s.nextAt=null;await chrome.alarms.clear(ALARM);log(s,'已停止，待执行循环已取消');await save(s);return s;}
    if(msg.kind==='PROBE'){if(s.tabId===null)throw Error('请先在 X 页点击扩展图标');const r=await probe(s.tabId,s.config.type);log(s,r.message);await save(s);return {...s,probe:r};}
    throw Error('未知命令');
  }).then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{
  if(a.name!==ALARM)return;
  serial(async()=>{
    const s=await get();if(!s.running)return null;
    if(Date.now()<s.nextAt){await chrome.alarms.create(ALARM,{when:s.nextAt});return null;}
    if(Date.now()-s.nextAt>120000){log(s,'错过执行时间，跳过积压任务');await schedule(s);return null;}
    const chosen=pick(s.rows,s.config.type,s.bag,s.last);
    if(!chosen.row){s.running=false;s.nextAt=null;log(s,'文案库为空，已停止');await save(s);return null;}
    s.bag=chosen.bag;s.last=chosen.row.id;await save(s);
    return {generation:s.generation,tabId:s.tabId,type:s.config.type,row:chosen.row};
  }).then(async ticket=>{
    if(!ticket)return;
    let result;try{result=await probe(ticket.tabId,ticket.type);}catch(e){result={ok:false,message:e.message};}
    await serial(async()=>{
      const s=await get();if(!s.running || s.generation!==ticket.generation)return;
      s.current={text:ticket.row.text,id:ticket.row.id,result,at:new Date().toISOString()};
      log(s,`验证 ${ticket.row.id}：${result.message}；未填入、未点击、未发布`);
      if(!result.ok){s.running=false;s.nextAt=null;log(s,'定位异常，已安全停止');await save(s);}else await schedule(s);
    });
  }).catch(async e=>serial(async()=>{const s=await get();s.running=false;s.nextAt=null;log(s,`循环异常：${e.message}`);await save(s);}));
});
chrome.runtime.onStartup.addListener(()=>serial(async()=>{const s=await get();s.running=false;s.nextAt=null;s.generation++;await chrome.alarms.clear(ALARM);const changed=applyReplySuffix(s);log(s,changed?`回复文案已更新：${changed} 条追加“尽快回关”`:'浏览器重新启动，保持停止');await save(s);}));
chrome.runtime.onInstalled.addListener(()=>serial(async()=>{const s=await get();s.running=false;s.nextAt=null;s.generation++;await chrome.alarms.clear(ALARM);
  if (!s.builtinLibraryV1Loaded) {
    const existing=new Set(s.rows.map(row=>row.id));
    const added=validateRows(builtinLibrary).filter(row=>!existing.has(row.id));
    s.rows.push(...added);s.builtinLibraryV1Loaded=true;
    log(s,`内置文案库已集成：新增 ${added.length} 条；同 ID 用户文案未覆盖`);
  }
  const changed=applyReplySuffix(s);if(changed)log(s,`回复文案已更新：${changed} 条追加“尽快回关”`);
  await save(s);
}));
