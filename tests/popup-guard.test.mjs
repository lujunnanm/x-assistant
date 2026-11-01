import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../popup-guard.js',import.meta.url),'utf8');
function fixture(mode){
 let dialogs=[],clicked=[];
 const button=(text,fn)=>({textContent:text,getAttribute:()=>null,click:()=>{clicked.push(text);fn();}});
 const dialog=(text,buttons,close=null)=>({textContent:text,querySelector:s=>s.includes('app-bar-close')?close:null,querySelectorAll:()=>buttons});
 if(mode==='close') {const b=button('关闭',()=>dialogs=[]);dialogs=[dialog('提示',[b],b)];}
 if(mode==='draft') {const drop=button('舍弃',()=>dialogs=[]),d=dialog('保存草稿？',[drop]);const close=button('关闭',()=>dialogs=[d]);dialogs=[dialog('未发送文字',[close],close)];}
 if(mode==='challenge')dialogs=[dialog('请验证身份',[button('确认',()=>dialogs=[])])];
 const ctx=vm.createContext({document:{querySelectorAll:()=>dialogs},setTimeout:f=>setTimeout(f,0)});vm.runInContext(source,ctx);return{cancel:ctx.XAssistantPopup.cancel,clicked};
}
test('ordinary cancellable modal is closed',async()=>{const f=fixture('close');assert.equal(await f.cancel(),true);assert.deepEqual(f.clicked,['关闭']);});
test('unsent draft close then discard confirmation is handled',async()=>{const f=fixture('draft');assert.equal(await f.cancel(),true);assert.deepEqual(f.clicked,['关闭','舍弃']);});
test('unknown verification dialog is never confirmed',async()=>{const f=fixture('challenge');assert.equal(await f.cancel(),false);assert.deepEqual(f.clicked,[]);});
test('no popup is a safe no-op',async()=>{assert.equal(await fixture('none').cancel(),true);});
for(const [title,label] of [['保存帖子？','放弃'],['保存帖子以供稍后使用？','舍弃草稿'],['Save post?','Discard'],['Save this post for later?','Don’t save'],['Save draft?','Discard draft']]){
 test(`save prompt ${title} chooses ${label}, not Save or Cancel`,async()=>{
  let present=true;const clicked=[];const b=text=>({textContent:text,getAttribute:()=>null,click:()=>{clicked.push(text);present=false;}});
  const buttons=[b('保存'),b('取消'),b(label)],d={textContent:title,querySelector:()=>null,querySelectorAll:()=>buttons};
  const ctx=vm.createContext({document:{querySelectorAll:()=>present?[d]:[]},setTimeout:f=>setTimeout(f,0)});vm.runInContext(source,ctx);
  assert.equal(await ctx.XAssistantPopup.cancel(),true);assert.deepEqual(clicked,[label]);
 });
}
test('unrecognized discard button never falls back to saving or cancelling a save prompt',async()=>{
 const d={textContent:'保存帖子？',querySelector:()=>null,querySelectorAll:()=>[{textContent:'取消',getAttribute:()=>null,click:()=>assert.fail('must not click Cancel')}]};
 const ctx=vm.createContext({document:{querySelectorAll:()=>[d]},setTimeout});vm.runInContext(source,ctx);assert.equal(await ctx.XAssistantPopup.cancel(),false);
});
test('save confirmation above a still-mounted composer takes priority',async()=>{
 let dialogs=[];const clicked=[];
 const composer={textContent:'草稿 正文',querySelector:()=>null,querySelectorAll:()=>[]};
 const drop={textContent:'放弃',getAttribute:()=>null,click:()=>{clicked.push('放弃');dialogs=[];}};
 const prompt={textContent:'保存帖子？你可以保存此内容，以便之后从草稿发布。保存 放弃',querySelector:()=>null,querySelectorAll:()=>[drop]};dialogs=[composer,prompt];
 const ctx=vm.createContext({document:{querySelectorAll:()=>dialogs},setTimeout:f=>setTimeout(f,0)});vm.runInContext(source,ctx);
 assert.equal(await ctx.XAssistantPopup.cancel(),true);assert.deepEqual(clicked,['放弃']);
});
