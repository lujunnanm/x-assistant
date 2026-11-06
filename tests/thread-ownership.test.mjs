import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('observer forwards only parsed thread metadata without changing the response',async()=>{
 const messages=[],response={url:'https://x.com/i/api/graphql/hash/HomeTimeline',clone:()=>({json:async()=>({tweet:{rest_id:'12',legacy:{conversation_id_str:'10',in_reply_to_status_id_str:'10'},core:{user_results:{result:{legacy:{screen_name:'Friend'}}}}}})})};
 const window={fetch:async()=>response,postMessage:m=>messages.push(m)};
 vm.runInNewContext(readFileSync(new URL('../thread-ownership.js',import.meta.url),'utf8'),{window,location:{origin:'https://x.com'},URL});
 assert.equal(await window.fetch('/timeline'),response);
 await new Promise(r=>setImmediate(r));
 assert.equal(messages[0].records[0].root,'10');
 assert.equal(messages[0].records[0].parent,'10');
 assert.equal(messages[0].records[0].author,'Friend');
});
