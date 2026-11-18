import './time-policy.js';
const time=globalThis.XAssistantTimePolicy;
// Account-scoped schedule survives Stop, crashes and extension/browser restarts.
export const POST_SCHEDULE_KEY='xAssistantPostSchedulesV1';
export function restoreSchedule(db={},account,legacy={},now=Date.now(),config){
 const saved=db[account.toLowerCase()];if(saved)return {...saved};
 const last=legacy.account?.toLowerCase()===account.toLowerCase()&&legacy.receipt?.kind==='confirmed'?Date.parse(legacy.submittedAt):NaN;
 // v3.0.0 did not persist its randomized cooldown after Stop. Migrate conservatively.
 const lastPostedAt=Number.isFinite(last)?last:null;
 const nextPostAt=legacy.account?.toLowerCase()===account.toLowerCase()&&Number.isFinite(legacy.nextAt)?legacy.nextAt:lastPostedAt!==null?lastPostedAt+1800000:now+time.milliseconds(config,'startup');
 return {lastPostedAt,nextPostAt};
}
export function confirmSchedule(now=Date.now(),random=Math.random,config){return {lastPostedAt:now,nextPostAt:now+time.milliseconds(config,'posting',random)};}
export function scheduledStart(schedule,now=Date.now(),config){return Number.isFinite(schedule.nextPostAt)?Math.max(now,schedule.nextPostAt):now+time.milliseconds(config,'startup');}
