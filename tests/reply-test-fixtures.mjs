export const withContext=post=>({...post,context:{version:1,root:{id:post.id,author:'writer',text:post.text,parentId:null},history:[],target:{id:post.id,author:'writer',text:post.text,parentId:null}}});
export const fixtureImageBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
export const fixtureImageResponse=()=>new Response(Uint8Array.from(atob(fixtureImageBase64),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});
