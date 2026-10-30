import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRows,interval,pick} from '../core.mjs';
test('empty library is valid and yields no selection',()=>{assert.deepEqual(validateRows([]),[]);assert.equal(pick([],'reply').row,null);});
test('import rejects malformed or duplicate entries',()=>{for(const rows of [{},[{type:'reply',text:''}],[{id:'a',type:'reply',text:'a'},{id:'a',type:'post',text:'b'}],[{type:'reply',text:'a',enabled:'false'}]])assert.throws(()=>validateRows(rows));});
test('interval bounds and bad settings',()=>{assert.equal(interval({min:30,max:60},()=>0),30000);assert.equal(interval({min:30,max:60},()=>1),60000);for(const c of [{min:0,max:60},{min:60,max:30},{min:30,max:Infinity}])assert.throws(()=>interval(c));});
test('shuffle consumes enabled rows once and filters removed rows',()=>{const rows=validateRows([{id:'a',type:'reply',text:'a'},{id:'b',type:'reply',text:'b'},{id:'c',type:'reply',text:'c',enabled:false}]);const a=pick(rows,'reply');const b=pick(rows,'reply',a.bag,a.row.id);assert.notEqual(a.row.id,b.row.id);assert.equal(b.bag.length,0);assert.equal(pick(rows,'post').row,null);assert.equal(pick(rows,'reply',['deleted','a']).row.id,'a');});
