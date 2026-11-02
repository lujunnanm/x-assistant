// Only wraps generation, never submission or receipt handling.
export function safeAIError(error){
 const message=String(error?.message||'');
 if(/本地服务不可用|连接失败|超时/.test(message))return 'DeepSeek 连接失败或请求超时';
 const status=message.match(/(?:HTTP\s*|（)(\d{3})/i)?.[1];
 if(status)return `DeepSeek 请求失败（HTTP ${status}）`;
 if(/密钥/.test(message))return 'DeepSeek 密钥未配置或无效';
 const detail=message.match(/AI 回复未通过检查：(动作或正文格式无效|正文过长|包含链接或代码|包含禁用表达)/)?.[1];
 if(detail)return 'AI 文案校验失败：'+detail;
 if(/检查|格式|JSON|过长/.test(message))return 'AI 文案格式或内容校验失败';
 return 'AI 生成失败（未发送）';
}
export async function recoverGeneration(generate,{check,report,sleep=ms=>new Promise(r=>setTimeout(r,ms)),binding}){
 for(let attempt=1;attempt<=3;attempt++){
  await check();
  let result;
  try{result=await generate();}catch(e){
   await check(); // Stopped/stale runs are never converted into retryable errors.
   const reason=safeAIError(e),retryable=/超时|HTTP (?:408|409|429|5\d\d)/.test(reason)||(/校验失败/.test(reason)&&attempt<2);
   await report({attempt,reason,retrying:retryable&&attempt<3});
   if(/HTTP (?:401|402|403)|密钥/.test(reason))throw Error(reason+'；协同已停止，请检查插件 API 设置');
   if(retryable&&attempt<3){await sleep(attempt*2000);continue;}
   return {action:'skip',text:'',...binding,reason,skippedGenerationError:true};
  }
  await check();return result;
 }
}
