// Pure clock model, shared by the browser and deterministic tests.
(()=>{
 const WORK=3600000,REST=1800000,GUARD=30000;
 const fresh=now=>({mode:'interaction',workMs:0,restUntil:0,repliesDone:false,lastTick:now});
 function tick(state,now,working){
  const s={...state},elapsed=Math.max(0,now-s.lastTick);s.lastTick=now;
  // Suspended pages do not accumulate unobserved working time.
  if(s.mode==='interaction'&&working)s.workMs+=Math.min(elapsed,2000);
  if(s.mode==='interaction'&&s.workMs>=WORK){s.mode='replies';s.restUntil=now+REST;s.repliesDone=false;}
  if(s.mode==='replies'&&now>=s.restUntil){s.mode='interaction';s.workMs=0;s.restUntil=0;s.repliesDone=false;}
  return s;
 }
 function choose(s,now,post){
  if(post.busy||now>=post.nextAt-GUARD)return 'posting';
  if(s.mode==='interaction')return 'interaction';
  if(s.repliesDone||now>=s.restUntil-GUARD)return 'waiting';
  return 'notifications';
 }
 globalThis.XAssistantSchedulerCore={WORK,REST,GUARD,fresh,tick,choose,replyDeadline:(s,post)=>Math.min(s.restUntil,post.nextAt)-GUARD};
})();
