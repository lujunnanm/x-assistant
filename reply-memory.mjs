// Cross-thread reply memory: what this account said to whom, kept across posts.
//
// Pure data helpers shared by the service worker and the tests (no chrome.*, no network).
// Everything stored here is quoted data for the model, never an instruction. Nothing in
// this module submits, edits or rejects a reply: it only supplies context for generation.
//
// Lifecycle (the reply claim ledger stays the single source of truth for "was it sent"):
//   generate  -> stage()      a pending entry keyed by the target post id
//   later     -> reconcile()  confirmed claim -> committed to the author book and the recent list;
//                             released / duplicate claim or an expired entry -> dropped
// Reconciling lazily against the ledger means every settlement route (inline confirm,
// read-back, auto review) feeds memory without any of them knowing about it.
export const MEMORY_KEY='xAssistantReplyMemoryV1';
export const LIMITS=Object.freeze({
  authors:200,        // people remembered per account (most recent contact wins)
  exchanges:3,        // past exchanges kept per person
  recent:60,          // own replies kept for repetition / consistency across posts
  pending:30,
  pendingTtl:24*3600000,
  authorTtl:90*86400000,
  theirs:90,          // characters kept of the other person's comment
  mine:140,           // characters kept of our own reply
  note:60             // characters kept of the model-written note about a person
});
const DAY=86400000;
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const handleOf=value=>typeof value==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(value)?value.toLowerCase():null;
const idOf=value=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:null;
const stamp=value=>Number.isFinite(value)&&value>0?Math.floor(value):0;
const CONTROL=/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

export function clip(value,limit){
  const text=String(value??'').replace(CONTROL,' ').replace(/\s+/g,' ').trim();
  const chars=[...text];
  return chars.length>limit?chars.slice(0,limit-1).join('')+'…':text;
}
const daysAgo=(at,now)=>Math.max(0,Math.round((now-at)/DAY*10)/10);

// Dice coefficient over character bigrams: cheap topical overlap that works for CJK and Latin text.
const grams=text=>{
  const chars=[...String(text??'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'')],set=new Set();
  for(let i=0;i<chars.length-1;i++)set.add(chars[i]+chars[i+1]);
  return set;
};
export function similarity(a,b){
  const x=grams(a),y=grams(b);
  if(!x.size||!y.size)return 0;
  let shared=0;for(const gram of x)if(y.has(gram))shared++;
  return 2*shared/(x.size+y.size);
}

// What a person typically starts a sentence with: the first two CJK characters or the first Latin word.
const opener=text=>{
  const body=String(text??'').replace(/^[\s\p{P}\p{S}]+/u,'');
  if(/^[㐀-鿿]/.test(body))return [...body].slice(0,2).join('');
  return (body.match(/^[A-Za-z']+/)?.[0]||'').toLowerCase();
};
export function repeatedOpeners(texts,{min=2,max=3}={}){
  const counts=new Map();
  for(const text of texts){const key=opener(text);if([...key].length>=2)counts.set(key,(counts.get(key)||0)+1);}
  return [...counts].filter(([,n])=>n>=min).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([key])=>key);
}

const exchange=value=>{
  const postId=idOf(value?.postId),at=stamp(value?.at);
  return postId&&at?{at,postId,rootId:idOf(value.rootId)||postId,theirs:clip(value.theirs,LIMITS.theirs),mine:clip(value.mine,LIMITS.mine)}:null;
};
const recentEntry=value=>{
  const postId=idOf(value?.postId),to=handleOf(value?.to),at=stamp(value?.at);
  return postId&&to&&at&&clip(value.mine,1)?{at,postId,to,theirs:clip(value.theirs,LIMITS.theirs),mine:clip(value.mine,LIMITS.mine)}:null;
};
const pendingEntry=(id,value)=>{
  const postId=idOf(id),author=handleOf(value?.author),at=stamp(value?.at);
  return postId&&author&&at&&clip(value.mine,1)?{at,author,rootId:idOf(value.rootId)||postId,theirs:clip(value.theirs,LIMITS.theirs),mine:clip(value.mine,LIMITS.mine),note:clip(value.note,LIMITS.note)}:null;
};

export const emptyAccount=()=>({version:1,authors:{},recent:[],pending:{}});

// Storage is untrusted input: coerce, clip and drop anything malformed.
export function normalizeAccount(raw){
  const account=emptyAccount();
  if(!isObject(raw))return account;
  if(isObject(raw.authors))for(const [name,entry] of Object.entries(raw.authors)){
    const handle=handleOf(name);if(!handle||!isObject(entry))continue;
    account.authors[handle]={
      n:Math.max(0,Math.floor(Number(entry.n))||0),first:stamp(entry.first),last:stamp(entry.last),note:clip(entry.note,LIMITS.note),
      exchanges:(Array.isArray(entry.exchanges)?entry.exchanges:[]).map(exchange).filter(Boolean).slice(-LIMITS.exchanges)
    };
  }
  account.recent=(Array.isArray(raw.recent)?raw.recent:[]).map(recentEntry).filter(Boolean).slice(-LIMITS.recent);
  if(isObject(raw.pending))for(const [id,entry] of Object.entries(raw.pending)){const value=pendingEntry(id,entry);if(value)account.pending[id]=value;}
  return account;
}

function prune(account,now){
  for(const [id,entry] of Object.entries(account.pending))if(now-entry.at>LIMITS.pendingTtl)delete account.pending[id];
  account.pending=Object.fromEntries(Object.entries(account.pending).sort((a,b)=>b[1].at-a[1].at).slice(0,LIMITS.pending));
  account.authors=Object.fromEntries(Object.entries(account.authors)
    .filter(([,entry])=>now-entry.last<=LIMITS.authorTtl).sort((a,b)=>b[1].last-a[1].last).slice(0,LIMITS.authors));
  return account;
}

// Remember a generated (not yet confirmed) reply. The note is the model's optional memory_note.
export function stage(raw,{postId,author,rootId,theirs,mine,note},now=Date.now()){
  const account=normalizeAccount(raw),entry=pendingEntry(postId,{at:now,author,rootId,theirs,mine,note});
  if(entry)account.pending[idOf(postId)]=entry;
  return prune(account,now);
}

function commit(account,postId,entry,at){
  const person=account.authors[entry.author]??={n:0,first:at,last:at,note:'',exchanges:[]};
  person.n+=1;person.last=at;person.first||=at;
  if(entry.note)person.note=entry.note;
  person.exchanges=[...person.exchanges,{at,postId,rootId:entry.rootId,theirs:entry.theirs,mine:entry.mine}].slice(-LIMITS.exchanges);
  account.recent=[...account.recent,{at,postId,to:entry.author,theirs:entry.theirs,mine:entry.mine}].slice(-LIMITS.recent);
}

// claims: this account's reply claim ledger, keyed by target post id.
export function reconcile(raw,claims,now=Date.now()){
  const account=normalizeAccount(raw);
  for(const [postId,entry] of Object.entries(account.pending)){
    const claim=claims?.[postId];
    if(claim?.status==='confirmed'){commit(account,postId,entry,stamp(claim.at)||now);delete account.pending[postId];}
    else if(['released','duplicate_skipped'].includes(claim?.status))delete account.pending[postId];
  }
  return prune(account,now);
}

const view=(entry,kind,now)=>({kind,to:entry.to,days_ago:daysAgo(entry.at,now),they_said:entry.theirs,you_said:entry.mine});

// What to show the model for one target. branchIds are the posts already visible in this
// conversation (their replies arrive as confirmed_own_replies), so they are left out here.
export function digest(raw,{author,branchIds=[],targetText='',now=Date.now(),recent=5,related=3,exchanges=3}={}){
  const account=normalizeAccount(raw),handle=handleOf(author),skip=new Set(branchIds.map(String)),out={};
  const person=handle&&account.authors[handle];
  if(person&&(person.n>0||person.note)){
    const earlier=person.exchanges.filter(x=>!skip.has(x.postId)).slice(-exchanges)
      .map(x=>({days_ago:daysAgo(x.at,now),they_said:x.theirs,you_replied:x.mine}));
    out.authorMemory={handle,replied_before:person.n,last_contact_days_ago:daysAgo(person.last,now),
      ...(person.note?{note:person.note}:{}),...(earlier.length?{earlier_exchanges:earlier}:{})};
  }
  const pool=account.recent.filter(x=>!skip.has(x.postId)),latest=pool.slice(-recent).reverse(),used=new Set(latest.map(x=>x.postId));
  const near=targetText?pool.filter(x=>!used.has(x.postId)).map(x=>({x,score:similarity(targetText,x.theirs+' '+x.mine)}))
    .filter(({score})=>score>=0.2).sort((a,b)=>b.score-a.score).slice(0,related).map(({x})=>x):[];
  out.recentOwnReplies=[...latest.map(x=>view(x,'recent',now)),...near.map(x=>view(x,'related',now))];
  out.avoidOpeners=repeatedOpeners(pool.slice(-8).map(x=>x.mine));
  return out;
}

// Reply length follows the other person's length (people answer in kind). A ceiling, not a target.
// What kind of reply to lean toward this time. Left to itself the model turns every
// comment into one polished verdict line, so each request gets a different suggestion.
// It is input only: nothing is checked or rewritten on the way out.
export const SHAPES=Object.freeze({
  react:{weight:18,scale:0.45},  // a reaction, half a sentence, no judgement
  pick:{weight:24,scale:0.75},   // grab one word or detail of theirs and run with it
  add:{weight:14,scale:1},       // add a concrete fact or detail they left out
  ask:{weight:10,scale:0.75},    // ask one real question
  agree:{weight:14,scale:0.8},   // go along with them and add something of your own
  push:{weight:10,scale:0.8},    // disagree in one line, no argument
  joke:{weight:10,scale:0.9}     // the usual ribbing
});
const QUESTION=/[?？]|怎么|如何|为什么|为啥|能不能|可不可以|是不是|有没有/;
export function replyShape(text,random=Math.random){
  const plain=String(text??'').replace(/https?:\/\/\S+/g,'').replace(/(?:^|\s)@\w{1,15}/g,' ').replace(/\s+/g,' ').trim();
  if(!plain)return null;
  // A real question gets an answer-shaped reply, not a bare reaction or a quip.
  const weights=Object.entries(SHAPES).map(([kind,{weight}])=>[kind,QUESTION.test(plain)?(['pick','add','push','agree'].includes(kind)?weight*2:kind==='ask'?weight:0):weight]);
  const total=weights.reduce((sum,[,w])=>sum+w,0),r=random();
  let pick=(Number.isFinite(r)&&r>=0&&r<1?r:0.5)*total;
  for(const [kind,w] of weights){if(pick<w)return {kind};pick-=w;}
  return {kind:'pick'};
}

export function replyBudget(text,random=Math.random){
  const plain=String(text??'').replace(/https?:\/\/\S+/g,'').replace(/(?:^|\s)@\w{1,15}/g,' ').replace(/\s+/g,' ').trim();
  const chars=[...plain],n=chars.length;
  if(!n)return null;
  const wide=chars.filter(c=>/[぀-ヿ㐀-鿿가-힯]/.test(c)).length;
  const base=n<=4?10:n<=10?16:n<=24?26:n<=60?36:n<=140?48:60;
  const asks=/[?？]|怎么|如何|为什么|为啥|能不能|可不可以|是不是|有没有/.test(plain);
  const r=random(),jitter=0.6+0.55*(Number.isFinite(r)&&r>=0&&r<1?r:0.5);
  let max=(asks?Math.max(base,36):base)*jitter;
  if(wide/n<0.3)max*=2.4; // Latin-script text spends more characters per idea.
  return {max_chars:Math.max(8,Math.min(180,Math.round(max)))};
}

export function buildVoice(raw,claims,context,{now=Date.now(),random=Math.random}={}){
  try{
    const account=reconcile(raw,claims,now),target=context.target;
    const d=digest(account,{author:target.author,branchIds:[context.root,...context.history,target].map(row=>row.id),targetText:target.text,now});
    const shape=replyShape(target.text,random);
    let budget=replyBudget(target.text,random);
    if(budget&&shape)budget={max_chars:Math.max(8,Math.round(budget.max_chars*SHAPES[shape.kind].scale))};
    const voice={...(budget?{replyBudget:budget}:{}),...(shape?{replyShape:shape}:{}),...(d.authorMemory?{authorMemory:d.authorMemory}:{}),
      ...(d.recentOwnReplies.length?{recentOwnReplies:d.recentOwnReplies}:{}),...(d.avoidOpeners.length?{avoidOpeners:d.avoidOpeners}:{})};
    return Object.keys(voice).length?voice:undefined;
  }catch{return undefined;} // Memory is a convenience: it must never block a reply.
}

// The adapter re-validates everything it is handed before it reaches the prompt.
export function normalizeVoice(value){
  if(!isObject(value))return undefined;
  const out={},budget=value.replyBudget;
  if(isObject(budget)&&Number.isInteger(budget.max_chars)&&budget.max_chars>=4&&budget.max_chars<=180)out.replyBudget={max_chars:budget.max_chars};
  if(isObject(value.replyShape)&&Object.hasOwn(SHAPES,value.replyShape.kind))out.replyShape={kind:value.replyShape.kind};
  const memory=value.authorMemory;
  if(isObject(memory)&&handleOf(memory.handle)){
    const earlier=(Array.isArray(memory.earlier_exchanges)?memory.earlier_exchanges:[]).slice(0,LIMITS.exchanges)
      .filter(isObject).map(x=>({days_ago:Math.max(0,Number(x.days_ago)||0),they_said:clip(x.they_said,LIMITS.theirs),you_replied:clip(x.you_replied,LIMITS.mine)}));
    out.authorMemory={handle:handleOf(memory.handle),replied_before:Math.max(0,Math.floor(Number(memory.replied_before))||0),
      last_contact_days_ago:Math.max(0,Number(memory.last_contact_days_ago)||0),
      ...(clip(memory.note,LIMITS.note)?{note:clip(memory.note,LIMITS.note)}:{}),...(earlier.length?{earlier_exchanges:earlier}:{})};
  }
  const rows=(Array.isArray(value.recentOwnReplies)?value.recentOwnReplies:[]).slice(0,8).filter(isObject)
    .filter(x=>['recent','related'].includes(x.kind)&&clip(x.you_said,1))
    .map(x=>({kind:x.kind,to:handleOf(x.to)||'',days_ago:Math.max(0,Number(x.days_ago)||0),they_said:clip(x.they_said,LIMITS.theirs),you_said:clip(x.you_said,LIMITS.mine)}));
  if(rows.length)out.recentOwnReplies=rows;
  const openers=(Array.isArray(value.avoidOpeners)?value.avoidOpeners:[]).map(x=>clip(x,8)).filter(Boolean).slice(0,3);
  if(openers.length)out.avoidOpeners=openers;
  return Object.keys(out).length?out:undefined;
}

export const stats=raw=>{const a=normalizeAccount(raw);return {authors:Object.keys(a.authors).length,replies:a.recent.length,pending:Object.keys(a.pending).length};};
