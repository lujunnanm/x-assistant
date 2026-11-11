import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../followback.js',import.meta.url),'utf8')
 .replace(' globalThis.XAssistantFollowbackDriver=', ' globalThis.fbTest={describe,next,locate,scan,transact};globalThis.XAssistantFollowbackDriver=');
const HIDDEN='[hidden],[inert],[aria-hidden="true"]', REGION='section[role="region"]',CELL='[data-testid="UserCell"]';
function node(attrs={}){
 const n={textContent:'',isConnected:true,hidden:false,parent:null,selectors:{},...attrs};
 n.getAttribute=k=>n[k]??null;
 n.closest=s=>s===HIDDEN?(n.hidden? n:n.parent?.closest(s)||null):n.matches(s)?n:n.parent?.closest(s)||null;
 n.matches=s=>Array.isArray(n.match)&&n.match.includes(s);
 n.querySelectorAll=s=>n.selectors[s]||[];n.querySelector=s=>n.querySelectorAll(s)[0]||null;
 return n;
}
function fixture(gap=55000){
 const account='/self',url='https://x.com'+account+'/verified_followers',doc=node({scrollingElement:{scrollHeight:1000}}),primary=node({parent:doc}),tab=node({href:url,textContent:'认证关注者',parent:primary});
 const region=node({parent:primary,match:[REGION],'aria-labelledby':'list-heading'}),head=node({parent:region,id:'list-heading',textContent:'认证关注者'}),list=node({parent:region,'aria-label':'时间线：认证关注者'});
 doc.selectors['[data-testid="primaryColumn"]']=[primary];primary.selectors['a[role="tab"][aria-selected="true"]']=[tab];primary.selectors[REGION]=[region];region.selectors['h1,h2']=[head];region.selectors['div[aria-label]']=[list];
 const cells=list.selectors[CELL]=[],events=[],store={},todo=[],win={addEventListener(){},dispatchEvent:e=>events.push([e.type,e.detail]),scrollY:0,innerHeight:1000,scrollBy(){},scrollTo(){}};
 let own=account,now=1000,clicks=0;
 function add(name,id='123',opt={}){
  const handle='@'+name,wrap=node({parent:list,match:['[data-testid="cellInnerDiv"]']}),cell=node({parent:wrap,match:[CELL,'button[role="button"][data-testid="UserCell"]']});
  const avatar=node({parent:cell,'data-testid':'UserAvatar-Container-'+name});
  const display=node({href:'https://x.com/'+name,textContent:'Display',parent:cell,match:['a[href]']}),identity=node({...display,textContent:handle,match:['a[href]']});
  const bio=node({href:'https://x.com/other',textContent:'@other',parent:cell,match:['a[href]']});
  const badge=node({parent:opt.bioBadge?bio:display}),indicator=node({parent:cell,textContent:'关注了你'});
  const btn=node({parent:cell}),set=followed=>{btn['data-testid']=id+(followed?'-unfollow':'-follow');btn.textContent=followed?'正在关注':'回关';btn['aria-label']=btn.textContent+' '+handle;};
  set(!!opt.followed);btn.click=()=>{clicks++;if(!opt.noReceipt)set(true);};
  cell.selectors['a[href]']=[display,identity,bio];cell.selectors['[data-testid^="UserAvatar-Container-"]']=[avatar];
  cell.selectors['[data-testid="userFollowIndicator"]']=opt.noFollower?[]:[indicator];cell.selectors['[data-testid="icon-verified"]']=opt.noBadge?[]:[badge];
  cell.selectors['button[data-testid$="-follow"],button[data-testid$="-unfollow"]']=[btn];wrap.selectors[CELL]=[cell];cells.push(cell);return {cell,btn,avatar,badge,bio,identity,indicator,set};
 }
 const api={storage:{get:async()=>store},assertContext(){},call:async msg=>{events.push([msg.kind,msg]);return msg.kind==='FOLLOWBACK_RESERVE'?{claimed:true,claimId:'claim'}:{nextAt:now+gap};},
  runtime:async(m,a,extra)=>{events.push([a,extra]);return a==='begin'?{runId:'run',account,nextAt:now+gap}:{};},
  wakeReadOnly:async ms=>{events.push(['readonly-wake',ms]);now+=ms;},check(signal){if(signal?.aborted)throw new DOMException('stopped','AbortError');},
  sleep(ms,signal){if(ms===900){api.check(signal);now+=ms;return Promise.resolve();}return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('stopped','AbortError'));signal?.addEventListener('abort',abort,{once:true});todo.push({ms,done(late=0){signal?.removeEventListener('abort',abort);now+=ms+late;resolve();}});});}};
 const tasks={waitForPage:async(probe,opts)=>{for(let i=0;i<=4;i++){const v=probe();if(v)return v;now+=500;}return null;}};
 const ctx=vm.createContext({document:doc,location:{href:url},window:win,AbortController,DOMException,CustomEvent:class{constructor(type,{detail}){Object.assign(this,{type,detail});}},chrome:{storage:{onChanged:{addListener(){}}}},URL,
  Date:{now:()=>now},XAssistantRuntime:api,XAssistantTasks:tasks,XAssistantDOM:{account:()=>own},XAssistantCore:{editorText:n=>n.textContent},
  XAssistantServicePolicy:{isFollowbackPage:(href,a)=>href==='https://x.com'+a+'/verified_followers'},XAssistantWorkspace:{ready:Promise.resolve(),progress:(step,extra)=>events.push(['progress',step,extra])},
  XAssistantActions:{click:async({beforeClick,validate,click})=>{await beforeClick();validate();click();}}});
 vm.runInContext(src,ctx);
 return {ctx,doc,primary,tab,region,head,list,cells,add,api,events,todo,store,account,url,get clicks(){return clicks;},setOwn:a=>own=a,
  s:{runId:'run',account,signal:new AbortController().signal},target:{target:'@alice',targetId:'123'},probe:()=>ctx.XAssistantFollowbackProbe.inspect(),fb:ctx.fbTest};
}
test('真实列表形状：只认本行认证、关注了我且回关按钮与账号匹配；简介可以含其他账号',()=>{
 const f=fixture();f.add('Alice','123');f.add('bob','124',{followed:true});f.add('unverified','125',{noBadge:true});f.add('stranger','126',{noFollower:true});f.add('borrowed','127',{bioBadge:true});
 const r=f.probe();assert.equal(r.verifiedList,true);assert.equal(r.recognized,2);assert.equal(r.following,1);assert.equal(r.actionable,1);
});
test('选错账号/标签/列表、重复身份、自己、旁栏推荐以及请求中均不能点击',()=>{
 const f=fixture();const alice=f.add('Alice','123'),pending=f.add('bob','124');f.add('self','125');
 pending.btn.textContent='请求已发送';pending.btn['aria-label']='请求已发送 @bob';
 f.add('other','123');
 assert.equal(f.probe().actionable,0);
 f.cells.splice(3);alice.btn['aria-label']='回关 @alice12';assert.equal(f.probe().actionable,0);
 alice.btn['aria-label']='回关 @alice';alice.cell.parent.parent=node({match:[REGION]});assert.equal(f.probe().actionable,0);
 f.region['aria-labelledby']='unrelated-heading';assert.equal(f.probe().verifiedList,false);f.region['aria-labelledby']=f.head.id;
 f.list['aria-label']='时间线：你可能喜欢';assert.equal(f.probe().verifiedList,false);f.list['aria-label']='时间线：认证关注者';
 f.tab.href='https://x.com/self/followers';assert.equal(f.probe().verifiedList,false);
 f.ctx.location.href='https://x.com/another/verified_followers';assert.throws(()=>f.probe(),{code:'PAGE_CHANGED'});
 assert.equal(f.clicks,0);
});
test('目标凭证以 handle 和数字 ID 交叉隔离，已确认/在途/未知均排除',()=>{
 const f=fixture();const a=f.add('alice'),b=f.add('bobby','124');const rows=[a,b].map(x=>f.fb.describe(x.cell));
 for(const status of ['confirmed','unknown','in_flight']){
  assert.equal(f.fb.next(rows,{'@alice':{status}},'/self').target,'@bobby');
  assert.equal(f.fb.next(rows,{'@previous':{status,targetId:'123'}},'/self').target,'@bobby');
 }
});
test('原生回关点击前持久占位，点击后仅以同账号同 ID 的已关注按钮稳定回读确认',async()=>{
 const f=fixture();f.add('Alice');await f.fb.transact(f.s,f.target);assert.equal(f.clicks,1);
 const call=f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE'||e[0]==='FOLLOWBACK_SETTLE');
 assert.deepEqual(call.map(x=>x[0]),['FOLLOWBACK_RESERVE','FOLLOWBACK_SETTLE']);assert.equal(call[1][1].outcome,'confirmed');assert.equal(call[1][1].receipt.targetId,'123');
});
test('按钮重用、目标改变或新草稿出现在占位后，仅释放本次未点击占位',async()=>{
 for(const mutate of [(f,a)=>{a.btn['data-testid']='99-follow';},(f,a)=>{a.btn['aria-label']='回关 @alice2';},(f)=>{f.doc.selectors['[contenteditable="true"]']=[node({textContent:'草稿'})];}]){
  const f=fixture(),a=f.add('alice');f.ctx.XAssistantActions.click=async o=>{await o.beforeClick();mutate(f,a);o.validate();o.click();};
  await f.fb.transact(f.s,f.target).catch(e=>assert.equal(e.code,'RESIDUAL_DRAFT'));assert.equal(f.clicks,0);assert.equal(f.events.at(-1)[1].outcome,'released');
 }
});
test('原生按钮点击后 stop/许可 ACK 丢失，只读核对：确认则完成，否则 unknown 不释放也不重试',async()=>{
 for(const confirmed of [false,true]){
  const f=fixture();f.add('alice','123',{noReceipt:!confirmed});const stop=new AbortController();f.s.signal=stop.signal;
  f.ctx.XAssistantActions.click=async o=>{await o.beforeClick();o.validate();o.click();stop.abort();throw Object.assign(Error('ACK lost'),{submitted:true});};
  if(confirmed)await f.fb.transact(f.s,f.target);else await assert.rejects(f.fb.transact(f.s,f.target),{code:'SEND_UNKNOWN',submitted:true});
  assert.equal(f.clicks,1);assert.equal(f.events.at(-1)[1].outcome,confirmed?'confirmed':'unknown');assert.ok(!f.events.some(e=>e[1]?.outcome==='released'));
 }
});
const flush=()=>new Promise(r=>setImmediate(r));
for(const gap of [55000,70000])test('只使用后台唯一截止 '+gap+'ms，延迟唤醒只处理一个，不叠加第二次随机等待',async()=>{
 const f=fixture(gap);f.add('alice');f.add('bob','124');
 const driver=f.ctx.XAssistantFollowbackDriver;await driver.start();await flush();assert.equal(f.clicks,0);assert.equal(f.todo[0].ms,gap);
 f.todo.shift().done(4*gap);await flush();assert.equal(f.clicks,1);assert.equal(f.events.find(e=>e[0]==='FOLLOWBACK_RESERVE')[1].target,'@alice');assert.equal(f.todo[0].ms,gap);
 f.todo.shift().done();await flush();assert.equal(f.clicks,2);assert.deepEqual(f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE').map(e=>e[1].target),['@alice','@bob']);assert.equal(f.todo[0].ms,gap-4500,'空列表尾部核对在现有冷却内完成');
 assert.ok(!f.events.some(e=>e[0]==='FOLLOWBACK_WAIT'),'有效的首次和回执截止不再抽样');
 await driver.stop();assert.equal(driver.isRunning(),false);assert.equal(f.clicks,2);assert.equal(f.events.filter(e=>e[0]==='stop').length,1);
 await driver.start();await flush();assert.equal(f.clicks,2);assert.equal(f.todo.at(-1).ms,gap-4500);await driver.stop();
});
test('无合格账号仅请求下一检查截止，不申请关注许可',async()=>{
 const f=fixture(69000);const driver=f.ctx.XAssistantFollowbackDriver;await driver.start();await flush();
 f.todo.shift().done();await flush();
 assert.equal(f.clicks,0);assert.equal(f.todo[0].ms,69000-4500);assert.equal(f.events.filter(e=>e[0]==='FOLLOWBACK_WAIT').length,1);await driver.stop();
});
test('遇到明确 X 限额提示先停手；点击后出现提示也不能把乐观按钮当作确认',async()=>{
 const sel='[data-testid="toast"],[role="alert"]',f=fixture(),a=f.add('alice');
 f.doc.selectors[sel]=[node({textContent:'你已达到关注上限'})];
 await assert.rejects(f.fb.transact(f.s,f.target),{code:'FOLLOW_LIMIT'});assert.equal(f.clicks,0);assert.ok(!f.events.some(e=>e[0]==='FOLLOWBACK_RESERVE'));
 f.doc.selectors[sel]=[];
 const click=a.btn.click;a.btn.click=()=>{click();f.doc.selectors[sel]=[node({textContent:'You are unable to follow more people at this time.'})];};
 await assert.rejects(f.fb.transact(f.s,f.target),{code:'SEND_UNKNOWN',submitted:true});
 assert.equal(f.clicks,1);assert.equal(f.events.at(-1)[1].outcome,'unknown');
});
test('后台回执以独立的只读唤醒复核；停止后不再申请许可，按钮回退不得确认',async()=>{
 const f=fixture(),row=f.add('alice');
 f.api.wakeReadOnly=async(ms,signal)=>{assert.equal(ms,1000);assert.equal(signal,undefined);row.set(false);};
 await assert.rejects(f.fb.transact(f.s,f.target),{code:'SEND_UNKNOWN'});assert.equal(f.clicks,1);assert.equal(f.events.at(-1)[1].outcome,'unknown');
});
test('未知回关由工作页稳定复核，不再要求人工点击核对结果',async()=>{
 for(const followed of [true,false]){
  const f=fixture(),row=f.add('alice','123',{followed});
  f.store.xAssistantFollowbackRuntimeV1={active:false,phase:'unknown',account:'/self',runId:'run',text:'@alice'};
  f.store.xAssistantFollowbackLedgerV1={'/self':{'@alice':{target:'@alice',targetId:'123',status:'unknown'}}};
  const result=await f.ctx.XAssistantFollowbackDriver.reviewUnknown();
  assert.equal(result.resolved,true);assert.equal(result.outcome,followed?'confirmed':'not_following');
  const review=f.events.find(e=>e[0]==='FOLLOWBACK_REVIEW')[1];assert.equal(review.targetId,'123');assert.equal(review.receipt.kind,followed?'following':'not_following');
  assert.equal(row.btn['data-testid'],followed?'123-unfollow':'123-follow');
 }
});

test('真实执行链：占位拒绝且确认未点击的首个候选跳过，同轮继续下一人，只在确认后冷却',async()=>{
 const f=fixture();f.add('alice','123');f.add('bob','124');const call=f.api.call;
 f.api.call=async msg=>{if(msg.kind==='FOLLOWBACK_RESERVE'&&msg.target==='@alice'){f.events.push([msg.kind,msg]);return{claimed:false,reason:'unknown'};}return call(msg);};
 const driver=f.ctx.XAssistantFollowbackDriver;await driver.start();await flush();f.todo.shift().done();await flush();
 assert.equal(f.clicks,1);assert.deepEqual(f.events.filter(x=>x[0]==='FOLLOWBACK_RESERVE').map(x=>x[1].target),['@alice','@bob']);
 assert.equal(f.events.filter(x=>x[0]==='FOLLOWBACK_SETTLE'&&x[1].outcome==='confirmed').length,1);
 assert.equal(f.events.filter(x=>x[0]==='FOLLOWBACK_WAIT').length,0);assert.equal(f.todo[0].ms,55000);
 await driver.stop();
});

test('冷却预查不占用写许可；停止后不回关预选对象',async()=>{
 const f=fixture();f.add('alice');const driver=f.ctx.XAssistantFollowbackDriver;
 await driver.start();await flush();
 assert.equal(f.clicks,0);
 assert.equal(f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE').length,0);
 assert.equal(f.todo[0].ms,55000,'看到顶部候选无需先等待列表底部');
 await driver.stop();assert.equal(f.clicks,0);
});
test('预查后目标已被关注，到点重新扫描下一位，不点击过期目标',async()=>{
 const f=fixture();const alice=f.add('alice','123');f.add('bob','124');
 const driver=f.ctx.XAssistantFollowbackDriver;await driver.start();await flush();
 alice.set(true);
 f.todo.shift().done();await flush();
 assert.deepEqual(f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE').map(e=>e[1].target),['@bob']);
 assert.equal(f.clicks,1);await driver.stop();
});

test('确认一人后在同一轮冷却内找好下一位，不提前点击，到点按最新列表重选',async()=>{
 const f=fixture();f.add('alice','123');const bob=f.add('bob','124');f.add('carol','125');
 const driver=f.ctx.XAssistantFollowbackDriver,attempts=()=>f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE').map(e=>e[1].target);
 await driver.start();await flush();
 assert.deepEqual(attempts(),[]);
 f.todo.shift().done();await flush();
 assert.deepEqual(attempts(),['@alice']);assert.equal(f.clicks,1);
 const afterFirst=f.events.slice(f.events.findIndex(e=>e[0]==='FOLLOWBACK_SETTLE')+1);
 assert.ok(afterFirst.some(e=>e[0]==='progress'&&e[1]==='已找到下一位回关对象，等待间隔结束'&&Number.isFinite(e[2].until)));
 assert.equal(f.todo[0].ms,55000);
 bob.set(true);
 f.todo.shift().done();await flush();
 assert.deepEqual(attempts(),['@alice','@carol']);assert.equal(f.clicks,2);
 await driver.stop();
});

test('明确频率限制在点击前直接退避，点击后保存限流并隔离目标',async()=>{
 const sel='[data-testid="toast"],[role="alert"]';
 for(const after of [false,true]){
  const f=fixture(),row=f.add('alice'),alert=node({textContent:'You are following too quickly. Please try again later.'});
  if(after){const click=row.btn.click;row.btn.click=()=>{click();f.doc.selectors[sel]=[alert];};}
  else f.doc.selectors[sel]=[alert];
  await assert.rejects(f.fb.transact(f.s,f.target),e=>e.code==='FOLLOW_RATE_LIMIT'&&!!e.submitted===after);
  assert.equal(f.clicks,after?1:0);
  if(after){assert.equal(f.events.at(-1)[1].outcome,'rate_limited');assert.equal(f.events.at(-1)[1].receipt.kind,'rate_limit');}
  else assert.equal(f.events.filter(e=>e[0]==='FOLLOWBACK_RESERVE').length,0);
 }
});
test('限流记录写入失败仍为未知；隐藏提示不能触发限流恢复',async()=>{
 const sel='[data-testid="toast"],[role="alert"]';
 for(const hidden of [false,true]){
  const f=fixture(),row=f.add('alice','123',{noReceipt:true}),click=row.btn.click;
  row.btn.click=()=>{click();f.doc.selectors[sel]=[node({textContent:'操作过于频繁',hidden})];};
  const call=f.api.call;f.api.call=async m=>{if(m.outcome==='rate_limited')throw Error('storage failed');return call(m);};
  await assert.rejects(f.fb.transact(f.s,f.target),{code:'SEND_UNKNOWN',submitted:true});assert.equal(f.clicks,1);
 }
});
