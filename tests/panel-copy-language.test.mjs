import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {COPY_LANGUAGE_KEY,translationLanguage} from '../copy-translation.mjs';
const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../panel.html',import.meta.url),'utf8');
function fixture(initial){
 const select={value:'',disabled:true},status={textContent:''},saved={[COPY_LANGUAGE_KEY]:initial},writes=[];let changed,fail=false;
 const ctx=vm.createContext({COPY_LANGUAGE_KEY,translationLanguage,$:id=>id==='copy-language'?select:status,
  chrome:{storage:{local:{get:async()=>({...saved}),set:async data=>{if(fail)throw Error('storage failure');Object.assign(saved,data);writes.push(data);}},onChanged:{addListener:f=>changed=f}}}});
 vm.runInContext(source.slice(source.indexOf('function bindCopyLanguage(){'),source.indexOf('const timing =')),ctx);
 return {select,status,saved,writes,fail:()=>fail=true,change:value=>changed({[COPY_LANGUAGE_KEY]:{newValue:value}},'local'),flush:()=>new Promise(r=>setImmediate(r))};
}
test('default options exposes original rewrite, English and Japanese without changing module controls',()=>{
 assert.match(html,/href="#default-settings">默认选项/);
 const block=html.slice(html.indexOf('<section id="default-settings"'),html.indexOf('<section id="time-settings"'));
 assert.match(block,/<option value="">原有改写（不翻译）/);assert.match(block,/<option value="en">英文/);assert.match(block,/<option value="ja">日文/);
 assert.match(block,/两个浏览器各自保存/);assert.match(source,/'#default-settings'/);
});
test('missing setting preserves original rewrite and stored defaults reload on next panel open',async()=>{
 for(const initial of [undefined,'','en','ja']){
  const f=fixture(initial);await f.flush();assert.equal(f.select.value,initial||'');assert.equal(f.select.disabled,false);assert.equal(f.writes.length,0);
 }
});
test('language change saves immediately, only to its setting, and another panel stays synchronized',async()=>{
 const f=fixture();await f.flush();
 for(const value of ['en','ja','']){f.select.value=value;await f.select.onchange();assert.equal(f.saved[COPY_LANGUAGE_KEY],value);assert.equal(f.select.disabled,false);assert.match(f.status.textContent,/已保存/);}
 assert.ok(f.writes.every(w=>Object.keys(w).length===1&&Object.hasOwn(w,COPY_LANGUAGE_KEY)));
 f.change('ja');assert.equal(f.select.value,'ja');assert.equal(f.writes.length,3);
});
test('failed save restores previous selection rather than claiming success',async()=>{
 const f=fixture('en');await f.flush();f.fail();f.select.value='ja';await f.select.onchange();
 assert.equal(f.select.value,'en');assert.equal(f.saved[COPY_LANGUAGE_KEY],'en');assert.match(f.status.textContent,/保存失败/);assert.equal(f.select.disabled,false);
});
test('plus scripts and manifest have no remaining language menu dependency',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
 for(const group of manifest.content_scripts)assert.ok(!group.js.includes('copy-menu.js'));
 for(const file of ['timeline-copy.js','zhihu-copy.js'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/XAssistantCopyMenu|targetLanguage|aria-haspopup/);
 const bg=readFileSync(new URL('../background.js',import.meta.url),'utf8');
 assert.equal(bg.match(/translationLanguage\(await read\(COPY_LANGUAGE_KEY\)\)/g)?.length,2);
 assert.doesNotMatch(bg,/translationLanguage\(msg.targetLanguage\)/);
});
