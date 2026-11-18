import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePostingCopies,postingCopyOperation,parsePostingPackage,classifyPostingImport,eligiblePostingCopies,cleanPostingPublishText,POSTING_LIBRARY_MAX_BYTES} from '../posting-copy.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==';
const row=(patch={})=>({id:'news_1',text:'第一行\n第二行',enabled:true,newsId:'source_1',variantId:'c1',sourceUrls:['https://example.com/news'],createdAt:'2026-11-05T00:00:00.000Z',...patch});

test('v3-style package keeps content metadata but strips obsolete workflow fields',()=>{
 const legacy=row({text:'  原文\r\n换行  ',enabled:false,status:'draft',targetAccount:'/owner',publishMode:'once',expiresAt:'2026-11-06T00:00:00.000Z'});
 const parsed=parsePostingPackage({schema:'sacred-plan-content-package',version:1,rows:[legacy]})[0];
 assert.equal(parsed.text,'  原文\n换行  ');assert.equal(parsed.enabled,true);
 for(const key of ['status','targetAccount','publishMode','expiresAt','publishedAt','postUrl'])assert.equal(parsed[key],undefined);
 assert.equal(parsed.newsId,'source_1');assert.equal(parsed.variantId,'c1');assert.deepEqual(parsed.sourceUrls,['https://example.com/news']);
 assert.equal(validatePostingCopies([row({image:'post-images/real.png'})])[0].image,'post-images/real.png');
});

test('legacy terminal cards migrate to disabled while ordinary missing enabled defaults on',()=>{
 assert.equal(validatePostingCopies([row({enabled:false,status:'draft'})])[0].enabled,true);
 assert.equal(validatePostingCopies([row({enabled:true,status:'published'})])[0].enabled,false);
 assert.equal(validatePostingCopies([row({enabled:true,status:'unknown'})])[0].enabled,false);
 assert.equal(validatePostingCopies([{id:'plain',text:'普通文案'}])[0].enabled,true);
 assert.equal(validatePostingCopies([row({enabled:false,status:'ready'})])[0].enabled,false);
});
test('new import enables ordinary disabled and ready rows without re-enabling existing manually stopped rows',()=>{
 const incoming=[row({id:'new',enabled:false}),row({id:'ready',text:'待发布',variantId:'c2',enabled:false,status:'ready'}),row({id:'terminal',text:'未知',variantId:'c3',status:'unknown'})];
 assert.deepEqual(parsePostingPackage(incoming).map(row=>row.enabled),[true,true,false]);
 const existing=row({id:'old',text:'保留停用',variantId:'c4',enabled:false});
 const result=classifyPostingImport([existing],JSON.stringify(incoming));
 assert.deepEqual(result.rows.map(row=>row.enabled),[false,true,true,false]);
 const saved=postingCopyOperation({revision:1,rows:[existing]},{action:'merge',expectedRevision:1,rows:JSON.stringify(incoming)});
 assert.deepEqual(saved.rows,result.rows);
});

test('published text removes the AI image caption and source-only link without touching正文 links',()=>{
 const source='https://example.com/news';
 assert.equal(cleanPostingPublishText('正文\n\n（AI概念配图）\n'+source,[source]),'正文');
 assert.equal(cleanPostingPublishText('正文\n\n(AI概念配图)\n\n'+source),'正文');
 assert.equal(validatePostingCopies([row({text:'正文\n\n'+source})])[0].text,'正文');
 assert.equal(validatePostingCopies([row({text:'正文含链接 '+source})])[0].text,'正文含链接 '+source);
 assert.equal(validatePostingCopies([row({text:'正文\n\nhttps://other.example/item'})])[0].text,'正文\n\nhttps://other.example/item');
 assert.throws(()=>validatePostingCopies([row({text:'（AI概念配图）\n'+source,sourceUrls:[]})]),/文案无效/);
});

test('images, sources and provenance remain strictly validated',()=>{
 for(const input of [{schema:'other',rows:[row()]},{schema:'sacred-plan-content-package',version:2,rows:[row()]},'not JSON'])assert.throws(()=>parsePostingPackage(input));
 for(const image of ['https://example.com/a.png','post-images/../a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YWJjZA==','data:image/png;base64,%%%','data:image/jpeg;base64,/9j/AA==x','data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(5*1024*1024)]).toString('base64')])assert.throws(()=>validatePostingCopies([row({image})]));
 for(const patch of [{sourceUrls:['javascript:alert(1)']},{sourceUrls:['https://u:p@example.com']},{createdAt:'yesterday'},{variantId:'bad/slash'},{variantId:'a',candidateId:'b'},{variantId:'a',newsId:undefined},{imageAssetId:'../image'}])assert.throws(()=>validatePostingCopies([row(patch)]));
 const alias=parsePostingPackage([row({variantId:undefined,candidateId:'angle_1',imageAssetId:'image_1'})])[0];assert.equal(alias.variantId,'angle_1');assert.equal(alias.candidateId,undefined);
});

test('merge permits three variants of one news and rejects exact or same-variant duplicates',()=>{
 const variants=['c1','c2','c3'].map((variantId,i)=>row({id:'row_'+variantId,variantId,text:'角度 '+(i+1)}));
 const first=classifyPostingImport([],variants);assert.equal(first.added,3);assert.equal(first.rows.length,3);
 const again=classifyPostingImport(first.rows,variants);assert.equal(again.added,0);assert.equal(again.duplicate,3);
 const renamed=classifyPostingImport(first.rows,[{...variants[1],id:'renamed',text:'同变体改文案'}]);assert.equal(renamed.duplicate,1);
 const exactBody=classifyPostingImport(first.rows,[{...variants[1],id:'new_variant',variantId:'c4'}]);assert.equal(exactBody.duplicate,1);
 const conflict=classifyPostingImport(first.rows,[{...variants[0],text:'同 ID 不同内容'}]);assert.deepEqual(conflict.conflicts,['row_c1']);
});

test('CAS edits any stopped row and eligibility depends only on enabled',()=>{
 const disabled=row({enabled:false,status:'published'}),state={revision:1,rows:validatePostingCopies([disabled])},existing=state.rows[0];
 const next=postingCopyOperation(state,{action:'upsert',expectedRevision:1,id:existing.id,expected:existing,row:{...existing,enabled:true}});
 assert.equal(next.rows[0].enabled,true);assert.equal(next.rows[0].status,undefined);
 assert.equal(eligiblePostingCopies(next.rows).length,1);assert.equal(eligiblePostingCopies([{...next.rows[0],enabled:false}]).length,0);
 assert.throws(()=>postingCopyOperation(next,{action:'clear',expectedRevision:1}),/已变化/);
});

test('library byte cap measures embedded image payload',()=>{
 const huge='A'.repeat(POSTING_LIBRARY_MAX_BYTES);assert.throws(()=>validatePostingCopies([{id:'huge',text:huge,enabled:true}]),/无效/);
 const many=Array.from({length:3400},(_,i)=>({id:'r'+i,text:'x'.repeat(9990),enabled:true}));assert.throws(()=>validatePostingCopies(many),/32 MB/);
});
