// Posting-only library: no old-library import or automatic seed.
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(id);
const body=text=>typeof text==='string'?text.replace(/\r\n?/g,'\n'):null;
export function validatePostingCopies(rows){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('发帖文案库最多 5000 条');
 const ids=new Set();
 return rows.map((raw,i)=>{
  const id=raw?.id,text=body(raw?.text);
  if(!validId(id)||ids.has(id)||!text?.trim()||text.length>10000||typeof raw.enabled!=='boolean')
   throw Error('第 '+(i+1)+' 条发帖文案无效：需唯一 ID、非空原文及启停状态');
  ids.add(id);return {id,text,enabled:raw.enabled};
 });
}
export function normalizePostingCopies(raw){
 if(raw==null)return {revision:0,rows:[]};
 if(!Number.isSafeInteger(raw.revision)||raw.revision<0)throw Error('发帖文案库版本无效');
 return {revision:raw.revision,rows:validatePostingCopies(raw.rows)};
}
export function postingCopyOperation(raw,op){
 const state=normalizePostingCopies(raw);
 if(!op||typeof op!=='object'||Array.isArray(op)||op.expectedRevision!==state.revision)
  throw Error('发帖文案库已变化，请刷新后重试');
 let rows=state.rows;
 switch(op.action){
  case 'replace': rows=validatePostingCopies(op.rows);break;
  case 'clear': rows=[];break;
  case 'upsert':{
   const old=rows.find(r=>r.id===op.id)??null;
   if(JSON.stringify(old)!==JSON.stringify(op.expected??null))throw Error('文案已在其他窗口修改');
   const row=validatePostingCopies([op.row])[0];
   if(row.id!==op.id)throw Error('文案 ID 不一致');
   rows=old?rows.map(r=>r.id===row.id?row:r):[...rows,row];
   break;
  }
  case 'delete':{
   const old=rows.find(r=>r.id===op.id)??null;
   if(!old||JSON.stringify(old)!==JSON.stringify(op.expected))throw Error('文案已在其他窗口修改');
   rows=rows.filter(r=>r.id!==op.id);break;
  }
  default:throw Error('未知发帖文案操作');
 }
 return {revision:state.revision+1,rows:validatePostingCopies(rows)};
}
export function splitPostingPaste(text,mode='lines'){
 const input=body(text);if(!input?.trim())return [];
 if(!['lines','separator'].includes(mode))throw Error('粘贴分隔方式无效');
 const parts=mode==='lines'?input.split('\n'):input.split(/^\s*---\s*$/m);
 const rows=parts.map(part=>part.trim()).filter(Boolean);
 if(rows.length>5000||rows.some(t=>t.length>10000))throw Error('批量文案数量或单条长度超限');
 return rows;
}
