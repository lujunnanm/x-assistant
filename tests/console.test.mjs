import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
class Node {
 constructor(tag='div'){this.tag=tag;this.dataset={};this.children=[];this.map={};this.attrs={};this.hidden=false;this.disabled=false;this.textContent='';}
 set innerHTML(text){for(const m of text.matchAll(/data-a="([^"]+)"/g))this.map[`[data-a="${m[1]}"]`]=new Node('button');if(text.includes('service-toggle'))this.map.button=this.map['[data-a="service-toggle"]'];}
 querySelector(s){return this.map[s]||null;}
 setAttribute(k,v){this.attrs[k]=String(v);}
 append(...nodes){this.children.push(...nodes);}
 after(node){this.next=node;}
 replaceWith(node){this.replacement=node;}
 insertBefore(){}
}
function fixture({enabled=false,selected={},working=true,runtimes={},workers={},account='/me',reviewed=true,hello,getService,serviceFailure=null}={}){
 const calls=[],ticks=[],listeners=[],events={},root=new Node('aside'),header=new Node('header'),close=new Node('button'),sections={};
 root.map.header=header;root.map['[data-a="hide"]']=close;
 for(const module of ['posting','interaction','notifications','followback']){const s=new Node('section');s.map.b=new Node('b');const icon=s.map['.module-icon']=new Node('button');icon.setAttribute('role','switch');icon.append(new Node('svg'));s.map['.state-lamp']=new Node('span');sections[module]=s;root.map[`[data-module="${module}"]`]=s;}
 let service={enabled,account:'/me',selected:{posting:true,interaction:false,notifications:false,...selected},workers,revision:1},now=Date.parse(working?'2026-11-04T04:00:00Z':'2026-11-03T17:00:00Z');
 const keys={posting:'xAssistantPostingV1',interaction:'xAssistantRuntimeV1',notifications:'xAssistantNotificationsRuntimeV1',followback:'xAssistantFollowbackRuntimeV1'};
 class Clock extends Date{static now(){return now;}}
 const ctx=vm.createContext({Date:Clock,URL,document:{hidden:false,getElementById:()=>root,createElement:t=>new Node(t),querySelector:()=>account?{getAttribute:()=>account}:null},window:{addEventListener:(name,cb)=>{events[name]=cb;}},setInterval:f=>{ticks.push(f);return ticks.length;},clearInterval(){},
 chrome:{runtime:{id:'abcdefghijklmnopabcdefghijklmnop',getManifest:()=>({version:'7.5.2'})},storage:{local:{get:async()=>Object.fromEntries(Object.entries(keys).map(([m,k])=>[k,runtimes[m]]))},onChanged:{addListener:f=>listeners.push(f)}}},
 XAssistantWorkspace:{ready:hello||Promise.resolve({tabId:1})},XAssistantRuntime:{review:async(...args)=>{calls.push({kind:'REVIEW',args});return reviewed;},call:async message=>{
 calls.push(message);if(message.kind==='SERVICE_GET'){if(getService)await getService;return service;}
 if(message.kind==='SERVICE_SET'){if(serviceFailure)throw Object.assign(Error(serviceFailure.message),{code:serviceFailure.code});service={...service,...('enabled'in message?{enabled:message.enabled}:{}),selected:{...service.selected,...message.selected},revision:service.revision+1};return service;}
 if(message.kind==='SERVICE_REPAIR')return service;return{};
 }}});
 vm.runInContext(source('service-policy.js'),ctx);vm.runInContext(source('console.js'),ctx);
 return{ctx,calls,root,sections,events,setServiceFailure:value=>{serviceFailure=value;},setAccount:value=>{account=value;},master:()=>header.next.querySelector('button'),summary:()=>header.next.next,selection:m=>sections[m].map['.module-icon'],issue:m=>sections[m].children[0],tick:()=>ticks.forEach(f=>f()),setNow:t=>now=Date.parse(t),change:(key,value)=>listeners.forEach(f=>f({[key]:{newValue:value}},'local')),close};
}
test('unrelated ledger updates never rerender module controls',async()=>{
 const f=fixture();await flush();let writes=0;
 const button=f.master(),original=button.setAttribute;
 button.setAttribute=function(...args){writes++;return original.apply(this,args);};
 for(let i=0;i<100;i++)f.change('xAssistantNotificationRepliesV1',{i});
 assert.equal(writes,0);
 f.change('xAssistantNotificationsRuntimeV1',{active:false,error:'test'});
 assert.ok(writes>0);
});
test('posting selection failure marks only posting and links to the library without stopping the master',async()=>{
 const f=fixture({enabled:true,selected:{posting:false,interaction:true},serviceFailure:{code:'POST_LIBRARY_EMPTY',message:'库内文案均已停用'}});await flush();
 await f.selection('posting').onclick();
 assert.equal(f.master().attrs['aria-checked'],'true');assert.equal(f.selection('posting').attrs['aria-checked'],'false');
 assert.equal(f.root.children[0].hidden,true,'posting is not a console-wide error');
 assert.equal(f.issue('posting').hidden,false);assert.equal(f.issue('posting').dataset.tone,'warning');assert.equal(f.issue('interaction').hidden,true);
 assert.equal(f.sections.posting.map['.state-lamp'].textContent,'待文案');
 const focus=f.sections.posting.map.b.replacement;assert.equal(focus.disabled,false);assert.equal(focus.attrs['aria-label'],'打开发帖文案库');
 await focus.onclick();assert.equal(f.calls.at(-1).kind,'OPEN_PANEL');assert.equal(f.calls.at(-1).section,'library');
 assert.equal(f.issue('posting').hidden,false,'opening settings does not pretend to fix the library');
 assert.equal(f.calls.filter(c=>c.kind==='SERVICE_SET').length,1,'never auto-retry a rejected switch');
});
test('enabling a copy clears its local warning but never starts posting automatically',async()=>{
 const f=fixture({selected:{posting:false},serviceFailure:{code:'POST_LIBRARY_EMPTY',message:'没有启用文案'}});await flush();await f.selection('posting').onclick();
 f.change('xAssistantPostingCopiesV1',{revision:2,rows:[{enabled:false}]});assert.equal(f.issue('posting').hidden,false);
 const count=f.calls.length;f.change('xAssistantPostingCopiesV1',{revision:3,rows:[{enabled:true}]});
 assert.equal(f.issue('posting').hidden,true);assert.equal(f.calls.length,count);assert.equal(f.selection('posting').attrs['aria-checked'],'false');
 f.setServiceFailure(null);await f.selection('posting').onclick();assert.equal(f.selection('posting').attrs['aria-checked'],'true');assert.equal(f.master().attrs['aria-checked'],'false');
});
test('a library rejection on master start is still attributed to posting and retains the actual off state',async()=>{
 const f=fixture({serviceFailure:{code:'POST_LIBRARY_EMPTY',message:'没有启用文案'}});await flush();await f.master().onclick();
 assert.equal(f.master().attrs['aria-checked'],'false');assert.equal(f.root.children[0].hidden,true);assert.equal(f.issue('posting').hidden,false);
});
test('an extension connection error is not mislabeled as a posting library issue',async()=>{
 const f=fixture({selected:{posting:false},serviceFailure:{code:'EXTENSION_CONTEXT_INVALIDATED',message:'扩展已更新，请刷新页面'}});await flush();await f.selection('posting').onclick();
 assert.equal(f.root.children[0].hidden,false);assert.equal(f.issue('posting').hidden,true);
});
test('all four module icons are independent switches, without an appended switch',async()=>{
 const f=fixture({selected:{posting:false}});await flush();
 for(const m of ['posting','interaction','notifications','followback']){assert.equal(f.selection(m).tag,'button');assert.equal(f.selection(m).attrs.role,'switch');assert.equal(f.selection(m).attrs['aria-checked'],'false');assert.equal(f.selection(m).children[0].tag,'svg');assert.equal(f.sections[m].children.length,1,'only the issue row is appended');}
 assert.equal(f.master().textContent,'开启神圣计划');assert.ok(Object.values(f.sections).every(s=>!s.hidden));
});
test('one master starts the managed service without changing selected modules',async()=>{
 const f=fixture();await flush();await f.master().onclick();
 const msg=f.calls.find(c=>c.kind==='SERVICE_SET');assert.equal(msg.enabled,true);assert.equal(msg.account,'/me');assert.equal(msg.selected,undefined);assert.equal(f.master().textContent,'关闭神圣计划');assert.ok(!f.calls.some(c=>c.kind==='RUNTIME'||c.kind==='AI_POST'));
});
test('a double-click cannot immediately reverse a successful master switch',async()=>{
 const f=fixture({selected:{posting:false,interaction:true}});await flush();
 await f.master().onclick({detail:1});await f.master().onclick({detail:2});
 assert.equal(f.master().attrs['aria-checked'],'true');
 assert.equal(f.calls.filter(c=>c.kind==='SERVICE_SET').length,1);
 await f.master().onclick({detail:1});
 assert.equal(f.master().attrs['aria-checked'],'false');
});
test('a double-click on a module icon does not reverse the selection or touch the master',async()=>{
 const f=fixture({selected:{followback:false}});await flush();
 const icon=f.selection('followback');
 assert.equal(icon.title,'开启回关模块');
 await icon.onclick({detail:1});await icon.onclick({detail:2});
 assert.equal(icon.attrs['aria-checked'],'true');assert.equal(icon.title,'关闭回关模块');
 assert.equal(f.master().attrs['aria-checked'],'false');
 assert.equal(f.calls.filter(c=>c.kind==='SERVICE_SET').length,1);
});
test('posting switch changes only posting; master may remain on for reply modules',async()=>{
 const f=fixture({enabled:true,selected:{posting:false,notifications:true}});await flush();await f.selection('posting').onclick();
 const msg=f.calls.find(c=>c.kind==='SERVICE_SET');assert.deepEqual(Object.keys(msg.selected),['posting']);assert.equal(msg.selected.posting,true);
 assert.equal(f.selection('posting').attrs['aria-checked'],'true');assert.equal(f.selection('notifications').attrs['aria-checked'],'true');
 await f.selection('posting').onclick();assert.equal(f.selection('posting').attrs['aria-checked'],'false');assert.equal(f.master().attrs['aria-checked'],'true');
});
test('optional switches change only their module and preserve the other selection',async()=>{
 const f=fixture({selected:{notifications:true}});await flush();await f.selection('interaction').onclick();
 const msg=f.calls.find(c=>c.kind==='SERVICE_SET');assert.deepEqual(Object.keys(msg.selected),['interaction']);assert.equal(msg.selected.interaction,true);assert.equal(f.selection('notifications').attrs['aria-checked'],'true');
});
test('overnight posting remains available without a rest state or automatic switch write',async()=>{
 const f=fixture({enabled:true,working:false});await flush();assert.equal(f.master().attrs['aria-checked'],'true');assert.match(f.summary().textContent,/已开启/);assert.equal(f.sections.posting.map['.state-lamp'].textContent,'等待中');
 f.setNow('2026-11-03T22:00:00Z');f.tick();assert.match(f.summary().textContent,/已开启/);assert.equal(f.sections.posting.map['.state-lamp'].textContent,'等待中');assert.equal(f.calls.filter(c=>c.kind==='SERVICE_SET').length,0);
});
test('ordinary console ticks never poll workers or write service state',async()=>{
 const f=fixture();await flush();const before=f.calls.length;for(let i=0;i<10;i++)f.tick();assert.equal(f.calls.length,before);
});
test('an in-flight active submission is not mislabeled unknown or offered manual review',async()=>{
 const f=fixture({enabled:true,runtimes:{posting:{active:true,phase:'submitting'}}});await flush();assert.equal(f.issue('posting').hidden,true);assert.equal(f.sections.posting.map['.state-lamp'].textContent,'运行中');
});
test('unknown sends require explicit review; declining never repairs or restarts',async()=>{
 const f=fixture({runtimes:{posting:{active:false,phase:'unknown'}},reviewed:false});await flush();assert.equal(f.issue('posting').hidden,false);const button=f.issue('posting').children[1];assert.equal(button.textContent,'核对结果');await button.onclick();assert.ok(f.calls.some(c=>c.kind==='REVIEW'));assert.ok(!f.calls.some(c=>c.kind==='SERVICE_REPAIR'));
});
test('stopping the service remains possible when account DOM has disappeared',async()=>{
 const f=fixture({enabled:true,account:null});await flush();assert.equal(f.master().disabled,false);await f.master().onclick();assert.equal(f.calls.find(c=>c.kind==='SERVICE_SET').enabled,false);
});
test('collapse changes presentation only, not service state',async()=>{
 const f=fixture({enabled:true});await flush();const before=f.calls.length;f.close.onclick();assert.equal(f.root.dataset.collapsed,'true');assert.equal(f.calls.length,before);assert.equal(f.master().attrs['aria-checked'],'true');
});

test('midnight keeps posting and optional modules available with the master enabled',async()=>{
 const f=fixture({enabled:true,working:true,selected:{interaction:true,notifications:true},runtimes:{posting:{active:false,phase:'stopped'},interaction:{active:true,phase:'waiting'},notifications:{active:true,phase:'notification_scan'}}});
 await flush();f.setNow('2026-11-04T16:00:00Z');f.tick();
 assert.equal(f.master().attrs['aria-checked'],'true');assert.match(f.summary().textContent,/已开启/);assert.doesNotMatch(f.summary().textContent,/休息/);
 assert.equal(f.sections.posting.map['.state-lamp'].textContent,'等待中');assert.equal(f.sections.interaction.map['.state-lamp'].textContent,'等待中');assert.equal(f.sections.notifications.map['.state-lamp'].textContent,'运行中');assert.equal(f.root.dataset.running,'true');
 assert.equal(f.calls.filter(c=>c.kind==='SERVICE_SET').length,0);
});
test('overnight optional-only readiness does not display whole service resting',async()=>{
 const f=fixture({enabled:true,working:false,selected:{posting:false,notifications:true}});await flush();
 assert.equal(f.sections.notifications.map['.state-lamp'].textContent,'等待中');assert.equal(f.sections.interaction.map['.state-lamp'].textContent,'未启用');assert.equal(f.sections.posting.map['.state-lamp'].textContent,'未启用');
 assert.match(f.summary().textContent,/已开启/);assert.equal(f.root.dataset.running,'true');
});

const NOON=Date.parse('2026-11-04T04:00:00Z');
test('live heartbeats never mask stalled business progress; ordinary consoles do no writes',async()=>{
 const f=fixture({enabled:true,selected:{interaction:true},workers:{interaction:{status:'running',lastSeen:NOON+60000}},runtimes:{interaction:{active:true,runId:'run',phase:'waiting',nextAt:NOON-5000,activity:{at:NOON,runId:'run',step:'等待回复输入框'}}}});
 await flush();f.setNow('2026-11-04T04:00:44.999Z');f.tick();assert.equal(f.issue('interaction').hidden,true);
 f.setNow('2026-11-04T04:00:45Z');f.tick();assert.equal(f.sections.interaction.map['.state-lamp'].textContent,'无进展');
 assert.match(f.issue('interaction').children[0].textContent,/45 秒无进展：等待回复输入框/);assert.equal(f.issue('interaction').children[1].hidden,true);
 assert.ok(f.calls.every(v=>v.kind==='SERVICE_GET'));
 f.change('xAssistantRuntimeV1',{active:true,runId:'run',phase:'filling',activity:{at:NOON+45000,step:'已找到回复框'}});
 assert.equal(f.issue('interaction').hidden,true);assert.match(f.sections.interaction.title,/已找到回复框/);
});
test('worker preparation and expired deadlines have a bounded no-progress indicator, not an early alarm',async()=>{
 const f=fixture({enabled:true,selected:{notifications:true},workers:{interaction:{status:'starting',createdAt:NOON}},runtimes:{notifications:{active:true,phase:'waiting',nextAt:NOON+600000,activity:{at:NOON,step:'下次回帖'}}}});
 await flush();f.setNow('2026-11-04T04:02:00Z');f.tick();assert.equal(f.issue('notifications').hidden,true);
 f.setNow('2026-11-04T04:10:44Z');f.tick();assert.equal(f.issue('notifications').hidden,true);
 f.setNow('2026-11-04T04:10:46Z');f.tick();assert.match(f.issue('notifications').children[0].textContent,/46 秒无进展/);
 f.change('xAssistantManagedServiceV1',{revision:5,enabled:true,selected:{interaction:true},workers:{interaction:{status:'starting',createdAt:NOON}}});
 assert.match(f.issue('interaction').children[0].textContent,/等待工作页就绪/);
});
test('a declared follow/action wait does not display a stall even without a new worker heartbeat',async()=>{
 const f=fixture({enabled:true,selected:{interaction:true},runtimes:{interaction:{active:true,phase:'following',activity:{at:NOON,step:'等待关注间隔',until:NOON+120000}}}});
 await flush();f.setNow('2026-11-04T04:01:50Z');f.tick();assert.equal(f.issue('interaction').hidden,true);assert.equal(f.sections.interaction.map['.state-lamp'].textContent,'等待中');
});
test('the last item error remains visible after a normal progress update and disabling a module',async()=>{
 const issue={at:NOON,code:'SEND_UNKNOWN',message:'X 报错，当前项不再重发',targetId:'123'};
 const f=fixture({enabled:true,selected:{notifications:true},runtimes:{notifications:{active:true,phase:'notification_scan',lastIssue:issue,activity:{at:NOON,step:'检查下一条'}}}});
 await flush();assert.equal(f.issue('notifications').hidden,false);assert.match(f.issue('notifications').children[0].textContent,/SEND_UNKNOWN.*不再重发.*123/);assert.equal(f.issue('notifications').children[1].hidden,true);
 f.change('xAssistantNotificationsRuntimeV1',{active:false,phase:'stopped',lastIssue:issue});await f.selection('notifications').onclick();
 assert.equal(f.issue('notifications').hidden,false);assert.match(f.issue('notifications').children[0].textContent,/SEND_UNKNOWN/);assert.equal(f.issue('notifications').children[1].hidden,true);
});
test('a one-round diagnostic explains why posting is not running',async()=>{
 const f=fixture({enabled:true});await flush();
 f.change('xAssistantManagedServiceV1',{enabled:true,account:'/me',revision:2,trial:{pending:{interaction:true,notifications:true},expiresAt:NOON+60000},selected:{interaction:true,notifications:true},workers:{}});
 assert.equal(f.sections.posting.map['.state-lamp'].textContent,'本次不测');assert.match(f.summary().textContent,/单轮诊断/);assert.equal(f.selection('posting').tag,'button');
});


for(const stage of ['hello','getService'])test('initial '+stage+' timeout is visible and read-only; a late success clears the warning without replaying controls',async()=>{
 let finish;const wait=new Promise(resolve=>{finish=resolve;});
 const f=fixture({[stage]:wait,enabled:true});await flush();
 f.setNow('2026-11-04T04:00:11.999Z');f.tick();assert.equal(f.summary().textContent,'正在连接控制台');
 f.setNow('2026-11-04T04:00:12Z');f.tick();
 assert.match(f.summary().textContent,/扩展后台未响应，未确认任务已启动.*刷新页面或重新加载扩展/);assert.equal(f.master().disabled,true);
 await f.master().onclick();await f.selection('interaction').onclick();f.tick();
 finish();await flush();assert.doesNotMatch(f.summary().textContent,/后台未响应/);
 assert.equal(f.master().textContent,'关闭神圣计划');assert.equal(f.master().disabled,false);
 assert.deepEqual(f.calls.map(c=>c.kind),['SERVICE_GET']);
});
test('a late reply cannot re-enable an invalidated console or overwrite its reason',async()=>{
 let finish;const f=fixture({getService:new Promise(resolve=>{finish=resolve;})});await flush();
 f.setNow('2026-11-04T04:00:13Z');f.tick();
 f.events['x-assistant-invalidate']({detail:{reason:'旧上下文失效，请刷新'}});finish();await flush();
 assert.match(f.summary().textContent,/控制台不可用/);assert.equal(f.root.children[0].textContent,'旧上下文失效，请刷新');
 assert.equal(f.master().disabled,true);await f.master().onclick();assert.deepEqual(f.calls.map(c=>c.kind),['SERVICE_GET']);
});

test('pending coverage is a note with full evidence; an old run and a live stall are distinct',async()=>{
 const lastIssue={at:NOON,runId:'current',code:'THREAD_COMMENTS_PENDING',message:'仅核对到 5 / 7 条；未记为完成',targetId:'123'};
 const state={active:true,runId:'current',phase:'waiting',lastIssue,activity:{at:NOON,step:'检查评论'}};
 const f=fixture({enabled:true,selected:{notifications:true},runtimes:{notifications:state}});
 await flush();const issue=f.issue('notifications'),detail=issue.children[0];
 assert.equal(issue.dataset.tone,'note');assert.match(detail.textContent,/本轮提示/);assert.match(detail.title,/5 \/ 7.*123/);
 f.change('xAssistantNotificationsRuntimeV1',{...state,runId:'different'});assert.match(detail.textContent,/上轮记录/);
 f.setNow('2026-11-04T04:01:00Z');f.tick();assert.equal(issue.dataset.tone,'warning');assert.match(detail.textContent,/无进展/);
 f.change('xAssistantNotificationsRuntimeV1',{active:false,phase:'unknown',lastIssue});assert.equal(issue.dataset.tone,'warning');assert.match(detail.textContent,/不会重发/);
});
test('native folded replies are shown as an informational note, not a repairable worker fault',async()=>{
 const lastIssue={at:NOON,runId:'current',code:'THREAD_COMMENTS_FOLDED',message:'发现 X 折叠回复入口，未展开；仅核对到 2 / 4 条',targetId:'123'};
 const state={active:true,runId:'current',phase:'waiting',nextAt:NOON+600000,lastIssue,activity:{at:NOON,step:'下次回帖'}};
 const f=fixture({enabled:true,selected:{notifications:true},runtimes:{notifications:state}});
 await flush();
 const issue=f.issue('notifications');
 assert.equal(issue.dataset.tone,'note');assert.match(issue.children[0].textContent,/折叠.*按单帖补查/);
 assert.match(issue.children[0].title,/2 \/ 4/);assert.equal(issue.children[1].hidden,true);
});
test('an old cancelled run stays historical even alongside a current draft blocker',async()=>{
 const f=fixture({enabled:true,selected:{interaction:true},workers:{interaction:{tabId:1,status:'blocked',code:'RESIDUAL_DRAFT',error:'原工作页有未发送草稿'}},
  runtimes:{interaction:{active:false,phase:'stopped',runId:'new',lastIssue:{at:NOON,runId:'old',code:'20',message:'任务已停止'}}}});
 await flush();const issue=f.issue('interaction'),detail=issue.children[0];
 assert.equal(issue.dataset.tone,'warning');assert.match(detail.textContent,/未发送草稿/);assert.match(detail.textContent,/上轮记录/);assert.doesNotMatch(detail.textContent,/上次异常.*任务已停止/);
 assert.match(detail.title,/20.*任务已停止/);assert.equal(issue.children[1].hidden,false);
});
test('inactive selected followback does not masquerade as its running cooldown',async()=>{
 const f=fixture({enabled:true,selected:{followback:true},workers:{followback:{tabId:1,status:'stopped'}},runtimes:{followback:{active:false,phase:'stopped'}}});
 await flush();
 const row=f.sections.followback,lamp=row.map['.state-lamp'];
 assert.equal(lamp.textContent,'未运行');assert.equal(row.dataset.nextAt,'');
 const now=Date.parse('2026-11-04T04:00:00Z');
 f.change('xAssistantFollowbackRuntimeV1',{active:true,phase:'waiting',nextAt:now+60000});
 assert.equal(lamp.textContent,'等待中');assert.equal(row.dataset.nextAt,String(now+60000));
});

test('search off does not hide activity or cooldown for an enabled timeline worker',async()=>{
 const f=fixture({enabled:true,selected:{posting:false,interaction:true,notifications:false},runtimes:{interaction:{active:true,phase:'waiting',nextAt:NOON+40000}}});
 await flush();f.change('xAssistantFriendSearchV1',false);
 assert.equal(f.root.dataset.running,'true');
 assert.equal(f.sections.interaction.map['.state-lamp'].textContent,'等待中');
 assert.equal(f.sections.interaction.dataset.nextAt,String(NOON+40000));
 assert.equal(f.selection('interaction').attrs['aria-checked'],'true');
 assert.ok(!f.calls.some(msg=>msg.kind==='SERVICE_SET'));
});

test('followback is independent of the interaction follow toggle and works overnight',async()=>{
 const f=fixture({enabled:true,working:false,selected:{posting:false,interaction:false,notifications:false}});
 await flush();assert.equal(f.selection('followback').attrs['aria-checked'],'false');
 await f.selection('followback').onclick();const m=f.calls.filter(c=>c.kind==='SERVICE_SET').at(-1);
 assert.deepEqual({...m.selected},{followback:true});assert.equal(f.selection('interaction').attrs['aria-checked'],'false');
 assert.equal(f.master().attrs['aria-checked'],'true');assert.equal(f.root.dataset.running,'true');
 f.change('xAssistantFollowbackRuntimeV1',{active:true,phase:'waiting',nextAt:Date.parse('2026-11-03T17:01:00Z')});
 assert.equal(f.sections.followback.map['.state-lamp'].textContent,'等待中');assert.ok(Number(f.sections.followback.dataset.nextAt)>0);
 f.change('xAssistantFollowbackRuntimeV1',{active:false,phase:'unknown'});
 assert.equal(f.issue('followback').dataset.tone,'warning');assert.match(f.issue('followback').children[0].textContent,/正在自动核对回关结果/);assert.equal(f.issue('followback').children[1].hidden,true);
});

test('compact console omits the version and posting-library diagnostic block',async()=>{
 const f=fixture();await flush();
 assert.equal(f.summary().next,undefined);
 assert.doesNotMatch(source('console.js'),/library-diagnostics|刷新诊断|POST_COPIES_STATUS/);
 assert.deepEqual(f.calls.map(c=>c.kind),['SERVICE_GET']);
});
