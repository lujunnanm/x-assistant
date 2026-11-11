import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {splitPostingPaste,parsePostingPackage,classifyPostingImport,postingCopyOperation,validatePostingCopies,cleanPostingPublishText,postingImages} from '../posting-copy.mjs';
const js=readFileSync(new URL('../panel.js',import.meta.url),'utf8'),html=readFileSync(new URL('../panel.html',import.meta.url),'utf8');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==';
const row=(id='news-1',extra={})=>({id,text:'新闻原文\n观点',enabled:true,newsId:id,...extra});
function setup(initial=[],decode=async()=>({width:1,height:1,close(){}})){
 const ids=new Map(),requests=[];
 class El{
  listeners=new Map();children=[];dataset={};textContent='';open=false;value='';disabled=false;hidden=false;
  addEventListener(k,fn){const a=this.listeners.get(k)||[];a.push(fn);this.listeners.set(k,a);}
  removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(x=>x!==fn));}
  fire(k,event={}){for(const fn of [...this.listeners.get(k)||[]])fn(event);}
  append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=xs;}
  setAttribute(){}removeAttribute(key){delete this[key];}reset(){}scrollIntoView(){}focus(){}
  showModal(){this.open=true;}close(){this.open=false;this.fire('close');}
 }
 const element=id=>{if(!ids.has(id))ids.set(id,new El());return ids.get(id);};
 const window=new El(),document={hidden:false,hasFocus:()=>true,getElementById:element,querySelector:element,createElement:()=>new El()};
 let data={revision:1,rows:validatePostingCopies(initial)},serial=0;
 const runtime={getURL:path=>'chrome-extension://fixture/'+path,sendMessage:async m=>{requests.push(m);if(m.kind==='POST_COPIES_OP')data=postingCopyOperation(data,m.op);return {ok:true,state:data};}};
 const scope=vm.createContext({window,document,chrome:{runtime},structuredClone,splitPostingPaste,parsePostingPackage,classifyPostingImport,cleanPostingPublishText,postingImages,createImageBitmap:decode,fetch:async()=>({ok:true,blob:async()=>({})}),crypto:{randomUUID:()=> 'new-'+ ++serial}});
 vm.runInContext(js.slice(js.indexOf('const $='),js.indexOf('chrome.storage.onChanged.addListener((changes,area)=>{')),scope);
 scope.renderCopies(data);return {element,scope,requests,get data(){return data;}};
}
const click=button=>button.onclick({type:'click'});

test('new editor saves exact pasted body as enabled without draft or ready state',async()=>{
 const f=setup();f.element('text').value='  标题\n详细原文  ';await f.element('editor').onsubmit({type:'submit',preventDefault(){}});
 assert.equal(f.data.rows.length,1);assert.equal(f.data.rows[0].text,'  标题\n详细原文  ');assert.equal(f.data.rows[0].enabled,true);
 for(const key of ['status','targetAccount','publishMode','expiresAt'])assert.equal(f.data.rows[0][key],undefined);
 assert.match(f.element('message').textContent,/保存并启用/);
});

test('editing preserves provenance, optional image and existing enabled state',async()=>{
 const f=setup([row('n',{image,enabled:false,variantId:'c2',imageAssetId:'image-3',sourceUrls:['https://example.com/news']})]);
 const card=f.element('rows').children[0],details=card.children.map(child=>child.textContent).join(' ');assert.match(details,/文案版本 c2/);assert.match(details,/配图资产 image-3/);
 await click(card.children.at(-1).children[0]);f.element('text').value='修改后的文案';await f.element('editor').onsubmit({type:'submit',preventDefault(){}});
 const r=f.data.rows[0];assert.equal(r.text,'修改后的文案');assert.equal(r.enabled,false);assert.equal(r.image,image);assert.equal(r.variantId,'c2');assert.deepEqual(r.sourceUrls,['https://example.com/news']);
});

test('each row has a direct enabled switch with no queue confirmation',async()=>{
 const f=setup([row()]);const controls=f.element('rows').children[0].children.at(-1).children;
 assert.equal(controls[1].textContent,'停用');await click(controls[1]);assert.equal(f.data.rows[0].enabled,false);assert.equal(f.element('library-confirm').open,false);
 await click(f.element('rows').children[0].children.at(-1).children[1]);assert.equal(f.data.rows[0].enabled,true);
});
test('a photo-only draft previews all pictures and can be edited without a text body',async()=>{
 const photos=[image,'post-images/another.webp'],f=setup([{id:'timeline_ai_123',text:'',enabled:false,images:photos}]);
 const card=f.element('rows').children[0];
 assert.deepEqual(card.children.filter(c=>c.src).map(c=>c.src),[image,'chrome-extension://fixture/post-images/another.webp']);
 await click(card.children.at(-1).children[0]);assert.equal(f.element('text').required,false);
 await f.element('editor').onsubmit({type:'submit',preventDefault(){}});
 assert.equal(f.data.rows[0].text,'');assert.equal(f.data.rows[0].enabled,false);assert.deepEqual(f.data.rows[0].images,photos);
});
test('a native X GIF saved as MP4 renders a muted looping playable preview',()=>{
 const mp4='data:video/mp4;base64,'+Buffer.from('0000ftypisom0000').toString('base64');
 const f=setup([row('gif',{text:'',image:mp4})]);
 const preview=f.element('rows').children[0].children.find(c=>c.src===mp4);
 assert.equal(preview.loop,true);assert.equal(preview.autoplay,true);assert.equal(preview.muted,true);assert.equal(preview.controls,true);
});

test('legacy import turns drafts on, keeps terminal rows off and merges without workflow fields',async()=>{
 const f=setup([row('a')]);const legacy=[row('a'),row('b',{text:'草稿迁移',enabled:false,status:'draft',targetAccount:'/example',publishMode:'once'}),row('c',{text:'历史终态',status:'published'})];
 f.element('import-text').value=JSON.stringify({schema:'sacred-plan-content-package',version:1,rows:legacy});await click(f.element('import-preview'));
 assert.equal(f.element('import-apply').disabled,false);assert.match(f.element('import-summary').textContent,/新增 2 条 · 重复 1 条/);await click(f.element('import-apply'));
 assert.equal(f.data.rows.length,3);assert.equal(f.data.rows.find(r=>r.id==='b').enabled,true);assert.equal(f.data.rows.find(r=>r.id==='c').enabled,false);
 assert.ok(f.data.rows.every(r=>r.status===undefined&&r.targetAccount===undefined&&r.publishMode===undefined));
});
test('import preview and commit both default new copy on while retaining unknown status through the raw package',async()=>{
 const f=setup([row('kept',{enabled:false})]);
 const incoming=[row('new',{enabled:false,text:'新文案'}),row('ready',{enabled:false,status:'ready',text:'旧待发'}),row('unknown',{status:'unknown',text:'未知稿'})];
 f.element('import-text').value=JSON.stringify(incoming);await click(f.element('import-preview'));
 assert.match(f.element('import-summary').textContent,/新增文案默认启用/);
 assert.match(f.element('import-rows').children[0].children[0].textContent,/启用/);
 assert.match(f.element('import-rows').children[2].children[0].textContent,/停用/);
 await click(f.element('import-apply'));
 assert.deepEqual(f.data.rows.map(row=>row.enabled),[false,true,true,false]);
 assert.equal(JSON.parse(f.requests.at(-1).op.rows)[2].status,'unknown');
});

test('conflicting import and intervening revision never overwrite the library',async()=>{
 const f=setup([row('a')]);f.element('import-text').value=JSON.stringify([row('a',{text:'different'})]);await click(f.element('import-preview'));
 assert.equal(f.element('import-apply').disabled,true);assert.match(f.element('import-summary').textContent,/冲突 1 条/);assert.equal(f.requests.length,0);
 f.element('import-text').value=JSON.stringify([row('b')]);await click(f.element('import-preview'));f.scope.renderCopies({revision:2,rows:f.data.rows});assert.equal(f.element('import-apply').disabled,true);
});

test('bulk paste adds enabled rows and image removal also removes its caption and source link',async()=>{
 const f=setup([row('with-image',{text:'新闻\n\n（AI概念配图）\nhttps://example.com/news',image,imageAssetId:'asset',sourceUrls:['https://example.com/news']})]);
 const controls=f.element('rows').children[0].children.at(-1).children;assert.equal(controls[2].textContent,'移除配图');await click(controls[2]);
 assert.equal(f.data.rows[0].image,undefined);assert.equal(f.data.rows[0].imageAssetId,undefined);assert.equal(f.data.rows[0].text,'新闻');assert.equal(f.data.rows[0].enabled,true);
 f.element('bulk-mode').value='lines';f.element('bulk-text').value='第一条\n第二条';await click(f.element('bulk-add'));assert.equal(f.data.rows.length,3);assert.ok(f.data.rows.every(r=>r.enabled));
});

test('clear remains explicitly confirmed and untrusted acceptance cannot apply',async()=>{
 const f=setup([row()]);const pending=click(f.element('clear'));assert.equal(f.element('library-confirm').open,true);assert.equal(f.requests.length,0);
 f.element('library-confirm-accept').fire('click',{isTrusted:false});assert.equal(f.element('library-confirm').open,true);
 f.element('library-confirm-accept').fire('click',{isTrusted:true});await pending;assert.equal(f.data.rows.length,0);
});

test('simple panel has unique ids and no draft, ready, account, expiry or image-upload controls',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const id of ['import-file','import-text','import-preview','import-apply','library-search','text','bulk-text'])assert.ok(ids.includes(id));
 for(const id of ['library-status','library-account','target-account','publish-mode','expires-at','image-file','remove-library-images'])assert.ok(!ids.includes(id));
 assert.doesNotMatch(html,/加入待发|全部状态|一次性新闻|保存为草稿/);assert.doesNotMatch(js,/statusLabels|terminalCopy|copyExpired/);assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.match(html,/从上到下依次选择启用文案/);assert.match(html,/确认成功后自动从文案库删除/);
});

test('import still rejects image bytes that cannot decode',async()=>{
 const f=setup([],async()=>{throw Error('Image decode failed');});f.element('import-text').value=JSON.stringify([row('broken',{image})]);await click(f.element('import-preview'));
 assert.equal(f.element('import-apply').disabled,true);assert.match(f.element('message').textContent,/decode failed/);assert.equal(f.requests.length,0);
});
