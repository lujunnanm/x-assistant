import {directGenerate, stripLegacyFooter} from './deepseek-direct.mjs';
import {createAIError} from './ai-recovery.mjs';

const FORBIDDEN = /我|本人|亲测|不是|不等于|与其|你以为/;
const LINK_OR_CODE = /https?:|<script/i;
const MAX_INPUT_LENGTH = 16000;
const REQUEST_TIMEOUT = 25000;
const weightedLength = text => [...text].reduce((n, c) => n + (c.codePointAt(0) > 0x10ff ? 2 : 1), 0);

function validSourceText(text) {
  return typeof text === 'string' && !!text.trim() && text.length <= MAX_INPUT_LENGTH;
}

async function request(mode, text, fetcher, extra = {}) {
  let response;
  try {
    // mode is an internal adapter route, not a localhost network endpoint.
    response = await fetcher(`/${mode}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text}), signal: AbortSignal.timeout(REQUEST_TIMEOUT), ...extra,
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
  const text = validateBody({...value, text: stripLegacyFooter(value?.text)}, 'send_reply', 180);
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
