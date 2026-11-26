import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../zhihu-dom.js',import.meta.url),'utf8');
function fixture({detail=false,folded=false}={}){
 const map=new Map(),attrs={name:'123','data-zop':JSON.stringify({title:'为什么要做小项目？'})};
 const card={isConnected:true,matches:s=>s==='.AnswerItem',getAttribute:k=>attrs[k],querySelectorAll:s=>map.get(s)||[]};
 const own=(values={})=>({closest:s=>s==='.AnswerItem'?card:null,...values});
 const rich=own({innerText:'每天完成一个小项目。\n再逐步增加难度。',querySelectorAll:s=>s==='img'?(map.get('rich-images')||[]):[]});
 map.set('meta[itemprop="url"]',[own({getAttribute:()=> 'https://www.zhihu.com/people/writer'}),own({getAttribute:()=> 'https://www.zhihu.com/question/456/answer/123'})]);
 map.set('.RichContent-inner .RichText',[rich]);map.set('.ContentItem-actions',[own()]);
 if(!detail)map.set('.ContentItem-title',[own({innerText:'为什么要做小项目？'})]);
 if(folded){map.set('.RichContent.is-collapsed',[own()]);map.set('button.ContentItem-more',[own({textContent:'阅读全文',click(){map.set('.RichContent.is-collapsed',[]);rich.innerText='这是展开后的完整答案。';}})]);}
 const ctx=vm.createContext({location:{href:'https://www.zhihu.com/',pathname:detail?'/question/456/answer/123':'/'},document:{querySelector:()=>({textContent:'详情问题'})},URL,setTimeout:fn=>setTimeout(fn,0)});vm.runInContext(script,ctx);
 return {api:ctx.XAssistantZhihu,card,map,attrs,rich,own};
}
test('feed and answer detail read only own canonical identity, question and rich answer',()=>{
 for(const detail of [false,true]){const f=fixture({detail}),row=f.api.read(f.card);assert.equal(row.sourceType,'answer');assert.equal(row.sourceKey,'answer:123');assert.equal(row.id,'123');assert.equal(row.questionId,'456');assert.equal(row.question,'为什么要做小项目？');assert.equal(row.text,f.rich.innerText);assert.ok(f.api.actions(f.card));}
});
test('question page h1 fallback applies only to matching question ID',()=>{
 const f=fixture({detail:true});f.attrs['data-zop']='{}';assert.equal(f.api.read(f.card).question,'详情问题');
 f.map.set('meta[itemprop="url"]',[f.own({getAttribute:()=> 'https://www.zhihu.com/question/999/answer/123'})]);assert.equal(f.api.read(f.card).question,'');
});
test('nested answer cannot contaminate card and conflicting identity fails',()=>{
 const f=fixture();f.map.get('meta[itemprop="url"]').push({closest:()=>({}),getAttribute:()=> 'https://www.zhihu.com/question/999/answer/888'});
 assert.equal(f.api.read(f.card).id,'123');f.attrs.name='999';assert.equal(f.api.read(f.card),null);
});
test('expands only the selected answer and returns full content',async()=>{
 const f=fixture({folded:true});assert.equal((await f.api.fullRow(f.card,f.api.read(f.card))).text,'这是展开后的完整答案。');
});
test('paid or unexpandable excerpt is not sent; unchanged collapsed state times out',async()=>{
 const f=fixture({folded:true}),row=f.api.read(f.card);f.map.set('button.ContentItem-more',[]);await assert.rejects(f.api.fullRow(f.card,row),/展开全文/);
 f.map.set('button.ContentItem-more',[f.own({textContent:'阅读全文',click(){}})]);await assert.rejects(f.api.fullRow(f.card,row),/加载未完成/);
});
test('detached and identity-changed cards cannot return wrong answer',async()=>{
 const f=fixture(),row=f.api.read(f.card);f.card.isConnected=false;await assert.rejects(f.api.fullRow(f.card,row),/已变化/);
 f.card.isConnected=true;f.attrs.name='999';await assert.rejects(f.api.fullRow(f.card,row),/已变化/);
});
test('reads only unique native images inside the selected answer body in document order',()=>{
 const f=fixture(),image=(attrs,owner=f.card)=>({closest:()=>owner,getAttribute:name=>attrs[name]||null});
 f.map.set('rich-images',[
  image({'data-original':'https://picx.zhimg.com/v2-first_720w.jpg?source=x',src:'data:image/png;base64,x'}),
  image({src:'https://pic1.zhimg.com/v2-second.png'}),
  image({src:'https://picx.zhimg.com/v2-first_720w.jpg'}),
  image({src:'https://example.com/not-answer.jpg'}),
  image({src:'https://pic2.zhimg.com/nested.jpg'},{}),
 ]);
 assert.deepEqual([...f.api.read(f.card).imageUrls],['https://picx.zhimg.com/v2-first_720w.jpg','https://pic1.zhimg.com/v2-second.png']);
});

function articleFixture({id='789',pathId=id,ogId=id,title='一篇完整文章',text='第一段。\n第二段。'}={}){
 const map=new Map(),location={href:`https://zhuanlan.zhihu.com/p/${pathId}?utm_source=test`,pathname:`/p/${pathId}`};
 const isArticle=s=>s==='article.Post-Main';
 const card={isConnected:true,matches:isArticle,getAttribute:()=>null,querySelectorAll:s=>map.get(s)||[]};
 const own=(values={})=>({closest:s=>isArticle(s)?card:null,...values});
 const rich=own({innerText:text,querySelectorAll:s=>s==='img'?(map.get('rich-images')||[]):[]});
 map.set('.Post-Title',[own({innerText:title})]);map.set('.Post-RichTextContainer .RichText',[rich]);map.set('.Post-RichTextContainer',[]);
 map.set('meta[itemprop="url"]',[own({getAttribute:()=>`https://zhuanlan.zhihu.com/p/${id}`}),own({getAttribute:()=> 'https://www.zhihu.com/people/writer'})]);
 map.set('.ContentItem-actions',[own()]);
 const og=ogId===null?null:{content:`https://zhuanlan.zhihu.com/p/${ogId}`,getAttribute:()=>`https://zhuanlan.zhihu.com/p/${ogId}`};
 const document={querySelector:s=>s==='meta[property="og:url"]'?og:null};
 const ctx=vm.createContext({location,document,URL,setTimeout:fn=>setTimeout(fn,0)});vm.runInContext(script,ctx);
 return {api:ctx.XAssistantZhihu,card,map,location,rich,own};
}
test('canonical Zhihu article reads its title, complete body and typed identity',async()=>{
 const f=articleFixture(),row=f.api.read(f.card);
 assert.deepEqual({sourceType:row.sourceType,sourceKey:row.sourceKey,id:row.id,question:row.question,text:row.text,url:row.url},{sourceType:'article',sourceKey:'article:789',id:'789',question:'一篇完整文章',text:'第一段。\n第二段。',url:'https://zhuanlan.zhihu.com/p/789'});
 assert.ok(f.api.actions(f.card));assert.equal((await f.api.fullRow(f.card,row)).sourceKey,'article:789');
});
test('article requires one canonical numeric identity matching the current detail URL',()=>{
 const invalid=articleFixture({pathId:'abc',id:'789',ogId:'789'});assert.equal(invalid.api.read(invalid.card),null);
 const conflict=articleFixture({id:'789',ogId:'790'});assert.equal(conflict.api.read(conflict.card),null);
 const foreign=articleFixture();foreign.location.href='https://zhuanlan.zhihu.com.evil.test/p/789';assert.equal(foreign.api.read(foreign.card),null);
 const secondary=articleFixture(),other={isConnected:true,matches:s=>s==='article.Post-Main',getAttribute:()=>null,querySelectorAll:()=>[]};assert.equal(secondary.api.read(other),null);
});
test('article ignores nested recommendations and reads unique body images in order',()=>{
 const f=articleFixture(),image=(attrs,owner=f.card)=>({closest:s=>s==='article.Post-Main'?owner:null,getAttribute:name=>attrs[name]||null});
 f.map.get('meta[itemprop="url"]').push({closest:()=>({}),getAttribute:()=> 'https://zhuanlan.zhihu.com/p/999'});
 f.map.set('rich-images',[
  image({'data-original':'https://picx.zhimg.com/article-first.jpg?source=x'}),image({src:'https://pic1.zhimg.com/article-second.png'}),
  image({src:'https://picx.zhimg.com/article-first.jpg'}),image({src:'https://example.com/outside.jpg'}),image({src:'https://pic2.zhimg.com/nested.jpg'},{}),
 ]);
 const row=f.api.read(f.card);assert.equal(row.id,'789');assert.deepEqual([...row.imageUrls],['https://picx.zhimg.com/article-first.jpg','https://pic1.zhimg.com/article-second.png']);
});
test('article page change, detachment and incomplete content fail before returning a row',async()=>{
 const f=articleFixture(),row=f.api.read(f.card);f.location.href='https://zhuanlan.zhihu.com/p/790';f.location.pathname='/p/790';await assert.rejects(f.api.fullRow(f.card,row),/文章页面已变化/);
 const detached=articleFixture(),initial=detached.api.read(detached.card);detached.card.isConnected=false;await assert.rejects(detached.api.fullRow(detached.card,initial),/文章页面已变化/);
 const empty=articleFixture({text:''}),emptyRow=empty.api.read(empty.card);await assert.rejects(empty.api.fullRow(empty.card,emptyRow),/标题或正文/);
});
