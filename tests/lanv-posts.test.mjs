import test from 'node:test';
import assert from 'node:assert/strict';
import rows from '../lanv-posts-50.mjs';

test('lanv collection contains 50 unique enabled short posts with the required topic',()=>{
 assert.equal(rows.length,50);
 assert.equal(new Set(rows.map(row=>row.id)).size,50);
 assert.equal(new Set(rows.map(row=>row.text)).size,50);
 assert.ok(rows.every(row=>row.type==='post'&&row.enabled));
 assert.ok(rows.every(row=>row.text.includes('#蓝v交友')));
 assert.ok(rows.every(row=>[...row.text].length<=280));
 for(const row of rows){const tags=row.text.match(/#\S+/g);assert.equal(tags.length,3);assert.equal(tags[0],'#蓝v交友');assert.equal(new Set(tags).size,3);}
});
