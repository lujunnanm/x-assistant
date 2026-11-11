import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFriendship} from '../deletion-topic.mjs';

test('direct Chinese, English and Japanese invitations qualify in author body',()=>{
 for(const s of ['出摊了！蓝V、活人，来交朋友。真诚浇友，有关必回 #蓝V交友','想认识一些新朋友！','来一波互关！','蓝V朋友欢迎互关，有空一起聊聊。','有没有人愿意和我交朋友？','想互关的朋友可以来评论区留言！','Who wants to be mutuals?','Looking for new mutuals!','I’m looking to meet new friends here.','Let’s be mutuals!','Follow me and I’ll follow you back.','友達募集！','お友達募集中です！','相互フォロー大歓迎！'])assert.equal(classifyFriendship(s),'match',s);
});
test('hashtags alone, indirect references and ambiguous contextual uses are never matches',()=>{
 for(const s of ['#蓝V交友 #真诚交友 #互关','今天摆个英语单词接龙摊 #浇朋友','如何交新朋友？','我不想认识新朋友。','我以前说过：来交朋友！','文章讨论社交，例子是“真诚交友，有关必回”。','他说：来交朋友！','小明问：有没有人愿意和我交朋友？','交友软件正在涨价。','今天是朋友的婚礼。#蓝V互关','互关似乎不适合我。','这里不互关，有关必回是个口号','今天抽奖，有关必回','I used to write: Let’s be mutuals!','Not looking for new friends.','My friends moved away.','She said: Let’s be friends.','My work on social networks. #followback','以前の投稿で「友達募集中です」と書きました。','友達募集していません！','不要为了交友而交友。','This post is about a phrase in https://example.com/followback','围观：招募交友 app 设计师'])assert.notEqual(classifyFriendship(s),'match',s);
});
test('no friendship evidence is not a candidate, and mutable input is never coerced',()=>{
 for(const s of ['',null,{},42,'北京天气不错，今天去买菜。','Follow me for daily recipes.','新商品のレビュー。'])assert.equal(classifyFriendship(s),'other',String(s));
});
