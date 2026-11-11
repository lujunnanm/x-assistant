import {POSTING_IMAGE_MAX_BYTES,validatePostingImage} from './posting-copy.mjs';

// Reject truncated MP4s before committing the entire copy. A usable native
// animation has format, track metadata and media data boxes.
function completeMp4(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let tracks=false,media=false;
 for(let offset=0;offset<bytes.length;){
  if(offset+8>bytes.length)return false;
  const size=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  const end=size===0?bytes.length:offset+size;
  if(end<offset+8||end>bytes.length)return false;
  if(end>offset+8){tracks||=type==='moov';media||=type==='mdat';}
  offset=end;
 }
 return tracks&&media;
}

// Only call with the canonical CDN URLs returned by validateTimelinePostingSource.
export async function fetchTimelineImages(urls=[],fetcher=fetch,decode=globalThis.createImageBitmap){
 const images=[];
 for(const [i,url] of urls.entries()){
  try{
   const response=await fetcher(url,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});
   const mime=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
   const nativeGif=url.startsWith('https://video.twimg.com/tweet_video/'),gifFile=url.includes('?format=gif&');
   const types=nativeGif?['video/mp4']:gifFile?['image/gif']:['image/jpeg','image/png','image/webp'];
   if(!response.ok||!types.includes(mime)||
      Number(response.headers.get('content-length'))>POSTING_IMAGE_MAX_BYTES||!response.body)throw Error('invalid image response');
   const reader=response.body.getReader(),parts=[];let length=0;
   try{
    for(;;){
     const {done,value}=await reader.read();if(done)break;
     length+=value.byteLength;if(length>POSTING_IMAGE_MAX_BYTES)throw Error('image limit');
     parts.push(value);
    }
   }finally{await reader.cancel().catch(()=>{});}
   const blob=new Blob(parts,{type:mime});
   const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
   if(nativeGif&&!completeMp4(bytes))throw Error('incomplete MP4');
   for(let j=0;j<bytes.length;j+=32768)binary+=String.fromCharCode(...bytes.subarray(j,j+32768));
   const data=validatePostingImage('data:'+mime+';base64,'+btoa(binary));
   if(!nativeGif){
    const bitmap=await decode(blob);
    try{if(!bitmap.width||!bitmap.height)throw Error('invalid image dimensions');}finally{bitmap.close();}
   }
   images.push(data);
  }catch{throw Error('第 '+(i+1)+' 个附件读取失败（可能不可用或超过 5 MB），未加入文案库');}
 }
 return images;
}
