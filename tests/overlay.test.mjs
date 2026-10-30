import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('manifest installs the X overlay and clipboard bridge',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,'0.12.5');
 assert.deepEqual(manifest.content_scripts[0].matches,['https://x.com/*']);
 assert.ok(manifest.content_scripts[0].js.includes('overlay.js'));
 assert.ok(manifest.permissions.includes('offscreen'));
 assert.ok(manifest.permissions.includes('clipboardWrite'));
});

test('overlay exposes all in-page controls without opening options',async()=>{
 const source=await readFile(new URL('../overlay.js',import.meta.url),'utf8');
 for(const action of ['start','stop','post-start','post-stop'])assert.match(source,new RegExp(`data-a=["']${action}["']`));
 assert.doesNotMatch(source,/openOptionsPage|chrome-extension:\/\//);
});

test('multiline replies use visual editor text and uncertain submissions stop safely',async()=>{
 const source=await readFile(new URL('../overlay.js',import.meta.url),'utf8');
 assert.match(source,/core\.editorText\(editor\)/);
 assert.doesNotMatch(source,/editor\.textContent\.replace/);
 assert.match(source,/回复提交结果未知，互动已停止，避免重复操作/);
 assert.match(source,/const dialog=ownedReplyDialog/);
});
