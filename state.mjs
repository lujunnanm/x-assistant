import {validateRows,pick} from './core.mjs';
export const KEYS={followback:'xAssistantFollowbackRuntimeV1',notifications:'xAssistantNotificationsRuntimeV1',interaction:'xAssistantRuntimeV1',posting:'xAssistantPostingV1',cleanup:'xAssistantCleanupV1'};
export const uncertain=s=>['submitting','deleting','unknown'].includes(s?.phase);
export function stopState(s={}){return {...s,active:false,nextAt:null,phase:uncertain(s)?'unknown':'stopped',revision:(s.revision||0)+1};}
// Old posting watchers persisted these non-specific notices as terminal rejection.
// Reopen only the exact, still-unreviewed submission; keep its original receipt.
const legacyGenericPostNotice=/^(?:出错了[，,]\s*别担心[，,]\s*让我们再试一次|出錯了[，,]\s*別擔心[，,]\s*讓我們再試一次|出错了|出錯了|出了点问题|出了點問題|something went wrong(?:[.!]?\s+(?:please try again|try again|try reloading)|,\s*but don['’]t fret[.,]?\s*(?:[—–-]\s*)?let['’]s give it another shot)?)[。.!！]?$/iu;
export function stopPostingState(s={},schedules={}){
 const {receipt,account,owner,runId,rowId,text,submittedAt}=s;
 const schedule=typeof account==='string'?schedules[account.toLowerCase()]:null;
 const bound=typeof account==='string'&&/^\/[A-Za-z0-9_]{1,15}$/.test(account)&&Number.isInteger(owner)&&owner>0&&
  typeof runId==='string'&&!!runId.trim()&&typeof rowId==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(rowId)&&typeof text==='string'&&
  typeof submittedAt==='string'&&Number.isFinite(Date.parse(submittedAt));
 if(bound&&(s.phase==='rejected'||s.phase==='stopped'&&s.active===false)&&
  receipt?.kind==='rejected'&&receipt.evidence==='x_notice'&&receipt.reason===undefined&&
  ![s.httpStatus,s.status,receipt.httpStatus,receipt.status].some(value=>Number(value)===429)&&
  typeof receipt.message==='string'&&!!receipt.message.trim()&&legacyGenericPostNotice.test(receipt.message.trim())&&
  s.resolution?.runId!==runId&&!(schedule?.confirmedRunId===runId&&schedule.confirmedSubmittedAt===submittedAt)){
  return stopState({...s,phase:'unknown',error:'X 提示：'+receipt.message+'；发帖结果未知，请核对平台记录'});
 }
 return stopState(s);
}
export function beginState(s={},other={}, {owner,account,documentId,resume=false,now=Date.now(),id=crypto.randomUUID()}){
 if(uncertain(s))throw Error('上次发送结果未知，请先核对平台记录；不会自动重发');
 if((Array.isArray(other)?other:[other]).some(state=>state.active&&state.owner===owner))throw Error('当前标签页已有其他模块运行，请使用独立标签页');
 if(s.active&&s.owner!==owner)throw Error('模块正在另一个 X 标签页运行');
 if(s.active&&!resume)throw Error('当前模块已运行，请先停止再启动');
 if(s.active&&s.documentId&&s.documentId!==documentId)throw Error('任务属于旧页面，请刷新后重新启动');
 if(resume&&(!s.active||s.account!==account))throw Error('循环已停止或账号已变化');
 if(!/^\/[A-Za-z0-9_]{1,15}$/.test(account||''))throw Error('无法核对登录账号');
 return {...s,active:true,owner,account,documentId,runId:resume?s.runId:id,activity:resume?s.activity:{step:'启动工作页',at:now,until:null,runId:id},lastIssue:s.account===account?s.lastIssue:null,receipt:resume?s.receipt:null,submittedAt:resume?s.submittedAt:null,phase:'waiting',nextAt:resume&&Number.isFinite(s.nextAt)?s.nextAt:now+30000,error:null,revision:(s.revision||0)+1};
}
export function assertRunOwner(s,{owner,runId,documentId}){
 if(!s||s.owner!==owner||typeof runId!=='string'||!runId||s.runId!==runId)throw Error('任务已停止或已被新任务替代');
 if(s.documentId&&s.documentId!==documentId)throw Error('任务属于其他页面实例');
 return s;
}
export function stopOwnedState(s={},auth){
 if(!s.active&&!s.runId&&s.owner==null)return s;
 assertRunOwner(s,auth);
 return stopState(s);
}
export function patchState(s,patch,{owner,runId,documentId}){
 if(!s?.active||s.owner!==owner||s.runId!==runId)throw Error('任务已停止或已被新任务替代');
 assertRunOwner(s,{owner,runId,documentId});
 const allowed=['phase','nextAt','error','receipt','rowId','text','submittedAt','cycleIndex','completed','pauseRequested','diagnostics'];
 const clean=Object.fromEntries(Object.entries(patch||{}).filter(([k])=>allowed.includes(k)));
 const now=Date.now();
 if(typeof patch?.activity?.step==='string'&&patch.activity.step.trim()){
  const until=patch.activity.until;
  clean.activity={step:patch.activity.step.trim().slice(0,150),at:now,until:Number.isFinite(until)&&until>now?Math.min(until,now+86400000):null,runId};
 }
 if(typeof patch?.lastIssue?.message==='string'&&patch.lastIssue.message.trim()){
  const v=patch.lastIssue;
  clean.lastIssue={message:v.message.trim().slice(0,320),code:String(v.code||'ITEM_ERROR').slice(0,80),targetId:/^\d{1,24}$/.test(v.targetId||'')?v.targetId:null,at:now,runId};
 }
 if(clean.phase==='submitting'&&!clean.receipt)clean.receipt=null;
 return {...s,...clean,revision:(s.revision||0)+1};
}
export function libraryOperation(app,op){
 const rows=validateRows(app.rows||[]),map=new Map(rows.map(r=>[r.id,r]));
 if(op.action==='replace'){if(app.revision!==op.expectedRevision)throw Error('文案库已变化，请刷新后重试'); const next=validateRows(op.rows);if(!next.length)throw Error('替换文件不能为空');return {...app,libraryBackup:{rows,backedUpAt:new Date().toISOString()},rows:next,revision:(app.revision||0)+1};}
 if(op.action==='merge')for(const r of validateRows(op.rows))map.set(r.id,r);
 else if(op.action==='delete'||op.action==='upsert'){
  const old=map.get(op.id);
  const expected=op.expected==null?null:validateRows([op.expected])[0];
  if(JSON.stringify(old??null)!==JSON.stringify(expected))throw Error('这条文案已在其他窗口修改，请刷新后重新编辑');
  if(op.action==='delete')map.delete(op.id);
  else {const [row]=validateRows([op.row]);if(row.id!==op.id)throw Error('ID 不一致');map.set(row.id,row);}
 }else throw Error('未知文案库操作');
 return {...app,rows:validateRows([...map.values()]),revision:(app.revision||0)+1};
}
export function reserveRow(state,rows,type){
 const selected=pick(rows,type,state.bag||[],state.lastId);
 if(!selected.row)throw Error('当前类型文案库为空或全部停用');
 return {state:{...state,bag:selected.bag,lastId:selected.row.id},row:selected.row};
}

export function resolveState(s,{runId,account,reviewed}){
 if(s?.active||!uncertain(s)||s.runId!==runId||s.account?.toLowerCase()!==account?.toLowerCase()||reviewed!==true)throw Error('请先停止任务，并核对同一账号的未知发送记录');
 return {...s,phase:'stopped',error:null,resolution:{reviewedAt:new Date().toISOString(),runId:s.runId,rowId:s.rowId,text:s.text,submittedAt:s.submittedAt,previousPhase:s.phase},revision:(s.revision||0)+1};
}

export function abandonState(s,{runId,account,reason}){
 if(s?.active||!uncertain(s)||s.runId!==runId||s.account?.toLowerCase()!==account?.toLowerCase()||reason!=='next_item')throw Error('只能跳过同一账号已停止的未知结果');
 return {...s,phase:'stopped',error:null,resolution:{disposition:'skipped',skippedAt:new Date().toISOString(),runId:s.runId,rowId:s.rowId,text:s.text,submittedAt:s.submittedAt,previousPhase:s.phase},revision:(s.revision||0)+1};
}
