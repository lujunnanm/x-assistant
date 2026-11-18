import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateReply} from '../ai-client.mjs';
import {directGenerate,API_KEY_STORAGE} from '../deepseek-direct.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rules=read('bridge/reply-rules.txt');
const includesAll=phrases=>{for(const phrase of phrases)assert.ok(rules.includes(phrase),phrase);};
// Prompt contracts and mocked transport only, not evidence of live model behavior.
test('both personas answer the actual distortion instead of naming a debate offence',()=>{
 assert.equal(rules,read('bridge/interaction-reply-rules.txt'));
 includesAll(['先看自己原来怎么说的，再接对方多出来的那一截','不拿“贴标签”“扣帽子”“偷换概念”当回复结论','也不换成“污名化”“稻草人”继续讲术语','这是表达习惯，不是关键词禁用','真正讨论这些词或引用原话时照常用']);
});
test('colloquial disagreement does not fabricate a distortion, deny history or escalate ordinary discussion',()=>{
 includesAll(['对方没歪曲他的意思，就正常聊具体问题','自己确实说过或说错的就认','不拿“我啥时候说过”抵赖','普通误会不自动升级成人身攻击','不把这几句当固定回嘴库','不是每条都反问、都挖苦']);
});
test('grounded examples include colloquial questions, statements and a genuine correction',()=>{
 includesAll(['嫌贵就是买不起呗？','我就吐槽个手机，咋还不爱国了？','不是，我啥时候说这话了？','得，啥都让你替我说了。','你给我加的戏还挺多。','好家伙，我自己都不知道。','这句是我说满了，收回。']);
 const samples=[...rules.matchAll(/^回复：(.+)$/gm)].map(m=>m[1]);
 for(const sample of samples)assert.doesNotMatch(sample,/贴标签|扣帽子|污名化|稻草人|偷换概念/);
 assert.ok(!rules.includes('搁这儿扣帽子装判官呢'));
});
test('both adapters pass the context and new voice once without replacing returned words',async()=>{
 const cases=[
  {root:'这个手机价格太贵了。',target:'买不起就直说。',reply:'嫌贵就是买不起呗？'},
  {root:'我只说这款手机续航不好。',target:'你就是不爱国。',reply:'我就吐槽个手机，咋还不爱国了？'},
  {root:'这些模型都没用。',target:'你上面不就说了全都没用吗？',reply:'这句是我说满了，收回。'},
  // Discussing the expression itself must not be mechanically blocked or replaced.
  {root:'聊聊中文表达。',target:'这里的“扣帽子”是什么意思？',reply:'这里的“扣帽子”，就是硬把没说过的立场安到人家头上。'},
 ];
 for(const notification of [false,true])for(const item of cases){
  const root={id:'1',author:'me',text:item.root,parentId:null};
  const target={id:'3',author:'reader',text:item.target,parentId:'2'};
  const history=[{id:'2',author:'me',text:'我说的就是上面这件事。',parentId:'1'}];
  const input={id:target.id,text:target.text,account:'/me',context:{version:1,root,history,target}};
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
  const system=payload.messages[0].content;
  assert.ok(system.startsWith(rules));
  assert.ok(system.includes('先看自己原来怎么说的，再接对方多出来的那一截'));
  const data=JSON.parse(payload.messages[1].content);
  assert.equal(data.original_post.text,item.root);assert.equal(data.reply_target.text,item.target);
  assert.equal(data.conversation_history[0].text,history[0].text);
 }
});
