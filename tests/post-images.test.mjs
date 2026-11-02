import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import imageMap from '../post-image-map.mjs';

test('50 packaged images are assigned once to 50 of the first 100 posts',async()=>{
 const entries=Object.entries(imageMap);
 assert.equal(entries.length,50);
 assert.equal(new Set(entries.map(([id])=>id)).size,50);
 assert.equal(new Set(entries.map(([,path])=>path)).size,50);
 for(const [id,path] of entries){
  assert.match(id,/^post_(?:0\d\d|100)$/);
  assert.match(path,/^post-images\/post-image-\d{2}\.jpg$/);
  const file=new URL('../'+path,import.meta.url),bytes=await readFile(file);
  assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.ok((await stat(file)).size>10_000);
 }
 const library=JSON.parse(await readFile(new URL('../post-library-100.json',import.meta.url),'utf8'));
 assert.equal(library.filter(row=>row.image).length,50);
 for(const row of library)assert.equal(row.image,imageMap[row.id]);
});

test('posting driver loads, attaches, verifies and cleans up owned images',async()=>{
 const source=await readFile(new URL('../posting.js',import.meta.url),'utf8');
 for(const needle of ['chrome.runtime.getURL(path)','new File([blob]','data.items.add(file)','等待图片上传','row.image&&!hasAttachment(dialog)','removeOwnedImage(dialog)'])assert.ok(source.includes(needle),needle);
});
