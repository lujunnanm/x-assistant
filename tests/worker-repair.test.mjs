import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareWorkerRepair} from '../worker-repair.mjs';
const tab={id:17,url:'https://x.com/home'};
function fixture({account='/me',draft=false,media=false,dialog=false,hidden=false,files=false,poll=false,url=tab.url}={}){
 let reads=0;
 globalThis.chrome={scripting:{executeScript:async({target,func})=>{
  reads++;assert.deepEqual(target,{tabId:17,frameIds:[0]});
  const element={textContent:'普通提示',hidden,getClientRects:()=>hidden?[]:[{}],closest:()=>null};
  const document={querySelector:s=>s.includes('AppTabBar_Profile_Link')?{getAttribute:()=>account}:
    s.includes('attachments')&&media||s.includes('pollCreator')&&poll||s.includes('role=')&&dialog?element:null,
   querySelectorAll:s=>s.includes('contenteditable')&&draft?[{...element,textContent:'未发送内容'}]:
    s.includes('input[type="file"]')&&files?[{...element,files:[{}]}]:
    s.includes('role=')&&dialog?[element]:[]};
  return [{result:vm.runInNewContext('('+func.toString()+')()',{document,location:{href:url},getComputedStyle:()=>({visibility:hidden?'hidden':'visible',display:hidden?'none':'block'})})}];
 }}};
 return ()=>reads;
}
test('clean original worker is read once without clearing or submitting anything',async()=>{
 const reads=fixture();await prepareWorkerRepair(tab,'/me');assert.equal(reads(),1);
});
test('text and media drafts remain untouched and block only the same-page repair',async()=>{
 for(const options of [{draft:true},{media:true}]){
  fixture(options);await assert.rejects(prepareWorkerRepair(tab,'/me'),e=>e.code==='RESIDUAL_DRAFT');
 }
});
test('account or URL changes cannot redirect an unrelated user page',async()=>{
 for(const options of [{account:'/other'},{url:'https://x.com/compose/post'}]){
  fixture(options);await assert.rejects(prepareWorkerRepair(tab,'/me'),/账号或页面/);
 }
});
test('external original page asks to return to X rather than creating a new tab',async()=>{
 const reads=fixture();await assert.rejects(prepareWorkerRepair({...tab,url:'https://example.com'},'/me'),/不会另开/);
 assert.equal(reads(),0);
});
test('non-composer dialogs are popup blockers, not fictitious drafts',async()=>{
 fixture({dialog:true});await assert.rejects(prepareWorkerRepair(tab,'/me'),e=>e.code==='RESIDUAL_POPUP'&&!e.message.includes('未发送草稿'));
});
test('hidden empty dialog shells do not permanently block the clean worker',async()=>{
 fixture({dialog:true,hidden:true});await prepareWorkerRepair(tab,'/me');
});
test('hidden text, selected files, photos and polls still protect real draft content',async()=>{
 for(const options of [{draft:true,hidden:true},{files:true},{media:true,hidden:true},{poll:true}]){
  fixture(options);await assert.rejects(prepareWorkerRepair(tab,'/me'),e=>e.code==='RESIDUAL_DRAFT');
 }
});
test('discarded and navigating pages must become ready before any preflight',async()=>{
 for(const change of [{discarded:true},{pendingUrl:'https://x.com/other'}]){
  const reads=fixture();await assert.rejects(prepareWorkerRepair({...tab,...change},'/me'),/切换或已挂起/);assert.equal(reads(),0);
 }
});
