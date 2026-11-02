// Generation-only recovery. Nothing in this module submits or retries an X action.
const MESSAGES = Object.freeze({
  missing_key: 'DeepSeek 密钥未配置，请在插件设置中保存',
  network: 'DeepSeek 连接失败或请求超时',
  prompt_load: 'AI 生成规则读取失败，请重载插件',
  format: 'AI 文案格式或内容校验失败',
  invalid_action: 'AI 文案校验失败：动作或正文格式无效',
  content_length: 'AI 文案校验失败：正文过长',
  content_link: 'AI 文案校验失败：包含链接或代码',
  content_forbidden: 'AI 文案校验失败：包含禁用表达',
  invalid_input: 'AI 输入信息无效，未发送',
  generation: 'AI 生成失败（未发送）',
});
const VALIDATION_CODES = new Set(['format', 'invalid_action', 'content_length', 'content_link', 'content_forbidden']);

// Error messages are generated locally, never copied from provider response bodies.
export function createAIError(code, status) {
  const isHTTP = code === 'http' && Number.isInteger(status) && status >= 100 && status <= 599;
  const safeCode = isHTTP ? 'http' : Object.hasOwn(MESSAGES, code) ? code : 'generation';
  const error = new Error(isHTTP ? `DeepSeek 请求失败（HTTP ${status}）` : MESSAGES[safeCode]);
  error.code = safeCode;
  if (isHTTP) error.status = status;
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
  const safe = createAIError(code, status);
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
