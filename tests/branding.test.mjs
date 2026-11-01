import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
test('Sacred Plan brand is consistent across extension and visible surfaces',async()=>{
 assert.equal(manifest.name,'神圣计划');assert.equal(manifest.action.default_title,'打开神圣计划');
 for(const path of ['overlay.js','panel.html']){const s=await readFile(new URL('../'+path,import.meta.url),'utf8');assert.ok(s.includes('神圣计划'));assert.ok(!s.includes('X 文案助手'));}
});
test('packaged icon sizes match PNG headers and toolbar entries',async()=>{
 for(const n of [16,32,48,128]){const path=manifest.icons[n];assert.equal(manifest.action.default_icon[n],path);const bytes=await readFile(new URL('../'+path,import.meta.url));assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),n);assert.equal(bytes.readUInt32BE(20),n);}
 assert.ok(manifest.web_accessible_resources.some(r=>r.resources.includes('icons/icon-48.png')&&r.matches.includes('https://x.com/*')));
});
