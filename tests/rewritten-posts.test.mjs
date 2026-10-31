import test from 'node:test';
import assert from 'node:assert/strict';
import rows from '../rewritten-existing-posts-155.mjs';
import grok from '../grok-post-library-100.json' with {type:'json'};

test('all 155 existing posts have unique complete rewrites',()=>{
 const expected=[...Array.from({length:49},(_,i)=>`post_${String(i+1).padStart(3,'0')}`),...Array.from({length:106},(_,i)=>`post_${i+101}`)];
 assert.deepEqual(rows.map(row=>row.id),expected);
 assert.equal(new Set(rows.map(row=>row.text)).size,155);
 assert.ok(rows.every(row=>row.type==='post'&&row.enabled&&row.text.length>10&&[...row.text].length<=280));
 assert.ok(rows.slice(0,49).every(row=>row.text.includes('#')));
 assert.ok(rows.slice(49,149).every(row=>row.text.endsWith('\n\n@grok')));
 assert.ok(rows.slice(49,149).every((row,index)=>row.text!==grok[index].text));
 const banned=[/不等于/,/不是.+而是/s,/与其.+不如/s,/你以为.+其实/s,/别把.+当成/s,/少一点.+多一点/s,/比起/];
 assert.ok(rows.every(row=>banned.every(pattern=>!pattern.test(row.text))));
 for(const row of rows){const tags=row.text.match(/#\S+/g);assert.equal(tags.length,3);assert.equal(tags[0],'#蓝v交友');assert.equal(new Set(tags).size,3);}
});
