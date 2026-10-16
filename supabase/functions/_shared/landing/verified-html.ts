// Static hosting allowlist prevents SSRF and binds approval to actual HTML bytes.
const allowedHost='guilherme-freitas-oryneo.github.io';
export function parseOryneoPreviewUrl(value:string):string|null {
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!==allowedHost||url.port||url.username||url.password||
     url.search||url.hash||!url.pathname.startsWith('/Oryneo_CRM/'))return null;
  return url.toString();
 }catch{return null}
}
export async function fetchVerifiedHtml(raw:string):Promise<{url:string;sha256:string}|null>{
 const url=parseOryneoPreviewUrl(raw);
 if(!url)return null;
 let response:Response;
 try{response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(9500),
  headers:{'Accept':'text/html'}})}catch{return null}
 if(!response.ok||response.status!==200||
   !response.headers.get('content-type')?.toLowerCase().includes('text/html'))return null;
 const reader=response.body?.getReader();
 if(!reader)return null;
 const parts:Uint8Array[]=[];let count=0;
 try{while(true){
  const chunk=await reader.read();if(chunk.done)break;
  count+=chunk.value.byteLength;
  if(count>350000){await reader.cancel();return null}
  parts.push(chunk.value);
 }}catch{return null}
 if(count<100)return null;
 const bytes=new Uint8Array(count);let at=0;
 for(const part of parts){bytes.set(part,at);at+=part.length}
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return{url,sha256:Array.from(digest).map(x=>x.toString(16).padStart(2,'0')).join('')};
}
