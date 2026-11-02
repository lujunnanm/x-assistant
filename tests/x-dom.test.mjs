import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
const stamp='2026-11-02T12:00:00.000Z';
const anchor=href=>({href:new URL(href,'https://x.com').href,getAttribute:name=>name==='href'?href:null});

// Minimal DOM nodes answer real production selectors; no sliced implementation.
function article({id='123',author='Writer',text='hello',time=stamp,permalink=true,connected=true,
  inDialog=false,addressed=[],quotes=[],links=[],replyLabel='Replying to ',hasTweetInLabel=false}={}) {
  const timeNode={dateTime:time,closest:()=>permalink?anchor('/'+author+'/status/'+id):null,
    getAttribute:name=>name==='datetime'?time:null};
  const recipientNode={textContent:replyLabel+addressed.join(' '),
    querySelector:()=>hasTweetInLabel?{}:null,
    querySelectorAll:()=>addressed.map(anchor)};
  return {isConnected:connected,
    closest:()=>inDialog?{}:null,
    querySelector:selector=>selector==='time'?timeNode:selector==='[data-testid="tweetText"]'?{textContent:text}:null,
    querySelectorAll:selector=>{
      if(selector==='div[dir]')return addressed.length?[recipientNode]:[];
      if(selector==='[role="link"]:not(a)')return quotes.map(textContent=>({textContent}));
      if(selector==='a[href]')return [anchor('/'+author),...(permalink?[anchor('/'+author+'/status/'+id)]:[]),...links.map(anchor)];
      return [];
    },
  };
}
function dialog(cards=[], fallback=null) {
  return {
    querySelector:selector=>fallback?.querySelector(selector)||null,
    querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?cards:fallback?.querySelectorAll(selector)||[],
  };
}
function fixture(nodes=[], owner='/Owner') {
  const context=vm.createContext({URL,document:{
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
  assert.deepEqual(Array.from(row.quoteHandles),['other','writer']);
  for(const attrs of [{addressed:['/owner2']},{addressed:['/owner'],replyLabel:'mention '},{addressed:['/owner'],hasTweetInLabel:true}]) {
    assert.equal(D.post(article(attrs)).addressed,false);
  }
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
  assert.equal(D.matches(dialog([],exact),row),true);
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
