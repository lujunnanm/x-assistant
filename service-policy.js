// Posting and the optional modules run all day. Beijing day boundaries remain
// available for the supervisor's compatibility alarm, but never pause work.
(() => {
 const KEY='xAssistantManagedServiceV1';
 const HOUR=3600000,DAY=24*HOUR,OFFSET=8*HOUR;
 function localParts(now){
  if(!Number.isFinite(now))throw Error('工作时钟无效');
  const local=now+OFFSET,day=Math.floor(local/DAY)*DAY;
  return {day,time:local-day};
 }
 function isWorkingTime(now=Date.now()){
  return Number.isFinite(now);
 }
 // Every module is available 24 hours when selected.
 function isModuleWorking(module,now=Date.now()){
  if(!Number.isFinite(now))return false;
  return ['posting','interaction','notifications','followback'].includes(module);
 }
 function nextBoundary(now=Date.now()){
  const {day}=localParts(now);
  return day+DAY-OFFSET;
 }
 function activeModules(selected={}){
  return ['posting','interaction','notifications','followback'].filter(module=>selected?.[module]===true);
 }
 function classifyFailure(error){
  // Retry only settled operations; preserve manual stops, drafts and unknown sends.
  const chain=[];let current=error;
  for(let i=0;current&&i<6;i++,current=current.cause)chain.push(current);
  const text=chain.map(value=>typeof value==='string'?value:value?.message||'').join(' ');
  const codes=chain.map(value=>String(value?.code||'').toUpperCase());
  const has=(...values)=>codes.some(code=>values.includes(code));
  const followRateLimit=has('FOLLOW_RATE_LIMIT');
  const confirmedReturn=error?.confirmed===true&&has('NAVIGATION','RETURN_UNVERIFIED','RETURN_FAILED');
  if((!confirmedReturn&&!followRateLimit&&chain.some(value=>value?.submitted||value?.confirmed))||has('SEND_UNKNOWN','UNKNOWN','SUBMITTING')||/发送结果(?:不明|未知)|提交结果未知|发送记录待核对|上次发送.*核对/.test(text))return {retryable:false,reason:'needs_review'};
  if(has('ACCOUNT_CHANGED','ACCOUNT_MISMATCH')||/账号(?:发生)?变化|账号不匹配/.test(text))return {retryable:false,reason:'account_changed'};
  if(has('PAGE_CHANGED','WORKER_CLOSED','WORKER_MISSING')||/页面已(?:切换|关闭|离开)|工作页.*关闭/.test(text))return {retryable:false,reason:'page_changed'};
  if(has('RESIDUAL_DRAFT','RESIDUAL_POPUP','CLEANUP_FAILED')||/草稿|弹窗/.test(text))return {retryable:false,reason:'draft'};
  if(chain.some(value=>value?.name==='AbortError')||has('ABORT_ERR','ABORTED','SERVICE_DISABLED','OUTSIDE_WINDOW','OUTSIDE_WORKING_HOURS','MODULE_DISABLED','REST_WINDOW','SERVICE_PAUSED','YIELD'))return {retryable:false,reason:'cancelled'};
  if(has('AUTH','AUTH_FAILED','UNAUTHORIZED','FORBIDDEN','MISSING_KEY')||chain.some(value=>[401,402,403].includes(value?.status))||/认证|鉴权|密钥|余额|登录|权限|HTTP\s*(?:401|402|403)/i.test(text))return {retryable:false,reason:'authentication'};
  if(has('FOLLOW_RATE_LIMIT','RATE_LIMIT','RATE_LIMITED','TOO_MANY_REQUESTS')||chain.some(value=>value?.status===429)||/rate limit|too many requests|HTTP\s*429|速率限制|频率限制|操作(?:过于)?频繁|请求过于频繁/i.test(text))return {retryable:true,reason:'rate_limit',delay:1800000};
  if(has('FOLLOW_LIMIT','AUTHOR_BLOCKED','RETURN_UNVERIFIED')&&!confirmedReturn)return {retryable:false,reason:'platform_restriction'};
  if(has('NETWORK','NETWORK_ERROR','REQUEST_TIMEOUT','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENETUNREACH','EAI_AGAIN','FETCH_FAILED')||/Failed to fetch|NetworkError|network request failed|fetch failed|socket hang up|connection reset|ECONNRESET|ETIMEDOUT|网络(?:错误|异常|超时|失败|请求失败)|连接失败|请求超时/i.test(text))return {retryable:true,reason:'network',delay:30000};
  return error?{retryable:true,reason:'ordinary',delay:30000}:{retryable:false,reason:'manual_attention'};
 }
 // Only the active account's verified-followers list is a valid follow-back surface.
 function isFollowbackPage(url,account){
  if(typeof url!=='string'||!/^\/[A-Za-z0-9_]{1,15}$/.test(account||''))return false;
  try{const u=new URL(url,'https://x.com');return u.origin==='https://x.com'&&!u.username&&!u.password&&u.href.toLowerCase()==='https://x.com'+account.toLowerCase()+'/verified_followers';}catch{return false;}
 }
 globalThis.XAssistantServicePolicy={KEY,isFollowbackPage,isWorkingTime,isModuleWorking,nextBoundary,activeModules,classifyFailure};
})();
