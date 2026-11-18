import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateReply} from '../ai-client.mjs';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rules=read('bridge/reply-rules.txt');
const includesAll=phrases=>{for(const phrase of phrases)assert.ok(rules.includes(phrase),phrase);};
// These contracts verify prompts and one-call wiring, not live model behavior.

test('both personas respond firmly to directed attacks rather than skipping pure abuse',()=>{
 assert.equal(rules,read('bridge/interaction-reply-rules.txt'));
 includesAll(['对方先冲着当前账号开骂、做人身攻击或恶意把没说过的立场硬安到他头上','直接强硬回击，可以回骂，不默认跳过','不因“纯辱骂”默认 skip','逻辑、言行、装腔作势','尖锐、具体、有个性','不堆一串空骂凑狠']);
 for(const old of ['只剩辱骂、没有新内容时可以不接','目标只有口号或纯粹辱骂'])assert.ok(!rules.includes(old),old);
});

test('disagreement and profanity about a personal frustration do not trigger retaliation',()=>{
 includesAll(['不同意见、批评原帖、用粗口表达自己的情绪，都不等于在骂当前账号','有具体问题同时回应其中的内容','不拿对方嘴臭当作自己回避问题或不认错的理由','这破模型他妈又把代码改坏了','并不是在骂当前账号','修一个 bug 又送仨，这售后可真够忙的。']);
});

test('directed abuse permits strong colloquial comebacks without a forced length or canned insults',()=>{
 includesAll(['被先骂时可以火力全开','地道中文粗口、方言口头语、烂梗、阴阳怪气、反讽都能用','不装客气','优先咬住具体话里的漏洞、嘴硬和装懂','想说的完整说完，不强制压短','不用固定模板堆“傻逼”','不把每次回骂写成同一个段子']);
 includesAll(['当面冲着对方还嘴','不是站在旁边分析、评价他的逻辑','不用“气势像你真懂”“逻辑薄弱”“暴露水平”这种评论员收尾','这只适用于被先攻击的回击，不影响普通接话','不固定套用下面某条样本']);
});

test('personal attack samples answer the attack without turning generic political slogans into an argument',()=>{
 for(const [number,text] of [['3','就会一句带节奏？你他妈复读机啊。'],['4','你他妈先把嘴里的屎咽干净再说话，隔着屏幕都熏得慌。'],['19','翻来覆去就那俩词，词库是他妈按条收费的？装懂装得挺大声，轮到讲道理就断网了。']]){
  const example=rules.match(new RegExp('^'+number+'\\. [^\\n]+\\n([^\\n]+)','m'));
  assert.equal(example?.[1],'回复：'+text);
 }
 assert.match(rules,/18\. 对方反复喊“共产党没干过一件好事”[^\n]+\n处理：\{"action":"skip","text":""\}/);
});

test('sharp responses stay confined to the current exchange without fabricated or dangerous attacks',()=>{
 includesAll(['不编造事实或隐私','不拿国籍、民族、性别、残疾这类身份骂人','不骂对方家人','不威胁暴力','不煽动自残','只回应当前这一轮','不追着对方到别的帖子骚扰','不号召别人围攻']);
});

test('both reply modes use one model call for attacks, disagreement and frustration without a tone classifier',async()=>{
 const cases=[
  {text:'傻逼博主，滚！',reply:'你他妈先把嘴里的屎咽干净再说话，隔着屏幕都熏得慌。'},
  {text:'我不认同，只看价格根本算不清这个成本。',reply:'后续维护这笔账确实也得算进去。'},
  {text:'这破模型他妈又把代码改坏了。',reply:'修一个 bug 又送仨，这售后可真够忙的。'},
 ];
 for(const notification of [false,true])for(const item of cases){
  const root={id:'1',author:'me',text:'聊聊新模型的使用体验。',parentId:null};
  const target={id:'2',author:'reader',text:item.text,parentId:'1'};
  const input={id:target.id,text:target.text,account:'/me',context:{version:1,root,history:[],target}};
  let payload,requests=0,promptReads=0;
  const result=await generateReply(input,(url,options)=>directGenerate(url,options,{
   storage:{get:async()=>({[API_KEY_STORAGE]:'fixture-key'})},resource:p=>'extension://'+p,
   fetcher:async(u,o)=>{
    if(u.startsWith('extension://')){promptReads++;return {ok:true,text:async()=>read(u.slice('extension://'.length))};}
    assert.equal(u,'https://api.deepseek.com/chat/completions');requests++;payload=JSON.parse(o.body);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'send_reply',text:item.reply})}}]})};
   }
  }),notification);
  assert.equal(requests,1);assert.equal(promptReads,1);assert.equal(result.text,item.reply);
  const mode=payload.messages[0].content.slice(rules.length);
  assert.match(mode,/直接强硬回击，不因纯辱骂而 skip/);
  assert.match(mode,/正常分歧、批评原帖或用粗口表达自身情绪不触发回骂/);
  assert.equal(JSON.parse(payload.messages[1].content).reply_target.text,item.text);
 }
});
