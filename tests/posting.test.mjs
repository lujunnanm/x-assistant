import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../posting.js',import.meta.url),'utf8');
test('posting no longer requires home and uses global original composer',()=>{
 assert.doesNotMatch(source,/location\.pathname|x\.com\/home/);
 assert.match(source,/SideNav_NewTweet_Button/);
 assert.match(source,/dialog\.querySelectorAll\('\[data-testid="tweetButton"\]/);
 assert.match(source,/发帖框已有用户草稿，未覆盖/);
 assert.match(source,/检测到回复或引用上下文/);
});
test('posting keeps abort controls and tenth-second scheduling',()=>{
 assert.match(source,/stop\.onclick/);assert.match(source,/control\?\.abort/);
 assert.match(source,/6000\+Math\.floor/);assert.match(source,/\*3001\)\)\*100/);
 assert.match(source,/toFixed\(1\)/);
});
test('posting resumes an interrupted countdown without resetting its deadline',()=>{
 assert.match(source,/launch\(true\)/);
 assert.match(source,/pendingNextAt=resume\?saved\.nextAt:null/);
 assert.match(source,/Number\.isFinite\(pendingNextAt\)\?pendingNextAt/);
});
test('posting waits for the X account link before validating a resumed run',()=>{
 assert.match(source,/const waitAccount=async signal/);
 assert.match(source,/const account=await waitAccount\(signal\)/);
});
test('posting verifies multiline composer content using rendered editor text',()=>{
 assert.match(source,/core\?\.editorText\(editor\)/);
 assert.doesNotMatch(source,/editor\.textContent\.replace/);
});
