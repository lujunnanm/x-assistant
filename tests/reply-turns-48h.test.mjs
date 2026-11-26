import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../x-dom.js',import.meta.url),'utf8');
const rec=(id,parent,author,replyCount=0,root='5')=>({id,parent,author,replyCount,root});
const native=records=>{const ctx=vm.createContext({});vm.runInContext(src,ctx);const d=ctx.XAssistantDOM;
 d.ingestThreadRecords([rec('5',null,'me',2),...records]);return d;};
test('per top comment: sort numeric Snowflakes, not DOM rank, siblings, or any previous own reply',()=>{
 const d=native([rec('95','50','me',1),rec('90071992547409991','5','Jane',1),rec('100','95','bob'),rec('50','5','alice',2),rec('96','50','alice'),
 rec('90071992547409992','90071992547409991','ME')]);
 let g=d.branchTurns('5','/ME');assert.equal(g.byId.get('50').latestId,'100');assert.equal(g.byId.get('95').latestAuthor,'bob');
 assert.equal(g.byId.get('50').complete,true);assert.equal(g.byId.get('90071992547409991').latestAuthor,'me');
 d.ingestThreadRecords([rec('101','100','me'),rec('100','95','bob',1)]);g=d.branchTurns('5','/me');assert.equal(g.byId.get('50').latestAuthor,'me');
 assert.equal(d.branchTurns('5','/other').groups.length,0);
});
test('single unanswered comment is its own latest; missing descendants/count and ambiguous newer orphan prevent proof',()=>{
 const d=native([rec('10','5','a'),rec('20','5','b',1)]);
 let g=d.branchTurns('5','/me');assert.equal(g.byId.get('10').latestId,'10');assert.equal(g.byId.get('10').complete,true);assert.equal(g.byId.get('20').complete,false);
 d.ingestThreadRecords([rec('21','20','me',null),rec('31','30','c')]);g=d.branchTurns('5','/me');
 assert.equal(g.byId.get('10').complete,false);assert.equal(g.byId.get('21').complete,false);assert.deepEqual([...g.orphans],['31']);
 d.ingestThreadRecords([rec('30','5','c',1),rec('21','20','me',0)]);g=d.branchTurns('5','/me');assert.ok(g.groups.every(t=>t.complete));
});
test('reply index exposes only native id/parent/author/child count, keeps nested own turns without post bodies',()=>{
 const d=native([rec('10','5','Alice',1),rec('20','10','ME',0)]);
 assert.deepEqual(JSON.parse(JSON.stringify(d.replyIndex('5','/me'))),[
  {id:'10',parent:'5',author:'alice',count:1},{id:'20',parent:'10',author:'me',count:0}]);
 assert.equal(d.replyIndex('5','/other').length,0);
});
