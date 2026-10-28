import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://crm.oryneo.com.br','https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user}}=await db.auth.getUser(jwt);
 if(!user)return respond({error:'Autenticação necessária.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError)return respond({error:'Não foi possível conferir as permissões.'},503);
 if(!member)return respond({error:'Acesso não autorizado.'},403);
 let body:{order_id?:string;milestone_id?:string;state?:string;due_at?:string|null;note?:string|null};
 try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 if(typeof body.order_id!=='string'||typeof body.milestone_id!=='string'
  ||!/^[0-9a-f-]{36}$/i.test(body.order_id)||!/^[0-9a-f-]{36}$/i.test(body.milestone_id)
  ||!['pending','in_progress','completed','blocked'].includes(body.state||''))return respond({error:'Informe um marco e estado válidos.'},422);
 const {data:order,error:orderError}=await db.from('crm_billing_orders').select('id,status').eq('id',body.order_id).maybeSingle();
 if(orderError)return respond({error:'Pedido indisponível.'},503);
 if(!order||order.status!=='paid')return respond({error:'A implantação só pode avançar após pagamento confirmado.'},409);
 const {data:result,error:progressError}=await db.rpc('crm_update_delivery_milestone',{
  p_order_id:order.id,p_milestone_id:body.milestone_id,p_state:body.state,
  p_due_at:body.due_at?new Date(body.due_at).toISOString():null,
  p_note:typeof body.note==='string'?body.note.trim():null,p_actor:user.id
 });
 if(progressError){console.error('Delivery milestone mutation failed',{code:progressError.code});
  return respond({error:'Não foi possível atualizar o marco.'},503)}
 if(!result?.ok)return respond({error:'Marco não encontrado ou atualização inválida.'},422);
 return respond({ok:true,state:result.state});
});
