import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../workspace.js',import.meta.url),'utf8');
function fixture(){
 let callback,disconnected=false,writes=0,title='主页 / X';
 const document={head:{},get title(){return title;},set title(value){writes++;title=value;}};
 const ctx=vm.createContext({document,assignment:null,closed:false,MutationObserver:class{
  constructor(cb){callback=cb;}
  observe(node,opts){assert.equal(node,document.head);assert.equal(opts.characterData,true);}
  disconnect(){disconnected=true;}
 }});
 vm.runInContext(source.slice(source.indexOf(' const workerLabels='),source.indexOf(' const state='))+';this.update=updateWorkerTitle;',ctx);
 return {ctx,document,set:module=>{ctx.assignment=module?{module}:null;ctx.update();},mutate:value=>{title=value;callback?.();},notify:()=>callback?.(),writes:()=>writes,disconnected:()=>disconnected};
}
test('only assigned posting interaction and notification tabs receive short exact labels',()=>{
 for(const [module,label] of [['posting','发帖'],['interaction','互动'],['notifications','回帖']]){
  const f=fixture();f.set(module);assert.equal(f.document.title,label);
 }
 for(const module of [null,'followback','other']){const f=fixture();f.set(module);assert.equal(f.document.title,'主页 / X');assert.equal(f.writes(),0);}
});
test('SPA title updates and unread counts cannot replace the module label or trigger a write loop',()=>{
 const f=fixture();f.set('posting');f.mutate('(6) 帖子 / X');assert.equal(f.document.title,'发帖');
 const before=f.writes();f.notify();f.notify();assert.equal(f.writes(),before);
 f.set('interaction');assert.equal(f.document.title,'互动');
});
test('unassignment or invalidated document disconnects the observer and restores the last site title',()=>{
 for(const closed of [false,true]){
  const f=fixture();f.set('posting');f.mutate('帖子详情 / X');
  if(closed){f.ctx.closed=true;f.ctx.update();}else f.set(null);
  assert.equal(f.disconnected(),true);assert.equal(f.document.title,'帖子详情 / X');
  f.mutate('新的页面 / X');assert.equal(f.document.title,'新的页面 / X');
 }
});
test('site title changed just before unassignment is not overwritten by a stale saved title',()=>{
 const f=fixture();f.set('notifications');f.document.title='用户的新页面 / X';f.set(null);assert.equal(f.document.title,'用户的新页面 / X');
});
test('title binding runs on workspace assignment and lifecycle transitions without creating tabs',()=>{
 assert.match(source,/function setTimers\(\)\{\s*updateWorkerTitle\(\)/);
 const code=source.slice(source.indexOf(' const workerLabels='),source.indexOf(' const state='));
 assert.doesNotMatch(code,/tabs\.create|location\.|setInterval|fetch\(/);
});
