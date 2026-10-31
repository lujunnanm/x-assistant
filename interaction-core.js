(function(root){
 const pattern=['unfollowed','unfollowed','unfollowed','followed'];
 function desiredAuthorType(index){return pattern[((Number(index)||0)%pattern.length+pattern.length)%pattern.length];}
 function nextCycleIndex(index){return ((Number(index)||0)+1)%pattern.length;}
 function randomSeconds(min,max,randomValue){
  min=Math.ceil(Number(min)*100);max=Math.floor(Number(max)*100);if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min)throw Error('随机时间范围无效');
  const value=randomValue===undefined?crypto.getRandomValues(new Uint32Array(1))[0]/4294967296:Number(randomValue);
  if(!Number.isFinite(value)||value<0||value>=1)throw Error('随机值无效');
  return (min+Math.floor(value*(max-min+1)))/100;
 }
 function formatSeconds(seconds){return Number(seconds).toFixed(2);}
 function editorText(node){const blocks=node?.querySelectorAll?.('[data-contents="true"] > [data-block="true"]');const text=blocks?.length?[...blocks].map(block=>block.textContent||'').join('\n'):(node?.innerText??node?.textContent??'');return String(text).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/\n+$/,'');}
 function autoFollowEnabled(value){return value!==false;}
 function highExposure(views,minimum=5000){return Number.isFinite(views)&&views>minimum;}
 root.XAssistantCore={autoFollowEnabled,highExposure,pattern:[...pattern],desiredAuthorType,nextCycleIndex,randomSeconds,formatSeconds,editorText};
})(globalThis);
