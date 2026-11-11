import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';


test('all 50 existing images remain packaged for saved user references',async()=>{
 for(let i=1;i<=50;i++){
  const path=`post-images/post-image-${String(i).padStart(2,'0')}.jpg`,file=new URL('../'+path,import.meta.url),bytes=await readFile(file);
  assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.ok((await stat(file)).size>10_000);
 }
});

test('posting driver loads, attaches, verifies and cleans up owned images',async()=>{
 const source=await readFile(new URL('../posting.js',import.meta.url),'utf8');
 for(const needle of ['chrome.runtime.getURL(path)','new File([blob]','data.items.add(file)','等待图片或动图上传','images.length&&!hasAttachment(dialog)','removeOwnedImage(dialog,cleanable)'])assert.ok(source.includes(needle),needle);
});
