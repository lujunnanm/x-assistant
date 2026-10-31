import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../posting-receipt.js',import.meta.url),'utf8');
function setup(initial=[]){
 let changed,closed=false,cleared=false;const scene={notices:initial,posts:[]};
 const document={documentElement:{},querySelectorAll:s=>s==='article'?scene.posts:s==='article time'?scene.posts.map(p=>p.querySelector('time')):scene.notices};
 const scope={URL,Date};vm.runInNewContext(source,scope);
 const watcher=scope.XAssistantPostingReceipt.create({document,MutationObserver:class{constructor(fn){changed=fn;}observe(){}disconnect(){closed=true;}},account:'/owner',text:'正文\n\n@grok',now:()=>100000,setInterval:()=>1,clearInterval:()=>{cleared=true;}});
 return {scene,watcher,changed:()=>changed(),clean:()=>closed&&cleared};
}
const notice=text=>({textContent:text,closest:()=>null});
function post({owner='owner',date=100000,text='正文\n\n@grok',id='1'}={}){
 const link={href:`https://x.com/${owner}/status/${id}`},time={closest:()=>link,getAttribute:()=>new Date(date).toISOString()};return {querySelector:s=>s==='time'?time:{innerText:text}};
}
test('captures reused toast whose text changes (old code missed this)',()=>{const e=notice('正在处理');const h=setup([e]);e.textContent='你的帖子已发送。';h.changed();assert.equal(h.watcher.result.kind,'confirmed');});
test('ignores old success notices and own overlay status',()=>{const h=setup([notice('你的帖子已发送。')]);h.scene.notices.push({textContent:'平台已提示帖子已发送',closest:()=>({})});assert.equal(h.watcher.poll(),null);});
test('captures a short-lived platform success before it disappears',()=>{const h=setup();h.scene.notices.push(notice('Your post was sent.'));h.changed();h.scene.notices=[];assert.equal(h.watcher.poll().kind,'confirmed');});
test('records platform refusal instead of misreporting receipt timeout',()=>{const h=setup();h.scene.notices.push(notice('You already said that.'));h.changed();assert.equal(h.watcher.result.kind,'rejected');assert.match(h.watcher.result.message,/already said/);});
test('can verify a new exact own post and its persistent link',()=>{const h=setup();h.scene.posts.push(post());h.changed();assert.equal(h.watcher.result.evidence,'visible_post');assert.equal(h.watcher.result.url,'https://x.com/owner/status/1');});
test('does not count old posts, another author, different text or stale timestamp',()=>{for(const p of [post({owner:'other'}),post({date:1000}),post({text:'different'})]){const h=setup();h.scene.posts.push(p);assert.equal(h.watcher.poll(),null);}});
test('releasing a watcher disconnects observer and timer',()=>{const h=setup();h.watcher.close();assert.equal(h.clean(),true);});
