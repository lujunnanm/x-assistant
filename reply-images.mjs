import {createAIError} from './ai-recovery.mjs';
import {normalizeTimelineImageUrl} from './posting-copy.mjs';
import {normalizeZhihuImageUrl} from './zhihu-images.mjs';

// DeepSeek inline limits apply to decoded images and the complete UTF-8 body.
export const REPLY_IMAGE_MAX_BYTES=32*1024*1024;
export const REPLY_BODY_MAX_BYTES=48*1024*1024;
const utf8Bytes=value=>new TextEncoder().encode(value).byteLength;
function matchesType(bytes,mime){
 const head=String.fromCharCode(...bytes.subarray(0,12));
 return mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
  mime==='image/png'?head.startsWith('\x89PNG\r\n\x1a\n'):
  mime==='image/gif'?/^GIF8[79]a/.test(head):
  mime==='image/webp'&&head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';
}
async function readImage(url,{fetcher,signal,maxDataLength}){
 try{
  signal?.throwIfAborted();
  // Public CDN request only: never send the API key, X cookies or a Referer.
  const response=await fetcher(url,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal});
  signal?.throwIfAborted();
  if(!response.ok||response.redirected||!response.body){
   await response.body?.cancel().catch(()=>{});throw createAIError('image_read');
  }
  const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png','image/gif','image/webp'].includes(mime)){
   await response.body.cancel().catch(()=>{});throw createAIError('image_format');
  }
  const prefix='data:'+mime+';base64,',fits=length=>length<=REPLY_IMAGE_MAX_BYTES&&prefix.length+4*Math.ceil(length/3)<=maxDataLength;
  if(!fits(Number(response.headers.get('content-length'))||0)){
   await response.body.cancel().catch(()=>{});throw createAIError('image_limit');
  }
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{
   for(;;){
    signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;
    length+=value.byteLength;if(!fits(length))throw createAIError('image_limit');chunks.push(value);
   }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(!length||!matchesType(bytes,mime))throw createAIError('image_format');
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  signal?.throwIfAborted();return prefix+btoa(binary);
 }catch(error){
  if(signal?.aborted)throw signal.reason;
  if(['image_read','image_format','image_limit'].includes(error?.code))throw error;
  throw createAIError('image_read'); // Do not expose CDN responses or URLs in logs.
 }
}
export async function inlineReplyImages(content,{fetcher=fetch,signal}={}){
 return inlineImages(content,{fetcher,signal,normalize:normalizeTimelineImageUrl});
}
export async function inlineZhihuImages(content,{fetcher=fetch,signal}={}){
 return inlineImages(content,{fetcher,signal,normalize:normalizeZhihuImageUrl});
}
async function inlineImages(content,{fetcher,signal,normalize}){
 if(!Array.isArray(content))return content;
 let used=utf8Bytes(JSON.stringify(content));
 if(used>REPLY_BODY_MAX_BYTES)throw createAIError('image_limit');
 const cache=new Map(),result=[];
 for(const part of content){
  signal?.throwIfAborted();
  if(part.type!=='image_url'){result.push(part);continue;}
  let url;try{url=normalize(part.image_url.url);}catch{throw createAIError('invalid_input');}
  let data=cache.get(url);
  if(!data){data=await readImage(url,{fetcher,signal,maxDataLength:REPLY_BODY_MAX_BYTES-used+part.image_url.url.length});cache.set(url,data);}
  used+=data.length-part.image_url.url.length;
  if(used>REPLY_BODY_MAX_BYTES)throw createAIError('image_limit');
  result.push({...part,image_url:{...part.image_url,url:data}});
 }
 // Cache and image bytes live only in this generation, never in persistent state.
 return result;
}
export function serializeVisionRequest(payload){
 const body=JSON.stringify(payload);
 if(utf8Bytes(body)>REPLY_BODY_MAX_BYTES)throw createAIError('image_limit');
 return body;
}
