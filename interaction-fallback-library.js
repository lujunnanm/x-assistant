(function(root){
 const rows=Object.freeze({
  zh:Object.freeze([
   '来打个招呼，认识一下。','路过冒个泡，以后常互动。','刷到这里，留个脚印。','来串个门，认识一下。','看到这条，过来问个好。',
   '先打个招呼，以后常来往。','很高兴刷到这条，认识一下。','时间线遇见了，来问声好。','过来串个门，交个新朋友。','留个脚印，之后常交流。',
   '刷到就是缘分，来认识一下。','路过这里，和你打个招呼。','来报个到，认识个新朋友。','时间线上碰见，过来问候一下。','先混个脸熟，以后多交流。',
   '过来冒个泡，常来常往。','看到这条就来打声招呼。','来认识一下，之后多互动。','路过不空手，留下一个问候。','刷到这条，顺便来串个门。',
   '来留个脚印，认识一下。','先问个好，以后常见。','时间线相遇，过来认识一下。','来打声招呼，之后常交流。','刷到这里，和你问个好。',
   '路过来看看，也来认识一下。','先来报到，之后常互动。','过来串串门，认识个朋友。','看到这条，留下一声问候。','时间线刷到了，来交个朋友。'
  ]),
  en:Object.freeze([
   'Stopping by to say hello.','Nice to meet you here.','Hello from the timeline.','Dropping by to connect.','Glad this showed up on the timeline.',
   'Just stopping by to say hi.','Leaving a quick hello here.','Nice running into this post.','A quick hello from my side.','Good to connect with you here.'
  ]),
  ja:Object.freeze([
   'こんにちは、よろしくお願いします。','見かけたのでご挨拶です。','タイムラインからこんにちは。','立ち寄ったので一言ご挨拶です。','ここで出会えたのでご挨拶します。',
   '投稿を見かけたので、こんにちは。','まずはご挨拶、よろしくお願いします。','タイムラインで見つけて立ち寄りました。','こんにちは、これから仲良くしてください。','見かけたので足跡を残します。'
  ])
 });
 const suffix='回关我交个朋友呀';
 const suffixes=Object.freeze({zh:suffix,en:"Follow me back—let's be friends!",ja:'よかったらフォロバして、仲良くしてください！'});
 const language=text=>{
  const raw=String(text||'');
  const body=raw.replace(/https?:\/\/\S+/gu,'').replace(/[@#＃][\p{L}\p{N}_]+/gu,'').trim()||raw;
  const han=(body.match(/\p{Script=Han}/gu)||[]).length;
  const kana=(body.match(/[\u3040-\u30ff]/gu)||[]).length;
  const latin=(body.match(/[A-Za-z]+/g)||[]).length;
  if(kana&&latin<kana+han)return 'ja';
  return han&&han>=latin?'zh':'en';
 };
 const pick=(text,random=Math.random)=>{const list=rows[language(text)],value=Number(random());const index=Number.isFinite(value)&&value>=0&&value<1?Math.floor(value*list.length):0;return list[index];};
 const appendFollowBack=text=>{
  const value=String(text||'').trim();
  if(Object.values(suffixes).some(tail=>value.endsWith(tail)))return value;
  const lang=language(value),tail=(lang==='zh'?'，':lang==='ja'?'。':'. ')+suffixes[lang],room=Math.max(0,130-[...tail].length);
  const body=[...value].slice(0,room).join('').trim().replace(/[。.!！,，]+$/u,'');
  return body+tail;
 };
 const compose=(text,followsYou,random=Math.random)=>{const body=pick(text,random);return followsYou===false?appendFollowBack(body):body;};
 root.XAssistantFallbackLibrary=Object.freeze({rows,pick,compose,appendFollowBack,suffix,suffixes,size:Object.values(rows).reduce((sum,list)=>sum+list.length,0)});
})(globalThis);
