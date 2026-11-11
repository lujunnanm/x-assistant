// Local interaction options shared by settings, worker startup, and filtering.
(()=>{
 const KEY='xAssistantInteractionPreferencesV1',VIEWS_KEY='xAssistantInteractionViewsV1',INDEX_KEY='xAssistantFriendTopicIndexV1';
 const DEFAULT_VIEWS=5000,MAX_VIEWS=100000,STEP=100,MAX_KEYWORDS=20,MAX_KEYWORD_LENGTH=120;
 const topics=[
  '人工智能 OR "artificial intelligence" OR 生成AI',
  '大语言模型 OR 大模型 OR LLM OR "foundation model"',
  'ChatGPT OR OpenAI OR "GPT model" OR GPT模型',
  'Claude AI OR Anthropic OR "Claude Code"',
  'Gemini AI OR DeepMind OR NotebookLM',
  'DeepSeek OR Qwen OR 通义千问 OR Kimi AI OR 豆包 AI',
  'Llama AI OR Mistral AI OR Gemma AI OR GLM 模型 OR 智谱',
  'AI编程 OR "AI coding" OR "vibe coding" OR 代码生成',
  'Cursor AI OR "GitHub Copilot" OR Codex AI OR Windsurf AI OR Cline AI',
  'AI智能体 OR "AI agent" OR "agentic AI" OR 多智能体',
  'MCP AI OR "model context protocol" OR "tool calling" OR "function calling"',
  'AI工作流 OR Dify OR Coze OR LangChain OR LangGraph',
  'RAG AI OR 检索增强生成 OR 向量数据库 OR "vector embeddings"',
  '提示词工程 OR "prompt engineering" OR "context engineering" OR 上下文工程',
  '模型微调 OR 指令微调 OR RLHF OR DPO LLM OR "fine tuning"',
  '推理模型 OR 思维链 OR "chain of thought" OR "test time scaling"',
  'Ollama OR vLLM OR "llama.cpp" OR "LM Studio" OR 模型量化',
  '开源大模型 OR 开源模型 OR "open weight model" OR HuggingFace',
  '大模型评测 OR AI评测 OR LLM评测 OR "AI benchmark"',
  'AI安全 OR 模型幻觉 OR "AI alignment" OR "prompt injection"',
  'AI绘画 OR AI生图 OR 文生图 OR Midjourney OR "Stable Diffusion"',
  'ComfyUI OR 即梦 OR "FLUX AI" OR 图像生成模型',
  'AI视频 OR 文生视频 OR 图生视频 OR Sora AI OR 可灵 OR Seedance',
  'AI配音 OR 语音合成 OR 语音识别 OR ElevenLabs OR Whisper AI',
  'AI音乐 OR 音乐生成 OR Suno OR Udio',
  '多模态模型 OR 视觉语言模型 OR VLM OR "vision language model"',
  '机器学习 OR 深度学习 OR 神经网络 OR "machine learning" OR "deep learning"',
  '具身智能 OR 机器人学习 OR 世界模型 OR "embodied AI"',
  'AI工具 OR AI应用 OR AI教程 OR "AI tools" OR "AI tutorial"',
  'AI创业 OR AI产品 OR AI办公 OR "AI startup" OR "AI productivity"'
 ];
 const canonical=text=>String(text||'').normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
 function parseKeywords(text){
  const result=[],seen=new Set();
  for(const raw of text.split(/\r?\n|\r/u)){
   const keyword=raw.trim().replace(/\s+/gu,' '),key=canonical(keyword);
   if(!key||seen.has(key))continue;
   if(keyword.length>MAX_KEYWORD_LENGTH||/[\u0000-\u001f\u007f]/u.test(keyword))throw Error('每行最多 120 个字符，不能包含控制字符');
   if(result.length>=MAX_KEYWORDS)throw Error('最多保存 20 个搜索关键词');
   seen.add(key);result.push(keyword.toWellFormed());
  }
  return result;
 }
 const validViews=n=>Number.isInteger(n)&&n>=0&&n<=MAX_VIEWS&&n%STEP===0;
 const effectiveViews=(value,override)=>validViews(override)?override:validViews(value?.minViews)?value.minViews:DEFAULT_VIEWS;
 function normalize(value,override){
  let keywords=[];
  if(Array.isArray(value?.keywords)&&value.keywords.every(v=>typeof v==='string'))try{keywords=parseKeywords(value.keywords.join('\n'));}catch{}
  return {keywords,minViews:effectiveViews(value,override)};
 }
 function selection(value,index,search){
  const {keywords,minViews}=normalize(value),list=keywords.length?keywords:topics;
  const position=Number.isInteger(index)&&index>=0?index%list.length:0;
  return {path:search?'/search?q='+encodeURIComponent(list[position])+'&src=typed_query':'/home',
   keyword:search&&keywords.length?list[position]:null,minViews,count:search?list.length:0,position};
 }
 function same(left,right,search){
  const a=normalize(left),b=normalize(right);
  return a.minViews===b.minViews&&(!search||JSON.stringify(a.keywords)===JSON.stringify(b.keywords));
 }
 globalThis.XAssistantInteractionPrefs={KEY,VIEWS_KEY,INDEX_KEY,DEFAULT_VIEWS,MAX_VIEWS,STEP,MAX_KEYWORD_LENGTH,parseKeywords,validViews,effectiveViews,normalize,selection,same};
})();
