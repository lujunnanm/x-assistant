import {createAIError} from './ai-recovery.mjs';

// Persistent credential, separate from exportable library state. Never log this value.
export const API_KEY_STORAGE = 'xAssistantDeepSeekKeyV1';
const API_ORIGIN = 'https://api.deepseek.com';
const MODEL = 'deepseek-flash';
const LEGACY_FOOTER = /(?:\s*(?:关注我交个朋友呀?|交个朋友呀?|(?:请|尽快)?回关(?:我)?)[\s，,。.!！]*)+$/u;
const isRewriteMode = mode => mode === 'timeline-rewrite' || mode === 'comment-rewrite';
const REWRITE_STYLE_RULES = `
【风格分流】先按整条成稿的主要用途选风格，不按题材、粗口或问号选。评论先融合成一个人的完整观点，再判定整条，不能只摘一段改成吐槽。
三个分支都不能把素材本身当成核实结果；缺少依据的重大指控、动机或归因，不因原文语气肯定就当作事实写入。
- 风格判断只在内部完成，不得把核查流程写进正文。不得添加“先把事实和猜疑分开”“先说结论”“需要注意的是”“目前没有定论”等编辑者元话语，也不得换同义词表达同类提醒、判断、总结或免责声明。
- standard（常规改写，默认）：教程、领取指南、功能更新、通知、测评、经历复盘、多步论证和信息汇总保留相应体裁、必要步骤、数字和限定条件；有反差也不能牺牲原用途。无法明确判定时选 standard。
- reaction（夸张反应）：只有三关都过才选：主要是在表达反应；能说清正常预期和实际反差；三四句能讲完整且不丢条件，结尾有具体吐槽或追问。开头直接反应，中间点出反差，最后落到具体细节。只夸张情绪或用明显比喻，不夸大事实，不捏造亲历，不强加粗口，不拿伤亡开玩笑。
- verify（克制求证）：有可追溯的来源、但关键事件或说法尚未证实，且主要用途适合追问时，围绕素材原有问题直接提问。只保留素材已经出现的“网传”“尚未证实”等限定，不自行补充核查立场、证据要求、事实判断或安全提示；不能用问号预设指控、编造来源或擅自添加 @grok。没有可追溯来源的重大指控，不写成肯定句，也不借问号传播；无法安全保留核心意思就 skip。
例：完整投资分析、订阅额度及领取步骤 → standard；单独吐槽“回本快、风险低、还翻十倍”的承诺 → reaction；有出处但尚未获确认的事件，只问有没有正式通报 → verify。
save_copy 时在 action、text 之外，填一个 style 值：standard、reaction 或 verify。不要把分类名或分析写进正文。每句一行；仅 reaction 和 verify 句间留一个空行。`;

export function stripLegacyFooter(text) {
  return typeof text === 'string' ? text.replace(LEGACY_FOOTER, '').trim() : text;
}

function modeFor(url) {
  if (url.endsWith('/timeline-rewrite')) return 'timeline-rewrite';
  if (url.endsWith('/comment-rewrite')) return 'comment-rewrite';
  if (url.endsWith('/post')) return 'post';
  if (url.endsWith('/notification-reply')) return 'notification';
  if (url.endsWith('/reply')) return 'reply';
  throw createAIError('invalid_input');
}

function modeRules(mode) {
  if (isRewriteMode(mode)) return REWRITE_STYLE_RULES;
  if (mode === 'post') return '';
  const base = '\n【本次运行模式】text 最多130字符，严格使用被回复正文 post_text 的主要语言，只回复内容；禁止交友、关注、回关尾句及任何语言翻译，不输出 footer。界面语言、账号语言、用户名和话题标签不能决定回复语言；中文评论用中文、英文评论用英文、日文评论用日文，其他语言同理。混合正文按主要内容语言回复，不附翻译。输出前检查语言，不一致先改写。';
  if (mode === 'notification') {
    return base + '\n这是别人回复当前账号的一条评论。不设内容价值门槛：普通问候、感谢、赞同、夸奖、表情、签到和寒暄都允许简短自然回复；能针对具体内容时优先具体回应。';
  }
  return base + '\n这是主动互动。不设内容价值门槛：普通问候、感谢、赞同和寒暄都允许简短自然回复；能针对具体内容时优先具体回应。缺少可理解内容时可返回 skip，由插件文案库兜底。';
}

async function readPrompt(mode, fetcher, resource) {
  try {
    const rulesFile = mode === 'comment-rewrite' ? 'comment-rewrite-rules.txt' : mode === 'timeline-rewrite' ? 'timeline-rewrite-rules.txt' : mode === 'post' ? 'post-rules.txt' : mode === 'notification' ? 'reply-rules.txt' : 'interaction-reply-rules.txt';
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
  if (options.rewriteRetry === true && isRewriteMode(mode)) {
    prompt += '\n【重新生成】上次没有得到合格文案。只返回一个 JSON 对象，action 用 "save_copy"，text 用非空字符串；从素材重新组织，不照抄，不补充不存在的事实。'+
      (mode === 'comment-rewrite' ? '必须同时融入原帖和评论的实质观点。' : '保留原帖立场并换一种表达。')+
      '不得加入编辑者核查、提醒、判断、总结或免责声明，不得出现“先把事实和猜疑分开”“先说结论”“需要注意的是”“目前没有定论”等元话语。不得把素材中的陈述或肯定判断改成“按这个说法看……是不是说明……”“照这个逻辑……是否意味着……”等推导式设问。仍按风格分流填写 style。如果素材仍不足以可靠改写，才返回 {"action":"skip","text":""}。';
  }
  if (mode === 'post' && Number.isFinite(options.maxBodyWeight)) {
    prompt += `\n【本条正文长度预算】最多 ${Math.floor(options.maxBodyWeight)} 加权字符。中文等非拉丁字符按2计、英文字母及空格按1计；原文标签由插件补回，正文必须为它们留出空间。`;
  }
  let input;
  try { input = JSON.parse(options.body); } catch { throw createAIError('invalid_input'); }
  const inputName = ['post','timeline-rewrite'].includes(mode) ? 'reference_text' : 'post_text';
  const userInput=mode==='comment-rewrite'?{reference_post_text:input.rootText,comment_text:input.text}:{[inputName]:input.text};
  if(mode==='comment-rewrite'&&(!userInput.reference_post_text?.trim()||!userInput.comment_text?.trim()))throw createAIError('invalid_input');
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
          {role: 'user', content: JSON.stringify(userInput)},
        ],
        stream: false,
        thinking: {type: 'disabled'},
        max_tokens: isRewriteMode(mode) ? 4096 : 512,
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
  if (mode !== 'post' && value.action !== 'skip') value.text = stripLegacyFooter(value.text);
  // Only the rewrite routes use style; never pass arbitrary provider fields through.
  const result = {action: value.action, text: value.text};
  if (isRewriteMode(mode) && value.action === 'save_copy' && ['standard','reaction','verify'].includes(value.style)) result.style = value.style;
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
