// Injected, read-only collector. The same storage schema is used by the overlay.
export async function collectFollowing(own,scanId){
 const SCAN='xAssistantFollowingScanV1',DB='xAssistantFollowedV1';let stable=0,seen=new Set(),previous='';
 const saveStatus=async(message,active=false)=>{const s=(await chrome.storage.local.get(SCAN))[SCAN];if(s?.scanId===scanId)await chrome.storage.local.set({[SCAN]:{...s,active,message,observed:seen.size}});};
 try{for(let page=0;page<180;page++){
  const scan=(await chrome.storage.local.get(SCAN))[SCAN];if(!scan?.active||scan.scanId!==scanId)return;
  if(location.pathname.toLowerCase()!==(own+'/following').toLowerCase())throw Error('页面已离开本人关注列表');
  const cells=[...document.querySelectorAll('[data-testid="UserCell"]')],found=[];
  for(const cell of cells){if(!cell.querySelector('[data-testid$="-unfollow"]'))continue;
   const handles=[...cell.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.href);return u.origin==='https://x.com'&&/^\/[A-Za-z0-9_]{1,15}$/.test(u.pathname)?u.pathname.slice(1):null;}catch{return null;}}).filter(Boolean);
   if(new Set(handles.map(h=>h.toLowerCase())).size!==1)continue;
   const author=handles[0],key=author.toLowerCase();seen.add(key);found.push({key,handle:'@'+author,displayName:cell.innerText.split('\n')[0],lastSeenAt:new Date().toISOString(),source:'following-list',owner:own.slice(1)});
  }
  // Merge into latest state so unrelated records are not replaced.
  const db=(await chrome.storage.local.get(DB))[DB]||{handles:{}};for(const row of found)db.handles[row.key]={...db.handles[row.key],...row};await chrome.storage.local.set({[DB]:db});
  await saveStatus(`正在读取：本次识别 ${seen.size} 个，第 ${page+1} 屏`,true);
  const fingerprint=[...seen].join(',')+'|'+document.documentElement.scrollHeight+'|'+Math.round(scrollY);
  stable=fingerprint===previous?stable+1:0;previous=fingerprint;
  if(stable>=6){await saveStatus(`读取结束：本次识别 ${seen.size} 个；页面连续无新增，未保证覆盖完整列表`);return;}
  window.scrollTo(0,document.documentElement.scrollHeight);await new Promise(r=>setTimeout(r,1200));
 }
 await saveStatus(`达到单次读取上限，本次 ${seen.size} 个；可再次读取补全`);
 }catch(e){await saveStatus('读取停止：'+e.message);}
}
