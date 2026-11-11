import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../service-policy.js',import.meta.url),'utf8');
function policy(){const sandbox={globalThis:{}};vm.runInNewContext(source,sandbox);return sandbox.globalThis.XAssistantServicePolicy;}

test('posting is independently opt-in; disabling it leaves the selected reply modules available',()=>{
 const p=policy();
 assert.deepEqual([...p.activeModules({})],[]);
 assert.deepEqual([...p.activeModules({posting:false,interaction:true,notifications:true})],['interaction','notifications']);
 assert.deepEqual([...p.activeModules({posting:true,interaction:true,notifications:false})],['posting','interaction']);
 assert.deepEqual([...p.activeModules({posting:true})],['posting']);
});
test('posting and the other service modules remain available around the clock',()=>{
 const p=policy(),night=Date.parse('2026-11-04T16:00:00Z'),morning=Date.parse('2026-11-04T22:00:00Z');
 assert.equal(p.isModuleWorking('posting',night),true);
 assert.equal(p.isModuleWorking('posting',morning),true);
 for(const module of ['interaction','notifications'])assert.equal(p.isModuleWorking(module,night),true);
});
