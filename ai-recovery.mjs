// Generation-only recovery. Nothing in this module submits or retries an X action.
const MESSAGES = Object.freeze({
  missing_key: 'DeepSeek 密钥未配置，请在插件设置中保存',
  network: 'DeepSeek 连接失败或请求超时',
  image_read: '图片下载失败，未生成回复',
  image_format: '图片内容或格式无效，未生成回复',
  image_limit: '图片或请求超过直传大小限制，未生成回复',
  prompt_load: 'AI 生成规则读取失败，请重载插件',
  format: 'AI 文案格式或内容校验失败',
  invalid_action: 'AI 文案校验失败：动作或正文格式无效',
  rewrite_format: 'DeepSeek 没有按要求返回改写正文，未入库',
  rewrite_skipped: 'DeepSeek 选择跳过，没有生成改写稿',
  rewrite_unchanged: 'DeepSeek 返回的内容与原帖或评论过于一致，未入库',
  rewrite_root_only: 'DeepSeek 只复述了所属帖子，没有融合评论，未入库',
  rewrite_editorialized: 'DeepSeek 擅自加入核查式过渡或编辑者提示，未入库',
  content_length: 'AI 文案校验失败：正文过长',
  content_link: 'AI 文案校验失败：包含链接或代码',
  content_forbidden: 'AI 文案校验失败：包含禁用表达',
  invalid_input: 'AI 输入信息无效，未发送',
  generation: 'AI 生成失败（未发送）',
});
const VALIDATION_CODES = new Set(['format', 'invalid_action', 'content_length', 'content_link', 'content_forbidden']);

// Only a bounded, redacted error.message/code/param may reach status text.
// Never retain the response body, request headers, credentials or input copy.
export function sanitizeHTTPDiagnostic(value,{secrets=[],texts=[],imageCount}={}) {
  const raw=value?.error||value;
  if(!raw||typeof raw.message!=='string'||!raw.message.trim()||raw.message.length>8192)return undefined;
  const scrub=value=>{
    let s=String(value);
    for(const secret of secrets)if(typeof secret==='string'&&secret)s=s.split(secret).join('[已隐藏]');
    for(const text of texts)if(typeof text==='string'&&text.length>=4)s=s.split(text).join('[输入正文已省略]');
    return s.replace(/\bBearer\s+[^\s;,]+/gi,'[鉴权信息已省略]')
      .replace(/\b(?:authorization|api[_ -]?key|access[_ -]?token|secret|token)\s*[:=]\s*["']?[^\s;,"']+/gi,'[鉴权信息已省略]')
      .replace(/(?:https?:\/\/|data:)[^\s"'<>]+/gi,'[链接已省略]')
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g,'[密钥已省略]')
      .replace(/[A-Za-z0-9_=-]{40,}/g,'[长标识已省略]')
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
  };
  const message=scrub(raw.message).replace(/(?:"messages"|"prompt"|"role")\s*:[\s\S]*/i,'[请求正文已省略]').slice(0,240);
  if(!message)return undefined;
  const field=value=>typeof value==='string'&&/^[A-Za-z0-9_.\[\]-]{1,80}$/.test(value)&&scrub(value)===value?value:undefined;
  const result={message};
  for(const key of ['code','type','param']){const v=field(raw[key]);if(v)result[key]=v;}
  const count=imageCount??raw.imageCount;if(Number.isInteger(count)&&count>=0&&count<=600)result.imageCount=count;
  return result;
}
export function createAIError(code, status, diagnostic) {
  const isHTTP = code === 'http' && Number.isInteger(status) && status >= 100 && status <= 599;
  const safeCode = isHTTP ? 'http' : Object.hasOwn(MESSAGES, code) ? code : 'generation';
  const error = new Error(isHTTP ? `DeepSeek 请求失败（HTTP ${status}）` : MESSAGES[safeCode]);
  error.code = safeCode;
  if (isHTTP) error.status = status;
  const detail=isHTTP&&status===400?sanitizeHTTPDiagnostic(diagnostic):null;
  if(detail){
    error.diagnostic=detail;
    const fields=[detail.code||detail.type,detail.param,Number.isInteger(detail.imageCount)?'图片 '+detail.imageCount+' 张':null].filter(Boolean);
    error.message+='；API 原因：'+detail.message+(fields.length?'（'+fields.join(' · ')+'）':'');
  }
  return error;
}

export function classifyAIError(error) {
  if (error?.name === 'AbortError') return {code: 'aborted', reason: '任务已停止', attempts: 0, fatal: true};
  let code = error?.code;
  let status = error?.status;
  // Compatibility with legacy callers; only whitelisted patterns survive into logs.
  if (!(code === 'http' || Object.hasOwn(MESSAGES, code))) {
    const message = String(error?.message || '');
    const http = message.match(/(?:HTTP\s*|（)(\d{3})/i)?.[1];
    if (http) { code = 'http'; status = Number(http); }
    else if (/密钥/.test(message)) code = 'missing_key';
    else if (/本地服务不可用|连接失败|超时/.test(message)) code = 'network';
    else if (/包含禁用表达/.test(message)) code = 'content_forbidden';
    else if (/包含链接或代码/.test(message)) code = 'content_link';
    else if (/过长/.test(message)) code = 'content_length';
    else if (/动作或正文格式无效/.test(message)) code = 'invalid_action';
    else if (/检查|格式|JSON/.test(message)) code = 'format';
    else code = 'generation';
  }
  const safe = createAIError(code, status, error?.diagnostic);
  const fatal = safe.code === 'missing_key' || safe.code === 'prompt_load' ||
    (safe.code === 'http' && [400, 401, 402, 403, 404].includes(safe.status));
  const transient = safe.code === 'network' ||
    (safe.code === 'http' && ([408, 409, 429].includes(safe.status) || safe.status >= 500));
  return {
    code: safe.code === 'http' ? `http_${safe.status}` : safe.code,
    reason: safe.message,
    fatal,
    attempts: transient ? 3 : VALIDATION_CODES.has(safe.code) ? 2 : 1,
  };
}

export function safeAIError(error) {
  return classifyAIError(error).reason;
}

export async function recoverGeneration(generate, {check, report, sleep = ms => new Promise(r => setTimeout(r, ms)), binding}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await check();
    let result;
    try {
      result = await generate();
    } catch (error) {
      // An invalidated owner/run must never be treated as an ordinary generation failure.
      await check();
      const failure = classifyAIError(error);
      if (failure.code === 'aborted') throw error;
      const retrying = !failure.fatal && attempt < failure.attempts;
      await report({attempt, reason: failure.reason, reasonCode: failure.code, retrying});
      if (failure.fatal) {
        const terminal = new Error(`${failure.reason}；协同已停止，请检查插件 API 设置`);
        terminal.code = failure.code;
        throw terminal;
      }
      if (retrying) {
        await sleep(attempt * 2000);
        continue;
      }
      return {
        action: 'skip', text: '', ...binding,
        outcome: 'generation_error', skippedGenerationError: true,
        reason: failure.reason, reasonCode: failure.code,
      };
    }
    await check();
    return result;
  }
}
