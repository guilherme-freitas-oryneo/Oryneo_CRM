import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
const origins = new Set(['https://oryneo-lp-preview.guilherme-frei160023.chatgpt.site','https://oryneo.com.br','https://www.oryneo.com.br','https://guilherme-freitas-oryneo.github.io']);
const url=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return response({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return response({error:'Método não permitido.'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>20000)return response({error:'Solicitação muito longa.'},413);
  const reader=req.body?.getReader();if(!reader)return response({error:'Solicitação inválida.'},400);
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20000){await reader.cancel();return response({error:'Solicitação muito longa.'},413)}chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  const text=(key:string,max:number)=>typeof body[key]==='string'?body[key].trim().slice(0,max):'';
  if(body.website)return response({ok:true});
  if(body.consent!==true||!text('contact',160)||(text('email',254)&&!/^\S+@\S+\.\S+$/.test(text('email',254)))||text('phone',40).replace(/\D/g,'').length<10||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id||''))return response({error:'Confira os dados e autorize o contato.'},400);
  const fingerprint=await digest(text('phone',40).replace(/\D/g,'')+service);
  const {error}=await db.rpc('crm_intake',{p_request_id:body.request_id,p_fingerprint:fingerprint,p_data:{title:('Solicitação · '+(text('company',140)||text('contact',140))).slice(0,160),company:text('company',160),contact:text('contact',160),email:text('email',254).toLowerCase(),phone:text('phone',40),notes:text('summary',11000)+'\n\nConsentimento de contato registrado em '+new Date().toISOString()+'.\nValor a qualificar pela equipe comercial.',due_date:''}});
  if(error)return response({error:error.message.includes('Muitas solicitações')?'Muitas solicitações. Tente novamente mais tarde.':'Não foi possível registrar agora. Tente novamente.'},error.message.includes('Muitas solicitações')?429:503);
  return response({ok:true});
 }catch{return response({error:'Solicitação inválida.'},400)}
});
