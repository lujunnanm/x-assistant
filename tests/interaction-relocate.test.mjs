import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../overlay.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(' const relocatePost='),source.indexOf(' const followAuthor='));
function fixture(rows){
 let clicks=0;
 const context=vm.createContext({document:{querySelectorAll:()=>rows},postInfo:x=>x,normalized:x=>x.trim(),check:()=>{},clickNative:b=>{clicks++;b.click();},waitFor:async f=>f()});
 vm.runInContext(code+';globalThis.like=likePost;',context);
 return {like:context.like,clicks:()=>clicks};
}
function row(){let liked=false;return{id:'123',author:'Test',time:'now',text:'hello',article:{isConnected:true,querySelectorAll:s=>s.includes('"unlike"')?(liked?[{}]:[]):liked?[]:[{disabled:false,click:()=>liked=true}]}};}
test('replaces detached article with current matching post before liking',async()=>{const current=row(),old={...current,article:{isConnected:false}};const f=fixture([current]);assert.equal(await f.like(old,{}),'verified');assert.equal(f.clicks(),1);});
test('missing or changed target never clicks',async()=>{const target=row();for(const rows of [[],[{...row(),text:'changed'}],[row(),row()]]){const f=fixture(rows);await assert.rejects(f.like(target,{}),/目标帖子已更新/);assert.equal(f.clicks(),0);}});
test('already liked post is not toggled off',async()=>{const r=row(),f=fixture([r]);await f.like(r,{});assert.equal(await f.like(r,{}),'skipped');assert.equal(f.clicks(),1);});
test('generation outage waits without permanently marking candidate processed',()=>{assert.match(source,/if\(generated.skippedGenerationError\).*?randomWait\(followEnabled\?60:5,followEnabled\?90:10.*?continue;/);assert.ok(source.includes('点赞未成功确认'));});
test('reply also relocates original target before opening editor',()=>{assert.ok(source.includes("replySubmitted=false;check(signal);info=relocatePost(info);"));});
test('modal matching ignores unrelated first article but rejects different target',()=>{
 const ctx=vm.createContext({postInfo:x=>x,normalized:x=>x.trim(),URL});
 vm.runInContext(source.slice(source.indexOf(' const replyTargetMatches='),source.indexOf(' const relocatePost='))+';globalThis.matches=replyTargetMatches;',ctx);
 const target=row(),other={...row(),id:'999'};
 assert.equal(ctx.matches({querySelectorAll:()=>[other,target]},target),true);
 assert.equal(ctx.matches({querySelectorAll:()=>[other]},target),false);
 assert.equal(ctx.matches({querySelectorAll:()=>[{...target,text:'changed'}]},target),false);
});
test('all between-post waits in disabled-follow mode stay at 5–10 seconds',()=>{
 const cases=[['followEnabled?60:5','followEnabled?90:10'],['followEnabled?10:5','followEnabled?20:10'],['5','followEnabled?20:10'],['followEnabled?40:5','followEnabled?60:10']];
 for(const [min,max] of cases){assert.ok(source.includes('randomWait('+min+','+max+',signal,'));assert.equal(vm.runInNewContext(min,{followEnabled:false}),5);assert.equal(vm.runInNewContext(max,{followEnabled:false}),10);}
 assert.ok(source.includes('randomWait(followEnabled?5:3,followEnabled?10:5,signal,'));
});
test('real X composer article without status permalink uses exact scoped identity',()=>{
 const ctx=vm.createContext({postInfo:()=>null,normalized:x=>(x||'').replace(/ https:\/\/pic\.x\.com\/\w+$/,'').trim(),URL});
 vm.runInContext(source.slice(source.indexOf(' const replyTargetMatches='),source.indexOf(' const relocatePost='))+';globalThis.matches=replyTargetMatches;',ctx);
 const target={id:'123',author:'Test',time:'2026-11-01',text:'hello'};
 const article=(author='Test',time='2026-11-01',text='hello https://pic.x.com/abc')=>({querySelectorAll:()=>[{href:'https://x.com/'+author}],querySelector:s=>s==='time'?{getAttribute:()=>time}:{textContent:text}});
 const dialog=a=>({querySelectorAll:()=>[a]});
 assert.equal(ctx.matches(dialog(article()),target),true);
 for(const a of [article('Other'),article('Test','wrong'),article('Test','2026-11-01','changed')])assert.equal(ctx.matches(dialog(a),target),false);
});
test('composer quote suffix requires original quote handle and unchanged body',()=>{
 const ctx=vm.createContext({postInfo:()=>null,normalized:x=>(x||'').trim(),URL});
 vm.runInContext(source.slice(source.indexOf(' const replyTargetMatches='),source.indexOf(' const relocatePost='))+';globalThis.matches=replyTargetMatches;',ctx);
 const target={author:'Test',time:'now',text:'body',quoteHandles:['deepseek_ai']};
 const article=text=>({querySelectorAll:()=>[{href:'https://x.com/Test'}],querySelector:s=>s==='time'?{getAttribute:()=>'now'}:{textContent:text}});
 const dialog=text=>({querySelectorAll:()=>[article(text)]});
 assert.equal(ctx.matches(dialog('body x.com/deepseek_ai/st…'),target),true);
 assert.equal(ctx.matches(dialog('body x.com/other/st…'),target),false);
 assert.equal(ctx.matches(dialog('changed x.com/deepseek_ai/st…'),target),false);
});
