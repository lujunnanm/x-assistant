// Runtime-only credential, deliberately separate from exportable library state.
export const API_KEY_STORAGE='xAssistantDeepSeekKeyV1';
export async function directGenerate(url,options,{storage=chrome.storage.local,fetcher=fetch,resource=path=>chrome.runtime.getURL(path)}={}){
 const key=(await storage.get(API_KEY_STORAGE))[API_KEY_STORAGE];
 if(typeof key!=='string'||!key.trim())throw Error('DeepSeek 密钥未配置，请在插件设置中保存');
 const post=url.endsWith('/post'),notification=url.endsWith('/notification-reply');
 let prompt=await (await fetcher(resource('bridge/'+(post?'post':'reply')+'-rules.txt'))).text();
 if(!post)prompt+='\n【本次运行模式】'+(notification?'通知回帖：只回复内容，footer 必须为空，不要交友或回关尾句。':'主动互动：JSON 增加 footer 字段，用正文同一种语言表达“交个朋友呀，请回关我”。简体中文固定为“交个朋友呀\n请回关我”；其他语言自然翻译，最多40字符。')+' text 正文最多130字符，正文与尾句必须同语言。';
 const input=JSON.parse(options.body);
 let response;
 try{
  response=await fetcher('https://api.deepseek.com/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
   signal:options.signal,body:JSON.stringify({model:'deepseek-flash',messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({[post?'reference_text':'post_text']:input.text})}],stream:false,thinking:{type:'disabled'},max_tokens:512,response_format:{type:'json_object'}})
  });
 }catch{throw Error('DeepSeek 连接失败或请求超时，未发送');}
 if(!response.ok)return {ok:false,status:response.status,json:async()=>({error:'HTTP '+response.status})};
 let value;
 try{
  const data=await response.json(),choice=data.choices[0];
  if(choice.finish_reason!=='stop')throw Error();
  value=JSON.parse(choice.message.content);
  if(value.action!=='skip'&&!post&&typeof value.text==='string'){
   const body=value.text.replace(/(?:\s*(?:交个朋友呀?|请回关我)[\s，,。.!！]*)+$/u,'').trim();
   const footer=notification?'':value.footer;
   if(!notification&&(typeof footer!=='string'||!footer.trim()||[...footer].length>40||/https?:|[<>@#]/i.test(footer)))throw Error();
   value.text=notification?body:body+'\n'+footer.trim();
  }
 }catch{throw Error('AI 文案格式校验失败，未发送');}
 return {ok:true,status:200,json:async()=>value};
}

export async function verifyCredential(key,{fetcher=fetch}={}){
 if(typeof key!=='string'||!key.trim())throw Error('DeepSeek 密钥未配置，请在插件设置中保存');
 let response;
 try{response=await fetcher('https://api.deepseek.com/models',{headers:{Authorization:'Bearer '+key.trim()},signal:AbortSignal.timeout(15000)});}
 catch{throw Error('DeepSeek 连接失败或请求超时，未发送');}
 if(!response.ok)throw Error(response.status===401?'DeepSeek HTTP 401：密钥认证失败，请更换有效密钥':response.status===402?'DeepSeek HTTP 402：余额不足，请充值后再试':response.status===403?'DeepSeek HTTP 403：访问被拒绝，请检查 API 权限':'DeepSeek HTTP '+response.status+'：连接检查失败');
 return true;
}
