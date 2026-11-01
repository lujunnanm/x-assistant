// Account-scoped schedule survives Stop, crashes and extension/browser restarts.
export const POST_SCHEDULE_KEY='xAssistantPostSchedulesV1';
export function restoreSchedule(db={},account,legacy={},now=Date.now()){
 const saved=db[account.toLowerCase()];if(saved)return {...saved};
 const last=legacy.account?.toLowerCase()===account.toLowerCase()&&legacy.receipt?.kind==='confirmed'?Date.parse(legacy.submittedAt):NaN;
 // v3.0.0 did not persist its randomized cooldown after Stop. Migrate conservatively.
 const lastPostedAt=Number.isFinite(last)?last:null;
 const nextPostAt=legacy.account?.toLowerCase()===account.toLowerCase()&&Number.isFinite(legacy.nextAt)?legacy.nextAt:lastPostedAt!==null?lastPostedAt+3000000:now+30000;
 return {lastPostedAt,nextPostAt};
}
export function confirmSchedule(now=Date.now(),random=Math.random){return {lastPostedAt:now,nextPostAt:now+Math.round((1800+random()*1200)*1000)};}
export function scheduledStart(schedule,now=Date.now()){return Number.isFinite(schedule.nextPostAt)?Math.max(now,schedule.nextPostAt):now+30000;}
