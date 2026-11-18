import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const rulesPath = new URL('../bridge/timeline-rewrite-rules.txt', import.meta.url);
const commentRulesPath = new URL('../bridge/comment-rewrite-rules.txt', import.meta.url);

test('timeline rewrite changes voice and structure while preserving facts and stance', async () => {
  const rules = await readFile(rulesPath, 'utf8');
  assert.match(rules, /保留原文的核心事实、核心立场和主要语言/);
  assert.match(rules, /不保留原文语气/);
  assert.match(rules, /改变开头、叙述顺序、句式和表达节奏/);
  assert.match(rules, /不能只换同义词/);
  assert.match(rules, /每个完整句子单独占一行/);
  assert.match(rules, /行与行之间不要留空行/);
  assert.match(rules, /只改写素材已有内容/);
  assert.match(rules, /先把事实和猜疑分开/);
  assert.match(rules, /不额外补充核查立场、证据要求或安全提示/);
  assert.doesNotMatch(rules, /优先先说结论/);
});

test('comment rewrite fuses both viewpoints into one person’s standalone position', async () => {
  const rules = await readFile(commentRulesPath, 'utf8');
  assert.match(rules, /把所属帖子与评论的核心观点融合/);
  assert.match(rules, /必须同时包含两者的实质信息或观点/);
  assert.match(rules, /像同一个人从头到尾表达自己的完整观点/);
  assert.match(rules, /只允许一个叙述者、一个说话主体、一套语气和一条连贯的逻辑链/);
  assert.match(rules, /不能让读者看出正文来自两个不同的人/);
  assert.match(rules, /重组为这个人的前提、权衡、转折、保留条件或最终判断/);
  assert.match(rules, /所有事实与判断都由同一个人统一表达/);
  assert.match(rules, /不要写成回复、摘要、对话/);
  assert.match(rules, /每个完整句子单独占一行/);
  assert.match(rules, /只改写两份素材已有内容/);
  assert.match(rules, /先把事实和猜疑分开/);
  assert.match(rules, /不额外补充核查立场、证据要求或安全提示/);
  assert.doesNotMatch(rules, /优先先说结论/);
});
