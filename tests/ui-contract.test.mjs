import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../overlay.js',import.meta.url),'utf8'),posting=await readFile(new URL('../posting.js',import.meta.url),'utf8'),cleanup=await readFile(new URL('../cleanup.js',import.meta.url),'utf8');
const hasSource=fragment=>source.replace(/\s+/g,'').includes(fragment.replace(/\s+/g,''));
test('drivers retain internal controls; cleanup remains independent',()=>{for(const a of ['clean-start','clean-stop'])assert.ok(source.includes(`data-a="${a}"`));assert.ok(posting.includes("output.dataset.status='posting'"));assert.ok(cleanup.includes("output.dataset.status='cleanup'"));});
test('modules use exclusive locks, release them on invalidation, and steal only stopped stale locks',()=>{assert.ok(source.includes("new CustomEvent('x-assistant-invalidate'"));assert.ok(source.includes("lockOptions=resume||existing.active?{ifAvailable:true}:{steal:true}"));assert.ok(posting.includes("lockOptions=resume||existing?.active?{ifAvailable:true}:{steal:true}"));assert.ok(cleanup.includes("lockOptions=resume||existing?.active?{ifAvailable:true}:{steal:true}"));for(const file of [source,posting,cleanup])assert.ok(file.includes("window.addEventListener('x-assistant-invalidate'"));assert.ok(posting.includes("api.runtime('posting','pick'"));});
test('interaction checks composer and route before acquiring an active runtime',()=>{const start=source.slice(source.indexOf('const start=async'));assert.ok(start.indexOf('页面已有弹窗')<start.indexOf("api.runtime('interaction','begin'"));assert.ok(start.indexOf("core.interactionPage(location.href)")<start.indexOf("api.runtime('interaction','begin'"));assert.ok(!source.includes('location.assign('));assert.ok(hasSource('location.reload();return;')); });

test('stop following scan bypasses long-running read busy guard',async()=>{const panel=await readFile(new URL('../panel.js',import.meta.url),'utf8');assert.ok(panel.includes("$('following-stop').onclick=async()=>{try{"));assert.ok(!panel.includes("$('following-stop').onclick=action("));});

test('posting can reuse only one empty original composer and records pre-submit stages',()=>{assert.ok(posting.includes("phase:'opening'"));assert.ok(posting.includes("phase:'filling'"));assert.ok(posting.includes('existing.length!==1'));assert.ok(posting.includes('core.editorText(editors[0]).trim()'));assert.ok(posting.includes('ownsDraft=openedHere'));});

test('six-screen refresh persists run, can be stopped, and waits for account on resume',()=>{assert.ok(hasSource("phase:'refreshing'"));assert.ok(hasSource('await sleep(3000,signal);check(signal);if(pauseRequested)return;'));assert.ok(hasSource('if(!latest.active||latest.runId!==runId)return;'));assert.ok(hasSource("post.active&&post.phase!=='waiting'"));assert.ok(source.includes('await waitFor(()=>selfHandle(),150,100,signal)'));});

test('posting cooldown is randomized between 30 and 50 minutes',()=>{assert.ok(posting.includes('core.randomSeconds(1800,3000)*1000'));assert.ok(posting.includes('随机间隔 30–50 分钟'));assert.ok(!posting.includes('core.randomSeconds(600,900)'));});
test('cleanup waits 10–30 seconds, verifies strict criteria, and requires platform confirmation',()=>{assert.ok(cleanup.includes('core.randomSeconds(10,30)*1000'));assert.ok(cleanup.includes("phase:'deleting'"));assert.ok(cleanup.includes('clean.eligible(current'));assert.ok(cleanup.includes('confirmationSheetConfirm'));assert.ok(cleanup.includes("phase:'confirmed'"));assert.ok(cleanup.includes("navigator.locks.request('x-assistant-low-view-cleanup'"));});

test('follow toggle persists and rechecks preference before final follow click',()=>{
 assert.ok(source.includes('data-setting="auto-follow"'));
 assert.ok(source.includes('await setLocal(FOLLOW_SETTING,next)'));
 assert.ok(source.includes("if(!await autoFollow()){await closeMenu(caret,menu,signal);return'skipped_disabled';}check(signal);clickNative(matches[0])"));
 assert.ok(hasSource("if(followEnabled&&desired==='unfollowed'&&!await autoFollow())"));
});

test('disabled following ignores follow state and requires more than 5000 views',()=>{
 assert.ok(source.includes("if(!followEnabled){if(core.highExposure(info.views,5000))return{...info,followState:'unrestricted'};continue;}"));
 assert.ok(hasSource("desired=followEnabled?core.desiredAuthorType(r.cycleIndex):'high_exposure'"));
 assert.ok(hasSource("follow:followEnabled?(desired==='followed'?'skipped':'pending'):'skipped_disabled'"));
 assert.ok(hasSource("randomWait(followEnabled?40:5,followEnabled?60:10,signal,"));
});

test("reply-to-like cooldown respects auto-follow setting",()=>{assert.ok(hasSource("randomWait(followEnabled?5:3,followEnabled?10:5,signal,\'评价完成，等待点赞\')"));});
