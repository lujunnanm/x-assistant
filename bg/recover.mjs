// Browser start / extension install. A reload invalidates content-script documents:
// keep every submission record, stop all runs, and leave the master switch off.
import {KEYS,stopState,stopPostingState} from '../state.mjs';
import {normalizePostingCopies} from '../posting-copy.mjs';
import {POST_SCHEDULE_KEY} from '../posting-schedule.mjs';
import {K,read,write,getApp,getTiming,timing,log} from './context.mjs';
import {managed} from './services.mjs';
import {retireFollowbacks} from './ledgers.mjs';
import {postRetryDeadline} from './copies.mjs';

async function migrateLibraries(app){
 if(!app.postingCopyMigratedV1){
  if(app.rows.length&&!(await read(K.LEGACY_COPY_BACKUP)))
   await write(K.LEGACY_COPY_BACKUP,{rows:app.rows,revision:app.revision||0,backedUpAt:new Date().toISOString()});
  app.rows=[];delete app.libraryBackup;app.postingCopyMigratedV1=true;app.revision=(app.revision||0)+1;
 }
 const rawCopies=await read(K.POST_COPIES),copies=normalizePostingCopies(rawCopies);
 if(rawCopies&&JSON.stringify(rawCopies)!==JSON.stringify(copies))copies.revision++;
 await write(K.POST_COPIES,copies);
 // The v7.4 once-only ledger no longer participates in rotation.
 if(await read(K.POST_LEDGER)!==undefined)await chrome.storage.local.remove?.(K.POST_LEDGER);
}

export async function recover(){
 const posting=await read(KEYS.posting),schedules=await read(POST_SCHEDULE_KEY);
 const stoppedPosting=stopPostingState(posting,schedules||{});
 const postingReview=stoppedPosting.phase==='unknown'&&stoppedPosting.receipt?.evidence==='x_notice'&&
  ['unknown','rejected'].includes(stoppedPosting.receipt.kind)?stoppedPosting:null;
 const postingCooldown=stoppedPosting.phase==='stopped'&&postRetryDeadline(schedules?.[stoppedPosting.account?.toLowerCase()])>Date.now()?stoppedPosting:null;
 await managed.recover({clearWorkers:true,postingReview,postingCooldown});await retireFollowbacks(null);
 const app=await getApp();
 await migrateLibraries(app);
 await write(timing.KEY,await getTiming());
 Object.assign(app,{schemaVersion:3,postingCopySimpleV1:true,postingCopyOrderedDeleteV1:true,running:false,nextAt:null});
 await write(K.APP,app);
 for(const key of Object.values(KEYS))await write(key,key===KEYS.posting?stoppedPosting:stopState(await read(key)));
 await write(K.WORKSPACES,{});
 const schedule=await read(K.LEGACY_SCHEDULER);
 if(schedule)await write(K.LEGACY_SCHEDULER,{...schedule,active:false,stopReason:'manual',restartAt:null,stoppedAt:Date.now()});
 const scan=await read(K.FOLLOWING_SCAN);
 if(scan)await write(K.FOLLOWING_SCAN,{...scan,active:false,message:'浏览器或扩展已重启，请重新读取'});
 await chrome.alarms.clear('x-assistant-loop');
 await log('灯神已恢复；总开关保持关闭');
}
