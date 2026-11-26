import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../view.js',import.meta.url),'utf8');
const now=1780000000000;
function mount(module,seconds,fromStatus){
 const label={textContent:''},status={textContent:fromStatus&&seconds!==null?'下一条 · '+seconds+' 秒':''};
 const lamp={dataset:{state:'on'},setAttribute(){}};
 const section={dataset:{module,...(!fromStatus&&seconds!==null?{nextAt:String(now+seconds*1000)}:{})},
  insertBefore(){},querySelector:s=>s==='.state-lamp'?lamp:status};
 const root={dataset:{workspace:'managed'},querySelectorAll:s=>s==='section'?[section]:[]};
 const timer={querySelector:()=>label,setAttribute(k,v){this[k]=v;}};
 const document={getElementById:()=>null,createElement:t=>t==='aside'?root:timer,documentElement:{append(){}}};
 vm.runInNewContext(source,{document,window:{addEventListener(){}},chrome:{runtime:{getURL:x=>x,getManifest:()=>({version:'test'})}},
  MutationObserver:class{observe(){}},Date:{now:()=>now},setInterval(){},clearInterval(){}});
 return [label.textContent,timer['aria-label']];
}

for(const module of ['posting','interaction','notifications']){
 test(module+' countdown rounds the display up to whole seconds, including minute boundaries and screen readers',()=>{
  for(const [input,visual,spoken] of [
   [19.7,'20',20],[0.3,'1',1],[59.1,'1:00',60],[60,'1:00',60],[61.2,'1:02',62],[0,'0',0],[null,'—',null]
  ])for(const fromStatus of [false,true]){
   assert.deepEqual(mount(module,input,fromStatus),[visual,spoken===null?'暂无倒计时':'剩余 '+spoken+' 秒'],
    'input '+input+', '+(fromStatus?'status text':'deadline'));
  }
 });
}
