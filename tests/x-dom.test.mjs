import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
const stamp='2026-11-02T12:00:00.000Z';
const anchor=href=>({href:new URL(href,'https://x.com').href,getAttribute:name=>name==='href'?href:null});

// Minimal DOM nodes answer real production selectors; no sliced implementation.
function article({id='123',author='Writer',text='hello',time=stamp,permalink=true,connected=true,
  inDialog=false,addressed=[],quotes=[],links=[],replyLabel='Replying to ',hasTweetInLabel=false,
  prefixTimes=[],suffixTimes=[],prefixBodies=[],suffixBodies=[],plainContainer=false,authorScope=null,nestedCard=false,headers=[],timePath}={}) {
  const embedded={},childArticle={},hidden={},canonical='/'+author+'/status/'+id;
  const card={isConnected:connected,parentElement:{closest:s=>s==='article'&&nestedCard?childArticle:null},matches:s=>s==='article'&&!plainContainer,contains:n=>n===embedded,
    closest:()=>inDialog?{}:null};
  const part=(scope,link)=>({closest:s=>{
    if(s==='article')return scope==='nested'?childArticle:plainContainer?null:card;
    if(s==='a[href]'||s==='a')return link;
    if(s==='[data-testid="tweetText"]')return scope==='body'?{}:null;
    if(s.includes('[role="link"]:not(a)'))return scope==='quote'?embedded:null;
    if(s.includes('[hidden]'))return scope==='hidden'?hidden:null;
    return null;
  }});
  const times=[...prefixTimes,{path:timePath??(permalink?canonical:null),date:time},...suffixTimes].map(({scope,path,date=stamp})=>{
    const link=path?{...anchor(path),...part(scope,null)}:null;
    return {...part(scope,link),dateTime:date,getAttribute:s=>s==='datetime'?date:null};
  });
  const bodies=[...prefixBodies,...(text===null?[]:[{text}]),...suffixBodies].map(({scope,text})=>({...part(scope,null),textContent:text}));
  const recipientNode={textContent:replyLabel+addressed.join(' '),
    querySelector:()=>hasTweetInLabel?{}:null,
    querySelectorAll:()=>addressed.map(anchor)};
  card.querySelector=selector=>selector==='time'?times[0]:selector==='[data-testid="tweetText"]'?bodies[0]:null;
  card.querySelectorAll=selector=>{
    if(selector==='[data-testid="User-Name"]')return headers.map(({scope=null,profiles})=>({...part(scope,null),querySelectorAll:q=>q==='a[href]'?profiles.map(([h,text])=>({...anchor(h),...part(scope,null),textContent:text})):[]}));
    if(selector==='time')return times;
    if(selector==='[data-testid="tweetText"]')return bodies;
    if(selector==='div[dir]')return addressed.length?[recipientNode]:[];
    if(selector==='[role="link"]:not(a)')return quotes.map(textContent=>({textContent}));
    if(selector==='a[href]')return [{...anchor('/'+author),...part(authorScope,null)},...(permalink?[{...anchor(canonical),...part(null,null)}]:[]),...links.map(h=>({...anchor(h),...part(null,null)}))];
    return [];
  };
  return card;
}
function dialog(cards=[], fallback=null) {
  return {
    querySelector:selector=>fallback?.querySelector(selector)||null,
    querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?cards:fallback?.querySelectorAll(selector)||[],
  };
}
function fixture(nodes=[], owner='/Owner',path='/home') {
  const context=vm.createContext({URL,location:{pathname:path},document:{
    querySelector:()=>owner?anchor(owner):null,
    querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?nodes:[],
  }});
  vm.runInContext(source,context);
  return context.XAssistantDOM;
}

test('DOM extraction returns bound status identity and detects exact reply recipient',()=>{
  const D=fixture(),node=article({addressed:['/owner'],quotes:['Quote @Other @WRITER']});
  const row=D.post(node);
  assert.equal(D.account(),'/owner');
  assert.equal(row.id,'123');
  assert.equal(row.author,'Writer');
  assert.equal(row.url,'https://x.com/Writer/status/123');
  assert.equal(row.at,Date.parse(stamp));
  assert.equal(row.addressed,true);
  assert.equal(row.directComment,false);
  assert.deepEqual(Array.from(row.replyRecipients),['/owner']);
  assert.deepEqual(Array.from(row.quoteHandles),['other','writer']);
  for(const attrs of [{addressed:['/owner2']},{addressed:['/owner'],replyLabel:'mention '},{addressed:['/owner'],hasTweetInLabel:true}]) {
    assert.equal(D.post(article(attrs)).addressed,false);
  }
  const multi=D.post(article({addressed:['/owner','/other']}));
  assert.equal(multi.addressed,true);assert.equal(multi.directComment,false);
});

test('rows ignore composer copies and posts lacking a status permalink',()=>{
  const D=fixture([article(),article({id:'456',inDialog:true}),article({permalink:false})]);
  assert.deepEqual(Array.from(D.rows('/owner'),row=>row.id),['123']);
});

test('relocation replaces detached article only with one exact current identity',()=>{
  const original=fixture().post(article({connected:false}));
  const current=article({text:'hello https://pic.x.com/abc'}),D=fixture([current]);
  assert.equal(D.relocate(original,'/owner').article,current);
  for(const attrs of [{id:'999'},{author:'Other'},{time:'2026-11-01T12:00:00.000Z'},{text:'changed'},{connected:false}]) {
    assert.equal(fixture([article(attrs)]).relocate(original,'/owner'),null);
  }
  assert.equal(fixture([article(),article()]).relocate(original,'/owner'),null);
  assert.equal(fixture([]).relocate(original,'/owner'),null);
});

test('notification relocation additionally requires exact current addressed account',()=>{
  const row=fixture().post(article());
  assert.equal(fixture([article()]).relocate(row,'/owner',true),null);
  assert.equal(fixture([article({addressed:['/owner2']})]).relocate(row,'/owner',true),null);
  assert.equal(fixture([article({addressed:['/owner']})]).relocate(row,'/owner',true).id,'123');
  assert.equal(fixture([article()]).relocate(row,'/owner',false).id,'123');
});

test('composer matching scopes identity to one article, not unrelated context cards',()=>{
  const D=fixture(),row=D.post(article());
  assert.equal(D.matches(dialog([article({id:'999'}),article()]),row),true);
  assert.equal(D.matches(dialog([article({id:'999'})]),row),false);
  assert.equal(D.matches(dialog([article({text:'changed'})]),row),false);
  assert.equal(D.matches(dialog([article({author:'Other'}),article({time:'wrong'})]),row),false);
});

test('composer without status permalink still requires exact author, timestamp and body',()=>{
  const D=fixture(),row=D.post(article());
  const exact=article({permalink:false,text:'hello https://pic.x.com/abc'});
  assert.equal(D.matches(dialog([exact]),row),true);
  assert.equal(D.matches(article({plainContainer:true,permalink:false,text:'hello https://pic.x.com/abc'}),row),true);
  for(const attrs of [{author:'Other'},{time:'wrong'},{text:'changed'}]) {
    assert.equal(D.matches(dialog([article({permalink:false,...attrs})]),row),false);
  }
});

test('composer quote suffix requires original quote handle and unchanged body',()=>{
  const D=fixture(),row=D.post(article({text:'body',quotes:['@deepseek_ai']}));
  assert.equal(D.matches(dialog([article({permalink:false,text:'body x.com/deepseek_ai/st…'})]),row),true);
  for(const text of ['body x.com/other/st…','changed x.com/deepseek_ai/st…']) {
    assert.equal(D.matches(dialog([article({permalink:false,text})]),row),false);
  }
});

test('normalization only removes trailing media links and preserves meaningful differences',()=>{
  const D=fixture();
  assert.equal(D.normalize('  hello\n world https://pic.x.com/abc '),'hello world');
  assert.notEqual(D.normalize('hello pic.x.com/abc is inline'),D.normalize('hello is inline'));
  assert.notEqual(D.normalize('Hello'),D.normalize('hello'));
});

test('ambiguous duplicate composer contexts are rejected',()=>{
 const D=fixture(),row=D.post(article());
 assert.equal(D.matches(dialog([article(),article()]),row),false);
});

test('thread root ownership distinguishes replies on other peoples originals',()=>{
 const D=fixture();
 D.ingestThreadRecords([{id:'10',root:'10',author:'Owner',parent:null},{id:'11',root:'10',author:'Friend',parent:'10'},
 {id:'20',root:'20',author:'Other',parent:null},{id:'21',root:'20',author:'Owner',parent:'20'},
 {id:'22',root:'20',author:'Other',parent:'21'}]);
 assert.equal(D.ownsOriginal('11','/owner'),true);
 assert.equal(D.ownsOriginal('22','/owner'),false);
 assert.equal(D.directChildOf('21','20'),true);assert.equal(D.directChildOf('22','20'),false);assert.equal(D.directChildOf('99','20'),false);
 assert.equal(D.ownsOriginal('99','/owner'),null);
 assert.equal(D.ownsOriginal('10','/owner'),null);
});

test('direct root reply identifies original author without a loaded root card',()=>{
 const D=fixture();
 D.ingestThreadRecords([{id:'31',root:'30',author:'Friend',parent:'30',parentAuthor:'Owner'},{id:'32',root:'20',author:'Other',parent:'21',parentAuthor:'Owner'}]);
 assert.equal(D.ownsOriginal('31','/owner'),true);
 assert.equal(D.ownsOriginal('32','/owner'),null);
});

test('own thread comments without recipient labels are replyable and relocatable',()=>{
 const node=article(),D=fixture([node],'/owner','/owner/status/100');
 D.ingestThreadRecords([{id:'123',root:'100',author:'Writer',parent:'100',parentAuthor:'owner'}]);
 const row=D.post(node);
 assert.equal(row.addressed,true);assert.equal(row.directComment,true);
 assert.ok(D.relocate(row,'/owner',true));
});
test('detail ownership cannot be inferred from page alone or unrelated recommendations',()=>{
 for(const [path,root,parentAuthor] of [['/other/status/100','100','other'],['/owner/status/100','200','owner'],['/owner/status/100','100','other']]){
  const node=article(),D=fixture([node],'/owner',path);
  D.ingestThreadRecords([{id:'123',root,author:'Writer',parent:root,parentAuthor}]);
  assert.equal(D.post(node).addressed,false);assert.equal(D.relocate(D.post(node),'/owner',true),null);
 }
 const D=fixture([article()],'/owner','/owner/status/100');assert.equal(D.post(article()).addressed,false);
});

// A real reply first mounted empty nested dialog shells over the home editor.
// The actual reply then had an article without a /status link: exact author,
// body and timestamp remained present inside the innermost dialog.
test('nested popup shells expose only the owned editor and still bind a permalink-less article',()=>{
 const row=fixture().post(article()), target=article({permalink:false});
 const homeEditor={},replyEditor={};let rendered=false;
 const inner={querySelector:()=>null,querySelectorAll:s=>s.includes('contenteditable')?(rendered?[replyEditor]:[]):s==='article[data-testid="tweet"]'?[target]:[]};
 const outer={querySelector:s=>s.includes('dialog')?inner:null,querySelectorAll:()=>[replyEditor]};
 const main={querySelectorAll:()=>[homeEditor]};
 const ctx=vm.createContext({URL,location:{pathname:'/compose/post'},document:{querySelector:s=>s.includes('AppTabBar')?anchor('/owner'):main,querySelectorAll:s=>s.includes('dialog')?[outer,inner]:[]}});
 vm.runInContext(source,ctx);const D=ctx.XAssistantDOM;
 assert.deepEqual(Array.from(D.dialogs()),[inner]);assert.equal(D.standaloneReply(row),null);
 assert.equal(D.replyEditor(inner),null);rendered=true;assert.equal(D.replyEditor(inner),replyEditor);assert.equal(D.matches(inner,row),true);
});
function standaloneFixture({path='/compose/post',label='回复 @Writer',copies=1,text='hello',time=stamp,author='Writer',buttonCount=1,editors=1}={}){
 const primary={},editor={parentElement:primary,closest:()=>null},row=fixture().post(article());
 const labelNode={textContent:label,closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
 primary.contains=n=>n===primary||n===editor;
 primary.querySelectorAll=s=>s.includes('contenteditable')?Array(editors).fill(editor):s.includes('tweetButton')?Array(buttonCount).fill({}):s==='time'?Array(copies).fill({}):s==='article[data-testid="tweet"]'?Array(copies).fill(article({permalink:false,text,time,author})):s==='[dir],button,[role="button"]'?[labelNode]:[];
 const ctx=vm.createContext({URL,location:{pathname:path},document:{querySelector:s=>s.includes('AppTabBar')?anchor('/owner'):primary,querySelectorAll:()=>[]}});
 vm.runInContext(source,ctx);return{result:ctx.XAssistantDOM.standaloneReply(row),primary,editor};
}
test('standalone reply requires one editor, submitter and proven parent plus explicit recipient',()=>{
 for(const label of ['回复 @Writer','Replying to @Writer','返信先: @Writer']){const f=standaloneFixture({label});assert.equal(f.result?.dialog,f.primary);assert.equal(f.result?.editor,f.editor);}
 for(const change of [{path:'/home'},{label:'Quote post'},{label:'Replying to @WriterExtra'},{text:'changed'},{author:'Other'},{time:'invalid'},{copies:2},{buttonCount:2},{editors:2}])assert.equal(standaloneFixture(change).result,null,JSON.stringify(change));
});

// Mirror the real status surface: the expanded root article and
// inline_reply_offscreen share a cell; sibling comments have their own cells.
function detailFixture(opts={}){
 const row=fixture().post(article()),target=article(opts.target),other=article({id:'999'});
 const holder={},editor={closest:()=>opts.hidden?{}:null},button={textContent:opts.label??'回复',getAttribute:()=>null,closest:()=>null};
 const cell={querySelectorAll:()=>opts.cellOther?[other]:[target]};
 const scope={closest:s=>s.includes('cellInnerDiv')?cell:null,contains:e=>e===editor||e===button&&!opts.outsideButton,
   querySelector:s=>s.includes('article')&&opts.nestedArticle?other:null,querySelectorAll:s=>s.includes('contenteditable')?[editor]:[]};
 target.compareDocumentPosition=()=>opts.orderWrong?2:4;
 const cards=opts.duplicateTarget?[target,article(),other]:[target,other];
 const main={closest:()=>null,querySelectorAll:s=>s.startsWith('article')?cards:s==='[contenteditable="true"]'?Array(opts.editorCount??1).fill(editor):s.includes('tweetButtonInline')?Array(opts.buttonCount??1).fill(button):s.includes('inline_reply_offscreen')?(opts.noWrapper?[]:[scope]):[]};
 const popup={querySelector:()=>null};
 const ctx=vm.createContext({URL,location:new URL(opts.path??'/Writer/status/123','https://x.com'),document:{querySelector:s=>s.includes('AppTabBar')?anchor('/owner'):null,
  querySelectorAll:s=>s.includes('primaryColumn')?[main]:s.includes('dialog')&&opts.popup?[popup]:[]}});vm.runInContext(source,ctx);
 return {D:ctx.XAssistantDOM,row,scope,editor,button};
}
test('status inline ownership requires its exact root status, full content and single reply form in the same cell',()=>{
 for(const label of ['回复','Reply','回覆','返信']){
  const {D,row,scope,editor,button}=detailFixture({label});
  const m=D.detailReply(row);assert.equal(m?.dialog,scope);assert.equal(m.editor,editor);assert.equal(m.button,button);assert.equal(D.detailReply(row,true).reason,'ready');
 }
 for(const change of [{path:'/compose/post'},{path:'/Writer/status/999'},{path:'/Other/status/123'},{target:{time:'different'}},{target:{text:'edited'}},{target:{author:'Different'}},{target:{permalink:false}},{duplicateTarget:true},{cellOther:true},{orderWrong:true},{hidden:true},{editorCount:2},{buttonCount:2},{noWrapper:true},{outsideButton:true},{label:'发帖'},{popup:true},{nestedArticle:true}]){
   const {D,row}=detailFixture(change);assert.equal(D.detailReply(row),null,JSON.stringify(change));assert.notEqual(D.detailReply(row,true).reason,'ready');
 }
});

const detailHistory='/Writer/status/123/history',validHeader={profiles:[['/Writer','Display'],['/Writer','@Writer']]};
test('edited post history time may identify only the exact current detail, never a list/deletion/composer navigation anchor',()=>{
 const target={timePath:detailHistory,headers:[validHeader]},f=detailFixture({target}),card=article(target);
 const result=f.D.detailReply(f.row);assert.equal(result?.dialog,f.scope);assert.equal(result.editedDetail,true);assert.equal(detailFixture().D.detailReply(f.row).editedDetail,false);assert.equal(f.D.detailReply(f.row,true).reason,'ready');
 assert.equal(f.D.statusStamp(card),null);assert.equal(f.D.post(card),null);
 assert.equal(f.D.matches(dialog([card]),f.row),false);
 for(const bad of [
  {path:'/writer/status/123/history'},{path:'/writer/status/123?via=x'},{path:'/writer/status/123#quote'},{path:'https://not-x.example/Writer/status/123'},
  {target:{headers:[]}},{target:{headers:[validHeader,validHeader]}},{target:{headers:[{profiles:[['/Impostor','@Writer']]}]}},
  {target:{headers:[{profiles:[['/Writer','NameOnly']]}]}},{target:{headers:[{profiles:[['/Writer','@Writer'],['/Wrong','@Wrong']]}]}},
  {target:{headers:[{...validHeader,scope:'quote'}]}},{target:{headers:[{...validHeader,scope:'body'}]}},
  {target:{timePath:'/Writer/status/999/history'}},{target:{timePath:'/Else/status/123/history'}},{target:{timePath:detailHistory+'?a'}},
  {target:{time:'2026-11-02T12:00:01Z'}},{target:{text:'old version'}},{target:{suffixTimes:[{path:'/Writer/status/123'}]}},
  {target:{prefixTimes:[{path:'/Writer/status/123'}]}},{target:{suffixTimes:[{path:detailHistory}]}},
  {target:{timePath:'/Writer/status/123/analytics',prefixTimes:[{scope:'quote',path:detailHistory}]}},
  {cellOther:true},{noWrapper:true},{buttonCount:2},{outsideButton:true}
 ]){
  const g=detailFixture({...bad,target:{...target,...bad.target}});
  assert.equal(g.D.detailReply(g.row),null,JSON.stringify(bad));
 }
});
test('expanded quote timestamp precedes the native root permalink: bind only the outer post and its own body',()=>{
 const attrs={prefixTimes:[{scope:'quote',path:null,date:'2026-11-02T13:00:00.000Z'}],prefixBodies:[{scope:'quote',text:'unrelated long quotation'}]};
 const D=fixture(),card=article(attrs),p=D.post(card);
 assert.equal(p.id,'123');assert.equal(p.time,stamp);assert.equal(p.text,'hello');
 assert.equal(D.statusStamp(card).time,card.querySelectorAll('time')[1]);
 assert.equal(D.statusStamp(card).link.getAttribute('href'),'/Writer/status/123');
 assert.equal(D.matches(dialog([card]),p),true);
 const f=detailFixture({target:attrs});assert.equal(f.D.detailReply(f.row,true).reason,'ready');
 for(const scope of ['quote','nested','hidden']){
   const foreign={scope,path:'/Writer/status/123'};
   const missing={permalink:false,prefixTimes:[foreign]};
   assert.equal(D.post(article(missing)),null);
   const wrong=detailFixture({target:missing});assert.equal(wrong.D.detailReply(wrong.row),null);
   const noText=article({text:null,prefixBodies:[{scope,text:'hello'}]});assert.equal(D.post(noText).text,'');
   const quoteOnly=detailFixture({target:{text:null,prefixBodies:[{scope,text:'hello'}]}});assert.equal(quoteOnly.D.detailReply(quoteOnly.row),null);
 }
});
test('two plausible outer status anchors or two outer bodies are ambiguous, even when one matches',()=>{
 const D=fixture(),row=D.post(article());
 for(const target of [{suffixTimes:[{path:'/Other/status/456'}]},{suffixTimes:[{path:'/Writer/status/123'}]},
   {suffixBodies:[{text:'another body'}]}]){
  assert.equal(D.post(article(target)),null);
  assert.equal(D.matches(dialog([article(target)]),row),false);
  const f=detailFixture({target});assert.equal(f.D.detailReply(f.row),null);
 }
 const quotedLink=article({prefixTimes:[{scope:'quote',path:'/Other/status/456'}]});
 assert.equal(D.statusStamp(quotedLink).id,'123');
});

test('missing/invalid dates or a nested article cannot supply status identity',()=>{
 const D=fixture(),row=D.post(article());
 for(const target of [{time:''},{time:'invalid'},{nestedCard:true}]){
  assert.equal(D.statusStamp(article(target)),null);assert.equal(D.post(article(target)),null);
  assert.equal(D.matches(dialog([article(target)]),row),false);
  const f=detailFixture({target});assert.equal(f.D.detailReply(f.row),null);
 }
});
test('a plain composer may not borrow its author profile link from a quotation, nested card, hidden block or body mention',()=>{
 const D=fixture(),row=D.post(article());
 for(const authorScope of ['quote','nested','hidden','body']){
  assert.equal(D.matches(dialog([article({permalink:false,authorScope})]),row),false);
 }
});
test('zero matching cards reports the failed comparison without leaking either body or relaxing ownership',()=>{
 for(const [target,expected] of [[{permalink:false},[0,0,0]],[{author:'Different'},[1,0,0]],[{time:'2026-11-02T13:00:00.000Z'},[1,1,0]],[{text:'changed-sensitive-body'},[1,1,1]]]){
  const {D,row}=detailFixture({target});const d=D.detailReply(row,true);
  assert.equal(D.detailReply(row),null);assert.equal(d.reason,'target');assert.equal(d.target,0);
  assert.deepEqual([d.idMatches,d.linkMatches,d.timeMatches],expected);
  assert.equal(JSON.stringify(d).includes('sensitive-body'),false);
 }
});

test('loaded direct-child evidence counts unique same-root metadata only, without creating any DOM row',()=>{
 const D=fixture([]);
 D.ingestThreadRecords([['100','100',null],['101','100','100'],['101','100','100'],['102','100','101'],['103','999','100'],['200','200',null]].map(([id,root,parent])=>({id,root,parent,author:'who'})));
 assert.equal(D.loadedDirectChildren('100'),1);assert.equal(D.loadedDirectChildren('bad'),0);assert.equal(D.rows('/owner').length,0);
});

test('a direct like requires the comment parent to be the owner original; same-root grandchildren are excluded',()=>{
 const d=fixture([]);d.ingestThreadRecords([
  {id:'100',root:'100',author:'owner',parent:null},{id:'101',root:'100',author:'other',parent:'100',parentAuthor:'owner'},
  {id:'102',root:'100',author:'other',parent:'101',parentAuthor:'other'},
  {id:'200',root:'200',author:'other',parent:null},{id:'201',root:'200',author:'other',parent:'200',parentAuthor:'owner'},
  {id:'301',root:'300',author:'other',parent:'300',parentAuthor:'owner'},{id:'401',root:'400',author:'other',parent:'400'}]);
 for(const id of ['101','301'])assert.equal(d.directOnOwnOriginal(id,'/Owner'),true);
 for(const id of ['100','102','201','401','999'])assert.equal(d.directOnOwnOriginal(id,'/Owner'),false);
 assert.equal(d.directOnOwnOriginal('101','/foreign'),false);
});
