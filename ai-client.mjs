export function validateReply(value,postId){
 if(value?.action==='skip')return {action:'skip',text:'',postId};
 const text=value?.text;
 if(value?.action!=='send_reply'||typeof text!=='string'||!text.trim()||[...text].length>180||/https?:|<script/i.test(text)||/我|本人|亲测|不是|不等于|与其|你以为/.test(text.replace(/交个朋友呀\s*请回关我$/, '').replace(/请回关我$/, '')))throw Error('AI 回复未通过检查，未发送');
 return {action:'send_reply',text:text.trim(),postId};
}
export async function generateReply(post,fetcher=fetch){
 if(!post||!/^\d+$/.test(post.id)||typeof post.text!=='string'||!post.text.trim()||post.text.length>16000)throw Error('帖子信息无效');
 let response;
 try{response=await fetcher('http://127.0.0.1:18765/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:post.text}),signal:AbortSignal.timeout(25000)});}catch{throw Error('DeepSeek 本地服务不可用或超时，未发送');}
 if(!response.ok)throw Error('DeepSeek 生成失败（'+response.status+'），请检查本地服务、密钥或余额');
 return validateReply(await response.json(),post.id);
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
export async function generatePost(row,fetcher=fetch){
 if(!row||row.type!=='post'||typeof row.text!=='string'||!row.text.trim()||row.text.length>16000)throw Error('发帖参考无效');
 const reference=row.text.replace(/#[\p{L}\p{N}_]+/gu,'').replace(/@grok\b/g,'').trim();
 let response;
 try{response=await fetcher('http://127.0.0.1:18765/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:reference}),signal:AbortSignal.timeout(25000)});}catch{throw Error('DeepSeek 本地服务不可用或超时，未发送');}
 if(!response.ok)throw Error('DeepSeek 发帖生成失败（'+response.status+'），未发送');
 return validatePost(await response.json(),row);
}
