import {directGenerate} from './deepseek-direct.mjs';
async function bridgeFailure(response){
 let detail='';try{const body=await response.json();const raw=String(body?.error||'');const code=raw.match(/HTTP\s*(\d{3})/i)?.[1];if(code)detail='HTTP '+code;else if(/格式不合格/.test(raw))detail='AI 文案格式校验失败';else if(/密钥/.test(raw))detail='DeepSeek 密钥未配置或无效';else if(/连接失败|超时/.test(raw))detail='DeepSeek 连接失败或超时';}catch{}
 return Error(detail||'DeepSeek 生成失败（'+response.status+'）');
}
export function validateReply(value,postId){
 if(value?.action==='skip')return {action:'skip',text:'',postId};
 const text=value?.text;
 if(value?.action!=='send_reply'||typeof text!=='string'||!text.trim())throw Error('AI 回复未通过检查：动作或正文格式无效，未发送');
 if([...text].length>180)throw Error('AI 回复未通过检查：正文过长，未发送');
 if(/https?:|<script/i.test(text))throw Error('AI 回复未通过检查：包含链接或代码，未发送');
 if(/我|本人|亲测|不是|不等于|与其|你以为/.test(text.replace(/交个朋友呀\s*请回关我$/, '').replace(/请回关我$/, '')))throw Error('AI 回复未通过检查：包含禁用表达，未发送');
 return {action:'send_reply',text:text.trim(),postId};
}
export async function generateReply(post,fetcher=directGenerate,notification=false){
 if(!post||!/^\d+$/.test(post.id)||typeof post.text!=='string'||!post.text.trim()||post.text.length>16000)throw Error('帖子信息无效');
 let response;
 try{response=await fetcher(notification?'http://127.0.0.1:18765/notification-reply':'http://127.0.0.1:18765/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:post.text}),signal:AbortSignal.timeout(25000)});}catch(e){throw Error(/密钥|格式|连接失败|超时/.test(e?.message||'')?e.message:'DeepSeek 连接失败或请求超时，未发送');}
 if(!response.ok)throw await bridgeFailure(response);
 return validateReply(await response.json(),post.id);
}

// The shared bridge still appends the proactive-interaction footer.
// Notification replies keep only the validated, contextual response body.
export async function generateNotificationReply(post,fetcher=directGenerate){
 const result=await generateReply(post,fetcher,true);
 if(result.action==='skip')return result;
 const text=result.text.replace(/(?:\s*(?:交个朋友呀?|请回关我)[\s，,。.!！]*)+$/u,'').trim();
 return validateReply({...result,text},post.id);
}

export function validatePost(value,row){
 if(value?.action==='skip')return {action:'skip',text:'',rowId:row.id};
 const body=value?.text;
 if(value?.action!=='send_post'||typeof body!=='string'||!body.trim()||[...body].length>140||/https?:|[<>#@]|我|本人|亲测|不是|不等于|与其|你以为/.test(body))throw Error('AI 发帖文案未通过检查，未发送');
 const tags=[...new Set(row.text.match(/#[\p{L}\p{N}_]+/gu)||[])];
 const grok=/(?:^|\s)@grok\b/.test(row.text);
 const text=[body.trim(),tags.join(' '),grok?'@grok':''].filter(Boolean).join('\n\n');
 // Conservative X weighted-length bound for short posts, including Chinese tags.
 const weight=[...text].reduce((n,c)=>n+(c.codePointAt(0)>0x10ff?2:1),0);
 if(weight>280)throw Error('AI 发帖文案过长，未发送');
 return {action:'send_post',text,rowId:row.id};
}
export async function generatePost(row,fetcher=directGenerate){
 if(!row||row.type!=='post'||typeof row.text!=='string'||!row.text.trim()||row.text.length>16000)throw Error('发帖参考无效');
 const reference=row.text.replace(/#[\p{L}\p{N}_]+/gu,'').replace(/@grok\b/g,'').trim();
 let response;
 try{response=await fetcher('http://127.0.0.1:18765/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:reference}),signal:AbortSignal.timeout(25000)});}catch(e){throw Error(/密钥|格式|连接失败|超时/.test(e?.message||'')?e.message:'DeepSeek 连接失败或请求超时，未发送');}
 if(!response.ok)throw await bridgeFailure(response);
 return validatePost(await response.json(),row);
}
