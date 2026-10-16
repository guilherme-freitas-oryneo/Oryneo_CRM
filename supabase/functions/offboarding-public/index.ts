import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return send({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send({error:'Método não permitido.'},405);
 let body:{action?:string;token?:string;name?:string;email?:string;type?:string;details?:string};
 try{body=await req.json()}catch{return send({error:'Solicitação inválida.'},400)}
 const token=typeof body.token==='string'?body.token:'';
 if(!/^[A-Za-z0-9_-]{42,50}$/.test(token))return send({error:'Link inválido.'},400);
 const {data:order,error:lookupError}=await db.from('crm_billing_orders')
  .select('id,status,reference,company,customer_name,customer_email')
  .eq('public_token_hash',await hash(token)).maybeSingle();
 if(lookupError)return send({error:'Consulta indisponível.'},503);
 if(!order)return send({error:'Link de pedido não encontrado.'},404);
 if(!['paid','canceled'].includes(order.status))return send({error:'Esse pedido ainda não está habilitado para o procedimento.'},409);
 if(body.action==='read')return send({ok:true,order:{
  reference:order.reference,company:order.company,customer_name:order.customer_name
 }});
 if(body.action!=='request')return send({error:'Ação inválida.'},400);
 const name=typeof body.name==='string'?body.name.trim():'',email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 const details=typeof body.details==='string'?body.details.trim():'';
 if(!['data_export','contract_clarification'].includes(body.type||'')||name.length<2||name.length>180
   ||email.length<5||email.length>254||details.length>1000)return send({error:'Preencha os dados da solicitação.'},422);
 const {data:request,error:requestError}=await db.rpc('crm_request_offboarding',{
  p_order_id:order.id,p_type:body.type,p_name:name,p_email:email,p_details:details
 });
 if(requestError)return send({error:'Solicitação temporariamente indisponível.'},503);
 if(!request?.ok)return send({error:'Não foi possível validar esta solicitação. Confira o e-mail destinatário.'},403);
 return send({ok:true,request_id:request.request_id,already_requested:request.already_requested,
  message:'Solicitação registrada para revisão de identidade pela equipe. Nenhuma exportação automática foi liberada.'});
});
