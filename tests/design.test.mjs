import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('redesigned settings keep account controls and expose a posting-only copy editor without duplicate IDs', async () => {
  const html = await read('panel.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['message', 'api-form', 'api-key', 'api-remove', 'api-status', 'following', 'following-read', 'following-stop', 'following-export', 'following-status', 'following-count', 'following-list', 'library', 'count', 'export', 'clear', 'library-summary', 'editor-details', 'editor', 'rowid', 'text', 'cancel', 'bulk-details', 'bulk-mode', 'bulk-text', 'bulk-add', 'rows', 'logs-section', 'logs']) {
    assert.ok(ids.includes(id), `Missing control ${id}`);
  }
  assert.ok(!ids.includes('import')&&!ids.includes('rowtype'),'old mixed-library controls must be removed');
  assert.match(html, /type="password"/);
  assert.match(html, /不代表密钥被删除/);
  assert.match(html, /aria-describedby="api-status key-help"/);
});

test('floating console exposes reasons, uses readable real dimensions, and honors hidden alerts', async () => {
  const css = await read('overlay.css');
  assert.match(css, /width:440px/);
  assert.match(css, /transform:scale\(\.5\);transform-origin:bottom right/);
  assert.match(css, /#x-assistant-float \.status\s*\{\s*display:none!important/);
  assert.doesNotMatch(css, /font-size:(?:10|11|12|13)px/);

  assert.match(css, /\[hidden\]\s*\{\s*display:none!important/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});

test('visual previews are labeled demos with no live extension script', async () => {
  for (const file of ['design/panel-preview.html', 'design/overlay-preview.html']) {
    const html = await read(file);
    assert.match(html, /演示/);
    assert.doesNotMatch(html, /<script[^>]+src="(?:\.\.\/)?(?:panel|overlay|scheduler)\.js"/);
    assert.doesNotMatch(html, /chrome\.storage|chrome\.runtime/);
  }
});

test('restored screenshot layout exposes follow and cleanup controls', async () => {
 const source=await read('view.js');
 assert.doesNotMatch(source, /more-options|more-schedule/);
 assert.doesNotMatch(source, /settings-link|时间设置/);
 assert.match(source, /data-setting="auto-follow"/);
 assert.match(source, /data-module="posting"/);
 assert.match(source, /data-module="notifications"/);
 assert.match(source,/data-module="followback"/);
 assert.equal((source.match(/class="module-icon"/g)||[]).length,4);
});

test('compact status prioritizes scheduler ownership without hiding real failures', async () => {
  const source = await read('view.js');
  const start = source.indexOf(' const sync=()=>{\n  const output=section.querySelector');
  const end = source.indexOf(' };new MutationObserver(sync).observe(section', start);
  assert.ok(start >= 0 && end > start);
  const syncSource = source.slice(start, end) + ' };sync();';
  function render({text, name='interaction', state='on', label='运行中', noLamp=false, nextAt=''}) {
    const output={textContent:text, hidden:false};
    const lamp=noLamp?null:{textContent:label,dataset:{state},setAttribute(){}};
    const value={textContent:''};
    const timer={querySelector:s=>s==='span'?value:null,setAttribute(){}};
    const section={dataset:{nextAt},querySelector:s=>s==='.status'?output:s==='.state-lamp'?lamp:null};
    vm.runInNewContext(syncSource,{section,timer,posting:name==='posting',notification:name==='notifications',Date:{now:()=>1000},root:{querySelector(){throw Error('unexpected schedule access');}}});
    return {output,lamp,value};
  }
  const stopped=render({text:'互动模块已停止',state:'off',label:'已停止'});
  assert.equal(stopped.output.hidden,true);
  assert.equal(stopped.lamp.dataset.quiet,'false');
  const yielded=render({text:'本帖处理结束，等待下一帖 · 7.2 秒',state:'wait',label:'等待回帖完成'});
  assert.equal(yielded.output.hidden,true);
  assert.equal(yielded.value.textContent,'—');
  const notification=render({text:'上轮回帖完成 · 8.0 秒',name:'notifications',state:'wait',label:'等待关注后冷却'});
  assert.equal(notification.output.hidden,true);
  assert.equal(notification.value.textContent,'—');
  const scheduledReply=render({text:'下次回帖 2 分钟',name:'notifications',state:'wait',label:'等待中',nextAt:'91000'});
  assert.equal(scheduledReply.value.textContent,'1:30');
  const replyCooldown=render({text:'下一条 · 8.0 秒 · 本轮已回复 1',name:'notifications',state:'on',label:'运行中',nextAt:'301000'});
  assert.equal(replyCooldown.value.textContent,'8');
  const skipped=render({text:'AI 主动跳过（并非发送失败），等待下一帖 · 5.0 秒',state:'wait',label:'等待回帖完成'});
  assert.equal(skipped.output.hidden,true);
  const error=render({text:'回复提交结果未知，已安全停止',state:'off',label:'已停止'});
  assert.equal(error.output.hidden,false);
  assert.equal(error.output.textContent,'回复提交结果未知，已安全停止');
  const running=render({text:'评价完成，等待点赞 · 4.2 秒'});
  assert.equal(running.output.hidden,true);
  assert.equal(running.value.textContent,'5');
  const posting=render({text:'下次发帖 1428 秒',name:'posting',state:'wait',label:'冷却中'});
  assert.equal(posting.value.textContent,'23:48');
  const cleanup=render({text:'清理已停止',name:'cleanup',noLamp:true});
  assert.equal(cleanup.output.hidden,false);
});
test('absolute countdowns receive a wall-clock tick even when their deadline attribute is unchanged',async()=>{
 const source=await read('view.js');
 assert.match(source,/const countdownTick=setInterval\(/);assert.match(source,/!document.hidden&&root.dataset.collapsed!=='true'/);assert.match(source,/timerRenders.forEach\(sync=>sync\(\)\)/);
 assert.match(source,/pagehide[^\n]+clearInterval\(countdownTick\)/);
 const control=await read('console.js');assert.match(control,/Number.isFinite\(state.nextAt\)/);assert.match(control,/Number.isFinite\(worker.retryAt\)/);
});
