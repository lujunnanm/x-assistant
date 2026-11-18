import {translationLanguage,translationPrompt} from './copy-translation.mjs';
import {createAIError, sanitizeHTTPDiagnostic} from './ai-recovery.mjs';
import {normalizeReplyImages} from './reply-context.mjs';
import {inlineReplyImages,inlineZhihuImages,serializeVisionRequest} from './reply-images.mjs';

// Persistent credential, separate from exportable library state. Never log this value.
export const API_KEY_STORAGE = 'xAssistantDeepSeekKeyV1';
const API_ORIGIN = 'https://api.deepseek.com';
const MODEL = 'deepseek-flash';
const LEGACY_FOOTER = /(?:\s*(?:关注我交个朋友呀?|交个朋友呀?|(?:请|尽快)?回关(?:我)?)[\s，,。.!！]*)+$/u;
const isRewriteMode = mode => mode === 'timeline-rewrite' || mode === 'comment-rewrite' || mode === 'zhihu-rewrite';
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
  if (url.endsWith('/zhihu-rewrite')) return 'zhihu-rewrite';
  if (url.endsWith('/timeline-rewrite')) return 'timeline-rewrite';
  if (url.endsWith('/comment-rewrite')) return 'comment-rewrite';
  if (url.endsWith('/post')) return 'post';
  if (url.endsWith('/notification-reply')) return 'notification';
  if (url.endsWith('/reply')) return 'reply';
  throw createAIError('invalid_input');
}

function modeRules(mode) {
  // Zhihu has its own full-content editorial style, not the short reaction branch.
  if (mode === 'zhihu-rewrite') return '';
  if (isRewriteMode(mode)) return REWRITE_STYLE_RULES;
  if (mode === 'post') return '';
  const base = '\n【本次运行模式】text 最多180个 Unicode 字符，且 X 加权长度最多280（中文等非拉丁字符按2计）。严格使用被回复正文 post_text 的主要语言，只回复内容；禁止交友、关注、回关尾句及任何语言翻译，不输出 footer。界面语言、账号语言、用户名和话题标签不能决定回复语言；中文评论用中文、英文评论用英文、日文评论用日文，其他语言同理。混合正文按主要内容语言回复，不附翻译。输出前检查语言，不一致先改写。';
  if (mode === 'notification') {
    return base + '\n这是当前账号自己帖子下或别人回复当前账号的一条评论。不设内容价值门槛，目标是尽可能逐条回应：普通问候、感谢、赞同、夸奖、表情、签到、寒暄以及已经自然收尾的评论，也用一句简短自然的话接住，不返回 conversation_ended。图片-only 评论直接看图回应；videoUnavailable 只表示视频内容没有提供，不假装看过视频，仍可根据目标评论文字和其他可见上下文回复。对方先冲着当前账号开骂、人身攻击或恶意扣帽子时，按人格规则直接强硬回击，不因纯辱骂而 skip；正常分歧、批评原帖或用粗口表达自身情绪不触发回骂，有具体问题照常回应。窄例外：结合完整上下文，目标只是泛泛口号，没有具体问题、论据或新信息，也没有针对当前账号的人身攻击时可以 skip，text 留空，不返回 conversation_ended；不按政治阵营或辱骂关键词过滤，普通问候、感谢、玩笑不套用这条例外。除此之外，目标作者不是 grok 且只是在问 @grok，或确实没有任何可理解文字、图片和上下文时才 skip。';
  }
  return base + '\n这是主动互动。对方先冲着当前账号开骂、人身攻击或恶意扣帽子时，按人格规则直接强硬回击，不因纯辱骂而 skip；正常分歧、批评原帖或用粗口表达自身情绪不触发回骂，有具体问题照常回应。结合完整上下文，目标只是泛泛口号，没有具体问题、论据或新信息，也没有针对当前账号的人身攻击时可以 skip，text 留空；不按政治阵营或辱骂关键词过滤，普通问候、感谢、玩笑不套用这条例外。不设内容价值门槛：普通问候、感谢、赞同和寒暄都允许简短自然回复；能针对具体内容时优先具体回应。结合上文已自然收尾时可以不回复，按人格规则返回 conversation_ended，不靠关键词判断。缺少可理解内容时可返回 skip，不用无关文案兜底。';
}

async function readPrompt(mode, fetcher, resource) {
  try {
    const rulesFile = mode === 'zhihu-rewrite' ? 'zhihu-rewrite-rules.txt' : mode === 'comment-rewrite' ? 'comment-rewrite-rules.txt' : mode === 'timeline-rewrite' ? 'timeline-rewrite-rules.txt' : mode === 'post' ? 'post-rules.txt' : mode === 'notification' ? 'reply-rules.txt' : 'interaction-reply-rules.txt';
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

function replyUserContent(input){
  const parts=[{type:'text',text:JSON.stringify(input)}],seen=new Set();
  for(const row of [input.original_post,...input.conversation_history,input.reply_target]){
    if(!row||seen.has(row.id))continue;
    seen.add(row.id);
    const images=normalizeReplyImages(row.imageUrls);
    if(images.length&&!/^\d+$/.test(row.id||''))throw createAIError('invalid_input');
    for(const [index,url] of images.entries()){
      // Labels and image contents remain untrusted user data, tied to their post.
      parts.push({type:'text',text:JSON.stringify({image_of_post:row.id,image_index:index+1})},
        {type:'image_url',image_url:{url,detail:'auto'}});
    }
  }
  return parts.length===1?parts[0].text:parts;
}
function zhihuUserContent(input){
 const parts=[{type:'text',text:JSON.stringify({question_text:input.questionText,answer_text:input.text,image_count:input.imageUrls?.length||0})}];
 for(const [i,url] of (input.imageUrls||[]).entries())parts.push({type:'text',text:'回答图片 '+(i+1)},{type:'image_url',image_url:{url,detail:'auto'}});
 return parts.length===1?parts[0].text:parts;
}

export async function directGenerate(url, options, {
  storage = chrome.storage.local,
  fetcher = fetch,
  resource = path => chrome.runtime.getURL(path),
} = {}) {
  const key = (await storage.get(API_KEY_STORAGE))[API_KEY_STORAGE];
  if (typeof key !== 'string' || !key.trim()) throw createAIError('missing_key');
  const mode = modeFor(url);
  let input;
  try { input = JSON.parse(options.body); } catch { throw createAIError('invalid_input'); }
  const targetLanguage=isRewriteMode(mode)?translationLanguage(input.targetLanguage):'';
  let prompt = targetLanguage?translationPrompt(targetLanguage,mode):await readPrompt(mode, fetcher, resource);
  if(targetLanguage&&options.rewriteRetry===true)prompt+='\n【重新生成】上次输出无效，请重新完整翻译并严格返回规定的 JSON，不截断正文。';
  if (!targetLanguage && options.rewriteRetry === true && isRewriteMode(mode)) {
    prompt += '\n【重新生成】上次没有得到合格文案。只返回一个 JSON 对象，action 用 "save_copy"，text 用非空字符串；从素材重新组织，不照抄，不补充不存在的事实。'+
      (mode === 'zhihu-rewrite' ? '用问题交代背景，按 UC 编辑部式叙事重写，保留回答的主要论点、关键案例和数字，不缩成摘要，style 固定 standard。' : mode === 'comment-rewrite' ? '必须同时融入原帖和评论的实质观点。' : '保留原帖立场并换一种表达。')+
      '不得加入编辑者核查、提醒、判断、总结或免责声明，不得出现“先把事实和猜疑分开”“先说结论”“需要注意的是”“目前没有定论”等元话语。不得把素材中的陈述或肯定判断改成“按这个说法看……是不是说明……”“照这个逻辑……是否意味着……”等推导式设问。'+
      (mode==='zhihu-rewrite'?'style 固定 standard。':'仍按风格分流填写 style。')+'如果素材仍不足以可靠改写，才返回 {"action":"skip","text":""}。';
  }
  if (mode === 'post' && Number.isFinite(options.maxBodyWeight)) {
    prompt += `\n【本条正文长度预算】最多 ${Math.floor(options.maxBodyWeight)} 加权字符。中文等非拉丁字符按2计、英文字母及空格按1计；原文标签由插件补回，正文必须为它们留出空间。`;
  }
  const inputName = ['post','timeline-rewrite'].includes(mode) ? 'reference_text' : 'post_text';
  const userInput=mode==='zhihu-rewrite'?{question_text:input.questionText,answer_text:input.text,image_count:input.imageUrls?.length||0}:mode==='comment-rewrite'?{reference_post_text:input.rootText,comment_text:input.text}:['reply','notification'].includes(mode)?{
    post_text:input.text,original_post:input.context?.root,conversation_history:input.context?.history||[],reply_target:input.context?.target,confirmed_own_replies:input.selfReplies||[],...(input.currentAccount?{current_account:input.currentAccount}:{})
  }:{[inputName]:input.text};
  if(mode==='comment-rewrite'&&(!userInput.reference_post_text?.trim()||!userInput.comment_text?.trim()))throw createAIError('invalid_input');
  const userContent=mode==='zhihu-rewrite'?await inlineZhihuImages(zhihuUserContent(input),{fetcher,signal:options.signal}):['reply','notification'].includes(mode)?await inlineReplyImages(replyUserContent(userInput),{fetcher,signal:options.signal}):JSON.stringify(userInput);
  options.signal?.throwIfAborted();
  const payload={
    model: MODEL,
    messages: [{role:'system',content:prompt},{role:'user',content:userContent}],
    stream:false,thinking:{type:'disabled'},max_tokens:targetLanguage||mode==='zhihu-rewrite'?8192:isRewriteMode(mode)?4096:512,response_format:{type:'json_object'},
  };
  const body=Array.isArray(userContent)?serializeVisionRequest(payload):JSON.stringify(payload);
  let response;
  try {
    response = await fetcher(`${API_ORIGIN}/chat/completions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}`},
      signal: options.signal,
      body,
    });
  } catch (error) {
    if (options.signal?.aborted && options.signal.reason?.name === 'AbortError') throw options.signal.reason;
    throw createAIError('network');
  }
  if (!response.ok) {
    let diagnostic;
    if(response.status===400)try{
      diagnostic=sanitizeHTTPDiagnostic(await response.json(),{secrets:[key.trim()],
        texts:[prompt,input.text,input.rootText,input.questionText,input.context?.root?.text,...(input.context?.history||[]).map(r=>r.text),input.context?.target?.text,...(input.selfReplies||[]).map(r=>r.text)],
        imageCount:Array.isArray(userContent)?userContent.filter(p=>p.type==='image_url').length:0});
    }catch{} // malformed/empty bodies must not hide the actual HTTP status
    return {ok: false, status: response.status,...(diagnostic?{diagnostic}:{}),json: async () => ({error: `HTTP ${response.status}`})};
  }
  let value;
  try { value = parseCompletion(await response.json()); }
  catch { throw createAIError('format'); }
  if (!targetLanguage && mode !== 'post' && value.action !== 'skip') value.text = stripLegacyFooter(value.text);
  // Only the rewrite routes use style; never pass arbitrary provider fields through.
  const result = {action: value.action, text: value.text};
  if (['reply','notification'].includes(mode) && value.action === 'skip' && value.reason === 'conversation_ended') result.reason = 'conversation_ended';
  if (isRewriteMode(mode) && value.action === 'save_copy' && ['standard','reaction','verify'].includes(value.style)) result.style = value.style;
  if(mode==='zhihu-rewrite'&&value.action==='save_copy')result.imageIndexes=value.image_indexes;
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
