import test from 'node:test';
import assert from 'node:assert/strict';
import builtin from '../builtin-library.mjs';
import {readFile} from 'node:fs/promises';
import {validateRows} from '../core.mjs';

test('reply library v3 contains 100 unique replacement rows',async()=>{
 const file=JSON.parse(await readFile(new URL('../reply-library-100-v3.json',import.meta.url),'utf8'));
 const rows=validateRows(file);
 assert.equal(rows.length,100);
 assert.equal(new Set(rows.map(row=>row.id)).size,100);
 assert.equal(new Set(rows.map(row=>row.text)).size,100);
 assert.ok(rows.every(row=>row.type==='reply'&&row.enabled&&row.text.endsWith('\n交个朋友呀\n请回关我')));
 assert.deepEqual(builtin.filter(row=>row.type==='reply'),rows);
});
