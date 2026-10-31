import {validateRows,pick} from './core.mjs';
export const KEYS={interaction:'xAssistantRuntimeV1',posting:'xAssistantPostingV1',cleanup:'xAssistantCleanupV1'};
export const uncertain=s=>['submitting','deleting','unknown'].includes(s?.phase);
export function stopState(s={}){return {...s,active:false,nextAt:null,phase:uncertain(s)?'unknown':'stopped',revision:(s.revision||0)+1};}
export function beginState(s={},other={}, {owner,account,resume=false,now=Date.now(),id=crypto.randomUUID()}){
 if(uncertain(s))throw Error('上次发送结果未知，请先核对平台记录；不会自动重发');
 if(other.active&&other.owner!==owner)throw Error('请在另一个模块所在的 X 标签页启动，避免页面相互抢占');
 if(s.active&&s.owner!==owner)throw Error('模块正在另一个 X 标签页运行');
 if(resume&&(!s.active||s.account!==account))throw Error('循环已停止或账号已变化');
 if(!/^\/[A-Za-z0-9_]{1,15}$/.test(account||''))throw Error('无法核对登录账号');
 return {...s,active:true,owner,account,runId:resume?s.runId:id,phase:'waiting',nextAt:resume&&Number.isFinite(s.nextAt)?s.nextAt:now+30000,error:null,revision:(s.revision||0)+1};
}
export function patchState(s,patch,{owner,runId}){
 if(!s?.active||s.owner!==owner||s.runId!==runId)throw Error('任务已停止或已被新任务替代');
 const allowed=['phase','nextAt','error','receipt','rowId','text','submittedAt','cycleIndex','completed','pauseRequested'];
 const clean=Object.fromEntries(Object.entries(patch||{}).filter(([k])=>allowed.includes(k)));
 return {...s,...clean,revision:(s.revision||0)+1};
}
export function libraryOperation(app,op){
 const rows=validateRows(app.rows||[]),map=new Map(rows.map(r=>[r.id,r]));
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
