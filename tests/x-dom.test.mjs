import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fixtureImageBase64,fixtureImageResponse} from './reply-test-fixtures.mjs';

const source=readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
const stamp='2026-11-02T12:00:00.000Z';
const anchor=href=>({href:new URL(href,'https://x.com').href,getAttribute:name=>name==='href'?href:null});

// Minimal DOM nodes answer real production selectors; no sliced implementation.
function article({id='123',author='Writer',text='hello',time=stamp,permalink=true,connected=true,
  inDialog=false,addressed=[],quotes=[],links=[],replyLabel='Replying to ',hasTweetInLabel=false,
  prefixTimes=[],suffixTimes=[],prefixBodies=[],suffixBodies=[],showMoreScopes=[],plainContainer=false,authorScope=null,nestedCard=false,headers=[],timePath}={}) {
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
    if(selector==='[data-testid="tweet-text-show-more-link"]')return showMoreScopes.map(scope=>part(scope,null));
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

test('receipt metadata requires own root, exact child and author; never strip arbitrary mentions',()=>{
 const D=fixture(),id='2124117383170478541',r={id,root:'10',parent:'20',author:'OwNeR',text:'@Other 正文',replyTextPrefix:'@Other '};
 D.ingestThreadRecords([{id:'10',root:'10',author:'Owner'},{id:'20',root:'10',parent:'10',author:'Other'},r]);
 let res=D.receiptChildren('10','20','/owner');assert.equal(res.length,1);assert.equal(res[0].text,'正文');assert.equal(new Date(res[0].at).toISOString(),'2026-11-21T12:27:02.997Z');
 for(const change of [{author:'Other'},{parent:'21'},{root:'11'},{imageUrls:['https://pbs.twimg.com/example']}]){D.ingestThreadRecords([{...r,...change}]);assert.equal(D.receiptChildren('10','20','/owner').length,0);}
 D.ingestThreadRecords([{...r,replyTextPrefix:''}]);assert.equal(D.receiptChildren('10','20','/owner')[0].text,'@Other 正文');assert.equal(D.receiptChildren('10','20','/other').length,0);
});
test('posting video lookup requires exact author, post, video index and allowlisted media evidence',()=>{
 const D=fixture(),url='https://x.com/Writer/status/123/video/1',src='https://video.twimg.com/ext_tw_video/456/vid/avc1/clip.mp4?tag=12';
 const record={id:'123',root:'123',author:'Writer',text:'source',videoUrls:[url],videoSources:[{url,urls:[src]}]};
 D.ingestThreadRecords([record]);assert.deepEqual(Array.from(D.postingVideoSources(url)),[src]);
 const result=D.postingVideoSources(url);result.push('changed');assert.equal(D.postingVideoSources(url).length,1);
 for(const other of [url.replace('/Writer/','/Other/'),url.replace('/123/','/124/'),url.replace('/video/1','/video/2'),url+'?s=20',url.replace('https://','https://u:p@')])assert.deepEqual(Array.from(D.postingVideoSources(other)),[]);
 for(const change of [{videoUrls:[]},{videoSources:[{url,urls:[src.replace('video.twimg.com','evil.example')]}]},{videoSources:[{url,urls:[src+'#fragment']}]},{videoSources:[{url,urls:[]}]},{videoSources:Array(5).fill({url,urls:[src]})}]){
  D.ingestThreadRecords([{...record,...change}]);assert.deepEqual(Array.from(D.postingVideoSources(url)),[]);
 }
 D.ingestThreadRecords([{...record,author:'Other'}]);assert.deepEqual(Array.from(D.postingVideoSources(url)),[]);
});

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

test('comment rows expose the canonical root post needed for viewpoint fusion',()=>{
 const D=fixture(),node=article({id:'11',author:'Friend',text:'评论观点'});
 D.ingestThreadRecords([{id:'10',root:'10',author:'Owner',parent:null,text:'所属帖子观点'},{id:'11',root:'10',author:'Friend',parent:'10',text:'评论观点'}]);
 const row=D.post(node);assert.equal(row.isComment,true);
 assert.deepEqual(JSON.parse(JSON.stringify(row.rootPost)),{id:'10',author:'owner',text:'所属帖子观点',url:'https://x.com/owner/status/10'});
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
 const target=article(opts.target),other=article({id:'999'});
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
 const D=ctx.XAssistantDOM;D.ingestThreadRecords(opts.records||[]);
 const row=D.post(article(opts.source));
 return {D,row,scope,editor,button};
}
test('reply context follows exact parent IDs, not adjacent or sibling comments',()=>{
 const {D,row}=detailFixture();
 const records=[
  {id:'100',root:'100',author:'Root',parent:null,text:'原帖'},
  {id:'110',root:'100',author:'Owner',parent:'100',text:'此前交流'},
  {id:'111',root:'100',author:'Sibling',parent:'100',text:'不能混进来的旁支'},
  {id:'123',root:'100',author:'Writer',parent:'110',text:'hello'}
 ];
 D.ingestThreadRecords(records);
 const c=D.replyContext(row,'/owner');assert.equal(c.root.id,'100');assert.deepEqual(Array.from(c.history,r=>r.id),['110']);assert.equal(c.target.id,'123');
 D.ingestThreadRecords([{...records[0],text:'更新后的原帖'}]);assert.equal(D.replyContext(row,'/owner').root.text,'更新后的原帖');
});
test('incomplete, cyclic and cross-conversation metadata cannot produce a reply prompt',()=>{
 for(const parents of [[],[{id:'110',root:'100',parent:'110',author:'owner',text:'cycle'}],[{id:'110',root:'999',parent:'100',author:'owner',text:'wrong thread'}]]){
  const {D,row}=detailFixture();D.ingestThreadRecords([{id:'100',root:'100',author:'root',text:'root'},{id:'123',root:'100',parent:'110',author:'writer',text:'hello'},...parents]);
  assert.equal(D.replyContext(row,'/owner'),null);
 }
});
test('full detail and target metadata must agree; source cards alone cannot supply context',()=>{
 const {D,row}=detailFixture();
 for(const text of ['hello','stale']){
  D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text}]);
  const c=D.replyContext(row,'/owner');if(text==='hello'){assert.equal(c.root.id,c.target.id);assert.equal(c.history.length,0);}else assert.equal(c,null);
 }
 const list=fixture();list.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'hello'}]);assert.equal(list.replyContext(row,'/owner'),null);
});
test('reply context tolerates only the own-media suffix hidden by the rendered post',()=>{
 const {D,row}=detailFixture(),url='https://t.co/OwnMedia1';
 D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'hello '+url,mediaTextUrls:[url]}]);
 const c=D.replyContext(row,'/owner');assert.ok(c);assert.equal(c.target.text,'hello');assert.equal(c.root.text,'hello');assert.equal(c.history.length,0);
 const shown=detailFixture({source:{text:'hello '+url},target:{text:'hello '+url}});
 shown.D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'hello '+url,mediaTextUrls:[url]}]);
 assert.equal(shown.D.replyContext(shown.row,'/owner').target.text,'hello '+url);
});
test('reply context handles repeated and multiple known media suffixes without altering branch text',()=>{
 const {D,row}=detailFixture(),a='https://t.co/Photo1',b='https://t.co/Video2';
 D.ingestThreadRecords([{id:'100',root:'100',author:'root',text:'原帖 '+a,mediaTextUrls:[a]},
  {id:'123',root:'100',parent:'100',author:'writer',text:'hello\n'+a+' '+b+' '+a,mediaTextUrls:[a,b]}]);
 const c=D.replyContext(row,'/owner');assert.ok(c);assert.equal(c.target.text,'hello');assert.equal(c.root.text,'原帖 '+a);
});
test('media matching never strips ordinary, unknown, embedded or malformed links',()=>{
 const url='https://t.co/OwnMedia1';
 for(const [text,mediaTextUrls] of [
  ['hello '+url,undefined],['hello https://t.co/Unknown',[url]],['hello '+url+'Extra',[url]],
  ['hello '+url+'.',[url]],['hello https://t.co.evil.test/OwnMedia1',['https://t.co.evil.test/OwnMedia1']],
  ['hello '+url+' suffix',[url]],[url+' hello',[url]],['hello'+url,[url]],
  ['hello '+url,[url,null]],['hello '+url,Array(5).fill(url)]
 ]){
  const {D,row}=detailFixture();D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text,mediaTextUrls}]);
  assert.equal(D.replyContext(row,'/owner'),null,JSON.stringify({text,mediaTextUrls}));
 }
});
test('known media links do not excuse changed body, wrong identity or unavailable ancestors',()=>{
 const url='https://t.co/OwnMedia1';
 for(const change of [{text:'different '+url},{author:'other'},{root:'100',parent:'100'}]){
  const {D,row}=detailFixture();D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'hello '+url,mediaTextUrls:[url],...change}]);
  assert.equal(D.replyContext(row,'/owner'),null);
 }
 const edited=detailFixture({target:{text:'edited'}});edited.D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'edited '+url,mediaTextUrls:[url]}]);
 assert.equal(edited.D.replyContext(edited.row,'/owner'),null);
});
test('an own-media URL alone cannot turn an empty post into readable reply context',()=>{
 const {D,row}=detailFixture({source:{text:''},target:{text:''}}),url='https://t.co/OwnMedia1';
 D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:url,mediaTextUrls:[url]}]);
 assert.equal(D.replyContext(row,'/owner'),null);
});
test('owned image-only comments become readable context while plain empty comments stay unreadable',()=>{
 const image=detailFixture({source:{text:''},target:{text:''}});
 image.D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'',imageUrls:['https://pbs.twimg.com/media/Only.jpg']}]);
 const context=image.D.replyContext(image.row,'/owner');assert.ok(context);assert.equal(context.target.text,'');
 assert.deepEqual(Array.from(context.target.imageUrls),['https://pbs.twimg.com/media/Only.jpg']);assert.equal(image.D.replyVideoOnly(image.row),false);
 const empty=detailFixture({source:{text:''},target:{text:''}});empty.D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:''}]);
 assert.equal(empty.D.replyContext(empty.row,'/owner'),null);
});
test('video skip follows own target and ancestors, including MP4 GIFs, but not siblings or photos',()=>{
 for(const media of [{videoUrls:['https://x.com/root/status/100/video/1']},{gifUrls:['https://video.twimg.com/tweet_video/A.mp4']},{missingGif:true}]){
  for(const onRoot of [false,true]){
   const {D,row}=detailFixture();D.ingestThreadRecords([{id:'100',root:'100',author:'root',text:'root',...(onRoot?media:{})},{id:'123',root:'100',parent:'100',author:'writer',text:'hello',...(!onRoot?media:{})}]);assert.equal(D.replyHasVideo(row),true);
  }
 }
 const {D,row}=detailFixture();D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'hello',imageUrls:['https://pbs.twimg.com/media/A.jpg']},{id:'999',root:'123',parent:'123',author:'sibling',videoUrls:['https://x.com/sibling/status/999/video/1']}]);assert.equal(D.replyHasVideo(row),false);
 D.ingestThreadRecords([{id:'123',root:'123',author:'wrong',text:'hello',videoUrls:['https://x.com/wrong/status/123/video/1']}]);assert.equal(D.replyHasVideo(row),false);
});
test('video-only ancestors are explicit unavailable context without blocking readable target text',()=>{
 const {D,row}=detailFixture();D.ingestThreadRecords([
  {id:'100',root:'100',author:'root',text:'',videoUrls:['https://x.com/root/status/100/video/1']},
  {id:'123',root:'100',parent:'100',author:'writer',text:'hello'}
 ]);
 const context=D.replyContext(row,'/owner');assert.ok(context);assert.equal(context.root.text,'');assert.equal(context.root.videoUnavailable,true);
 assert.equal(D.replyHasVideo(row),true);assert.equal(D.replyVideoOnly(row),false);
 const only=detailFixture({source:{text:''},target:{text:''}});only.D.ingestThreadRecords([{id:'123',root:'123',author:'writer',text:'',videoUrls:['https://x.com/writer/status/123/video/1']}]);
 assert.equal(only.D.replyVideoOnly(only.row),true);
});
test('visible native video skips even before metadata arrives without borrowing a neighboring card',()=>{
 const D=fixture(),card=article(),base=card.querySelectorAll;
 const video={closest:s=>s==='article'?card:null};card.querySelectorAll=s=>s==='[data-testid="videoPlayer"]'?[video]:base(s);
 const row=D.post(card);assert.equal(D.replyHasVideo(row),true);
 video.closest=s=>s==='article'?article({id:'999'}):null;assert.equal(D.replyHasVideo(row),false);
});
test('status inline ownership requires its exact root status, full content and single reply form in the same cell',()=>{
 for(const label of ['回复','Reply','回覆','返信']){
  const {D,row,scope,editor,button}=detailFixture({label});
  const m=D.detailReply(row);assert.equal(m?.dialog,scope);assert.equal(m.editor,editor);assert.equal(m.button,button);assert.equal(D.detailReply(row,true).reason,'ready');
 }
 for(const change of [{path:'/compose/post'},{path:'/Writer/status/999'},{path:'/Other/status/123'},{target:{time:'different'}},{target:{text:'edited'}},{target:{author:'Different'}},{target:{permalink:false}},{duplicateTarget:true},{cellOther:true},{orderWrong:true},{hidden:true},{editorCount:2},{buttonCount:2},{noWrapper:true},{outsideButton:true},{label:'发帖'},{popup:true},{nestedArticle:true}]){
   const {D,row}=detailFixture(change);assert.equal(D.detailReply(row),null,JSON.stringify(change));assert.notEqual(D.detailReply(row,true).reason,'ready');
 }
});

test('status detail accepts expanded text only when the exact source body carried native truncation proof',()=>{
 const preview='这是一个足够长且只在列表里被截断的评论正文，用来验证详情页展开后的安全绑定';
 const full=preview+'，后面还有进入详情页才显示的完整观点。';
 const expanded=detailFixture({source:{text:preview,showMoreScopes:['body']},target:{text:full}});
 assert.equal(expanded.row.clipped,true);
 assert.equal(expanded.D.detailReply(expanded.row,true).reason,'ready');
 assert.equal(expanded.D.detailReply(expanded.row).text,full);
 const unproven=detailFixture({source:{text:preview},target:{text:full}});
 assert.equal(unproven.D.detailReply(unproven.row),null);
 for(const change of [
  {source:{text:preview,showMoreScopes:['body']},target:{text:'前缀已经变化，'+full}},
  {source:{text:'太短',showMoreScopes:['body']},target:{text:'太短但详情更长'}},
  {source:{text:preview,showMoreScopes:['quote']},target:{text:full}},
  {source:{text:preview,showMoreScopes:['hidden']},target:{text:full}}
 ]){
  const f=detailFixture(change);assert.equal(f.D.detailReply(f.row),null,JSON.stringify(change));
 }
});

const shortPreviewFull='嗯嗯  我说的想象尤指一种明天或者下一刻的希望，不然我们是很难坚持到下一刻的，如果你知道你的生活底层是苦难铺满的，每走一步都是艰难，你还会选择继续走下去吧，大概率我们人类是忍受不了这种持续的极致的苦难的，但我们拥有内心创造出来的美好想象，不管是艺术音乐还是不确定的未来里能带来的可能性的美好，都是我们的想象，柳暗花明，人生本底是苦难，但我们要活成灿烂潇洒的人生';
const shortPreviewRecords=[{id:'100',root:'100',author:'Owner',text:'原帖'},
 {id:'123',root:'100',parent:'100',author:'Writer',text:shortPreviewFull}];
const shortPreviewFixture=(opts={})=>detailFixture({source:{text:'嗯嗯',showMoreScopes:['body']},target:{text:shortPreviewFull},records:shortPreviewRecords,...opts});

test('a native two-character preview binds the full source-time record through detail and reply context',()=>{
 const {D,row}=shortPreviewFixture();
 assert.equal(shortPreviewFull.length,180);assert.equal(row.clipped,true);
 assert.equal(D.detailTextMatches(row,shortPreviewFull),true);
 assert.equal(D.detailReply(row,true).reason,'ready');
 assert.equal(D.replyContext(row,'/owner').target.text,shortPreviewFull);
 // Repeated validation uses the same source row; harmless count updates do not invalidate it.
 D.ingestThreadRecords([{...shortPreviewRecords[1],replyCount:3}]);
 assert.equal(D.detailReply(row,true).reason,'ready');
 assert.equal(D.replyContext(row,'/owner').target.text,shortPreviewFull);
});

test('short previews keep source proof through generation and the last pre-submit validation',async()=>{
 const {D,row}=shortPreviewFixture();let request;
 class TaskError extends Error{constructor(code,message){super(message);this.code=code;}}
 const ctx=vm.createContext({Date,XAssistantDOM:D,
  XAssistantTasks:{TaskError,check:()=>{},waitForPage:async read=>read(),bounded:fn=>fn()},
  XAssistantRuntime:{call:async msg=>{request=msg;return {action:'send_reply',text:'能理解你的意思。',postId:row.id};}}
 });
 vm.runInContext(readFileSync(new URL('../reply-preparation.js',import.meta.url),'utf8'),ctx);
 const prepared=await ctx.XAssistantReplyPreparation.generate({row,account:'/owner',module:'notifications',runId:'fixture'});
 assert.equal(request.post.text,shortPreviewFull);assert.equal(prepared.sourceText,shortPreviewFull);
 assert.equal(row.text,'嗯嗯');assert.equal(row.clipped,true);
 assert.doesNotThrow(()=>prepared.validatePrepared());
 // The engine carries full text into its editor row, but its preparation
 // callback must still check the original short source and native snapshot.
 const editorRow={...row,text:prepared.sourceText,clipped:false};
 assert.equal(D.detailReply(editorRow,true).reason,'ready');
 D.ingestThreadRecords([{...shortPreviewRecords[1],text:shortPreviewFull+' edited'}]);
 assert.throws(()=>prepared.validatePrepared(),error=>error.code==='TARGET_UPDATED');
});

test('short preview proof cannot be invented, copied, acquired later or borrowed from another thread record',()=>{
 for(const records of [[],[shortPreviewRecords[0]],
  [shortPreviewRecords[0],{...shortPreviewRecords[1],id:'124'}],
  [shortPreviewRecords[0],{...shortPreviewRecords[1],author:'Other'}],
  [shortPreviewRecords[0],{...shortPreviewRecords[1],root:'200'}],
  [shortPreviewRecords[0],{...shortPreviewRecords[1],parent:'110'}],
  [shortPreviewRecords[0],{...shortPreviewRecords[1],text:'不同正文'}]]){
  const {D,row}=shortPreviewFixture({records});
  assert.equal(D.detailReply(row),null,JSON.stringify(records));
  D.ingestThreadRecords(shortPreviewRecords);
  assert.equal(D.detailReply(row),null,'late metadata cannot bless an old source row');
 }
 const {D,row}=shortPreviewFixture();
 assert.equal(D.detailTextMatches({...row},shortPreviewFull),false);
 for(const change of [{id:'124'},{author:'Other'},{time:'2026-11-01T12:00:00.000Z'},{text:'嗯'},{clipped:false}]){
  const original={...row};Object.assign(row,change);
  assert.equal(D.detailTextMatches(row,shortPreviewFull),false,JSON.stringify(change));
  Object.assign(row,original);
 }
});

test('short preview validation rejects changed target identity and changed native content at send time',()=>{
 for(const target of [{id:'124',text:shortPreviewFull},{author:'Other',text:shortPreviewFull},
  {time:'2026-11-01T12:00:00.000Z',text:shortPreviewFull},{text:shortPreviewFull+' changed'},
  {text:'嗯嗯 '+shortPreviewFull},{text:shortPreviewFull.slice(0,60)}]){
  const {D,row}=shortPreviewFixture({target});assert.equal(D.detailReply(row),null,JSON.stringify(target));
 }
 for(const change of [{author:'Other'},{root:'200'},{parent:'110'},{parentAuthor:'Other'},
  {text:shortPreviewFull+' changed'},{text:shortPreviewFull.replace('苦难','快乐')},
  {mediaTextUrls:['https://t.co/Changed']}]){
  const {D,row}=shortPreviewFixture();assert.equal(D.detailReply(row,true).reason,'ready');
  D.ingestThreadRecords([{...shortPreviewRecords[1],...change}]);
  assert.equal(D.detailReply(row),null,JSON.stringify(change));
  assert.equal(D.replyContext(row,'/owner'),null);
 }
});

test('short native previews preserve whitespace and proven recipient/media rules without accepting empty bodies',()=>{
 const url='https://t.co/OwnMedia1',prefix='@Owner ';
 for(const visible of [shortPreviewFull,shortPreviewFull.replace('  ','\n\n'),shortPreviewFull+' '+url]){
  const {D,row}=shortPreviewFixture({target:{text:visible},records:[shortPreviewRecords[0],
   {...shortPreviewRecords[1],text:prefix+shortPreviewFull+' '+url,replyTextPrefix:prefix,mediaTextUrls:[url]}]});
  assert.equal(D.detailReply(row,true).reason,'ready');
  assert.equal(D.replyContext(row,'/owner').target.text,visible);
 }
 for(const change of [{replyTextPrefix:undefined},{mediaTextUrls:[]},{text:prefix+shortPreviewFull+' https://t.co/Unknown'}]){
  const {D,row}=shortPreviewFixture({records:[shortPreviewRecords[0],
   {...shortPreviewRecords[1],text:prefix+shortPreviewFull+' '+url,replyTextPrefix:prefix,mediaTextUrls:[url],...change}]});
  assert.equal(D.detailReply(row),null,JSON.stringify(change));
 }
 for(const text of ['', ' \n ']){
  const {D,row}=shortPreviewFixture({source:{text,showMoreScopes:['body']}});
  assert.equal(D.detailTextMatches(row,shortPreviewFull),false);
 }
 const {D,row}=shortPreviewFixture();
 for(const visible of [null,undefined,'',' ',shortPreviewFull+' https://t.co/Unknown'])assert.equal(D.detailTextMatches(row,visible),false);
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
 assert.deepEqual(Array.from(D.loadedThreadIds('100')).sort(),['101','102']);assert.equal(D.loadedDirectChildren('100'),1);assert.equal(D.loadedDirectChildren('bad'),0);assert.equal(D.rows('/owner').length,0);
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

test('comment root media survives original card virtualization, including textless originals',()=>{
 const D=fixture(),node=article({id:'11',author:'Friend',text:'评论观点'});
 const imageUrls=['https://pbs.twimg.com/media/A.jpg'],videoUrls=['https://x.com/Owner/status/10/video/2'];
 D.ingestThreadRecords([{id:'10',root:'10',author:'Owner',parent:null,text:'',imageUrls,videoUrls},{id:'11',root:'10',author:'Friend',parent:'10',text:'评论观点'}]);
 const row=D.post(node);assert.equal(row.isComment,true);
 assert.deepEqual(JSON.parse(JSON.stringify(row.rootPost)),{id:'10',author:'owner',text:'',url:'https://x.com/owner/status/10',imageUrls,videoUrls});
});
test('own media metadata cannot attach to a card with a different author',()=>{
 const D=fixture();D.ingestThreadRecords([{id:'123',root:'123',author:'Other',imageUrls:['https://pbs.twimg.com/media/Foreign.jpg']}]);
 assert.equal(D.post(article()).imageUrls,undefined);
});
test('a textless GIF-only original remains available to comments when its card is unmounted',()=>{
 const D=fixture(),gifUrls=['https://video.twimg.com/tweet_video/Animation.mp4'];
 D.ingestThreadRecords([{id:'10',root:'10',author:'Owner',parent:null,text:'',gifUrls},{id:'11',root:'10',author:'Friend',parent:'10',text:'评论观点'}]);
 const row=D.post(article({id:'11',author:'Friend',text:'评论观点'}));
 assert.deepEqual(Array.from(row.rootPost.gifUrls),gifUrls);assert.equal(row.rootPost.text,'');assert.equal(row.gifUrls,undefined);
});

test('reply context preserves photos of root, ancestors and target but never a sibling photo',()=>{
 const {D,row}=detailFixture(),records=[
  {id:'100',root:'100',author:'root',text:'早餐',imageUrls:['https://pbs.twimg.com/media/Root.jpg']},
  {id:'110',root:'100',parent:'100',author:'owner',text:'这是我的',imageUrls:['https://pbs.twimg.com/media/History.jpg']},
  {id:'123',root:'100',parent:'110',author:'writer',text:'hello',imageUrls:['https://pbs.twimg.com/media/Target.jpg']},
  {id:'999',root:'100',parent:'100',author:'other',text:'旁支',imageUrls:['https://pbs.twimg.com/media/Sibling.jpg']}
 ];D.ingestThreadRecords(records);
 const c=JSON.parse(JSON.stringify(D.replyContext(row,'/owner')));
 assert.deepEqual(c.root.imageUrls,records[0].imageUrls);assert.deepEqual(c.history[0].imageUrls,records[1].imageUrls);assert.deepEqual(c.target.imageUrls,records[2].imageUrls);assert.ok(!JSON.stringify(c).includes('Sibling'));
 D.ingestThreadRecords([{...records[0],imageUrls:['https://pbs.twimg.com/media/Changed.jpg']}]);
 assert.notDeepEqual(D.replyContext(row,'/owner').root.imageUrls,c.root.imageUrls);
});

test('breakfast photo fixture flows from observed X metadata to actual multimodal API payload on both routes',async()=>{
 const text='兄弟们这算A8早餐吗，打几分？',messages=[];
 const tweet={rest_id:'123',legacy:{conversation_id_str:'123',full_text:text+' https://t.co/Breakfast',extended_entities:{media:[
  {type:'photo',url:'https://t.co/Breakfast',media_url_https:'https://pbs.twimg.com/media/Breakfast.jpg'},
  {type:'photo',source_status_id_str:'999',media_url_https:'https://pbs.twimg.com/media/Borrowed.jpg'}
 ]}},core:{user_results:{result:{legacy:{screen_name:'Writer'}}}}};
 const response={url:'https://x.com/i/api/graphql/fixture/TweetDetail',clone:()=>({json:async()=>({tweet})})};
 const window={fetch:async()=>response,postMessage:value=>messages.push(value)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 await window.fetch('/fixture');await new Promise(resolve=>setImmediate(resolve));
 const {D,row}=detailFixture({source:{text},target:{text}});D.ingestThreadRecords(messages[0].records);
 const context=JSON.parse(JSON.stringify(D.replyContext(row,'/owner')));
 const {generateReply}=await import('../ai-client.mjs'),{directGenerate,API_KEY_STORAGE}=await import('../deepseek-direct.mjs');
 for(const notification of [false,true]){
  let payload,requests=0;
  const result=await generateReply({id:row.id,text:context.target.text,context},(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:path=>'extension://'+path,fetcher:async(url,options)=>{
   if(url.startsWith('extension://'))return{ok:true,text:async()=>'fixture JSON rules'};
   if(url.startsWith('https://pbs.twimg.com/'))return fixtureImageResponse();
   requests++;payload=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"send_reply","text":"看着就饿了。"}'}}]})};
  }}),notification);
  assert.equal(result.postId,'123');assert.equal(requests,1);
  const parts=payload.messages[1].content;assert.ok(Array.isArray(parts));assert.equal(JSON.parse(parts[0].text).post_text,text);
  assert.deepEqual(parts.filter(part=>part.type==='image_url'),[{type:'image_url',image_url:{url:'data:image/png;base64,'+fixtureImageBase64,detail:'auto'}}]);
  assert.ok(!JSON.stringify(payload).includes('Borrowed'));
 }
});

test('early photo detection follows only this target and its ancestors, never a sibling or wrong author',()=>{
 const {D,row}=detailFixture();
 D.ingestThreadRecords([{id:'100',root:'100',author:'root',text:'root',imageUrls:['https://pbs.twimg.com/media/A.jpg']},{id:'123',root:'100',parent:'100',author:'writer',text:'hello'}]);
 assert.equal(D.replyHasImages(row),true);
 D.ingestThreadRecords([{id:'100',root:'100',author:'root',text:'root'},{id:'999',root:'100',parent:'100',author:'other',text:'sibling',imageUrls:['https://pbs.twimg.com/media/B.jpg']}]);
 assert.equal(D.replyHasImages(row),false);
 D.ingestThreadRecords([{id:'123',root:'100',parent:'100',author:'wrong',text:'hello',imageUrls:['https://pbs.twimg.com/media/C.jpg']}]);assert.equal(D.replyHasImages(row),false);
});

test('reply context accepts proven hidden recipients plus known media tokens, not arbitrary mention removal',()=>{
 const prefix='@Owner @Friend ',url='https://t.co/Photo1',root={id:'100',root:'100',author:'owner',text:'root'};
 for(const shown of ['hello',prefix+'hello',prefix+'hello '+url]){
  const f=detailFixture({source:{text:shown},target:{text:shown}});
  f.D.ingestThreadRecords([root,{id:'123',root:'100',parent:'100',author:'writer',text:prefix+'hello '+url,replyTextPrefix:prefix,mediaTextUrls:[url]}]);
  const c=f.D.replyContext(f.row,'/owner');assert.ok(c,shown);assert.equal(c.target.text,shown);assert.equal(c.root.text,'root');
 }
 for(const change of [{replyTextPrefix:undefined},{replyTextPrefix:'@Owner '},{replyTextPrefix:'hello '},{text:'@Other hello'},
  {parent:null},{root:'123',parent:null},{author:'other'},{text:prefix+'changed'},
  {text:prefix+'hello https://t.co/NotMedia'}]){
  const f=detailFixture();f.D.ingestThreadRecords([root,{id:'123',root:'100',parent:'100',author:'writer',text:prefix+'hello',replyTextPrefix:prefix,...change}]);
  assert.equal(f.D.replyContext(f.row,'/owner'),null,JSON.stringify(change));
 }
 const empty=detailFixture({source:{text:''},target:{text:''}});empty.D.ingestThreadRecords([root,{id:'123',root:'100',parent:'100',author:'writer',text:prefix,replyTextPrefix:prefix}]);
 assert.equal(empty.D.replyContext(empty.row,'/owner'),null);
});

// Raw recipient prefix and display offsets captured from an actual X reply on
// 2026-11-12; original body replaced with a neutral fixture. No live API or send.
for(const notification of [false,true])test(`observed hidden-recipient sample reaches generation through ${notification?'notification':'interaction'} preparation`,async()=>{
 const id='2120856067353751591',rootId='2120801583982313961',text='没有没有通过',raw='@lujunnanm23 '+text,messages=[];
 const tweets=[
  {rest_id:rootId,legacy:{conversation_id_str:rootId,full_text:'原帖上下文'},core:{user_results:{result:{legacy:{screen_name:'lujunnanm23'}}}}},
  {rest_id:id,legacy:{conversation_id_str:rootId,in_reply_to_status_id_str:rootId,full_text:raw,display_text_range:[13,19],entities:{user_mentions:[{screen_name:'lujunnanm23',indices:[0,12]}]}},core:{user_results:{result:{legacy:{screen_name:'frover_the'}}}}}
 ];
 const response={url:'https://x.com/i/api/graphql/fixture/TweetDetail',clone:()=>({json:async()=>({tweets})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 await window.fetch('/fixture');await new Promise(resolve=>setImmediate(resolve));
 const {D,row}=detailFixture({source:{id,author:'frover_the',text},target:{id,author:'frover_the',text},path:'/frover_the/status/'+id});D.ingestThreadRecords(messages[0].records);
 const {generateReply}=await import('../ai-client.mjs'),{directGenerate,API_KEY_STORAGE}=await import('../deepseek-direct.mjs');
 let requests=0,input;
 const ctx=vm.createContext({Date,XAssistantDOM:D,XAssistantTasks:{check:()=>{},waitForPage:async read=>read(),bounded:fn=>fn()},
  XAssistantRuntime:{call:async msg=>generateReply(msg.post,(url,options)=>directGenerate(url,options,{storage:{get:async()=>({[API_KEY_STORAGE]:'fixture'})},resource:p=>'extension://'+p,fetcher:async(url,options)=>{
   if(url.startsWith('extension://'))return{ok:true,text:async()=>readFileSync(new URL('../'+url.slice('extension://'.length),import.meta.url),'utf8')};
   requests++;input=JSON.parse(JSON.parse(options.body).messages[1].content);
   return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"send_reply","text":"你说的是哪个环节？"}'}}]})};
  }}),msg.kind==='AI_NOTIFICATION_REPLY')}
 });
 vm.runInContext(readFileSync(new URL('../reply-preparation.js',import.meta.url),'utf8'),ctx);
 const result=await ctx.XAssistantReplyPreparation.generate({row,account:'/owner',module:notification?'notifications':'interaction'});
 assert.equal(result.action,'send_reply');assert.equal(requests,1);assert.equal(input.reply_target.text,text);assert.equal(input.original_post.id,rootId);assert.equal(result.postId,id);assert.doesNotThrow(()=>result.validatePrepared());
 // An edited detail body is still rejected; this fix is not general prefix matching.
 D.ingestThreadRecords([{...messages[0].records[1],text:raw+' changed'}]);assert.equal(D.replyContext(row,'/owner'),null);
});

test('verified own-root grandchildren are addressed without masquerading as direct children',()=>{
 const node=article(),D=fixture([node],'/owner','/owner/status/100');
 D.ingestThreadRecords([{id:'100',root:'100',author:'owner',parent:null},{id:'123',root:'100',author:'Writer',parent:'101',parentAuthor:'other'}]);
 const row=D.post(node);assert.equal(row.addressed,true);assert.equal(row.directComment,false);assert.equal(row.ownThread,true);
});

// Observed on 2026-11-16: X hid all body text in a photo-only reply, but its
// raw body retained the exact parent mention and its own attachment token.
test('photo-only reply accepts exact hidden parent and owned media tokens without dropping prose',()=>{
 const image='https://pbs.twimg.com/media/ReplyPhoto.jpg',media='https://t.co/ReplyPhoto';
 const record={id:'123',root:'100',parent:'110',parentAuthor:'owner',author:'writer',
  text:'@Owner '+media,imageUrls:[image],mediaTextUrls:[media]};
 const root={id:'100',root:'100',author:'root',text:'原帖'},parent={id:'110',root:'100',parent:'100',author:'owner',text:'上条交流'};
 for(const text of ['',media,'@Owner '+media]){
  const {D,row}=detailFixture({source:{text:''},target:{text:''}});
  D.ingestThreadRecords([root,parent,{...record,text}]);
  const context=D.replyContext(row,'/owner');assert.ok(context,text);assert.equal(context.target.text,'');assert.deepEqual(Array.from(context.target.imageUrls),[image]);assert.deepEqual(Array.from(context.history,r=>r.id),['110']);
 }
 for(const change of [{text:'有意义的正文 '+media},{text:'@Other '+media},{text:'@Owner extra '+media},
  {text:'@Owner https://t.co/Unknown'},{mediaTextUrls:[]},{parentAuthor:'other'},{parentAuthor:undefined},
  {imageUrls:[]},{parent:null},{author:'other'}]){
  const {D,row}=detailFixture({source:{text:''},target:{text:''}});
  D.ingestThreadRecords([root,parent,{...record,...change}]);assert.equal(D.replyContext(row,'/owner'),null,JSON.stringify(change));
 }
});

test('photo-only reply normalizes a proven multi-recipient prefix and own media without empty-text bypass',()=>{
 const prefix='@Owner @Friend ',media='https://t.co/ReplyPhoto';
 const record={id:'123',root:'100',parent:'100',author:'writer',text:prefix+media,replyTextPrefix:prefix,
  imageUrls:['https://pbs.twimg.com/media/ReplyPhoto.jpg'],mediaTextUrls:[media]};
 const {D,row}=detailFixture({source:{text:''},target:{text:''}});D.ingestThreadRecords([{id:'100',root:'100',author:'owner',text:'原帖'},record]);
 assert.ok(D.replyContext(row,'/owner'));
 D.ingestThreadRecords([{...record,text:prefix+'some caption '+media}]);assert.equal(D.replyContext(row,'/owner'),null);
});

test('native own replies deduplicate only an exact same-thread direct child, independently of local ledgers',()=>{
 const D=fixture();D.ingestThreadRecords([{id:'100',root:'100',author:'owner',text:'original'},
  {id:'110',root:'100',parent:'100',author:'reader',text:'comment'},
  {id:'111',root:'100',parent:'100',author:'another',text:'sibling'},
  {id:'112',root:'100',parent:'111',author:'owner',text:'answered sibling'},
  {id:'113',root:'100',parent:'110',author:'another',text:'another reader reply'},
  {id:'114',root:'999',parent:'110',author:'owner',text:'conflicting thread'}]);
 assert.equal(D.hasOwnReply('110','/owner'),false);assert.equal(D.hasOwnReply('100','/owner'),false);
 assert.equal(D.hasOwnReply('111','/owner'),true);assert.equal(D.hasOwnReply('missing','/owner'),false);
 D.ingestThreadRecords([{id:'115',root:'100',parent:'110',author:'Owner',text:'manually sent own reply'}]);
 assert.equal(D.hasOwnReply('110','/OWNER'),true);assert.equal(D.hasOwnReply('110','/owner2'),false);
 assert.equal(D.hasOwnReply('115','/owner'),false);assert.equal(D.hasOwnReply('110',''),false);
});

test('branch membership follows same-root native parent chains, not sibling conversation membership',()=>{
 const D=fixture();D.ingestThreadRecords([{id:'100',root:'100',author:'owner'},
  {id:'110',root:'100',parent:'100',author:'reader'},
  {id:'120',root:'100',parent:'110',author:'another'},
  {id:'121',root:'100',parent:'120',author:'reader'},
  {id:'130',root:'100',parent:'100',author:'reader'},
  {id:'140',root:'900',parent:'110',author:'reader'},
  {id:'150',root:'100',parent:'151',author:'reader'},
  {id:'151',root:'100',parent:'150',author:'reader'},
  {id:'160',root:'100',parent:'missing',author:'reader'}]);
 assert.equal(D.inBranch('120','110'),true);assert.equal(D.descendantOf('121','110','100'),true);
 for(const id of ['110','100','130','140','150','151','160','missing'])assert.equal(D.inBranch(id,'110'),false,id);
 assert.equal(D.inBranch('120','110','900'),false);assert.equal(D.inBranch('120','missing'),false);
 assert.deepEqual(Array.from(D.loadedBranchIds('110')),['120','121']);
 assert.deepEqual(Array.from(D.loadedBranchIds('100')),['110','120','121','130']);
 const identity=D.threadIdentity('120');identity.author='changed';assert.equal(D.threadIdentity('120').author,'another');assert.equal(D.threadIdentity('missing'),null);
 const long=[];for(let i=200;i<460;i++)long.push({id:String(i),root:'100',parent:i===200?'110':String(i-1),author:'reader'});
 D.ingestThreadRecords(long);assert.equal(D.inBranch('459','110'),true);
});

function branchDetailFixture({path='/Writer/status/123',rootAuthor='owner',metadataAuthor='writer',detailText='hello',duplicate=false,showDetail=true,missingParent=false}={}){
 const target=article({id:'123',author:'Writer',text:detailText});
 const child=article({id:'124',author:'Reader',text:'child'}),sibling=article({id:'125',author:'Other',text:'sibling'}),foreign=article({id:'126',author:'Foreign',text:'recommendation'});
 const cards=[...(showDetail?[target]:[]),...(duplicate?[article({id:'123',author:'Writer'})]:[]),child,sibling,foreign];
 const main={closest:()=>null,querySelectorAll:s=>s==='article[data-testid="tweet"]'?cards:[]};
 const ctx=vm.createContext({URL,location:{pathname:path},document:{querySelector:()=>anchor('/owner'),querySelectorAll:s=>s==='[data-testid="primaryColumn"]'?[main]:s==='article[data-testid="tweet"]'?cards:[]}});
 vm.runInContext(source,ctx);const D=ctx.XAssistantDOM;
 D.ingestThreadRecords([{id:'100',root:'100',author:rootAuthor,text:'root'},
  ...(!missingParent?[{id:'110',root:'100',parent:'100',author:'owner',text:'parent'}]:[]),
  {id:'123',root:'100',parent:'110',author:metadataAuthor,text:'hello'},
  {id:'124',root:'100',parent:'123',author:'reader',text:'child'},
  {id:'125',root:'100',parent:'100',author:'other',text:'sibling'},
  {id:'900',root:'900',author:'owner',text:'different own root'},
  {id:'126',root:'900',parent:'900',author:'foreign',text:'recommendation'}]);
 return {D,ctx,cards,target,child,sibling,foreign};
}
test('verified child detail under an own original marks same-thread comments addressed without changing direct-parent semantics',()=>{
 const {D,child,sibling,foreign}=branchDetailFixture();
 assert.equal(D.post(child,'/owner').addressed,true);assert.equal(D.post(child,'/owner').ownThread,true);assert.equal(D.post(child,'/owner').directComment,false);
 assert.equal(D.post(sibling,'/owner').addressed,true);assert.equal(D.inBranch('125','123'),false);
 assert.equal(D.post(foreign,'/owner').addressed,false);assert.equal(D.rows('/owner').find(r=>r.id==='124').addressed,true);
});
test('child detail ownership needs canonical route, exact primary target and a proven chain to own original',()=>{
 for(const options of [{path:'/Someone/status/123'},{path:'/Writer/status/999'},{rootAuthor:'someone'},
  {metadataAuthor:'someone'},{detailText:'edited'},{duplicate:true},{showDetail:false},{missingParent:true}]){
  const {D,child}=branchDetailFixture(options);assert.equal(D.post(child,'/owner').addressed,false,JSON.stringify(options));
 }
});
test('proven child detail binding survives virtualization but not route, account or native-identity changes',()=>{
 const f=branchDetailFixture();assert.equal(f.D.post(f.child,'/owner').addressed,true);
 f.cards.splice(f.cards.indexOf(f.target),1);assert.equal(f.D.post(f.child,'/owner').addressed,true);
 f.ctx.location.pathname='/home';assert.equal(f.D.post(f.child,'/owner').addressed,false);
 f.ctx.location.pathname='/Writer/status/123';assert.equal(f.D.post(f.child,'/owner').addressed,false);
 const a=branchDetailFixture();assert.equal(a.D.post(a.child,'/owner').addressed,true);a.cards.splice(a.cards.indexOf(a.target),1);
 assert.equal(a.D.post(a.child,'/someone').addressed,false);assert.equal(a.D.post(a.child,'/owner').addressed,false);
 const b=branchDetailFixture();assert.equal(b.D.post(b.child,'/owner').addressed,true);b.cards.splice(b.cards.indexOf(b.target),1);
 b.D.ingestThreadRecords([{id:'123',root:'900',parent:'900',author:'writer',text:'hello'}]);assert.equal(b.D.post(b.child,'/owner').addressed,false);
});
