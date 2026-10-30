import test from 'node:test';import assert from 'node:assert/strict';
import {newSingleLedger,transitionSingle,recoverSingle} from '../single-ledger.mjs';
test('unknown result cannot be retried and crash becomes unknown',()=>{
 let s=newSingleLedger({url:'https://x.com/a/status/123',reply:'hello',account:'@me'});
 s=transitionSingle(s,'reply','in_flight');s=recoverSingle(s);
 assert.equal(s.steps.reply,'unknown');assert.throws(()=>transitionSingle(s,'reply','in_flight'));
 s=transitionSingle(s,'reply','verified');assert.throws(()=>transitionSingle(s,'reply','in_flight'));
});
test('terminal states cannot be re-executed',()=>{
 let s=newSingleLedger({url:'https://x.com/a/status/123',reply:'hello',account:'@me'});
 s=transitionSingle(s,'like','skipped');assert.throws(()=>transitionSingle(s,'like','in_flight'));
 assert.throws(()=>newSingleLedger({url:'https://evil.test/a/status/1',reply:'x',account:'@me'}));
});
test('safe pre-click failure can return to pending',()=>{
 let s=newSingleLedger({url:'https://x.com/a/status/123',reply:'hello'});
 s=transitionSingle(s,'like','in_flight');s=transitionSingle(s,'like','pending');
 assert.equal(s.steps.like,'pending');
});
test('unknown like can return to pending only after external verification',()=>{
 let s=newSingleLedger({url:'https://x.com/a/status/123',reply:'hello'});
 s=transitionSingle(s,'like','in_flight');s=transitionSingle(s,'like','unknown');s=transitionSingle(s,'like','pending');
 assert.equal(s.steps.like,'pending');
});
