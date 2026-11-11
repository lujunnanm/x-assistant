import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('overlay.js');

async function runOne({enabled=true,relation='unknown',replyFails=false,rounds=1}={}){
 const events=[],signal={aborted:false};let selected=0,completed=0;
 const info={id:'123',author:'ann',text:'fixture',followState:relation,followsYou:true,article:{classList:{remove(){}}}};
 const cx=vm.createContext({Map,Date,homeSource:null,selected:info.article,replySubmitted:false,
  location:{href:'https://x.com/home',pathname:'/home',search:''},document:{querySelector:()=>null},
  check(){},requireSource:async()=>{},core:{interactionPage:()=>true},runtime:async()=>({active:true,runId:'run',nextAt:0}),
  autoFollow:async()=>enabled,status(){},findCandidate:async()=>({...info,id:String(++selected),author:'ann'+selected}),markSelected(){},
  aiReply:async info=>({postId:info.id,action:'send_reply',text:'hello'}),recordOutcome(){},
  saveProcessed:async(_i,r)=>events.push('save:'+r.reply+':'+r.follow),deferRecord:async()=>{},
  replyAndSend:async(_i,_text,_signal,onConfirmed)=>{events.push('reply');if(replyFails)throw Error('unsent');await onConfirmed();return 'verified';},
  followAuthor:async()=>{events.push('follow');return 'queued';},updateRuntime:async()=>{},
  waitAfterAttempt:async()=>{signal.aborted=++completed>=rounds;}});
 vm.runInContext(source.slice(source.indexOf('  const runLoop ='),source.indexOf(' // A single owner per module;'))+';globalThis.run=runLoop;',cx);
 await cx.run(signal,'run','home');return events;
}
test('unknown cooldown relationship and unfollowed author both enqueue after confirmed reply',async()=>{
 for(const relation of ['unknown','unfollowed']){
  const events=await runOne({relation});assert.equal(events.filter(x=>x==='follow').length,1);
  assert.ok(events.indexOf('follow')>events.indexOf('save:verified:pending'));
  assert.ok(events.includes('save:verified:queued'));
 }
});
test('disabled setting, known followed author, or failed reply never schedule a follow',async()=>{
 for(const options of [{enabled:false},{relation:'followed'},{replyFails:true}])assert.equal((await runOne(options)).includes('follow'),false);
});

test('interaction proceeds to the second reply while both follow jobs are still queued',async()=>{
 const events=await runOne({rounds:2});
 assert.equal(events.filter(e=>e==='reply').length,2);
 assert.equal(events.filter(e=>e==='save:verified:queued').length,2);
 assert.equal(events.filter(e=>e==='follow').length,2);
});
