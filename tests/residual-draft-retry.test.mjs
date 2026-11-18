import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('legacy residual drafts retry next batch but unknown sends never retry',()=>{
 const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../notification-policy.js',import.meta.url),'utf8'),c);
 const row={id:'1',author:'friend',addressed:true,at:1000,text:'hi'};
 const options={account:'/owner',now:2000,until:2000,record:{status:'skipped_issue',reasonCode:'RESIDUAL_DRAFT'}};
 const reason=c.XAssistantNotificationPolicy.reason;
 assert.equal(reason(row,options),null);
 assert.equal(reason(row,{...options,attempted:new Set(['1'])}),'attempted_this_window');
 assert.equal(reason(row,{...options,prior:{reply:'unknown'}}),'unknown_send');
 assert.equal(reason(row,{...options,record:{status:'skipped_issue',reasonCode:'AUTHOR_BLOCKED'}}),'skipped_issue');
});
