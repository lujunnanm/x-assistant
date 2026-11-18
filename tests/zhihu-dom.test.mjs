import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../zhihu-dom.js',import.meta.url),'utf8');
function fixture({detail=false,folded=false}={}){
 const map=new Map(),attrs={name:'123','data-zop':JSON.stringify({title:'为什么要做小项目？'})};
 const card={isConnected:true,getAttribute:k=>attrs[k],querySelectorAll:s=>map.get(s)||[]};
 const own=(values={})=>({closest:()=>card,...values});
 const rich=own({innerText:'每天完成一个小项目。\n再逐步增加难度。',querySelectorAll:s=>s==='img'?(map.get('rich-images')||[]):[]});
 map.set('meta[itemprop="url"]',[own({getAttribute:()=> 'https://www.zhihu.com/people/writer'}),own({getAttribute:()=> 'https://www.zhihu.com/question/456/answer/123'})]);
 map.set('.RichContent-inner .RichText',[rich]);map.set('.ContentItem-actions',[own()]);
 if(!detail)map.set('.ContentItem-title',[own({innerText:'为什么要做小项目？'})]);
 if(folded){map.set('.RichContent.is-collapsed',[own()]);map.set('button.ContentItem-more',[own({textContent:'阅读全文',click(){map.set('.RichContent.is-collapsed',[]);rich.innerText='这是展开后的完整答案。';}})]);}
 const ctx=vm.createContext({location:{href:'https://www.zhihu.com/',pathname:detail?'/question/456/answer/123':'/'},document:{querySelector:()=>({textContent:'详情问题'})},URL,setTimeout:fn=>setTimeout(fn,0)});vm.runInContext(script,ctx);
 return {api:ctx.XAssistantZhihu,card,map,attrs,rich,own};
}
test('feed and answer detail read only own canonical identity, question and rich answer',()=>{
 for(const detail of [false,true]){const f=fixture({detail}),row=f.api.read(f.card);assert.equal(row.id,'123');assert.equal(row.questionId,'456');assert.equal(row.question,'为什么要做小项目？');assert.equal(row.text,f.rich.innerText);assert.ok(f.api.actions(f.card));}
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
