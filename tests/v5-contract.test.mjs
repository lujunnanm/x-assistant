import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
test('manifest assets exist and timing/view load before drivers',()=>{const m=JSON.parse(read('manifest.json')),s=m.content_scripts[0].js;for(const n of [...s,...m.content_scripts[0].css,m.background.service_worker])assert.ok(existsSync(new URL('../'+n,import.meta.url)));assert.ok(s.indexOf('time-client.js')<s.indexOf('workspace.js'));assert.ok(s.indexOf('view.js')<s.indexOf('overlay.js'));assert.ok(!s.includes('cleanup-core.js'));for(const old of ['scheduler.js','scheduler-core.js','coordination.js'])assert.ok(!s.includes(old));assert.ok(s.indexOf('notifications-driver.js')<s.indexOf('workspace.js'));assert.ok(s.indexOf('workspace-policy.js')<s.indexOf('workspace.js'));assert.ok(s.indexOf('service-policy.js')<s.indexOf('workspace.js'));assert.ok(s.indexOf('workspace.js')<s.indexOf('console.js'));});
test('independent module entry retains timing and unknown-result review',()=>{const v=read('view.js'),driver=read('overlay.js'),workspace=read('workspace.js'),console=read('console.js');for(const name of ['clean-start','clean-stop','post-start','reply-start','data-a="start"'])assert.ok(!v.includes(name));assert.ok(driver.includes("XAssistantTime.arm('interaction'"));assert.ok(driver.includes('XAssistantTime.pending(account)'));assert.ok(!workspace.includes('replyDuringCooldown'));assert.ok(console.includes('api.review(module,self())'));assert.ok(console.includes('data-a="service-toggle"'));assert.ok(!console.includes('data-a="module-toggle"'));assert.ok(!workspace.includes('confirm('));});
test('timing settings are discoverable and posting interval is enforced by the service worker schedule',()=>{
 assert.ok(read('panel.html').includes('href="#time-settings"'));
 assert.ok(read('panel.js').includes("send('TIME_SAVE'"));
 const background=read('background.js'),schedule=read('posting-schedule.mjs'),posting=read('posting.js');
 assert.ok(background.includes('timing.normalize(msg.config)'));
 assert.ok(background.includes('confirmSchedule(Date.now(),Math.random,time)'));
 assert.ok(schedule.includes("time.milliseconds(config,'posting',random)"));
 assert.ok(posting.includes('await countdown(deadline,signal'));
 assert.ok(!posting.includes('AI_POST'));
 assert.ok(read('notifications.js').includes("XAssistantTime.ms('replyGap')"));
});
