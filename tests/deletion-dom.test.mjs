import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../deletion-dom.js', import.meta.url),'utf8');
const DIALOG='[role="dialog"],[role="alertdialog"],[data-testid="confirmationSheetDialog"]', MENU='[role="menu"],[data-testid="Dropdown"]', ARTICLE='article[data-testid="tweet"]';
function fixture({quoted=false,byline='/Me',safe=true,stale=false,removeCard=true,toastText='Your post was deleted.',headingText='Delete post?',otherDialog=false,ref=false,outside=false,refHidden=false,actualHeading,deleteLabel='Delete'}={}){
 const f={account:'/me',path:'/me/status/102',clicks:[],stage:'idle',title:'求交友，认识新朋友',list:true,qualified:safe},id='102';
 function node(data={}){return Object.assign({isConnected:true,disabled:false,textContent:'',getAttribute(){return null;},closest(){return null;},querySelectorAll(){return [];},querySelector(){return null;},contains(v){return v===this;}},data);}
 const stamp=node({closest:s=>s==='a[href]'?node({getAttribute:()=>'/Me/status/'+id}):null});
 const name=node({querySelectorAll:()=>[node({getAttribute:()=>byline})]});
 const body=node();Object.defineProperty(body,'textContent',{get:()=>f.title});
 const main=node({querySelectorAll:s=>s===ARTICLE?(f.list?[card]:[]):[]});
 const caret=node({closest:s=>s===ARTICLE?card:null,click(){f.clicks.push('caret');f.stage='menu';f.onOpen?.();}});
 let card=node({querySelector:s=>s.includes('quoteTweet')&&quoted?{}:null,querySelectorAll:s=>({
  'time':[stamp],'[data-testid="User-Name"]':[name],'[data-testid="tweetText"]':[body],'[data-testid="caret"]':f.noCaret?[]:[caret]
 }[s]||[])});
 const menu=node(),menuitem=node({textContent:deleteLabel,closest:s=>s===MENU?menu:null,click(){f.clicks.push('menu');f.stage='dialog';}});
 const heading=node({textContent:headingText,checkVisibility:()=>!refHidden}),otherHeading=node({textContent:actualHeading});
 const dialog=node({getAttribute:k=>k==='aria-labelledby'&&ref?'local-sheet-title':null,
  contains(n){return n===this||n===button||(!outside&&n===heading);},
  querySelectorAll:s=>s.includes('confirmationSheetTitle')?(ref?(actualHeading?[otherHeading]:[]):[heading]):[]});
 const button=node({textContent:deleteLabel,closest:s=>s===DIALOG?dialog:null,click(){f.clicks.push('confirm');if(removeCard){card.isConnected=false;f.list=false;}f.stage='done';}});
 const toast=node({textContent:toastText}),extra=node();
 const document={getElementById:id=>id==='local-sheet-title'?heading:null,querySelectorAll:s=>({
  '[data-testid="primaryColumn"]':[main],[DIALOG]:f.stage==='dialog'?(otherDialog?[dialog,extra]:[dialog]):[],
  [MENU]:f.stage==='menu'?[menu]:[],'[role="menuitem"]':f.stage==='menu'?[menuitem]:[],
  '[data-testid="confirmationSheetConfirm"]':f.stage==='dialog'?[button]:[],
  '[data-testid="toast"],[role="status"],[role="alert"]':stale||f.stage==='done'?[toast]:[]
 }[s]||[])};
 let now=0;
 const ctx=vm.createContext({document,Date:{now:()=>now},setTimeout(cb,ms){now+=ms;f.tick?.(now);queueMicrotask(cb);},
  location:{origin:'https://x.com',get pathname(){return f.path;}},XAssistantDOM:{account:()=>f.account,deletableOriginal:()=>f.qualified}});
 vm.runInContext(src,ctx);const api=ctx.XAssistantDeletionDOM;
 return Object.assign(f,{api,expected:{id,account:'/me',text:f.title},card,ctx,button,rerender(){const old=card;card=node({...old});old.isConnected=false;}});
}
test('scan is read-only and emits only account-bound positively identified original texts',()=>{
 const f=fixture();const [row]=f.api.scan('/ME');
 assert.equal(row.author,'me');assert.equal(row.id,'102');assert.equal(row.text,f.title);assert.equal(row.owned,true);
 assert.equal(row.original,true);assert.equal(row.isReply,false);assert.equal(row.isQuote,false);assert.equal(row.isRepost,false);assert.equal(f.clicks.length,0);
 assert.equal(f.api.scan('/other').length,0);f.path='/home';assert.equal(f.api.scan('/me').length,0);
 for(const opts of [{safe:false},{byline:'/other'},{quoted:true}]){const x=fixture(opts);assert.equal(x.api.inspect(x.expected),null);}
});
test('inspect requires the exact detail and original preview text; rejects stale account or permalink',()=>{
 const f=fixture();assert.ok(f.api.inspect(f.expected));assert.equal(f.api.inspect({...f.expected,text:'变了'}),null);
 f.path='/me';assert.equal(f.api.inspect(f.expected),null);assert.equal(f.api.scan('/me').length,1);
 f.path='/me/status/102';f.account='/other';assert.equal(f.api.inspect(f.expected),null);
});
test('delete binds native menu and confirmation, journals fresh row before the only confirm click, requires positive receipt',async()=>{
 const f=fixture();const result=await f.api.remove(f.expected,{beforeConfirm:async row=>{assert.equal(row.text,f.title);assert.equal(row.id,'102');assert.equal(row.owned,true);f.clicks.push('write');}});
 assert.deepEqual(f.clicks,['caret','menu','write','confirm']);assert.equal(result.status,'deleted');assert.equal(result.id,'102');
});
test('no hook, storage failure, changed body, stopped run, or changed account cannot confirm',async()=>{
 let f=fixture();assert.equal((await f.api.remove(f.expected)).status,'skipped');assert.deepEqual(f.clicks,[]);
 for(const mode of ['persist','body','account','abort','control']){
  f=fixture();const ac=new AbortController();const result=await f.api.remove(f.expected,{signal:ac.signal,beforeConfirm:async()=>{
   if(mode==='persist')throw Error('journal unavailable');if(mode==='body')f.title+='x';if(mode==='account')f.account='/other';if(mode==='abort')ac.abort();if(mode==='control')f.button.isConnected=false;
  }});
  assert.equal(result.status,'skipped');assert.deepEqual(f.clicks,['caret','menu']);
 }
});
test('confirmation sheet for a different action or concurrent dialog is not clicked',async()=>{
 for(const opts of [{headingText:'Delete draft?'},{otherDialog:true}]){const f=fixture(opts);
  const r=await f.api.remove(f.expected,{beforeConfirm:()=>assert.fail()});assert.equal(r.status,'skipped');assert.deepEqual(f.clicks,['caret','menu']);}
});
test('vanished card alone, stale positive receipt, or positive toast without card removal stay unknown',async()=>{
 for(const opts of [{toastText:'Something went wrong.'},{stale:true},{removeCard:false}]){const f=fixture(opts);
  const r=await f.api.remove(f.expected,{beforeConfirm:async()=>{}});assert.equal(r.status,'unknown');assert.deepEqual(f.clicks,['caret','menu','confirm']);}
});
test('adapter refuses a second invocation while an explicitly confirmed batch owns the UI',async()=>{
 const f=fixture();let resolve,ready;const paused=new Promise(r=>resolve=r),entered=new Promise(r=>ready=r);
 const running=f.api.remove(f.expected,{beforeConfirm:async()=>{ready();await paused;}});await entered;
 assert.equal((await f.api.remove(f.expected,{beforeConfirm:async()=>{}})).status,'skipped');
 resolve();assert.equal((await running).status,'deleted');assert.deepEqual(f.clicks,['caret','menu','confirm']);
});

test('Chinese post delete accepts exact heading or a visible in-sheet named span and requires the fresh Chinese receipt',async()=>{
 for(const opts of [{headingText:'删除帖子？'},{ref:true,headingText:'要删除此帖子吗？'}]){
  const f=fixture({...opts,deleteLabel:'删除',toastText:'你的帖子已删除。'});
  assert.equal((await f.api.remove(f.expected,{beforeConfirm:async()=>{}})).status,'deleted');
  assert.deepEqual(f.clicks,['caret','menu','confirm']);
 }
});
test('a misleading, outside, hidden, or conflicting confirmation name cannot authorize an action',async()=>{
 for(const opts of [{outside:true},{refHidden:true},{actualHeading:'删除草稿？'},{headingText:'要删除此回复吗？'},{headingText:'不要删除帖子？'}]){
  const f=fixture({ref:true,headingText:'要删除此帖子吗？',deleteLabel:'删除',...opts});
  assert.equal((await f.api.remove(f.expected,{beforeConfirm:()=>assert.fail()})).status,'skipped');
  assert.deepEqual(f.clicks,['caret','menu']);
 }
});

test('native more button may mount after the verified text and an identical pre-menu card may hydrate',async()=>{
 const f=fixture();f.noCaret=true;let tick=0;
 f.tick=()=>{if(++tick===1)f.rerender();if(tick===3)f.noCaret=false;};
 const r=await f.api.remove(f.expected,{beforeConfirm:async()=>{}});
 assert.equal(r.status,'deleted');assert.equal(tick,3);assert.deepEqual(f.clicks,['caret','menu','confirm']);
});
test('before an opening click, timeout, foreign account, changed content or a competing overlay fail without any click',async()=>{
 for(const problem of ['never','account','text','menu','path']){
  const f=fixture();f.noCaret=true;f.tick=()=>{
   if(problem==='never')return;f.noCaret=false;
   if(problem==='account')f.account='/other';
   if(problem==='text')f.title='different';
   if(problem==='menu')f.stage='menu';
   if(problem==='path')f.path='/me/status/103';
  };
  assert.equal((await f.api.remove(f.expected,{beforeConfirm:()=>assert.fail()})).status,'skipped');
  assert.deepEqual(f.clicks,[]);
 }
});
test('a card replaced immediately after the more click may not rebind for the next step',async()=>{
 const f=fixture();f.onOpen=()=>f.rerender();
 assert.equal((await f.api.remove(f.expected,{beforeConfirm:()=>assert.fail()})).status,'skipped');
 assert.deepEqual(f.clicks,['caret']);
});
