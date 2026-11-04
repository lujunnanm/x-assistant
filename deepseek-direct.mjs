import {createAIError} from './ai-recovery.mjs';

// Persistent credential, separate from exportable library state. Never log this value.
export const API_KEY_STORAGE = 'xAssistantDeepSeekKeyV1';
const API_ORIGIN = 'https://api.deepseek.com';
const MODEL = 'deepseek-flash';
const LEGACY_FOOTER = /(?:\s*(?:关注我交个朋友呀?|来交个朋友呀?|交个朋友呀?|方便的话回关一下|求回关|(?:请|尽快)?回关(?:我)?)[\s，,。.!！]*)+$/u;

export function stripLegacyFooter(text) {
  return typeof text === 'string' ? text.replace(LEGACY_FOOTER, '').trim() : text;
}

export function interactionFallback(text) {
  const value = typeof text === 'string' ? text : '';
  if (/[぀-ヿ]/u.test(value)) return 'よかったらつながりましょう。フォローバックもうれしいです。';
  if (/[가-힯]/u.test(value)) return '서로 소통해요. 괜찮다면 맞팔 부탁드려요.';
  if (/\p{Script=Han}/u.test(value)) return '来交个朋友，方便的话回关一下。';
  return "Let’s connect—follow back if you’d like.";
}

function modeFor(url) {
  if (url.endsWith('/post')) return 'post';
  if (url.endsWith('/notification-reply')) return 'notification';
  if (url.endsWith('/reply')) return 'reply';
  throw createAIError('invalid_input');
}

function modeRules(mode) {
  if (mode === 'post') return '';
  const base = '\n【本次运行模式】text 最多130字符，使用原文主要语言，只回复内容，不输出 footer。';
  if (mode === 'notification') {
    return base + '\n这是别人回复当前账号的一条评论。禁止交友、关注、回关尾句。通知回帖同样执行价值门槛：普通问候、感谢、赞同、夸奖、表情、签到和寒暄默认 skip。只有能回答具体问题、补充有用信息或针对实质细节推进讨论时才回复；不要为了礼貌或活跃度硬凑内容。';
  }
  return base + '\n这是主动互动，禁止返回 skip。有具体内容就自然回应；信息少或无法针对内容回复时，改用同语言的简短交友、请求回关或互动邀请，例如“来交个朋友，方便的话回关一下”。';
}

async function readPrompt(mode, fetcher, resource) {
  try {
    const rulesFile = mode === 'post' ? 'post-rules.txt' : mode === 'notification' ? 'reply-rules.txt' : 'interaction-reply-rules.txt';
    const response = await fetcher(resource(`bridge/${rulesFile}`));
    if (response.ok === false) throw new Error();
    const text = await response.text();
    if (!text.trim()) throw new Error();
    return text + modeRules(mode);
  } catch {
    throw createAIError('prompt_load');
  }
}

function parseCompletion(data) {
  const choice = data?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw createAIError('format');
  let value;
  try { value = JSON.parse(choice.message.content); } catch { throw createAIError('format'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createAIError('format');
  return value;
}

export async function directGenerate(url, options, {
  storage = chrome.storage.local,
  fetcher = fetch,
  resource = path => chrome.runtime.getURL(path),
} = {}) {
  const key = (await storage.get(API_KEY_STORAGE))[API_KEY_STORAGE];
  if (typeof key !== 'string' || !key.trim()) throw createAIError('missing_key');
  const mode = modeFor(url);
  let prompt = await readPrompt(mode, fetcher, resource);
  if (mode === 'post' && Number.isFinite(options.maxBodyWeight)) {
    prompt += `\n【本条正文长度预算】最多 ${Math.floor(options.maxBodyWeight)} 加权字符。中文等非拉丁字符按2计、英文字母及空格按1计；原文标签由插件补回，正文必须为它们留出空间。`;
  }
  let input;
  try { input = JSON.parse(options.body); } catch { throw createAIError('invalid_input'); }
  options.signal?.throwIfAborted();
  let response;
  try {
    response = await fetcher(`${API_ORIGIN}/chat/completions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}`},
      signal: options.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {role: 'system', content: prompt},
          {role: 'user', content: JSON.stringify({[mode === 'post' ? 'reference_text' : 'post_text']: input.text})},
        ],
        stream: false,
        thinking: {type: 'disabled'},
        max_tokens: 512,
        response_format: {type: 'json_object'},
      }),
    });
  } catch (error) {
    if (options.signal?.aborted && options.signal.reason?.name === 'AbortError') throw options.signal.reason;
    throw createAIError('network');
  }
  if (!response.ok) {
    // Compatibility with injectable fetch-style clients, with no raw provider payload.
    return {ok: false, status: response.status, json: async () => ({error: `HTTP ${response.status}`})};
  }
  let value;
  try { value = parseCompletion(await response.json()); }
  catch { throw createAIError('format'); }
  if (mode === 'reply' && value.action === 'skip') value = {action: 'send_reply', text: interactionFallback(input.text)};
  if (mode === 'notification' && value.action !== 'skip') value.text = stripLegacyFooter(value.text);
  // Ignore all unexpected fields, including legacy multilingual footer fields.
  const result = {action: value.action, text: value.text};
  return {ok: true, status: 200, json: async () => result};
}

export async function verifyCredential(key, {fetcher = fetch} = {}) {
  if (typeof key !== 'string' || !key.trim()) throw createAIError('missing_key');
  let response;
  try {
    response = await fetcher(`${API_ORIGIN}/models`, {
      headers: {Authorization: `Bearer ${key.trim()}`},
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw createAIError('network'); }
  if (!response.ok) {
    const hint = {401: '密钥认证失败，请更换有效密钥', 402: '余额不足，请充值后再试', 403: '访问被拒绝，请检查 API 权限'}[response.status];
    const error = createAIError('http', response.status);
    if (hint) error.message += `：${hint}`;
    throw error;
  }
  return true;
}
