import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../posting-receipt.js',import.meta.url),'utf8');
function setup(initial=[],initialPosts=[],options={}){
 let changed,closed=false,cleared=false;const scene={notices:initial,posts:[...initialPosts]};
 const document={documentElement:{},querySelectorAll:s=>s==='article'?scene.posts:s==='article time'?scene.posts.map(p=>p.querySelector('time')):scene.notices};
 const scope={URL,Date};vm.runInNewContext(source,scope);
 const watcher=scope.XAssistantPostingReceipt.create({document,MutationObserver:class{constructor(fn){changed=fn;}observe(){}disconnect(){closed=true;}},account:'/owner',text:'正文\n\n@grok',now:()=>100000,setInterval:()=>1,clearInterval:()=>{cleared=true;},...options});
 return {scene,watcher,changed:()=>changed(),clean:()=>closed&&cleared};
}
const notice=text=>({textContent:text,closest:()=>null});
test('a new unmarked inline error span prompts readback without counting as success or failure',()=>{
 const message='出错了，别担心，让我们再试一次。',nodes=[notice(message)],primary={querySelectorAll:()=>nodes};
 const h=setup([],[],{replyTarget:{primary:()=>primary,matchesParent:()=>false}});
 h.changed();assert.equal(h.watcher.hint,null);
 nodes.push({...notice(message),closest:()=>({})});h.changed();assert.equal(h.watcher.hint,null);
 nodes.push(notice(message));h.changed();assert.equal(h.watcher.hint,message);assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.atDeadline(),null);
});
function post({owner='owner',date=100000,text='正文\n\n@grok',id='1',href=`https://x.com/${owner}/status/${id}`}={}){
 const link={href},time={closest:()=>link,getAttribute:()=>new Date(date).toISOString()};return {querySelector:s=>s==='time'?time:{innerText:text}};
}
test('captures reused toast whose text changes (old code missed this)',()=>{const e=notice('正在处理');const h=setup([e]);e.textContent='你的帖子已发送。';h.changed();assert.equal(h.watcher.result.kind,'confirmed');});
test('ignores old success notices and own overlay status',()=>{const h=setup([notice('你的帖子已发送。')]);h.scene.notices.push({textContent:'平台已提示帖子已发送',closest:()=>({})});assert.equal(h.watcher.poll(),null);});
test('captures a short-lived platform success before it disappears',()=>{const h=setup();h.scene.notices.push(notice('Your post was sent.'));h.changed();h.scene.notices=[];assert.equal(h.watcher.poll().kind,'confirmed');});
test('records a platform refusal without ending native receipt readback early',()=>{const h=setup();h.scene.notices.push(notice('You already said that.'));h.changed();assert.equal(h.watcher.result,null);assert.equal(h.watcher.refusal.kind,'rejected');assert.match(h.watcher.refusal.message,/already said/);});
test('can verify a new exact own post and its persistent link',()=>{const h=setup();h.scene.posts.push(post());h.changed();assert.equal(h.watcher.result.evidence,'visible_post');assert.equal(h.watcher.result.url,'https://x.com/owner/status/1');});
test('does not count old posts, another author, different text or stale timestamp',()=>{for(const p of [post({owner:'other'}),post({date:1000}),post({text:'different'})]){const h=setup();h.scene.posts.push(p);assert.equal(h.watcher.poll(),null);}});
test('releasing a watcher disconnects observer and timer',()=>{const h=setup();h.watcher.close();assert.equal(h.clean(),true);});

test('X inserting extra blank lines before mentions still confirms the same own post',()=>{
 const h=setup();h.scene.posts.push(post({text:'正文\n\n\n@grok'}));h.changed();
 assert.equal(h.watcher.result?.kind,'confirmed');assert.equal(h.watcher.result?.url,'https://x.com/owner/status/1');
});
test('blank-line count, CRLF, NBSP and whitespace-only lines are presentation differences',()=>{
 for(const text of ['正文\n@grok','正文\r\n\r\n\r\n@grok','正文\n \t \n\u00a0\n@grok','正文\n\n\n\n@grok']){
  const h=setup();h.scene.posts.push(post({text}));assert.equal(h.watcher.poll()?.kind,'confirmed',JSON.stringify(text));
 }
});
test('ignoring blank lines does not ignore meaning, punctuation, mention or nonempty line boundaries',()=>{
 for(const text of ['正文不对\n\n@grok','正文！\n\n@grok','正文\n\n@other','正文 @grok','正文\n@grok\n新增一行','正文\n@g rok']){
  const h=setup();h.scene.posts.push(post({text}));assert.equal(h.watcher.poll(),null,text);
 }
});
test('blank-line-normalized matches still reject preexisting posts, foreign authors and out-of-window timestamps',()=>{
 const existing=post({text:'正文\n\n\n@grok'}),h=setup([], [existing]);
 assert.equal(h.watcher.poll(),null);
 for(const options of [{owner:'other'},{date:94000},{date:106000}]){
  const h=setup();h.scene.posts.push(post({...options,text:'正文\n\n\n@grok'}));assert.equal(h.watcher.poll(),null);
 }
});
test('platform rejection is not overridden by a text-normalized visible match',()=>{
 const h=setup();h.scene.notices.push(notice('已达到发帖频率限制。'));h.scene.posts.push(post({text:'正文\n\n\n@grok'}));
 assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.refusal?.kind,'rejected');
});

test('the Chrome generic composer error is diagnostic, not final, and a delayed success still wins',()=>{
 const h=setup(),message='出错了，别担心，让我们再试一次。';
 h.scene.notices.push(notice(message));h.changed();
 assert.equal(h.watcher.poll(),null);
 assert.equal(h.watcher.hint,message);
 h.scene.notices=[];h.changed();
 assert.equal(h.watcher.hint,message);
 h.scene.notices.push(notice('你的帖子已发送。'));h.changed();
 assert.equal(h.watcher.result?.kind,'confirmed');
});

test('an ambiguous message can be resolved by a new exact own post, not an existing or different one',()=>{
 const h=setup([], [post({id:'100'})]);
 h.scene.notices.push(notice('Something went wrong.'));h.changed();
 h.scene.posts.push(post({id:'101',owner:'other'}),post({id:'102',text:'正文换一种写法\n@grok'}),post({id:'103',date:99000}));
 h.scene.posts.push(post({href:''}),post({href:'https://example.com/owner/status/104'}),post({id:'104/photo/1'}));
 assert.equal(h.watcher.poll(),null);
 h.scene.posts.push(post({id:'104'}));
 assert.equal(h.watcher.poll()?.url,'https://x.com/owner/status/104');
});

test('an exact text match alone cannot confirm a post with attachments',()=>{
 const h=setup([],[], {hasMedia:true});
 h.scene.posts.push(post());
 assert.equal(h.watcher.poll(),null);
 h.scene.notices.push(notice('Something went wrong.'));h.scene.posts.push(post());
 assert.equal(h.watcher.poll(),null);
});

test('ignore unchanged generic error nodes, but do not ignore an explicit rejection with generic wording',()=>{
 const h=setup([notice('出错了，别担心，让我们再试一次。')]);
 assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.hint,null);
 h.scene.notices.push(notice('出错了：请求过于频繁。'));
 assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.refusal?.kind,'rejected');assert.equal(h.watcher.hint,null);
});

test('localized duplicate refusals have a distinct reason and are never success receipts',()=>{
 for(const text of ['哇哦！你已经发过了。','你已发过了','你已經發過了','You already said that.','Duplicate content']){
  const h=setup();h.scene.notices.push(notice(text));h.changed();
  assert.equal(h.watcher.result,null);assert.equal(h.watcher.refusal.kind,'rejected');assert.equal(h.watcher.refusal.reason,'duplicate');
 }
 const h=setup([notice('哇哦！你已经发过了。')]);assert.equal(h.watcher.poll(),null);
});

test('a native confirmed original wins after a misleading error and supports media-only posts',()=>{
 let native=null,closed=0;
 const h=setup([],[],{text:'',hasMedia:true,native:{poll:()=>native,close:()=>closed++}});
 h.scene.notices.push(notice('出错了，别担心，让我们再试一次。'),notice('已达到发帖频率限制。'));h.changed();
 assert.equal(h.watcher.result,null);
 native={kind:'confirmed',evidence:'x_create_result',postId:'126',url:'https://x.com/owner/status/126'};
 assert.equal(h.watcher.poll(),native);h.watcher.close();assert.equal(closed,1);
});

test('an exact native rejection can settle at the deadline, not earlier or as an optimistic feed post',()=>{
 const native={kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88};
 const h=setup([],[],{native:{poll:()=>native,close(){}}});
 h.scene.posts.push(post());assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.atDeadline(),native);
});

test('a provisional refusal invalidated by a second request cannot cause a retry',()=>{
 let native={kind:'not_sent',evidence:'x_create_result',reason:'rate_limit',code:88};
 const h=setup([],[],{native:{poll:()=>native,close(){}}});
 assert.equal(h.watcher.poll(),null);
 native=null;
 assert.equal(h.watcher.atDeadline(),null);
});
test('inline reply: exact fresh success or duplicate toast only; no stale duplicate/quoted notice or unrelated same-text post',()=>{
 const replyTarget={matchesParent:id=>id==='100'},message='哇哦！你已经发过了。';
 const h=setup([notice(message)],[],{replyTarget});h.scene.posts.push(post({id:'99'}));assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.atDeadline(),null);
 h.scene.notices.push({textContent:message,closest:s=>s.includes('article')?{}:null},notice('帖子已发布失败'));assert.equal(h.watcher.poll(),null);assert.equal(h.watcher.atDeadline(),null);
 h.scene.notices.push(notice(message));h.changed();assert.equal(h.watcher.atDeadline().reason,'duplicate');
 h.scene.notices.push(notice('你的帖子已发布。查看'));assert.equal(h.watcher.poll().kind,'confirmed');
 const fresh=setup([],[],{replyTarget});fresh.scene.posts.push(post({id:'100'}));assert.equal(fresh.watcher.poll().kind,'confirmed');
});
