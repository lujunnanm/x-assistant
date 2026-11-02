import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('upgraded icon sizes retain alpha and are not recolored',async()=>{
 for(const size of [16,32,48,128,1024]){
  const name=size===1024?'logo-1024.png':`icon-${size}.png`;
  const b=await readFile(new URL('../icons/'+name,import.meta.url));
  assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);assert.equal(b[25],6);
 }
 const css=await readFile(new URL('../overlay.css',import.meta.url),'utf8');
 assert.ok(css.includes('#x-assistant-float .brand-icon{filter:none}'));
});
