// Destructive operations use an immutable, explicitly confirmed preview. No discovery or bulk selectors here.
// Deletion is serial and independent of the publishing/reply action gate.
const GAP=5000, running=new Set();
const fail=(code,message)=>Object.assign(Error(message),{code});
const handle=value=>typeof value==='string'&&/^[/@]?[a-z0-9_]{1,15}$/i.test(value)?'/'+value.replace(/^[/@]/,'').toLowerCase():null;
const postId=value=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const body=value=>typeof value==='string'?value.replace(/\r\n/g,'\n'):null;
const checkAbort=signal=>{if(signal?.aborted)throw fail('CANCELLED','删除已停止');};
const defaultSleep=(ms,signal)=>new Promise((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);reject(fail('CANCELLED','删除已停止'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
function match(row,post,account){
 return !!row&&row.id===post.id&&handle(row.author)===account&&row.owned===true&&row.isReply===false&&row.isQuote===false&&row.isRepost===false&&body(row.text)===post.text;
}
function snapshot(plan,confirmed){
 const account=handle(plan?.account);
 if(!account||typeof plan.id!=='string'||!plan.id.trim()||plan.id!==confirmed||!Array.isArray(plan.posts))throw fail('PLAN_UNCONFIRMED','需确认这份固定删除清单');
 const ids=new Set(),posts=plan.posts.map(p=>{
  if(!postId(p?.id)||ids.has(p.id)||!body(p.text)?.trim())throw fail('PLAN_INVALID','清单内帖子身份或文本不完整、重复');
  ids.add(p.id);return Object.freeze({id:p.id,text:body(p.text)});
 });
 return {id:plan.id,account,posts};
}
function checkedLedger(raw,account){
 if(raw==null)return {version:1,account,nextAt:0,records:{}};
 if(raw.version!==1||raw.account!==account||!Number.isFinite(raw.nextAt)||raw.nextAt<0||!raw.records||typeof raw.records!=='object'||Array.isArray(raw.records)||
    Object.entries(raw.records).some(([k,v])=>!postId(k)||!['in_flight','unknown','deleted'].includes(v?.status)))throw fail('LEDGER_INVALID','删除记录异常，不能安全继续');
 return raw;
}

// remove must bind a single native confirmation, call beforeConfirm(freshRow) exactly once
// BEFORE its irreversible click, recheck the same account/row/dialog then click synchronously.
// Only a positive, target-bound receipt {status:'deleted',id} proves deletion.
export async function runDeletionPlan({plan,confirmedPlanId,adapter,signal}){
 const {account,id:planId,posts}=snapshot(plan,confirmedPlanId);
 for(const k of ['currentAccount','inspect','remove','readLedger','writeLedger'])if(typeof adapter?.[k]!=='function')throw fail('ADAPTER_INVALID','缺少删除适配器 '+k);
 async function run(){
  if(running.has(account))throw fail('DELETE_BUSY','此账号已有删除任务');
  running.add(account);
  const result={deleted:0,skipped:0,unknown:0,stopped:false,reason:null,items:[]};
  const add=(id,status,reason)=>{result[status]++;result.items.push({id,status,...(reason?{reason}:{})});};
  const stop=reason=>{result.stopped=true;result.reason=reason;};
  const now=()=>{const t=(adapter.now||Date.now)();if(!Number.isFinite(t)||t<0)throw fail('INVALID_CLOCK','系统时间无效');return t;};
  const guard=async()=>{checkAbort(signal);if(handle(await adapter.currentAccount())!==account)throw fail('ACCOUNT_CHANGED','账号不匹配');checkAbort(signal);};
  try{
   let ledger=checkedLedger(await adapter.readLedger(account),account);
   const write=async(id,status)=>{const at=now(),next={...ledger,nextAt:Math.max(ledger.nextAt,at+GAP),records:{...ledger.records,[id]:{status,at,planId}}};
    await adapter.writeLedger(account,next);ledger=next;};
   for(const post of posts){
    let armed=false,called=false,accepting=true;
    try{
     await guard();
     const prior=ledger.records[post.id];
     if(prior){add(post.id,'skipped',prior.status==='deleted'?'already_deleted':'prior_unknown');continue;}
     while(now()<ledger.nextAt){await (adapter.sleep||defaultSleep)(Math.max(1,ledger.nextAt-now()),signal);await guard();}
     const row=await adapter.inspect(post.id);
     await guard();if(!match(row,post,account)){add(post.id,'skipped','target_mismatch');continue;}
     const beforeConfirm=async fresh=>{
      if(!accepting||called)throw fail('DUPLICATE_CONFIRM','确认已失效或被重复使用');called=true;
      await guard();if(!match(fresh,post,account))throw fail('TARGET_CHANGED','确认前目标已变化');
      await write(post.id,'in_flight');armed=true;
      await guard();if(!accepting)throw fail('STALE_CONFIRM','确认已失效');
     };
     const receipt=await adapter.remove(row,{signal,beforeConfirm});
     accepting=false;
     if(armed&&receipt?.status==='deleted'&&receipt.id===post.id){await write(post.id,'deleted');add(post.id,'deleted',receipt.reason);}
     else if(!armed&&receipt?.status==='skipped'){add(post.id,'skipped',String(receipt.reason||'no_click'));await guard();}
     else{await write(post.id,'unknown');add(post.id,'unknown',receipt?.reason||'unverified_delete');stop('unknown');break;}
    }catch(error){
     if(armed||error?.submitted===true){
      // If the final write fails the original in_flight row still quarantines this ID.
      try{await write(post.id,'unknown');}catch{}
      add(post.id,'unknown','unverified_delete');stop('unknown');
     }else if(error?.code==='TARGET_CHANGED'){add(post.id,'skipped','target_mismatch');continue;}
     else stop(signal?.aborted?'CANCELLED':error?.code||'DELETE_ERROR');
     break;
    }finally{accepting=false;}
   }
   return result;
  }finally{running.delete(account);}
 }
 const locks=globalThis.navigator?.locks;
 if(locks)return locks.request('x-assistant-deletion-engine:'+account,{ifAvailable:true},lock=>{
  if(!lock)throw fail('DELETE_BUSY','此账号已有删除任务');return run();
 });
 return run();
}
