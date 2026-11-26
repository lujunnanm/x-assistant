import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../zhihu-copy.js',import.meta.url),'utf8');

function fixture(pathname='/home',row={sourceType:'answer',sourceKey:'answer:123',id:'123',question:'问题',text:'回答正文',url:'https://www.zhihu.com/question/456/answer/123'},existing=[],photos=[],add=async()=>({added:true,revision:1})){
 const listeners=new Map(),calls=[];
 const cardSelector=row.sourceType==='article'?'article.Post-Main':'.AnswerItem',isCard=s=>String(s).split(',').includes(cardSelector);
 const action=type=>({nodeType:1,closest:s=>isCard(s)?article:null,matches:()=>false});
 const reply=action(),retweet=action(),like=action();
 const group={nodeType:1,children:[],closest:s=>isCard(s)?article:null,
  querySelectorAll:s=>s.includes('reply')?[reply]:s.includes('retweet')?[retweet]:s.includes('like')?[like]:[],append(node){this.children.push(node);node.parent=this;}};
 const article={nodeType:1,isConnected:true,button:null,matches:s=>isCard(s),closest:()=>null,
  querySelectorAll:s=>s==='[role="group"]'?[group]:s.includes('tweetPhoto')?photos.map(({url,href,excluded=false})=>({
   closest:s=>isCard(s)?article:s==='a[href]'?{getAttribute:()=>href}:excluded?{}:null,
   querySelectorAll:()=>[{getAttribute:()=>url}]
  })):[],querySelector(s){return s==='[data-sacred-zhihu-copy]'?this.button:null;}};
 const makeButton=()=>({nodeType:1,dataset:{},isConnected:true,disabled:false,attrs:{},textContent:'',title:'',
  setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){listeners.set(k,v);},closest:s=>isCard(s)?article:null,remove(){this.isConnected=false;article.button=null;}});
 group.append=node=>{group.children.push(node);node.parent=group;article.button=node;};
 const root={nodeType:1,matches:()=>false,closest:()=>null,querySelectorAll:s=>s==='.AnswerItem,article.Post-Main'?[article]:[]};
 const document={documentElement:root,createElement:makeButton,querySelectorAll:s=>s==='[data-sacred-zhihu-copy]'&&article.button?[article.button]:[]};
 let observer,storageChanged;
 const context=vm.createContext({document,location:{pathname},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},queueMicrotask:fn=>fn(),setTimeout,clearTimeout,
  XAssistantZhihu:{read:()=>row,actions:()=>group,fullRow:async()=>row},
  XAssistantRuntime:{call:async message=>{calls.push(message);return message.kind==='ZHIHU_REWRITE_STATUS'?{existing,revision:0}:add(message);}},
  chrome:{storage:{onChanged:{addListener(fn){storageChanged=fn;}}}}});
 vm.runInContext(source,context);
 return {context,document,article,group,listeners,calls,observer,storageChanged,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

const click=f=>f.listeners.get('click').call(f.article.button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
test('Zhihu plus adds once, expands selected answer, disables duplicate and does not rescan status on mutations',async()=>{
 const f=fixture();await f.flush();assert.equal(f.article.button.textContent,'+');
 assert.deepEqual([...f.calls[0].ids],['answer:123']);assert.match(f.article.button.title,/问题与回答/);
 let expanded=0;f.context.XAssistantZhihu.fullRow=async()=>{expanded++;return {sourceType:'answer',sourceKey:'answer:123',id:'123',question:'问题',text:'完整答案'};};
 await click(f);assert.equal(expanded,1);assert.equal(f.article.button.textContent,'✓');assert.equal(f.article.button.disabled,true);
 assert.equal(f.calls.at(-1).kind,'ZHIHU_REWRITE_ADD');assert.equal(f.calls.at(-1).post.text,'完整答案');
 for(let i=0;i<1000;i++)f.observer([{target:f.article,addedNodes:[]}]);await f.flush();
 assert.equal(f.calls.length,2);assert.equal(f.group.children.length,1);
 await click(f);assert.equal(f.calls.length,2);
});
test('Zhihu saved answer is disabled immediately; deleted item becomes available again',async()=>{
 const existing=['answer:123'],f=fixture('/',undefined,existing);await f.flush();assert.equal(f.article.button.disabled,true);
 existing.length=0;f.storageChanged({xAssistantPostingCopiesV1:{}},'local');await f.flush();
 assert.equal(f.article.button.disabled,false);assert.equal(f.article.button.textContent,'+');
});

test('Zhihu article uses a typed status key, article wording and the same one-click add route',async()=>{
 const row={sourceType:'article',sourceKey:'article:123',id:'123',question:'文章标题',text:'文章正文',url:'https://zhuanlan.zhihu.com/p/123'},f=fixture('/p/123',row);
 await f.flush();assert.deepEqual([...f.calls[0].ids],['article:123']);assert.equal(f.article.button.dataset.sourceKey,'article:123');assert.match(f.article.button.title,/文章标题与正文/);
 await click(f);assert.equal(f.calls.at(-1).kind,'ZHIHU_REWRITE_ADD');assert.equal(f.calls.at(-1).post.sourceType,'article');assert.equal(f.article.button.textContent,'✓');assert.match(f.article.button.title,/此文章已加入/);
});
test('article and answer with the same numeric id never share status identity',async()=>{
 const article={sourceType:'article',sourceKey:'article:123',id:'123',question:'标题',text:'正文',url:'https://zhuanlan.zhihu.com/p/123'};
 const answer=fixture('/',undefined,['article:123']);await answer.flush();assert.equal(answer.article.button.disabled,false);
 const post=fixture('/p/123',article,['answer:123']);await post.flush();assert.equal(post.article.button.disabled,false);
});
test('Zhihu errors are visible and retryable without saving an excerpt',async()=>{
 const f=fixture();await f.flush();f.context.XAssistantZhihu.fullRow=async()=>{throw Error('全文未加载');};
 await click(f);assert.equal(f.article.button.textContent,'!');assert.match(f.article.button.title,/全文未加载/);assert.equal(f.article.button.disabled,false);assert.equal(f.calls.length,1);
});

test('plus has no chooser or per-click language override',()=>{assert.doesNotMatch(source,/XAssistantCopyMenu|targetLanguage|aria-haspopup/);});
