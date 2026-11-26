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

test('transient skipped comments retry after 30 minutes up to 3 attempts; blocked authors stay skipped',()=>{
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../notification-policy.js',import.meta.url),'utf8'),ctx);
 const {reason}=ctx.XAssistantNotificationPolicy,now=10*3600000,row={id:'1',author:'a',addressed:true,directComment:true,at:now-1000,text:'hi'};
 const at=now-30*60000;
 assert.equal(reason(row,{account:'/me',now,record:{status:'skipped_issue',reasonCode:'CLEANUP_FAILED',at:now-60000,attempts:1}}),'skipped_issue');
 assert.equal(reason(row,{account:'/me',now,record:{status:'skipped_issue',reasonCode:'CLEANUP_FAILED',at,attempts:1}}),null);
 assert.equal(reason(row,{account:'/me',now,record:{status:'skipped_issue',reasonCode:'ACCOUNT_CHANGED',at,attempts:2}}),null);
 assert.equal(reason(row,{account:'/me',now,record:{status:'skipped_issue',reasonCode:'ACCOUNT_CHANGED',at,attempts:3}}),'skipped_issue');
 assert.equal(reason(row,{account:'/me',now,record:{status:'skipped_issue',reasonCode:'AUTHOR_BLOCKED',at:0,attempts:1}}),'skipped_issue');
});
