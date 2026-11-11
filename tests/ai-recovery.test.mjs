import test from 'node:test';import assert from 'node:assert/strict';import {recoverGeneration,safeAIError} from '../ai-recovery.mjs';
const options=()=>({check:async()=>{},report:async()=>{},sleep:async()=>{},binding:{postId:'123'}});
test('temporary generation error retries then succeeds',async()=>{let n=0;const r=await recoverGeneration(async()=>{if(++n<3)throw Error('DeepSeek 本地服务不可用或超时');return{action:'send_reply',text:'hi'};},options());assert.equal(n,3);assert.equal(r.action,'send_reply');});
test('exhausted retries skip exactly current task with bound ID',async()=>{let n=0;const r=await recoverGeneration(async()=>{n++;throw Error('HTTP 503');},options());assert.equal(n,3);assert.equal(r.action,'skip');assert.equal(r.postId,'123');assert.equal(r.skippedGenerationError,true);});
test('invalid output regenerates once then skips; following generation still runs',async()=>{let n=0;const r=await recoverGeneration(async()=>{n++;throw Error('AI 回复未通过检查');},options());assert.equal(n,2);assert.equal(r.action,'skip');assert.equal((await recoverGeneration(async()=>({action:'send_reply'}),options())).action,'send_reply');});
test('authority failure is not swallowed or retried',async()=>{let n=0;await assert.rejects(recoverGeneration(async()=>{n++;throw Error('HTTP 500');},{...options(),check:async()=>{throw Error('任务已停止');}}),/任务已停止/);assert.equal(n,0);});
test('diagnostics never include raw secret-bearing messages',()=>{assert.equal(safeAIError(Error('secret=example')), 'AI 生成失败（未发送）');});
test('authentication and billing failures terminate instead of skip loops',async()=>{for(const status of [401,402,403]){let count=0;await assert.rejects(recoverGeneration(async()=>{count++;throw Error('HTTP '+status);},options()),/协同已停止/);assert.equal(count,1);}});
test('model skip and generation failure have separate machine-readable outcomes',async()=>{
 const intentional=await recoverGeneration(async()=>({action:'skip',skipReason:'model_choice'}),options());
 assert.equal(intentional.skippedGenerationError,undefined);
 const reports=[];const failed=await recoverGeneration(async()=>{throw Error('HTTP 429');},{...options(),report:async r=>reports.push(r)});
 assert.equal(failed.outcome,'generation_error');assert.equal(failed.reasonCode,'http_429');assert.equal(failed.postId,'123');
 assert.deepEqual(reports.map(r=>r.retrying),[true,true,false]);
});
test('aborted generation is neither reported nor converted to skip',async()=>{
 let reports=0;await assert.rejects(recoverGeneration(async()=>{throw new DOMException('cancelled','AbortError');},{...options(),report:async()=>reports++}),{name:'AbortError'});assert.equal(reports,0);
});
test('stale run after completed generation discards late result',async()=>{
 let checks=0;await assert.rejects(recoverGeneration(async()=>({action:'send_reply',text:'body'}),{...options(),check:async()=>{if(++checks>1)throw Error('任务已停止');}}),/任务已停止/);
});
test('known model and configuration HTTP errors stop instead of endlessly skipping',async()=>{
 for(const status of [400,404]){let n=0;await assert.rejects(recoverGeneration(async()=>{n++;throw Error('HTTP '+status);},options()),/协同已停止/);assert.equal(n,1);}
});
test('structured validation codes survive while arbitrary error messages never escape',async()=>{
 const {createAIError,classifyAIError}=await import('../ai-recovery.mjs');
 assert.equal(classifyAIError(createAIError('content_forbidden')).code,'content_forbidden');
 assert.equal(classifyAIError(createAIError('content_forbidden')).attempts,2);
 assert.equal(safeAIError({code:'untrusted',message:'Authorization Bearer private-value'}),'AI 生成失败（未发送）');
});
