import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const coreContext=vm.createContext({URL});
vm.runInContext(read('interaction-core.js'),coreContext);
const core=coreContext.XAssistantCore,source=read('overlay.js');
const pickSource=source.slice(source.indexOf(' const findCandidate='),source.indexOf(' const aiReply='))+';globalThis.pick=findCandidate;';

test('source-based selection preserves self, receipt, unknown-send and retry guards but allows distinct posts from the same author',()=>{
 const row={author:'writer',text:'周末露营记录',views:5001};
 for(const [opts,reason] of [
  [{self:'writer'},'self'],[{record:{reply:'verified'}},'confirmed'],[{record:{reply:'blocked_author'}},'author_blocked'],
  [{record:{reply:'unknown'}},'uncertain'],[{record:{reply:'in_flight'}},'uncertain'],
  [{record:{retryAt:101},now:100},'retry_cooldown']
 ])assert.equal(core.interactionSkipReason(row,opts),reason);
 assert.equal(core.interactionSkipReason(row,{record:{reply:'failed',retryAt:100},now:100}),null);
 assert.equal(core.interactionSkipReason(row,{authors:new Set(['writer'])}),null);
});

test('a photo-only post can be selected without a topic or text if its exposure is known',async()=>{
 const row={id:'1',author:'writer',text:'',views:501,hasMedia:true};
 const f=candidateFixture([row]);
 assert.equal((await f.pick({},false,new Map(),{minViews:500,validate(){}})).id,row.id);
 for(const views of [null,500])assert.equal(core.interactionSkipReason({...row,views},{minViews:500}),'low_exposure');
 assert.equal(core.interactionSkipReason({...row,hasMedia:false},{minViews:500}),'no_text');
});

test('native media and exposure are bound to the outer post, not quoted media',()=>{
 const coreRow={id:'12',author:'writer',url:'https://x.com/writer/status/12',text:''};
 const a={querySelector:s=>s.endsWith('/12/analytics"]')?{getAttribute:()=> '查看帖子分析',textContent:'352 次观看'}:null,
  querySelectorAll:s=>s==='a[href]'?[]:media};
 const node=quoted=>({closest:s=>s==='article'?a:quoted?{}:null});
 let media=[node(true)];
 const ctx=vm.createContext({URL,core,account:'/self',XAssistantDOM:{post:()=>coreRow}});
 vm.runInContext(source.slice(source.indexOf(' const moreSelector='),source.indexOf(' const selfHandle='))+';globalThis.read=postInfo;',ctx);
 assert.equal(ctx.read(a).views,352);assert.equal(ctx.read(a).hasMedia,false);
 media=[node(false)];assert.equal(ctx.read(a).hasMedia,true);
 ctx.XAssistantDOM.post=()=>null;assert.equal(ctx.read(a),null);
});

function candidateFixture(rows,{records={},cooling=false}={}){
 const inspected=[],seen=[],expanded=[];
 const ctx=vm.createContext({document:{querySelector:()=>null},check(){},processed:async()=>({posts:records}),selfHandle:()=> 'self',
  followCooldownActive:async()=>cooling,visiblePosts:()=>rows,sessionAuthors:new Set(),core,recordCandidate:(row,reason)=>seen.push([row.id,reason]),publishDiagnostics:async()=>{},
  expandSearchCard:async info=>{expanded.push(info.id);return {...info,text:'周末露营，晚上去湖边看星星',clipped:false};},
  followsYouBadge:()=>false,inspectFollowState:async info=>{inspected.push(info.id);return {state:'unfollowed',followsYou:true};}});
 vm.runInContext(pickSource,ctx);
 return {pick:ctx.pick,inspected,seen,expanded};
}
for(const [name,filters] of [
 ['custom search',{path:'/search?q=足球',keyword:'足球'}],
 ['built-in search',{path:'/search?q=ChatGPT',keyword:null}],
 ['chosen home timeline',{path:'/home',keyword:null}]
])test(name+' uses its displayed timeline rather than a local body-topic match',async()=>{
 const rows=[
  {id:'1',author:'other',text:'足球 ChatGPT',views:3400,clipped:true},
  {id:'2',author:'images',text:'',views:50000},
  {id:'3',author:'writer',text:'周末露营',views:3401,clipped:true}
 ];
 const f=candidateFixture(rows);
 const selected=await f.pick({},true,new Map(),{...filters,minViews:3400,validate(){}});
 assert.equal(selected.id,'3');assert.equal(selected.text,'周末露营，晚上去湖边看星星');
 assert.deepEqual(f.expanded,['3']);assert.deepEqual(f.inspected,['3']);
 assert.deepEqual(f.seen,[['1','low_exposure'],['2','no_text'],['3',null]]);
});

test('follow cooldown reads only the surviving candidate relationship without weakening dedup or exposure',async()=>{
 const rows=[
  {id:'1',author:'self',text:'周末露营',views:5001},
  {id:'2',author:'done',text:'最新赛况',views:5001},
  {id:'3',author:'uncertain',text:'周末露营',views:5001},
  {id:'4',author:'low',text:'今天吃饭',views:4999},
  {id:'5',author:'fresh',text:'周末露营',views:5001}
 ];
 const f=candidateFixture(rows,{cooling:true,records:{'2':{reply:'verified'},'3':{reply:'unknown'}}});
 const selected=await f.pick({},true);
 assert.equal(selected.id,'5');assert.equal(selected.followState,'unknown');
 assert.deepEqual(f.inspected,['5']);
 assert.deepEqual(f.seen,[['1','self'],['2','confirmed'],['3','uncertain'],['4','low_exposure'],['5',null]]);
});

test('timeline reads only visible outer cards in the one primary column, not ads or sidebars',()=>{
 const article=(id,opt={})=>({id,isConnected:!opt.detached,closest:()=>opt.excluded?{}:null,
  parentElement:{closest:()=>opt.nested?{}:null},innerText:opt.ad?'Promoted':'内容',
  getBoundingClientRect:()=>({top:opt.top??1,bottom:opt.bottom??120})});
 const valid=article('real'),sidebar=article('side');
 const main={isConnected:true,closest:()=>null,querySelectorAll:()=>[article('ad',{ad:true}),article('quote',{nested:true}),article('hidden',{excluded:true}),article('past',{bottom:0}),article('future',{top:900}),article('detached',{detached:true}),valid]};
 let columns=[main];
 const ctx=vm.createContext({innerHeight:800,document:{querySelectorAll:selector=>selector.includes('primaryColumn')?columns:[sidebar]},postInfo:node=>({id:node.id})});
 vm.runInContext(source.slice(source.indexOf(' const visiblePosts='),source.indexOf(' const clickNow='))+';globalThis.read=visiblePosts;',ctx);
 assert.deepEqual(Array.from(ctx.read(),row=>row.id),['real']);
 columns=[main,{...main}];assert.equal(ctx.read().length,0);
});
