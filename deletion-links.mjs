// Verify supplied own-post URLs in disposable tabs. Never discover, click, expand or delete.
const exact=/^https:\/\/x\.com\/([a-z0-9_]{1,15})\/status\/([1-9]\d{0,19})\/?$/i;
const canonical=url=>{const m=typeof url==='string'&&url.match(exact);return m?'https://x.com/'+m[1].toLowerCase()+'/status/'+m[2]:null;};
const blank=url=>!url||url==='about:blank'||url==='chrome://newtab/';
function probe(owner,id){
 const path=owner+'/status/'+id;
 if(location.origin!=='https://x.com'||location.pathname.replace(/\/$/,'').toLowerCase()!==path)return null;
 const api=globalThis.XAssistantDeletionDOM,account=api?.account();
 if(!account)return null;
 if(account!==owner)return {wrongAccount:true};
 const alerts=[...document.querySelectorAll('[data-testid="primaryColumn"] [role="alert"],[data-testid="primaryColumn"] [data-testid="emptyState"],[data-testid="error-detail"]')]
  .filter(n=>!n.closest('article')).map(n=>n.innerText||'').join('\n');
 if(/rate limit|too many requests|达到.{0,6}上限|超出.{0,4}上限|请求过于频繁|制限を超え/i.test(alerts))return {limited:true};
 if(/(?:this (?:post|tweet) (?:doesn.t exist|is unavailable|was deleted))|(?:此|这条|該則|這則)(?:帖子|推文|貼文).{0,8}(?:不存在|不可用|已删除|已刪除)|ポストは表示できません/i.test(alerts))return {unavailable:true};
 return {account,row:api.inspect({account:owner,id})};
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function checked(row,target,owner){
 return row?.id===target.id&&row.account===owner&&typeof row.author==='string'&&'/'+row.author.toLowerCase()===owner&&row.owned===true&&row.original===true&&row.isReply===false&&row.isQuote===false&&row.isRepost===false&&typeof row.text==='string'&&!!row.text.trim()&&canonical(row.url)===target.url&&row.path===owner+'/status/'+target.id;
}
export async function verifyOwnLinks({account,urls,signal,onProgress},env={}){
 if(typeof account!=='string'||!/^\/[a-z0-9_]{1,15}$/i.test(account)||!Array.isArray(urls))throw Error('需要账号和本人帖子链接数组');
 const owner=account.toLowerCase(),unique=new Map();
 for(const input of urls){
  const m=typeof input==='string'&&input.match(exact);
  if(!m||'/'+m[1].toLowerCase()!==owner)throw Error('仅接受本人精确的 https://x.com/账号/status/数字 链接');
  unique.set(m[2],{id:m[2],url:canonical(input)});
  if(unique.size>500)throw Error('每批最多核验 500 条不同的本人帖子链接');
 }
 const list=[...unique.values()],entries=Array(list.length),api=env.chrome||globalThis.chrome,now=env.now||Date.now,wait=env.wait||delay;
 const owned=new Map();let cursor=0,done=0,verified=0,stopped='';
 const stopReason=()=>signal?.aborted?'已取消核验':stopped;
 const record=(index,row,reason)=>{if(entries[index])return;entries[index]=row?{row}:{unverified:{...list[index],text:'',reason}};if(row)verified++;done++;onProgress?.({total:list.length,done,verified,unverified:done-verified});};
 const observe=(id,change)=>{const tab=owned.get(id);if(!tab||!change.url)return;if(!tab.allowed.has(canonical(change.url))&&!blank(change.url))tab.diverted=true;};
 const within=async(task,ms)=>{let timer;try{return await Promise.race([task,new Promise((_,rej)=>{timer=setTimeout(()=>rej(Error('标签页响应超时')),ms);})]);}finally{clearTimeout(timer);}};
 const tabState=async tab=>{
  try{const t=await within(api.tabs.get(tab.id),3500);
   if(!t||[t.url,t.pendingUrl].some(s=>!blank(s)&&!tab.allowed.has(canonical(s))))tab.diverted=true;
   return t;
  }catch{tab.diverted=true;return null;}
 };
 async function worker(){
  let tab=null;
  try{
   while(!stopReason()&&cursor<list.length){
    const i=cursor++,target=list[i];let reason='';
    try{
     if(!tab){const t=await api.tabs.create({url:target.url,active:false});if(!Number.isInteger(t?.id))throw Error('创建核验标签失败');
      tab={id:t.id,expected:target.url,allowed:new Set([target.url]),diverted:false};owned.set(tab.id,tab);
     }else{
      const old=await tabState(tab);
      if(tab.diverted||canonical(old?.url)!==tab.expected||old?.pendingUrl&&canonical(old.pendingUrl)!==tab.expected){tab.diverted=true;throw Error('核验标签已被切换，未接管该页面');}
      const prev=tab.expected;tab.expected=target.url;tab.allowed=new Set([prev,target.url]);await within(api.tabs.update(tab.id,{url:target.url}),5000);
     }
     const end=now()+16000;
     do{
      if(stopReason()){reason=stopReason();break;}
      const t=await tabState(tab);
      if(tab.diverted){reason='核验标签被移走或关闭';break;}
      if(canonical(t?.url)===target.url&&(!t.pendingUrl||canonical(t.pendingUrl)===target.url)){
       tab.allowed=new Set([target.url]);
       let injection;
       try{injection=await within(api.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:probe,args:[owner,target.id]}),4000);}
       catch(e){if(!/frame|cannot access|navigat|no tab/i.test(e?.message||''))throw e;}
       const result=injection?.length===1&&injection[0].frameId===0?injection[0].result:null;
       if(result?.wrongAccount||result?.limited){reason=stopped=result.wrongAccount?'登录账号不符，已停止核验':'X 提示访问上限，已停止核验';break;}
       if(result?.unavailable){reason='帖子不可访问或无法找到';break;}
       if(result?.account===owner&&checked(result.row,target,owner)){
        const final=await tabState(tab);
        if(!stopReason()&&!tab.diverted&&canonical(final?.url)===target.url&&(!final.pendingUrl||canonical(final.pendingUrl)===target.url))record(i,result.row);
        break;
       }
      }
      if(now()<end)await wait(250);
     }while(now()<end);
    }catch(e){reason=String(e?.message||e).slice(0,140);}
    if(!entries[i])record(i,null,reason||stopReason()||'本次未核实该帖身份、原创类型和完整正文');
    if(!tab||tab.diverted)break;
   }
  }finally{
   if(tab){
    const t=await tabState(tab);
    if(!tab.diverted&&canonical(t?.url)===tab.expected&&(!t.pendingUrl||canonical(t.pendingUrl)===tab.expected))await api.tabs.remove(tab.id).catch(()=>{});
    owned.delete(tab.id);
   }
  }
 }
 api?.tabs?.onUpdated?.addListener(observe);
 try{await Promise.all(Array.from({length:Math.min(3,list.length)},()=>worker()));}
 finally{api?.tabs?.onUpdated?.removeListener(observe);}
 for(let i=0;i<list.length;i++)if(!entries[i])record(i,null,stopReason()||'没有可继续使用的专用核验标签页');
 const rows=entries.flatMap(e=>e.row?[e.row]:[]),unverified=entries.flatMap(e=>e.unverified?[e.unverified]:[]);
 return {rows,unverified,complete:!unverified.length,coverage:'仅核验本批指定链接：共 '+list.length+' 条，已核实 '+rows.length+' 条，待查 '+unverified.length+' 条。'+(stopReason()||'')};
}
