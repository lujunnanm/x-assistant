import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../notifications.js',import.meta.url),'utf8');
const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
test('notification scan uses rolling 24h boundary and persistent per-account records',()=>{assert.ok(source.includes('since:Date.now()-86400000'));assert.ok(source.includes('db.records[row.id]'));assert.ok(source.includes('!recent(row.at)'));assert.ok(source.includes('db.since=Date.now()-86400000'));assert.ok(source.includes('account.toLowerCase()'));});
test('notifications end on exhaustion without five-minute polling and do not like or follow',()=>{assert.ok(source.includes('db.nextAt=0'));assert.ok(!source.includes('data-testid="like"'));assert.ok(!source.includes('data-testid="follow"'));});
test('notification replies are authorized by their independent run',()=>{assert.ok(background.includes("msg?.kind==='AI_NOTIFICATION_REPLY'"));assert.ok(background.includes("msg.kind==='AI_NOTIFICATION_REPLY'?KEYS.notifications"));});
test('unknown sends survive restart; record is reserved before sender invocation',()=>{assert.ok(source.indexOf("status:'in_flight'")<source.indexOf('await sendReply(row'));assert.ok(source.includes("['in_flight','unknown'].includes(r.status)"));assert.ok(source.includes("replySubmitted?'unknown':'failed'"));});
test('notification target validation waits for exactly one rendered context and rechecks before submission',()=>{assert.ok(source.includes('cards.length===1'));assert.ok(source.includes('await waitFor(targetMatches,150,100,signal)'));assert.ok(source.includes("if(!targetMatches())throw Error('发送前回复目标已变化')"));assert.ok(source.includes("info.article.isConnected"));});
test('only definitely unsent failures can retry; successful and uncertain records remain deduplicated',()=>{assert.ok(source.includes("db.records[row.id].status!=='failed'"));assert.ok(source.includes("['in_flight','unknown'].includes(r.status)"));});
test('each confirmed notification reply uses an abortable randomized 10–30 second cooldown',()=>{assert.ok(source.includes('const replyDelay=core.randomSeconds(10,30)'));assert.ok(source.includes('Date.now()+replyDelay*1000'));assert.ok(!source.includes('await sleep(10000,signal)'));assert.ok(source.includes('db.nextAt=0'));});
test('batch cutoff is fixed across posting preemption and cleared only on completion',()=>{assert.ok(source.includes('db.batchUntil=db.batchUntil||Date.now()'));assert.ok(source.includes('row.at>db.batchUntil'));assert.ok(source.includes('delete db.batchUntil;'));assert.ok(source.includes('db.nextAt=0'));assert.ok(source.includes('if(yieldToPost()){await defer();return {complete:false};}'));});
test('master owns notification runs and shares the posting page lock',async()=>{const p=await readFile(new URL('../posting.js',import.meta.url),'utf8'),n=await readFile(new URL('../scheduler.js',import.meta.url),'utf8');for(const s of [p,n])assert.ok(s.includes("navigator.locks.request('x-assistant-page-actions'"));assert.ok(n.includes("api.runtime('notifications','stop')"));assert.ok(n.includes('C.replyDeadline(state,post)'));});
test('Grok comments are excluded and audited by exact case-insensitive handle before AI generation',()=>{const guard='if(excludedAuthor(row.author))';assert.ok(source.includes("author.toLowerCase()==='grok'"));assert.ok(source.includes('shouldIgnore:excludedAuthor'));assert.ok(source.includes("status:'ignored_grok'"));assert.ok(source.indexOf(guard)<source.indexOf("kind:'AI_NOTIFICATION_REPLY'"));for(const author of ['grok','Grok','GROK'])assert.equal(author.toLowerCase()==='grok',true);for(const author of ['grokfan','mygrok','user'])assert.equal(author.toLowerCase()==='grok',false);});
test('unexpected popup is discarded and skipped only when definitely unsent',()=>{assert.ok(source.includes('if(!replySubmitted&&'));assert.ok(source.includes("'skipped_popup'"));assert.ok(source.includes('if(!await discardResidual())'));assert.ok(source.includes("if(replySubmitted)return false"));assert.ok(source.includes("e.name==='YieldError'?'failed':'skipped_popup'"));});
test('relocation uses fresh same-ID author time text and addressed context, not the retained node',async()=>{
 const vm=await import('node:vm');const expression=source.match(/const relocate=(.*);\n const recent/)[1];
 const row={id:'1',author:'A',time:'t',text:'body',addressed:true,article:{isConnected:false}},fresh={...row,article:{isConnected:true}};
 const context=vm.createContext({document:{querySelectorAll:()=>[fresh]},info:x=>x,normalized:x=>x,row});
 assert.equal(vm.runInContext(`(${expression})(row)`,context),fresh);
 fresh.text='changed';assert.equal(vm.runInContext(`(${expression})(row)`,context),undefined);
 fresh.text='body';fresh.id='2';assert.equal(vm.runInContext(`(${expression})(row)`,context),undefined);
});
test('stale unsent targets are recorded as skipped_updated and continue through normal cooldown',()=>{
 assert.ok(source.includes("if(!replySubmitted&&e.message==='通知目标已更新，请重新扫描')"));
 const branch=source.split("if(!replySubmitted&&e.message==='通知目标已更新，请重新扫描')")[1].split('}else if')[0];
 assert.ok(branch.includes("status='skipped_updated'"));assert.ok(branch.includes("phase:'notification_scan'"));assert.ok(!branch.includes('throw'));
});
test('rolling age boundary excludes stale and future comments even after startup',async()=>{
 const vm=await import('node:vm');const ctx=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf(' const recent='),source.indexOf(' const excludedAuthor='))+';globalThis.recent=recent;',ctx);
 const now=200000000;assert.equal(ctx.recent(now-86400000,now),true);assert.equal(ctx.recent(now-86400001,now),false);assert.equal(ctx.recent(now+1,now),false);assert.equal(ctx.recent(NaN,now),false);assert.equal(ctx.recent(now-86399000,now+2000),false);
 assert.ok(source.includes('try{requireRecent(info);replySubmitted=true;'));
});
test('scan limits and loading stalls rest without claiming completion or stopping collaboration',()=>{
 assert.ok(source.includes("if(screen===99)return await rest("));
 assert.ok(source.includes('complete:false,rest:true,reason'));
 assert.ok(!source.includes("throw Error('通知扫描达到安全上限"));
 assert.ok(source.includes("status='skipped_expired'"));
});
