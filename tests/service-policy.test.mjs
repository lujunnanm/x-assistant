import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const source=readFileSync(new URL('../service-policy.js',import.meta.url),'utf8');
const context=vm.createContext({Date,URL});vm.runInContext(source,context);const P=context.XAssistantServicePolicy;
const at=iso=>Date.parse(iso);

test('posting is available throughout the full 24-hour Beijing day',()=>{
 for(const iso of [
  '2026-11-04T00:00:00.000+08:00','2026-11-04T05:59:59.999+08:00',
  '2026-11-04T06:00:00.000+08:00','2026-11-04T23:59:59.999+08:00',
 ])assert.equal(P.isWorkingTime(at(iso)),true,iso);
});
test('compatibility boundary is the next Beijing midnight and never pauses posting',()=>{
 for(const [iso,next] of [
  ['2026-11-04T00:00:00.000+08:00','2026-11-05T00:00:00+08:00'],
  ['2026-11-04T05:59:59.999+08:00','2026-11-05T00:00:00+08:00'],
  ['2026-11-04T23:59:59.999+08:00','2026-11-05T00:00:00+08:00'],
  ['2026-11-05T00:00:00+08:00','2026-11-06T00:00:00+08:00'],
 ]){assert.equal(P.nextBoundary(at(iso)),at(next));assert.ok(P.nextBoundary(at(iso))>at(iso));}
});
test('leap day, year changes and pre-epoch dates use Beijing day boundaries',()=>{
 for(const [iso,next] of [
  ['2028-02-28T23:59:59+08:00','2028-02-29T00:00:00+08:00'],
  ['2028-02-29T23:59:59+08:00','2028-03-01T00:00:00+08:00'],
  ['2026-12-31T23:59:59+08:00','2027-01-01T00:00:00+08:00'],
  ['1969-12-31T23:59:59+08:00','1970-01-01T00:00:00+08:00'],
 ])assert.equal(P.nextBoundary(at(iso)),at(next));
});
test('host time zone and DST cannot change 24-hour availability or Beijing day boundaries',()=>{
 const script=source+`;console.log(JSON.stringify(['2026-03-08T21:59:59.999Z','2026-03-08T22:00:00.000Z','2026-11-01T15:59:59.999Z','2026-11-01T16:00:00.000Z'].map(value=>{const now=Date.parse(value),p=globalThis.XAssistantServicePolicy;return[p.isWorkingTime(now),p.nextBoundary(now)];})));`;
 const results=['UTC','America/Los_Angeles','Asia/Shanghai','Pacific/Auckland'].map(TZ=>execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ},encoding:'utf8'}));
 for(const output of results)assert.equal(output,results[0]);
});
test('invalid clock fails closed and cannot create a boundary alarm',()=>{
 for(const value of [NaN,Infinity,-Infinity,'2026-11-04',null]){assert.equal(P.isWorkingTime(value),false);assert.throws(()=>P.nextBoundary(value));}
});
test('each module requires literal true; posting is independently opt-in',()=>{
 for(const selected of [undefined,null,{}, {posting:false},{interaction:1,notifications:'true'}])assert.deepEqual([...P.activeModules(selected)],[]);
 assert.deepEqual([...P.activeModules({posting:false,interaction:true})],['interaction']);
 assert.deepEqual([...P.activeModules({interaction:true,notifications:true,other:true})],['interaction','notifications']);
 assert.deepEqual([...P.activeModules({posting:true,interaction:true})],['posting','interaction']);
});
test('network and ordinary failures retry after thirty seconds; rate limits after thirty minutes',()=>{
 for(const error of [Object.assign(Error('connection'),{code:'network'}),{code:'ETIMEDOUT'},Error('DeepSeek 连接失败或请求超时'),new TypeError('Failed to fetch')]){
  assert.equal(P.classifyFailure(error).retryable,true);assert.equal(P.classifyFailure(error).reason,'network');
 }
 for(const error of [Error('页面加载超时'),Error('waiting send button timeout'),Error('unexpected failure'),{code:'HTTP',status:500}])assert.equal(P.classifyFailure(error).delay,30000);
 for(const error of [{code:'HTTP',status:429},{code:'RATE_LIMIT'},Error('操作过于频繁')])assert.equal(P.classifyFailure(error).delay,1800000);
 assert.equal(P.classifyFailure(null).retryable,false);
});
test('submission uncertainty always overrides a transient-looking error or nested cause',()=>{
 for(const error of [{code:'NETWORK_ERROR',submitted:true},{code:'ETIMEDOUT',confirmed:true},{code:'SEND_UNKNOWN',message:'请求超时'},Error('发帖提交结果未知，请核对平台记录'),{message:'network',cause:{submitted:true}}]){
  const result=P.classifyFailure(error);assert.equal(result.retryable,false);assert.equal(result.reason,'needs_review');
 }
});
test('manual navigation, drafts, login failures and cancellation never self-retry',()=>{
 for(const [error,reason] of [
  [{code:'ACCOUNT_CHANGED',message:'网络失败'},'account_changed'],[{code:'PAGE_CHANGED'},'page_changed'],
  [{code:'RESIDUAL_DRAFT',message:'请求超时'},'draft'],[{code:'CLEANUP_FAILED'},'draft'],
  [{name:'AbortError',code:'network'},'cancelled'],[{code:'OUTSIDE_WINDOW'},'cancelled'],
  [{status:401,message:'Failed to fetch'},'authentication'],[Error('DeepSeek 密钥认证失败，请更换有效密钥'),'authentication'],
 ]){assert.equal(P.classifyFailure(error).retryable,false);assert.equal(P.classifyFailure(error).reason,reason);}
});
test('normal supervisor rest and selection revocations are cancellation, never manual errors',()=>{
 for(const code of ['OUTSIDE_WORKING_HOURS','MODULE_DISABLED','REST_WINDOW','SERVICE_PAUSED','SERVICE_DISABLED']){
  const result=P.classifyFailure({code,message:'当前模块未获运行许可'});
  assert.equal(result.reason,'cancelled',code);assert.equal(result.retryable,false,code);
 }
 const submitted=P.classifyFailure({code:'OUTSIDE_WORKING_HOURS',submitted:true});
 assert.equal(submitted.reason,'needs_review');assert.equal(submitted.retryable,false);
});

test('all four modules are available all day',()=>{
 for(const iso of ['2026-11-05T00:00:00+08:00','2026-11-05T05:59:59.999+08:00','2026-11-05T06:00:00+08:00','2026-11-05T23:59:59.999+08:00']){
  const now=at(iso);for(const module of ['posting','interaction','notifications','followback'])assert.equal(P.isModuleWorking(module,now),true,`${module} ${iso}`);
 }
 assert.equal(P.isModuleWorking('unknown',at('2026-11-05T12:00:00+08:00')),false);
 for(const module of ['posting','interaction','notifications','followback'])for(const value of [NaN,Infinity,null,'invalid'])assert.equal(P.isModuleWorking(module,value),false);
});

test('follow-back is opt-in, all day and only accepts the exact owner verified-followers URL',()=>{
 const p='https://x.com/Owner/verified_followers';
 assert.ok(P.isFollowbackPage(p,'/owner'));assert.ok(P.isFollowbackPage('/OWNER/verified_followers','/Owner'));
 assert.deepEqual([...P.activeModules({followback:true})],['followback']);
 assert.deepEqual([...P.activeModules({followback:1})],[]);
 assert.equal(P.isModuleWorking('followback',Date.parse('2026-11-04T17:00:00Z')),true);
 for(const u of [p+'?',p+'#',p+'?q=1',p+'/',p.replace('/Owner','/other'),p.replace('verified_followers','followers'),p.replace('x.com','notx.com'),p.replace('x.com','x:x@x.com')])assert.equal(P.isFollowbackPage(u,'/owner'),false,u);
});

test('dedicated follow rate rejection permits cooldown, but unknown evidence always wins',()=>{
 assert.equal(P.classifyFailure({code:'FOLLOW_RATE_LIMIT',submitted:true}).delay,1800000);
 assert.equal(P.classifyFailure({code:'FOLLOW_RATE_LIMIT',submitted:true,cause:{code:'SEND_UNKNOWN'}}).retryable,false);
 assert.equal(P.classifyFailure({code:'FOLLOW_LIMIT',message:'你已达到关注人数上限'}).retryable,false);
});
