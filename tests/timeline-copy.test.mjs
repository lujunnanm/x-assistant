import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../timeline-copy.js',import.meta.url),'utf8');

function fixture(pathname='/home',row={id:'123',author:'Writer',text:'帖子正文',url:'https://x.com/Writer/status/123'},existing=[],photos=[],add=async()=>({added:true,revision:1})){
 const listeners=new Map(),calls=[];
 const action=type=>({nodeType:1,closest:s=>s==='article[data-testid="tweet"]'?article:null,matches:()=>false});
 const reply=action(),retweet=action(),like=action();
 const group={nodeType:1,children:[],closest:s=>s==='article[data-testid="tweet"]'?article:null,
  querySelectorAll:s=>s.includes('reply')?[reply]:s.includes('retweet')?[retweet]:s.includes('like')?[like]:[],append(node){this.children.push(node);node.parent=this;}};
 const article={nodeType:1,isConnected:true,button:null,matches:s=>s==='article[data-testid="tweet"]',closest:()=>null,
  querySelectorAll:s=>s==='[role="group"]'?[group]:s.includes('tweetPhoto')?photos.map(({url,href,excluded=false})=>({
   closest:s=>s==='article[data-testid="tweet"]'?article:s==='a[href]'?{getAttribute:()=>href}:excluded?{}:null,
   querySelectorAll:()=>[{getAttribute:()=>url}]
  })):[],querySelector(s){return s==='[data-sacred-copy-post]'?this.button:null;}};
 const makeButton=()=>({nodeType:1,dataset:{},isConnected:true,disabled:false,attrs:{},textContent:'',title:'',
  setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){listeners.set(k,v);},closest:s=>s==='article[data-testid="tweet"]'?article:null,remove(){this.isConnected=false;article.button=null;}});
 group.append=node=>{group.children.push(node);node.parent=group;article.button=node;};
 const root={nodeType:1,matches:()=>false,closest:()=>null,querySelectorAll:s=>s==='article[data-testid="tweet"]'?[article]:[]};
 const document={documentElement:root,createElement:makeButton,querySelectorAll:s=>s==='[data-sacred-copy-post]'&&article.button?[article.button]:[]};
 let observer,storageChanged;
 const context=vm.createContext({document,location:{pathname},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},queueMicrotask:fn=>fn(),setTimeout,clearTimeout,
  XAssistantDOM:{post:()=>row},
  XAssistantRuntime:{call:async message=>{calls.push(message);return message.kind==='TIMELINE_REWRITE_STATUS'?{existing,revision:0}:add(message);}},
  chrome:{storage:{onChanged:{addListener(fn){storageChanged=fn;}}}}});
 vm.runInContext(source,context);
 return {context,document,article,group,listeners,calls,observer,storageChanged,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('1000 mutations of an existing saved post do not repeat status requests',async()=>{
 const f=fixture('/home',undefined,['123']);await f.flush();
 for(let i=0;i<1000;i++)f.observer([{target:f.article,addedNodes:[]}]);
 await f.flush();
 assert.equal(f.calls.length,1);assert.equal(f.article.button.textContent,'✓');
 f.storageChanged({xAssistantPostingCopiesV1:{newValue:{revision:2}}},'local');
 await f.flush();assert.equal(f.calls.length,2,'library edits still refresh visible buttons');
});
test('library changes during a slow status request are coalesced and read after it, never concurrently',async()=>{
 const f=fixture('/home',undefined,['123']);await f.flush();const pending=[];
 f.context.XAssistantRuntime.call=()=>new Promise(resolve=>pending.push(resolve));
 const changed=()=>f.storageChanged({xAssistantPostingCopiesV1:{newValue:{revision:2}}},'local');
 changed();for(let i=0;i<100;i++)changed();
 assert.equal(pending.length,1);
 pending[0]({revision:2,existing:[]});await f.flush();
 assert.equal(pending.length,2);
 pending[1]({revision:3,existing:['123']});await f.flush();
 assert.equal(pending.length,2);assert.equal(f.article.button.textContent,'✓');
});

test('adds one plus control and requests a DeepSeek rewrite for the library',async()=>{
 const f=fixture();await f.flush();const button=f.article.button;assert.ok(button);assert.equal(button.textContent,'+');
 await f.listeners.get('click').call(button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 assert.equal(button.textContent,'✓');assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(call=>call.kind==='TIMELINE_REWRITE_ADD'))),[{kind:'TIMELINE_REWRITE_ADD',post:{id:'123',author:'Writer',text:'帖子正文',url:'https://x.com/Writer/status/123'}}]);
 f.observer([{target:f.article,addedNodes:[]}]);await f.flush();assert.equal(f.group.children.filter(node=>node.isConnected).length,1);
});

test('adds the same plus control on non-home X pages',async()=>{const f=fixture('/Writer/status/123');await f.flush();assert.equal(f.article.button.textContent,'+');});

test('comment plus sends both the comment and its conversation root for fusion',async()=>{
 const rootPost={id:'100',author:'Root',text:'所属帖子观点',url:'https://x.com/Root/status/100'};
 const row={id:'123',author:'Writer',text:'评论观点',url:'https://x.com/Writer/status/123',isComment:true,rootPost};
 const f=fixture('/Root/status/100',row);await f.flush();const button=f.article.button;
 assert.equal(button.textContent,'+');assert.match(button.title,/融合评论/);
 await f.listeners.get('click').call(button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 assert.equal(button.textContent,'✓');assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(call=>call.kind==='TIMELINE_REWRITE_ADD'))),[{kind:'TIMELINE_REWRITE_ADD',post:{id:'123',author:'Writer',text:'评论观点',url:'https://x.com/Writer/status/123',rootPost}}]);
});

test('an existing rewritten source is locked before it can be clicked again',async()=>{
 const f=fixture('/search',undefined,['123']);await f.flush();const button=f.article.button;
 assert.equal(button.textContent,'✓');assert.equal(button.disabled,true);assert.equal(button.dataset.librarySaved,'true');
 assert.equal(f.calls.filter(call=>call.kind==='TIMELINE_REWRITE_ADD').length,0);
});

test('image-only post includes its own native photos in order, never quoted or foreign media',async()=>{
 const photo=n=>'https://pbs.twimg.com/media/Photo'+n+'?format=jpg&name=small';
 const f=fixture('/home',{id:'123',author:'Writer',text:'',url:'https://x.com/Writer/status/123'},[],[
  {href:'/Writer/status/123/photo/2',url:photo(2)},{href:'/Writer/status/999/photo/1',url:photo(3)},
  {href:'/Writer/status/123/photo/1',url:photo(4),excluded:true},{href:'/Writer/status/123/photo/1',url:photo(1)}
 ]);
 await f.flush();const button=f.article.button;
 await f.listeners.get('click').call(button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 const added=f.calls.find(c=>c.kind==='TIMELINE_REWRITE_ADD');
 assert.equal(added.post.text,'');assert.deepEqual(Array.from(added.post.imageUrls),[photo(1),photo(2)]);assert.equal(button.textContent,'✓');
});
test('failed rewrite keeps its readable tooltip and can be retried with the same control',async()=>{
 let attempts=0;
 const f=fixture('/home',undefined,[],[],async()=>{if(++attempts===1)throw Error('DeepSeek 选择跳过，没有生成改写稿');return {added:true,revision:1};});
 await f.flush();const button=f.article.button,click=()=>f.listeners.get('click').call(button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 await click();assert.equal(button.textContent,'!');assert.equal(button.disabled,false);assert.match(button.title,/选择跳过/);
 f.observer([{target:f.article,addedNodes:[]}]);await f.flush();assert.match(button.title,/选择跳过/);
 await click();assert.equal(button.textContent,'✓');assert.equal(button.disabled,true);
});

test('comment plus carries original media even when the original article is unmounted',async()=>{
 const rootPost={id:'100',author:'Root',text:'原帖',url:'https://x.com/Root/status/100',imageUrls:['https://pbs.twimg.com/media/Photo.jpg'],videoUrls:['https://x.com/Root/status/100/video/2']};
 const f=fixture('/Root/status/100',{id:'123',author:'Writer',text:'评论观点',url:'https://x.com/Writer/status/123',isComment:true,rootPost});
 await f.flush();const button=f.article.button;
 await f.listeners.get('click').call(button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 const saved=f.calls.find(c=>c.kind==='TIMELINE_REWRITE_ADD');
 assert.deepEqual(JSON.parse(JSON.stringify(saved.post.rootPost)),rootPost);
 assert.match(button.title,/1 张配图.*已启用/);assert.doesNotMatch(button.title,/待启用/);
});
test('comment plus can fall back to the matched mounted root photo, not other articles',async()=>{
 const rootPost={id:'100',author:'Root',text:'原帖',url:'https://x.com/Root/status/100'};
 const row={id:'123',author:'Writer',text:'评论观点',url:'https://x.com/Writer/status/123',isComment:true,rootPost};
 const f=fixture('/Root/status/100',row),rootFixture=fixture('/home',rootPost,[],[{href:'/Root/status/100/photo/1',url:'https://pbs.twimg.com/media/Photo.jpg'}]);
 const query=f.document.querySelectorAll;f.document.querySelectorAll=s=>s==='article[data-testid="tweet"]'?[rootFixture.article,f.article]:query(s);
 f.context.XAssistantDOM.post=a=>a===rootFixture.article?rootPost:row;
 await f.flush();await f.listeners.get('click').call(f.article.button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 const saved=f.calls.find(c=>c.kind==='TIMELINE_REWRITE_ADD');assert.deepEqual(Array.from(saved.post.rootPost.imageUrls),['https://pbs.twimg.com/media/Photo.jpg']);
});
test('video-only DOM fallback saves canonical video link and ignores a quoted player',async()=>{
 const f=fixture('/home',{id:'123',author:'Writer',text:'',url:'https://x.com/Writer/status/123'});
 const query=f.article.querySelectorAll;f.article.querySelectorAll=s=>s==='[data-testid="videoPlayer"]'?[false,true].map(excluded=>({closest:q=>q==='article[data-testid="tweet"]'?f.article:q==='a[href]'?null:excluded?{}:null})):query(s);
 await f.flush();await f.listeners.get('click').call(f.article.button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 const saved=f.calls.find(c=>c.kind==='TIMELINE_REWRITE_ADD');assert.ok(saved);
 assert.deepEqual(Array.from(saved.post.videoUrls),['https://x.com/Writer/status/123/video/1']);
});
test('plus classifies a native GIF player separately and never imports a quoted GIF',async()=>{
 const f=fixture('/home',{id:'123',author:'Writer',text:'',url:'https://x.com/Writer/status/123'});
 const q=f.article.querySelectorAll,src='https://video.twimg.com/tweet_video/Own_1.mp4';
 f.article.querySelectorAll=s=>s==='[data-testid="videoPlayer"]'?[false,true].map(excluded=>({
  closest:k=>k==='article[data-testid="tweet"]'?f.article:k==='a[href]'?null:excluded?{}:null,
  querySelectorAll:()=>[{currentSrc:excluded?'https://video.twimg.com/tweet_video/Foreign.mp4':src+'?tag=12'}]
 })):q(s);
 await f.flush();await f.listeners.get('click').call(f.article.button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 const saved=f.calls.find(c=>c.kind==='TIMELINE_REWRITE_ADD');assert.deepEqual(Array.from(saved.post.gifUrls),[src]);assert.equal(saved.post.videoUrls,undefined);
 assert.match(f.article.button.title,/动图.*已启用/);
});
test('a known but not loaded GIF fails visibly instead of silently creating a text-only copy',async()=>{
 const row={id:'123',author:'Writer',text:'原文',url:'https://x.com/Writer/status/123',missingGif:true};
 const f=fixture('/home',row);await f.flush();await f.listeners.get('click').call(f.article.button,{isTrusted:true,preventDefault(){},stopPropagation(){}});
 assert.equal(f.calls.some(c=>c.kind==='TIMELINE_REWRITE_ADD'),false);
 assert.match(f.article.button.title,/动图文件尚未加载/);assert.equal(f.article.button.disabled,false);
});
