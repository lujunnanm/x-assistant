// Quarantine in-flight work when its tab or run disappears. Pending clicks become
// "unknown", never "released": dropping that evidence could cause duplicate sends.
import {KEYS,stopState} from '../state.mjs';
import {ACTION_GATE_KEY} from '../action-gate.mjs';
import {K,read,write,writeAll} from './context.mjs';

export async function retireFollowbacks(owner){
 const db=await read(K.FOLLOWBACK_LEDGER);if(!db)return;
 let changed=false;
 for(const records of Object.values(db))for(const entry of Object.values(records)){
  if(entry.status==='in_flight'&&(owner==null||entry.owner===owner)){entry.status='unknown';entry.at=Date.now();changed=true;}
 }
 if(changed)await write(K.FOLLOWBACK_LEDGER,db);
}

export async function stopTab(id){
 for(const key of Object.values(KEYS)){
  const s=await read(key);if(s?.owner===id&&s.active)await write(key,stopState(s));
 }
 const claims=await read(K.REPLY_CLAIMS)||{};let changed=false;
 for(const account of Object.values(claims))for(const claim of Object.values(account))
  if(claim.owner===id&&claim.status==='in_flight'){claim.status='unknown';claim.at=Date.now();changed=true;}
 if(changed)await write(K.REPLY_CLAIMS,claims);
 await retireFollowbacks(id);
}

export async function forgetTab(id){
 await stopTab(id);
 const db=await read(K.WORKSPACES)||{};delete db[id];await write(K.WORKSPACES,db);
}

// Called by the serialized supervisor after tabs.get(run.owner) positively
// confirms closure. Retire only this run; keep pending clicks quarantined.
export async function retireMissingRun(module,expected){
 const key=KEYS[module],run=await read(key);
 const matches=x=>x?.owner===expected.owner&&x?.runId===expected.runId&&x?.documentId===expected.documentId;
 if(!run?.active||!matches(run)||run.account!==expected.account)return;
 const stopped=stopState(run),updates={[key]:stopped};
 const ledgerKey=module==='followback'?K.FOLLOWBACK_LEDGER:['interaction','notifications'].includes(module)?K.REPLY_CLAIMS:null;
 if(ledgerKey){
  const db=await read(ledgerKey),entries=db?.[run.account.toLowerCase()]||{};
  for(const entry of Object.values(entries))if(matches(entry)&&entry.status==='in_flight'&&(module==='followback'||entry.module===module)){
   entry.status='unknown';entry.at=Date.now();updates[ledgerKey]=db;stopped.phase='unknown';
  }
 }
 const holder=(await read(ACTION_GATE_KEY))?.holder;
 if(holder?.module===module&&matches(holder))stopped.phase='unknown';
 await writeAll(updates);
}
