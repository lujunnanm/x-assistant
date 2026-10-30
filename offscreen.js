chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
 if(msg?.kind!=='OFFSCREEN_COPY')return;
 try{
  const input=document.createElement('textarea');input.value=msg.text;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';
  document.body.append(input);input.focus();input.select();const ok=document.execCommand('copy');input.remove();
  respond(ok?{ok:true}:{ok:false,error:'浏览器拒绝复制命令'});
 }catch(e){respond({ok:false,error:e.message});}
});
