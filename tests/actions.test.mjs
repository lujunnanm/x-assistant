import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {submitCurrentReply,likeOriginalPost,followAuthorOnProfile} from '../actions.mjs';

const run=(fn,args,context)=>vm.runInNewContext(`(${fn})(${args.map(JSON.stringify).join(',')})`,{URL,Promise,setTimeout:r=>r(),...context});

test('reply submits only the exact reviewed draft',async()=>{
 let removed=false,clicks=0;
 const editor={textContent:'exact reply'};
 const link={href:'https://x.com/author/status/1'};
 const button={disabled:false,getAttribute:()=>null,click(){clicks++;removed=true;}};
 const dialog={
  querySelector:s=>s==='[role="dialog"]'?null:s.includes('tweetTextarea_0')?editor:null,
  querySelectorAll:s=>s==='a[href]'?[link]:s.includes('tweetButton')?[button]:[]
 };
 const document={querySelectorAll:()=>[dialog],contains:()=>!removed};
 const ok=await run(submitCurrentReply,['https://x.com/author/status/1','exact reply'],{location:{origin:'https://x.com'},document});
 assert.equal(ok.status,'verified');assert.equal(clicks,1);
 removed=false;clicks=0;
 const bad=await run(submitCurrentReply,['https://x.com/author/status/1','different'],{location:{origin:'https://x.com'},document});
 assert.equal(bad.status,'failed');assert.equal(clicks,0);
});

test('like clicks once, verifies, and skips an existing like',async()=>{
 let liked=false,clicks=0,loads=0;
 const link={href:'https://x.com/author/status/1',querySelector:()=>({})};
 const button={disabled:false,getAttribute:()=>null,scrollIntoView(){},click(){clicks++;liked=true;}};
 const article={querySelectorAll:s=>s==='a[href]'?[link]:s.includes('unlike')?(liked?[button]:[]):s.includes('like')?(!liked?[button]:[]):[]};
 const document={querySelector:()=>null,querySelectorAll:()=>++loads<3?[]:[article]};
 const first=await run(likeOriginalPost,['https://x.com/author/status/1'],{location:{origin:'https://x.com',pathname:'/author/status/1'},document});
 assert.equal(first.status,'verified');assert.equal(clicks,1);
 const second=await run(likeOriginalPost,['https://x.com/author/status/1'],{location:{origin:'https://x.com',pathname:'/author/status/1'},document});
 assert.equal(second.status,'skipped');assert.equal(clicks,1);
});

test('follow targets the exact profile author and verifies',async()=>{
 let following=false,clicks=0;
 const button={disabled:false,scrollIntoView(){},click(){clicks++;following=true;},getAttribute:k=>k==='aria-label'?(following?'正在关注 @author':'关注 @author'):null};
 const document={querySelector:()=>null,querySelectorAll:s=>s==='button'?[button]:[]};
 const first=await run(followAuthorOnProfile,['author'],{location:{origin:'https://x.com',pathname:'/author'},document});
 assert.equal(first.status,'verified');assert.equal(clicks,1);
 const second=await run(followAuthorOnProfile,['author'],{location:{origin:'https://x.com',pathname:'/author'},document});
 assert.equal(second.status,'skipped');assert.equal(clicks,1);
});
