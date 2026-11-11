import {directGenerate, stripLegacyFooter} from './deepseek-direct.mjs';
import {createAIError} from './ai-recovery.mjs';
import {formatTimelineRewriteText,isSpacedRewriteStyle,timelineRewriteFingerprint} from './posting-copy.mjs';

const FORBIDDEN = /我|本人|亲测|不是|不等于|与其|你以为/;
const LINK_OR_CODE = /https?:|<script/i;
const REWRITE_EDITORIAL_META = /先把(?:事实|已知信息|已确认信息)(?:和|与)(?:猜疑|猜测|传闻|推测|质疑)分开|先说结论|需要注意的是|目前(?:仍然)?没有(?:明确)?定论/u;
const REWRITE_INFERENCE_LEAD = /按(?:这个|这种|上述)(?:说法|逻辑|思路)(?:来)?看|照(?:这个|这种|上述)(?:说法|逻辑|思路)(?:来)?看/u;
const REWRITE_INFERENCE_QUESTION = /(?:是不是|是否)(?:就)?(?:说明|意味着|代表)/u;
const MAX_INPUT_LENGTH = 16000;
const REQUEST_TIMEOUT = 25000;
const weightedLength = text => [...text].reduce((n, c) => n + (c.codePointAt(0) > 0x10ff ? 2 : 1), 0);

function validSourceText(text) {
  return typeof text === 'string' && !!text.trim() && text.length <= MAX_INPUT_LENGTH;
}

async function request(mode, text, fetcher, extra = {}) {
  const {bodyFields = {}, ...requestOptions} = extra;
  let response;
  try {
    // mode is an internal adapter route, not a localhost network endpoint.
    response = await fetcher(`/${mode}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text, ...bodyFields}), signal: AbortSignal.timeout(REQUEST_TIMEOUT), ...requestOptions,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error?.name === 'TimeoutError') throw createAIError('network');
    if (typeof error?.code === 'string') throw createAIError(error.code, error.status);
    throw createAIError('network');
  }
  if (!response?.ok) throw createAIError('http', response?.status);
  try { return await response.json(); }
  catch { throw createAIError('format'); }
}

function validateBody(value, action, limit) {
  const text = value?.text;
  if (value?.action !== action || typeof text !== 'string' || !text.trim()) throw createAIError('invalid_action');
  if ([...text].length > limit) throw createAIError('content_length');
  if (LINK_OR_CODE.test(text)) throw createAIError('content_link');
  if (FORBIDDEN.test(text)) throw createAIError('content_forbidden');
  return text.trim();
}

export function validateReply(value, postId) {
  if (value?.action === 'skip') return {action: 'skip', text: '', postId, skipReason: 'model_choice'};
  const body = validateBody({...value, text: stripLegacyFooter(value?.text)}, 'send_reply', 180);
  const text = body;
  if (weightedLength(text) > 280) throw createAIError('content_length');
  return {action: 'send_reply', text, postId};
}

export async function generateReply(post, fetcher = directGenerate, notification = false) {
  if (!post || !/^\d+$/.test(post.id) || !validSourceText(post.text)) throw createAIError('invalid_input');
  const value = await request(notification ? 'notification-reply' : 'reply', post.text, fetcher);
  return validateReply(value, post.id);
}

export function generateNotificationReply(post, fetcher = directGenerate) {
  return generateReply(post, fetcher, true);
}

export function validateTimelineRewrite(value, post) {
  if (value?.action === 'skip') throw createAIError('rewrite_skipped');
  if (value?.action !== 'save_copy' || typeof value.text !== 'string' || !value.text.trim()) throw createAIError('rewrite_format');
  const style = isSpacedRewriteStyle(value.style) ? value.style : undefined;
  const text = formatTimelineRewriteText(value.text,style);
  if (!text.trim()) throw createAIError('rewrite_format');
  if (text.length > 10000) throw createAIError('content_length');
  const source=[post.text,post.rootPost?.text].filter(Boolean).join('\n');
  const addedInference=(REWRITE_INFERENCE_LEAD.test(text)&&!REWRITE_INFERENCE_LEAD.test(source))||(REWRITE_INFERENCE_QUESTION.test(text)&&!REWRITE_INFERENCE_QUESTION.test(source));
  if (REWRITE_EDITORIAL_META.test(text) || addedInference) throw createAIError('rewrite_editorialized');
  const fingerprint=timelineRewriteFingerprint(text);
  if (fingerprint === timelineRewriteFingerprint(post.text)) throw createAIError('rewrite_unchanged');
  if (post.rootPost && fingerprint === timelineRewriteFingerprint(post.rootPost.text)) throw createAIError('rewrite_root_only');
  return {action: 'save_copy', text, postId: post.id, ...(style?{style}:{})};
}

export async function generateTimelineRewrite(post, fetcher = directGenerate) {
  if (!post || !/^\d+$/.test(post.id) || !validSourceText(post.text)) throw createAIError('invalid_input');
  const mediaOnlyRoot=post.rootPost?.text===''&&(post.rootPost.imageUrls?.length>0||post.rootPost.videoUrls?.length>0);
  if (post.rootPost && (!/^\d+$/.test(post.rootPost.id) || post.rootPost.id === post.id || !validSourceText(post.rootPost.text)&&!mediaOnlyRoot)) throw createAIError('invalid_input');
  // Media bytes are never sent to AI; a textless root has no viewpoint to fuse.
  const fuse=post.rootPost&&!mediaOnlyRoot;
  const mode=fuse?'comment-rewrite':'timeline-rewrite';
  const bodyFields=fuse?{rootText:post.rootPost.text}:{};
  const attempt=async rewriteRetry=>validateTimelineRewrite(await request(mode,post.text,fetcher,{bodyFields,rewriteRetry}),post);
  try{return await attempt(false);}
  catch(error){
    if(!['format','rewrite_format','rewrite_skipped','rewrite_unchanged','rewrite_root_only','rewrite_editorialized','content_length'].includes(error.code))throw error;
    try{return await attempt(true);}
    catch(retry){throw retry.code==='format'?createAIError('rewrite_format'):retry;}
  }
}

function postMetadata(row) {
  const tags = [...new Set(row.text.match(/#[\p{L}\p{N}_]+/gu) || [])];
  const grok = /(?:^|\s)@grok\b/.test(row.text);
  return [tags.join(' '), grok ? '@grok' : ''].filter(Boolean).join('\n\n');
}

export function validatePost(value, row) {
  if (value?.action === 'skip') return {action: 'skip', text: '', rowId: row.id, skipReason: 'model_choice'};
  const body = validateBody(value, 'send_post', 140);
  if (/[<>#@]/.test(body)) throw createAIError('content_link');
  const text = [body, postMetadata(row)].filter(Boolean).join('\n\n');
  if (weightedLength(text) > 280) throw createAIError('content_length');
  // Preserve row binding. Images are still attached by posting.js using the source row.
  return {action: 'send_post', text, rowId: row.id};
}

export async function generatePost(row, fetcher = directGenerate) {
  if (!row || row.type !== 'post' || !validSourceText(row.text)) throw createAIError('invalid_input');
  const reference = row.text.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/@grok\b/g, '').trim();
  if (!reference) throw createAIError('invalid_input');
  const metadata = postMetadata(row);
  const maxBodyWeight = 280 - weightedLength(metadata) - (metadata ? 2 : 0);
  if (maxBodyWeight <= 0) throw createAIError('content_length');
  const value = await request('post', reference, fetcher, {maxBodyWeight});
  return validatePost(value, row);
}
