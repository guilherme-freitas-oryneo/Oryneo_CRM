import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {fetchVerifiedHtml} from '../_shared/landing/verified-html.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','http://localhost:4175']);
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return send({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send({error:'Método não permitido.'},405);
 let body:{action?:string;token?:string;name?:string;email?:string;sha256?:string;consent?:boolean};
 try{body=await req.json()}catch{return send({error:'Solicitação inválida.'},400)}
 const token=typeof body.token==='string'?body.token:'';
 if(!/^[A-Za-z0-9_-]{42,50}$/.test(token))return send({error:'Link inválido.'},400);
 const {data:review,error:lookupError}=await db.from('crm_landing_reviews')
 .select('order_id,version,status,preview_url,preview_html_sha256,expires_at,accepted_at,published_url')
 .eq('review_token_hash',await hash(token)).maybeSingle();
 if(lookupError)return send({error:'Revisão indisponível.'},503);
 if(!review)return send({error:'Revisão não encontrada.'},404);
 const {data:order,error:orderError}=await db.from('crm_billing_orders')
 .select('company,customer_name,customer_email,status').eq('id',review.order_id).maybeSingle();
 if(orderError||!order)return send({error:'Dados da solicitação indisponíveis.'},503);
 if(order.status!=='paid')return send({error:'Pedido ainda não confirmado.'},409);
 const {data:latest,error:versionError}=await db.from('crm_landing_reviews')
 .select('version').eq('order_id',review.order_id).order('version',{ascending:false}).limit(1).maybeSingle();
 if(versionError)return send({error:'Não foi possível validar a versão.'},503);
 const effective=latest&&latest.version>review.version?'superseded':
  review.status==='review'&&new Date(review.expires_at).getTime()<=Date.now()?'expired':review.status;
 if(body.action==='read')return send({ok:true,review:{
  version:review.version,status:effective,company:order.company,customer_name:order.customer_name,
  contact_email:order.customer_email,preview_url:review.preview_url,preview_html_sha256:review.preview_html_sha256,
  expires_at:review.expires_at,accepted_at:review.accepted_at,published_url:review.published_url
 }});
 if(body.action!=='accept')return send({error:'Ação desconhecida.'},400);
 if(effective!=='review')return send({error:'Esta revisão já não aceita alterações.'},409);
 const name=typeof body.name==='string'?body.name.trim():'';
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(body.consent!==true||name.length<2||name.length>180||email.length<5||email.length>254||
  typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))
  return send({error:'Revise a página e informe sua confirmação de aceite.'},422);
 const checked=await fetchVerifiedHtml(review.preview_url);
 if(!checked||checked.sha256!==review.preview_html_sha256||body.sha256!==review.preview_html_sha256)
  return send({error:'A página foi modificada após o envio. Solicite uma nova versão.'},409);
 const {data:accepted,error:acceptError}=await db.rpc('crm_approve_landing_review',{
  p_order_id:review.order_id,p_version:review.version,p_preview_html_sha256:checked.sha256,
  p_name:name,p_email:email
 });
 if(acceptError)return send({error:'Não foi possível registrar o aceite.'},503);
 if(!accepted?.ok)return send({error:accepted?.reason==='email_mismatch'?
  'O e-mail precisa corresponder ao destinatário.' : 'A revisão não está mais disponível.'},409);
 return send({ok:true,approved:true,version:accepted.version});
});
