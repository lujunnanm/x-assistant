import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeZhihuImageUrl,fetchZhihuImages} from '../zhihu-images.mjs';
import {inlineZhihuImages} from '../reply-images.mjs';
const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cQAAAABJRU5ErkJggg==',bytes=Buffer.from(base64,'base64');
const response=()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});
test('normalizes only supported Zhihu CDN image URLs without query tracking',()=>{
 assert.equal(normalizeZhihuImageUrl('https://picx.zhimg.com/v2-a.png?source=x'),'https://picx.zhimg.com/v2-a.png');
 for(const url of ['http://picx.zhimg.com/a.png','https://zhimg.com/a.png','https://evil.zhimg.com/a.png','https://picx.zhimg.com/a.svg','https://picx.zhimg.com/a.png#x'])assert.throws(()=>normalizeZhihuImageUrl(url));
});
test('selected images download without credentials or referrer and become posting data',async()=>{
 const calls=[],result=await fetchZhihuImages(['https://picx.zhimg.com/v2-a.png?source=x'],async(url,opts)=>{calls.push({url,opts});return response();},async()=>({width:1,height:1,close(){}}));
 assert.equal(result[0],'data:image/png;base64,'+base64);assert.equal(calls[0].url,'https://picx.zhimg.com/v2-a.png');assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.referrerPolicy,'no-referrer');
});
test('DeepSeek vision receives numbered candidate images as inline bytes, not remote URLs',async()=>{
 const content=[{type:'text',text:'回答图片 1'},{type:'image_url',image_url:{url:'https://pic1.zhimg.com/v2-a.png',detail:'auto'}}],calls=[];
 const result=await inlineZhihuImages(content,{fetcher:async(url,opts)=>{calls.push({url,opts});return response();}});
 assert.equal(result[1].image_url.url,'data:image/png;base64,'+base64);assert.equal(calls.length,1);assert.equal(content[1].image_url.url,'https://pic1.zhimg.com/v2-a.png');
});
test('failed or oversized selected image aborts instead of saving a partial set',async()=>{
 await assert.rejects(fetchZhihuImages(['https://picx.zhimg.com/a.png'],async()=>new Response('',{status:404})),/未加入文案库/);
 await assert.rejects(fetchZhihuImages(['https://picx.zhimg.com/a.png'],async()=>new Response(bytes,{headers:{'content-type':'image/png','content-length':String(6*1024*1024)}})),/超过 5 MB/);
});
