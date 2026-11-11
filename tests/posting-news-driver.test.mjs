import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../posting.js',import.meta.url),'utf8');
const guardSource=source.slice(source.indexOf('  const assertCopyReady='),source.indexOf('  const same=()=>'));
function guard(row){return vm.runInNewContext(guardSource+'assertCopyReady;',{row,postingFailure:(code,message)=>Object.assign(Error(message),{code})});}
test('final synchronous click guard follows v3 enabled/disabled semantics',()=>{
 assert.throws(guard({enabled:false}),e=>e.code==='POST_COPY_DISABLED');
 assert.doesNotThrow(guard({enabled:true}));assert.doesNotThrow(guard({}));
 assert.doesNotThrow(guard({enabled:true,status:'draft',targetAccount:'/other',expiresAt:'2000-01-01T00:00:00Z'}),'removed workflow fields cannot silently block an enabled normalized row');
 const validate=source.slice(source.indexOf('     validate:()=>{'),source.indexOf('     click:()=>'));
 assert.ok(validate.includes('assertCopyReady();'),'guard must run after persistence and before actual click');
});
test('real upload supports portable data URLs, bounded blobs and decoded pixels before writing a file input',()=>{
 const upload=source.slice(source.indexOf(' async function uploadImage('),source.indexOf(' async function removeOwnedImage('));
 assert.ok(upload.includes('fetch(inline?path:chrome.runtime.getURL(path))'));
 assert.ok(upload.includes('blob.size>5*1024*1024'));
 assert.ok(upload.indexOf('await createImageBitmap(blob)')<upload.indexOf('inputs[0].files=data.files'));
 assert.ok(upload.includes('decoded?.close()'));assert.ok(upload.includes('配图无法解码，未发送'));
});
test('confirmed state controls ordered queue completion only after the backend transaction returns',()=>{
 assert.match(source,/return await patch\(\{phase:'confirmed'/);
 assert.match(source,/confirmedState\?\.libraryRemaining===0/);
 assert.match(source,/全部启用文案已发布并从文案库删除/);
});
