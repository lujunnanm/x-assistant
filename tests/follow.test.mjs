import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {locateAuthorFollow} from '../follow.mjs';
function run(labels){
 const buttons=labels.map(label=>({style:{},getAttribute:k=>k==='aria-label'?label:null,scrollIntoView(){},click(){throw Error('must not click');}}));
 const article={querySelectorAll:s=>s==='button'?buttons:[{href:'https://x.com/author/status/1',querySelector:()=>({})}]};
 return vm.runInNewContext(`(${locateAuthorFollow})('https://x.com/author/status/1')`,{URL,location:{origin:'https://x.com',pathname:'/author/status/1'},setTimeout:()=>{},document:{querySelector:()=>null,querySelectorAll:()=>[article]}});
}
test('marks only exact author and never clicks',()=>{assert.match(run(['关注 @author']).message,/绿框/);});
test('already followed is skipped and unrelated controls ignored',()=>{
 assert.match(run(['取消关注 @author']).message,/已关注/);
 assert.match(run(['正在关注 @author']).message,/已关注/);
 assert.match(run(['Following @author']).message,/已关注/);
 assert.match(run(['关注 @someone_else']).message,/未找到/);
 assert.match(run(['关注 @author','关注 @author']).message,/未找到/);
});
