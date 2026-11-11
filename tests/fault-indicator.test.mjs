import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const sheet='fault-indicator.css';
const rules=()=>[...read(sheet).replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
 .map(([,selector,declarations])=>({selector:selector.trim(),declarations:declarations.trim()}));
const hidden=rule=>/(?:^|;)\s*display\s*:\s*none\b/.test(rule.declarations);

test('the X console loads the fault override after its normal orange and hidden styles',()=>{
 const groups=JSON.parse(read('manifest.json')).content_scripts;
 const hosts=groups.filter(g=>g.matches.includes('https://x.com/*')&&g.js?.includes('console.js'));
 assert.equal(hosts.length,1);const styles=hosts[0].css;
 assert.ok(styles.indexOf('overlay.css')>=0);
 assert.ok(styles.indexOf(sheet)>styles.indexOf('overlay.css'));
});

test('the error color is local to an icon whose own module has a visible warning, not a hidden warning or normal note',()=>{
 const red=rules().filter(r=>r.selector.includes('.module-icon')&&/(?:^|;)\s*color\s*:/.test(r.declarations));
 assert.ok(red.length,'missing module fault color');
 for(const r of red){
  const selector=r.selector.replace(/\s/g,'').replaceAll('"','');
  assert.equal(selector,'#x-assistant-floatsection:has(>.module-issue[data-tone=warning]:not([hidden])).module-icon');
  const hex=r.declarations.match(/(?:^|;)\s*color\s*:\s*#([\da-f]{6})\b/i)?.[1];assert.ok(hex);
  const [r8,g,b]=hex.match(/../g).map(s=>parseInt(s,16));
  assert.ok(r8>180&&r8>g+65&&r8>b+45&&b>=g-25,'must be red, not the normal orange');
 }
});

test('module error copy and global notice copy do not occupy space, without disabling explicit review/repair',()=>{
 const selectors=rules().filter(hidden).map(r=>r.selector).join(',');
 assert.match(selectors,/\.module-issue\s*>?\s*span\b/);
 assert.match(selectors,/\.workspace-notice\b/);
 assert.match(selectors,/\.module-issue:has\(\s*>\s*\.repair-worker\[hidden\]\)/,'no empty row after hiding a message');
 // The action is separate from the description; never unconditionally hide the whole row or its button.
 assert.doesNotMatch(selectors,/\.module-issue\s*(?:,|$)|\.repair-worker\s*(?:,|$)|\.module-issue\s*>?\s*button\s*(?:,|$)/);
 assert.match(read('console.js'),/issue\.append\(detail,fix\)/);
 assert.match(read('console.js'),/if\(!await api\.review\(module,self\(\)\)\)return/);
});

test('a global notice or connection timeout marks the brand instead of painting every module red',()=>{
 const brand=rules().find(r=>r.selector.includes('.brand-icon'));
 assert.ok(brand);assert.match(brand.selector,/\.workspace-notice:not\(\[hidden\]\)/);
 assert.match(brand.selector,/\[aria-label="后台未响应"\]/);assert.doesNotMatch(brand.selector,/\.module-icon/);
 assert.match(brand.declarations,/outline\s*:\s*[^;]+#f[0-9a-f][0-9a-f]{4}/i);
});
