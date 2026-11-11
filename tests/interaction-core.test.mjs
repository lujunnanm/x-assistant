import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../interaction-core.js',import.meta.url),'utf8');
const context={URL,crypto:{getRandomValues:a=>{a[0]=0;return a;}}};context.globalThis=context;vm.runInNewContext(source,context);
const core=context.XAssistantCore;

test('interaction no longer exposes a followed/unfollowed rotation policy',()=>{
 assert.equal(core.pattern,undefined);
 assert.equal(core.desiredAuthorType,undefined);
 assert.equal(core.nextCycleIndex,undefined);
});

test('each random timer uses hundredth-second precision inside its inclusive range',()=>{
 assert.equal(core.randomSeconds(5,10,0),5);
 assert.equal(core.randomSeconds(5,10,0.999999),10);
 assert.equal(core.randomSeconds(5,20,0.5),12.5);
 assert.equal(core.randomSeconds(5,10,0.1234),5.61);
 assert.equal(core.formatSeconds(5),'5.00');
 assert.equal(core.formatSeconds(5.6),'5.60');
 assert.throws(()=>core.randomSeconds(10,5,0));
});

test('editor text preserves visual line breaks used by the X composer',()=>{
 assert.equal(core.editorText({innerText:'第一句\r\n交个朋友呀\n',textContent:'第一句交个朋友呀'}),'第一句\n交个朋友呀');
 assert.equal(core.editorText({textContent:'单行内容'}),'单行内容');
});

test('Draft editor block reading preserves a blank line without innerText extra newline',()=>{
 const node={innerText:'正文\n\n\n#话题',querySelectorAll:()=>[{textContent:'正文'},{textContent:''},{textContent:'#话题'}]};
 assert.equal(core.editorText(node),'正文\n\n#话题');
 assert.notEqual(core.editorText(node),'正文\n#话题');
});

test('automatic following defaults on and honors persisted false',()=>{
 assert.equal(core.autoFollowEnabled(undefined),true);
 assert.equal(core.autoFollowEnabled(true),true);
 assert.equal(core.autoFollowEnabled(false),false);
});

test('interaction exposure gate requires more than 5000 and rejects unreadable counts',()=>{
 assert.equal(core.MIN_INTERACTION_VIEWS,5000);
 for(const views of [null,NaN,undefined,0,1000,4999,5000,'5000'])assert.equal(core.highExposure(views),false);
 for(const views of [5001,50000])assert.equal(core.highExposure(views),true);
 for(const label of ['0 次查看','4,999 次查看','4.9K views','5K views','no count'])
  assert.equal(core.interactionSkipReason({author:'other',text:'AI 编程',views:core.parseViews(label)},{self:'self'}),'low_exposure');
 for(const label of ['5,001 次查看','5.1K views','0.51万 次查看'])
  assert.equal(core.interactionSkipReason({author:'other',text:'AI 编程',views:core.parseViews(label)},{self:'self'}),null);
});

test('interaction accepts friendship posts regardless of exposure count',()=>{
 for(const text of ['#蓝v交友 来认识一下','想认识一些新朋友','交个朋友','#蓝V交友圈','#蓝V诚信互关','#蓝V关注必回','#蓝V涨粉互助','#蓝V新人报到','#蓝V日常互动','#蓝V抱团','#蓝V冲千粉','#蓝友互关','#互关大队','#回关大队','#真诚互粉','#浇友串门','出摊啦，蓝V来认识一下','Looking for new friends!','Let\'s connect #mutuals','Let\'s be mutuals','Active mutuals wanted','Following everyone back','New mutuals welcome','Support each other','Join this follow chain','Let\'s grow together','#ifollowback','#followback100','#followbackguaranteed','#mutualfollow','#creatorcommunity','#engagementtrain','#bluecheckmutuals','#f4f','友達募集','お友達募集','相互フォロー希望','相互垢募集','フォロバ必ず','フォロバ希望','フォロー返し','友達募集中','交流したい','絡み募集中','ブルーバッジ仲間','認証垢相互','Xで繋がりたい','仲良くなりたい','맞팔']){
  assert.equal(core.friendshipRelated(text),true,text);
  for(const views of [null,0,499,500])assert.equal(core.friendshipCandidate(text,views),true,text);
 }
 for(const text of ['今天和朋友吃饭','科技新闻更新','普通生活记录','蓝V认证价格介绍','饭馆出摊卖早餐','朋友来家里串门','Follow the instructions below','The train follows the river','Networking event starts at eight','友達と夕食を食べました','説明に従ってください',''])assert.equal(core.friendshipRelated(text),false,text);
 assert.equal(core.friendshipCandidate('普通帖子',50000),false);
});

test('legacy friendship helpers do not bypass the current timeline exposure gate',()=>{
 for(const text of ['今天想认真交友，认识些聊得来的朋友','最近互关的人越来越多了','欢迎回关，之后常来往','蓝 V，交 友，活人在线','想找一些 new creators 一起交流','フォロワー募集しています']){
  assert.equal(core.friendshipRelated(text),true,text);
  assert.equal(core.interactionSkipReason({author:'other',text},{self:'self'}),'low_exposure',text);
 }
});

test('deduplicated Japanese follow tags from the supplied screenshot are all recognized',()=>{
 const tags=['ブルバ100','フォロバ100','フォロバ確実','フォロー返します','相互フォロー','相互フォロワー募集','フォロバ相互','フォローしてね','フォロバ100絶対','いいねした人全員フォロー','フォロー返し','いいねした人全員フォローする','フォローした人全員フォローする','ファボした人全員フォローする','ファボください','いいねください','フォロバ100パーセント','フォローしてくれたアイドル全員フォローする','いいねしてきたアイドルをフォローする','フォロバ','フォロバ100パー','フォロバ100変なアカウント以外'];
 assert.equal(new Set(tags).size,22);
 for(const tag of tags)assert.equal(core.friendshipRelated('#'+tag),true,tag);
});

test('interaction supports home and top/latest post searches, not people or media tabs',()=>{
 for(const p of ['/home','/search?q=交友','/search?q=test&f=top','/search?q=test&f=live'])assert.equal(core.interactionPage(p),true);
 for(const p of ['/search','/search?q=test&f=user','/search?q=test&f=image','/notifications','https://evil.example/home'])assert.equal(core.interactionPage(p),false);
});

test('fixed remaining cooldown preserves fractional milliseconds without invalid range',()=>{
 for(const value of [0,0.001,3.141,12.349,29.999,45.001])assert.equal(core.randomSeconds(value,value),value);
 assert.throws(()=>core.randomSeconds(-0.001,-0.001));
 assert.throws(()=>core.randomSeconds(NaN,NaN));
});

test('localized view parser accepts native view labels, never unnumbered analytics labels',()=>{for(const [value,count] of [['49 views. View post analytics',49],['1.2K views',1200],['2.5万 次查看',25000],['1,234 views',1234],['352 次观看',352],['1.2萬 次瀏覽',12000]])assert.equal(core.parseViews(value),count);assert.equal(core.parseViews('查看帖子分析'),null);});
