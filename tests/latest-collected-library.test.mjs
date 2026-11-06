import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('bundled legacy collection is never seeded into the new posting library',async()=>{
 const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
 assert.doesNotMatch(background,/import\s+latestCollectedLibrary\s+from/);
 assert.doesNotMatch(background,/app\.rows\s*=\s*validateRows\(latestCollectedLibrary\)/);
 assert.doesNotMatch(background,/latestCollectedLibraryV4019Loaded/);
 await assert.rejects(access(new URL('../latest-collected-library-200.mjs',import.meta.url)),'old bundled text bank must be removed');
});
