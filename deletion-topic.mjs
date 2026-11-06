// Deliberately narrower than the search/interaction classifier. Topic is only
// one condition: the caller must separately verify owner, original, and full text.
const topic=/交友|友[谊誼]|[交浇澆](?:个|個|些|点|點|新)?朋友|(?:认识|認識).{0,8}(?:新朋友|同好)|浇友|澆友|浇(?:个)?朋友|互浇|互澆|互[关關粉]|[回互][关關]|[关關]注必回|有[关關]必回|扩列|擴列|\b(?:friends?(?:hip)?|mutuals?|follow(?:[ -]?back| (?:you|everyone) back)|follow for follow|let['’]?s connect)\b|#(?:makefriends|newfriends|followback|f4f|letsconnect)|友達|友だち|友人|友情|相互フォロー|フォロバ|繋がりたい/iu;
// Preserve commentary, quoted speech, advice, and mixed-purpose promotions for review.
const caution=/[「」『』“”"]|(?:他说|她说|他說|她說|对我说|对我說|告诉我|教你|不是为了|并非|並非|不打算|不想|不再|谢绝|謝絕|拒绝|拒絕|不要|并不|並不|不会|不會|别再|別再|停止|不[互交]|不[回求][关關]|反对|反對|被骗|被騙|骗局|騙局|诈骗|詐騙|教程|攻略|科普|手把手|单词接龙|抽奖|抽獎|开奖|開獎|空投|赞助|贊助|案例|举例|舉例|例如|有人说|有人說|引用|文案示例|分析|观点|觀點|怎么理解|如何|我曾|我以前|以前我|曾经|曾經|故事|[转轉][述載载]|[说說写寫问問][道到]?[：:]|这句|這句|[口标標]号|[标標]語)|\b(?:not|never|avoid|don['’]t|do not|used to|remember when|how to|he said|she said|they said|someone said|they asked|she asked|he asked|the (?:post|sign|example|caption) (?:says|reads|said)|wrote|slogan|example|tutorial|advice|scam|giveaway|sponsored)\b|募集していません|募集しません|募集してない|募集しない|フォロバしません|しないで|と言[いうっ]|って言|とは|例えば|詐欺|解説|応募条件|プレゼント企画/iu;
const zh=/^(?:(?:(?:大家|各位|朋友们|朋友們|新朋友|同频的朋友|同頻的朋友|蓝\s*v(?:朋友|活人)?|藍\s*v(?:朋友|活人)?|还在更推的|還在更推的)\s*)?(?:(?:欢迎|歡迎|快|一起|都|也|继续|繼續|不妨)\s*)*(?:来|來)(?:一起)?(?:交|浇|澆)(?:个|個|点|點|些)?(?:新)?朋友|(?:真[诚誠]|[诚誠]信)(?:交友|浇友|澆友|互[关關粉])|(?:(?:蓝\s*v|藍\s*v)(?:活人)?\s*)?(?:有[关關]必回|[关關]注必回(?:[关關])?|[关關]注我(?:必|秒|就)回[关關])|(?:欢迎|歡迎|求|一起|在线|在線|来一波|來一波)(?:蓝\s*v|藍\s*v)?互[关關粉]|(?:我(?:也)?(?:想|想要|希望)|想|希望|出来|出來)(?:在这[里裡]|在這[里裡])?(?:交|认识|認識)(?:一些|几个|幾個|点|點|个|個|更多|几个志同道合的)?(?:新朋友|朋友)|(?:有(?:没有|沒有)|有没有)(?:人|朋友)(?:想|愿意|願意)(?:和|跟)我交(?:个|個)?朋友|(?:想|愿意|願意)(?:互[关關]|交朋友)的(?:小伙伴|朋友)(?:们|們)?(?:可以)?(?:来|來)?(?:在)?(?:评论区|評論區)(?:留言|打个招呼|打個招呼)|(?:欢迎|歡迎)(?:大家|同好|新朋友)(?:来|來)?(?:和我|跟我)?(?:互[关關]|交(?:个|個)?朋友)|蓝\s*v朋友欢迎互关)(?:[吧啊呀啦哦哟喔噢哒喽呢了嘛哈哇～~!！\s]|[\p{Emoji_Presentation}\uFE0F])*$/iu;
const en=/^(?:(?:(?:i(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:looking|hoping)\s+(?:for (?:some )?(?:new |active )?(?:friends|mutuals)|to (?:meet|make) (?:some )?new friends)|(?:i (?:want|would love|hope) to (?:make|meet) (?:some )?new friends)|(?:who wants to|anyone want to) be (?:friends|mutuals)|let['’]?s (?:be(?:come)? (?:friends|mutuals)|make (?:some )?new friends)|(?:i(?:['’]ll| will)? follow (?:you |everyone )?back)|follow me (?:and|&) i(?:['’]ll| will)? follow (?:you )?back)(?:\s+(?:here|on [xX]|too|today))?[!\s\p{Emoji_Presentation}\uFE0F]*$/iu;
const ja=/^(?:(?:一緒に|新しい|お|同じ趣味の)?(?:友達|友だち)(?:を|が)?(?:募集|募集中|募集します|募集しています|募集してます|になりませんか|になりましょう)|(?:相互フォロー|フォロバ)(?:募集中|募集します|大歓迎|します))(?:です|ですので)?[!！〜～\s\p{Emoji_Presentation}\uFE0F]*$/u;

export function classifyFriendship(text){
 if(typeof text!=='string')return 'other';
 const value=text.normalize('NFKC').replace(/[\u200B\uFEFF]/gu,'').trim();
 if(!value||!topic.test(value))return 'other';
 const body=value.replace(/https?:\/\/[^\s]+/giu,' ').replace(/#[\p{L}\p{N}_]+/gu,' ');
 if(caution.test(body))return 'review';
 const clauses=body.split(/[\n\r,，、。！？!?；;：:.]+/u).map(s=>s.trim()).filter(Boolean);
 return clauses.some(s=>zh.test(s)||en.test(s)||ja.test(s))?'match':'review';
}
