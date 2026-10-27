import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {fetchVerifiedHtml} from '../_shared/landing/verified-html.ts';
import { crmPublicUrl } from '../_shared/hosting/crm-urls.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://crm.oryneo.com.br','https://guilherme-freitas-oryneo.github.io','http://localhost:4175']);
const token=()=>{const v=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9-]{36}$/i.test(s);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return send({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user}}=await db.auth.getUser(jwt);
 if(!user)return send({error:'Autenticação necessária.'},401);
 const {data:member,error:me}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(me)return send({error:'Acesso indisponível.'},503);
 if(!member)return send({error:'Acesso não autorizado.'},403);
 let body:{action?:string;order_id?:string;version?:number;url?:string};
 try{body=await req.json()}catch{return send({error:'Solicitação inválida.'},400)}
 if(!uuid(body?.order_id))return send({error:'Pedido inválido.'},422);
 const {data:order,error:orderError}=await db.from('crm_billing_orders')
  .select('id,status,selection').eq('id',body.order_id).maybeSingle();
 if(orderError)return send({error:'Pedido indisponível.'},503);
 const addons=(order?.selection as {addons?:string[]}|undefined)?.addons||[];
 if(!order||order.status!=='paid'||!addons.includes('landing-page'))
  return send({error:'Revisão disponível somente para landing contratada e paga.'},409);
 if(body.action==='issue'){
  const checked=await fetchVerifiedHtml(String(body.url||''));
  if(!checked)return send({error:'A prévia deve existir em HTML público e estar publicada no ambiente autorizado.'},422);
  const secret=token();
  const {data:issued,error:issueError}=await db.rpc('crm_issue_landing_review',{
   p_order_id:order.id,p_preview_url:checked.url,p_preview_html_sha256:checked.sha256,
   p_review_token_hash:await hash(secret),p_actor:user.id
  });
  if(issueError||!issued?.ok)return send({error:'Não foi possível emitir revisão versionada.'},503);
  return send({ok:true,version:issued.version,sha256:checked.sha256,
   url:crmPublicUrl('/revisao-lp/?token='+encodeURIComponent(secret),Deno.env.get('ORYNEO_CRM_PUBLIC_BASE'))});
 }
 if(body.action==='publish'){
  if(!Number.isInteger(body.version)||Number(body.version)<1)return send({error:'Versão inválida.'},422);
  const {data:review,error:reviewError}=await db.from('crm_landing_reviews')
   .select('status,preview_html_sha256').eq('order_id',order.id).eq('version',body.version).maybeSingle();
  if(reviewError||!review)return send({error:'Revisão indisponível.'},404);
  if(review.status!=='approved')return send({error:'A prévia precisa de aprovação antes de publicar.'},409);
  const checked=await fetchVerifiedHtml(String(body.url||''));
  if(!checked||checked.sha256!==review.preview_html_sha256)
   return send({error:'O HTML publicado não corresponde à versão aprovada.'},409);
  const {data:published,error:publishError}=await db.rpc('crm_publish_landing_review',{
   p_order_id:order.id,p_version:body.version,p_published_url:checked.url,p_actor:user.id
  });
  if(publishError||!published?.ok)return send({error:'Não foi possível registrar a publicação.'},503);
  return send({ok:true,published_url:checked.url,version:body.version});
 }
 return send({error:'Ação desconhecida.'},400);
});
