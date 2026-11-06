import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {splitPostingPaste} from '../posting-copy.mjs';

const js=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../panel.html',import.meta.url),'utf8');
function setup(){
 const ids=new Map(),requests=[];
 class El{
  listeners=new Map();children=[];dataset={};textContent='';open=false;value='';
  addEventListener(k,fn){const a=this.listeners.get(k)||[];a.push(fn);this.listeners.set(k,a);}
  removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(x=>x!==fn));}
  fire(k,event={}){for(const fn of [...this.listeners.get(k)||[]])fn(event);}
  append(...xs){this.children.push(...xs);}
  replaceChildren(...xs){this.children=xs;}
  setAttribute(){} removeAttribute(){} reset(){this.value='';} scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  focus(){this.focused=true;}
 }
 const element=id=>{if(!ids.has(id))ids.set(id,new El());return ids.get(id);};
 const window=new El(),document={hidden:false,hasFocus:()=>true,getElementById:element,querySelector:element,createElement:()=>new El()};
 const data={rows:[{id:'old',enabled:true,text:'before'}],revision:4};
 const runtime={sendMessage:async m=>{requests.push(m);return {ok:true,state:data};}};
 let serial=0;
 const scope=vm.createContext({window,document,chrome:{runtime},structuredClone,splitPostingPaste,crypto:{randomUUID:()=> 'generated-'+ ++serial}});
 const setupJs=js.slice(js.indexOf('const $='),js.indexOf('chrome.storage.onChanged.addListener((changes,area)=>{'));
 vm.runInContext(setupJs,scope);
 scope.renderCopies(data);return {element,scope,document,requests,window,data};
}
test('settings open a non-blocking page dialog with Cancel as default; cancel, close and pagehide never approve',async()=>{
 assert.match(html,/<dialog id="library-confirm"/);
 assert.match(html,/<button[^>]+id="library-confirm-cancel"[^>]+autofocus/);
 const f=setup(),dialog=f.element('library-confirm'),cancel=f.element('library-confirm-cancel');
 for(const leave of [()=>cancel.fire('click'),()=>dialog.close(),()=>f.window.fire('pagehide')]){
  const pending=f.scope.confirmLibraryChange('将删除','删除');
  assert.equal(dialog.open,true);assert.equal(cancel.focused,true);
  assert.equal(await f.scope.confirmLibraryChange('不可替换已有提示','删除'),false);
  leave();assert.equal(await pending,false);
 }
 assert.equal(f.requests.length,0);
});
test('posting-copy deletion requires foreground trusted consent and carries CAS revision',async()=>{
 const f=setup(),bar=f.element('rows').children[0].children.at(-1),deleteButton=bar.children.at(-1);
 const pending=deleteButton.onclick({type:'click'}),accept=f.element('library-confirm-accept'),dialog=f.element('library-confirm');
 f.document.hidden=true;accept.fire('click',{isTrusted:true});f.document.hidden=false;
 f.document.hasFocus=()=>false;accept.fire('click',{isTrusted:true});f.document.hasFocus=()=>true;
 accept.fire('click',{isTrusted:false});
 assert.equal(dialog.open,true);assert.equal(f.requests.length,0);
 accept.fire('click',{isTrusted:true});accept.fire('click',{isTrusted:true});await pending;
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].kind,'POST_COPIES_OP');
 assert.equal(f.requests[0].op.action,'delete');
 assert.equal(f.requests[0].op.expected.id,'old');
 assert.equal(f.requests[0].op.expectedRevision,4);
});
test('clear confirmation retains original revision and cancellation writes nothing',async()=>{
 const f=setup(),button=f.element('clear'),dialog=f.element('library-confirm');
 const pick=async()=>{const pending=button.onclick({type:'click'});await new Promise(resolve=>setImmediate(resolve));assert.equal(dialog.open,true);return {pending};};
 let {pending}=await pick();dialog.close();await pending;assert.equal(f.requests.length,0);
 ({pending}=await pick());f.scope.renderCopies({...f.data,revision:5,rows:[...f.data.rows,{id:'new',text:'fresh',enabled:true}]});
 assert.match(f.element('library-confirm-description').textContent,/当前 1 条/);
 f.element('library-confirm-accept').fire('click',{isTrusted:true});await pending;
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].op.action,'clear');
 assert.equal(f.requests[0].op.expectedRevision,4);
});
test('single-item editor preserves pasted body and batch mode retains multiline posts',async()=>{
 const f=setup();
 f.element('text').value='  原文\n第二行  ';
 await f.element('editor').onsubmit({type:'submit',preventDefault(){}});
 assert.equal(f.requests[0].op.row.text,'  原文\n第二行  ');
 assert.equal(f.requests[0].op.expectedRevision,4);
 f.element('bulk-mode').value='separator';
 f.element('bulk-text').value='第一条\n内容\n---\n第二条\n内容';
 await f.element('bulk-add').onclick({type:'click'});
 assert.equal(f.requests[1].op.action,'replace');
 assert.deepEqual(Array.from(f.requests[1].op.rows.slice(-2),r=>r.text),['第一条\n内容','第二条\n内容']);
});
