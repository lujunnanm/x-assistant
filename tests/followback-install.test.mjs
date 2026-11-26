import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
test('verified-follower driver is only injected once on X, after its helpers and before workspace boot',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 const groups=manifest.content_scripts.filter(g=>g.js?.includes('followback.js'));
 assert.equal(groups.length,1);const group=groups[0],js=group.js;
 assert.deepEqual(group.matches,['https://x.com/*']);assert.notEqual(group.world,'MAIN');
 assert.equal(js.filter(x=>x==='followback.js').length,1);
 for(const dep of ['action-client.js','runtime-client.js','task-utils.js','x-dom.js','service-policy.js'])
  assert.ok(js.includes(dep)&&js.indexOf(dep)<js.indexOf('followback.js'),dep);
 assert.ok(js.indexOf('workspace.js')>js.indexOf('followback.js'));
 assert.doesNotMatch(read('panel.html'),/<script[^>]+src="followback.js"/);
 assert.doesNotMatch(read('followback.js'),/\.handOff\(|AI_CHECK|AI_NOTIFICATION_REPLY|\.sendMessage\(\{kind:'SERVICE_SET'/);
});
