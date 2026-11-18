// Session-only presentation for already loaded legacy views. Not a manifest entry.
// Leave their original span/aria-label untouched so their observer never fights ours.
(()=>{
 const key=Symbol.for('sacred.countdownDisplay707');
 if(globalThis[key]||!['7.0.5','7.0.6'].includes(chrome.runtime.getManifest().version))return;
 globalThis[key]=true;
 const bind=()=>{
  const timers=document.querySelectorAll('#x-assistant-float section .countdown');
  if(timers.length<3)return false;
  for(const timer of timers){
   const raw=timer.querySelector('span');if(!raw)continue;
   const out=document.createElement('span'),spoken=document.createElement('i');
   spoken.hidden=true;spoken.id='sacred-countdown-'+crypto.randomUUID();out.dataset.wholeSeconds='';
   raw.hidden=true;timer.append(out,spoken);timer.setAttribute('aria-labelledby',spoken.id);
   const update=()=>{
    const m=/^剩余 (\d+(?:\.\d+)?) 秒$/.exec(timer.getAttribute('aria-label')||'');
    const n=m?Math.ceil(Number(m[1])):null;
    const text=n===null?'—':n>=60?Math.floor(n/60)+':'+String(n%60).padStart(2,'0'):String(n);
    const label=n===null?'暂无倒计时':'剩余 '+n+' 秒';
    if(out.textContent!==text)out.textContent=text;
    if(spoken.textContent!==label)spoken.textContent=label;
   };
   new MutationObserver(update).observe(timer,{attributes:true,attributeFilter:['aria-label']});update();
  }
  return true;
 };
 if(!bind()){
  const mounted=new MutationObserver(()=>{if(bind()){mounted.disconnect();clearTimeout(limit);}});
  const limit=setTimeout(()=>mounted.disconnect(),15000);
  mounted.observe(document.documentElement,{childList:true,subtree:true});
 }
})();
