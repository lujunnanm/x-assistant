import {POSTING_IMAGE_MAX_BYTES,validatePostingImage} from './posting-copy.mjs';

export function normalizeZhihuImageUrl(value){
 let url;try{if(typeof value==='string'&&value.length<=2048)url=new URL(value);}catch{}
 if(url?.protocol!=='https:'||url.username||url.password||url.hash||
    !/^(?:pic|pica|picb|picx|pic[1-4])\.zhimg\.com$/.test(url.hostname)||
    !/\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname))throw Error('不是受支持的知乎回答图片');
 return url.origin+url.pathname;
}

export async function fetchZhihuImages(urls=[],fetcher=fetch,decode=globalThis.createImageBitmap){
 const images=[];
 for(const [i,raw] of urls.entries()){
  try{
   const url=normalizeZhihuImageUrl(raw);
   const response=await fetcher(url,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});
   const mime=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
   if(!response.ok||response.redirected||!['image/jpeg','image/png','image/webp','image/gif'].includes(mime)||
      Number(response.headers.get('content-length'))>POSTING_IMAGE_MAX_BYTES||!response.body)throw Error('invalid image response');
   const reader=response.body.getReader(),parts=[];let length=0;
   try{
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>POSTING_IMAGE_MAX_BYTES)throw Error('image limit');parts.push(value);}
   }finally{await reader.cancel().catch(()=>{});}
   const blob=new Blob(parts,{type:mime}),bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
   for(let j=0;j<bytes.length;j+=32768)binary+=String.fromCharCode(...bytes.subarray(j,j+32768));
   const data=validatePostingImage('data:'+mime+';base64,'+btoa(binary));
   if(mime!=='image/gif'){
    const bitmap=await decode(blob);try{if(!bitmap.width||!bitmap.height)throw Error('invalid dimensions');}finally{bitmap.close();}
   }
   images.push(data);
  }catch{throw Error('选中的第 '+(i+1)+' 张知乎配图读取失败（可能不可用或超过 5 MB），未加入文案库');}
 }
 return images;
}
