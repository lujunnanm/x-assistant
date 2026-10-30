// Durable transition rules for a user-confirmed, one-post operation.
// An uncertain write must be verified before any retry.
const steps=['reply','like','follow'];
const states=['pending','in_flight','verified','skipped','unknown'];
export function newSingleLedger({url,reply,account}){
 if(typeof url!=='string'||!/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(url))throw Error('帖子链接无效');
 if(typeof reply!=='string'||!reply.trim())throw Error('回复无效');
 if(account!==undefined&&(typeof account!=='string'||!/^@[A-Za-z0-9_]{1,15}$/.test(account)))throw Error('当前账号无效');
 return {url,reply,account:account||null,steps:Object.fromEntries(steps.map(s=>[s,'pending']))};
}
export function transitionSingle(ledger,step,next){
 if(!steps.includes(step)||!states.includes(next)||!states.includes(ledger?.steps?.[step]))throw Error('状态无效');
 const current=ledger.steps[step];
 const allowed={pending:['in_flight','skipped'],in_flight:['pending','verified','unknown'],unknown:['pending','verified','skipped'],verified:[],skipped:[]};
 if(!allowed[current].includes(next))throw Error('禁止不安全的状态转换');
 return {...ledger,steps:{...ledger.steps,[step]:next}};
}
export function recoverSingle(ledger){
 return {...ledger,steps:Object.fromEntries(steps.map(s=>[s,ledger.steps[s]==='in_flight'?'unknown':ledger.steps[s]]))};
}
