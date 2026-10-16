import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 let body:{token?:string};try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 const token=typeof body.token==='string'?body.token:'';
 if(!/^[A-Za-z0-9_-]{42,50}$/.test(token))return respond({error:'Link inválido.'},400);
 const {data:order,error:lookupError}=await db.from('crm_billing_orders')
  .select('id,status,reference,company,customer_name,selection')
  .eq('public_token_hash',await hash(token)).maybeSingle();
 if(lookupError)return respond({error:'Consulta indisponível.'},503);
 if(!order)return respond({error:'Link não encontrado.'},404);
 if(order.status!=='paid')return respond({error:'A implantação poderá ser acompanhada após a confirmação do pagamento.'},409);
 const {data:project,error:projectError}=await db.from('crm_delivery_projects')
  .select('status,started_at,completed_at,created_at,updated_at').eq('order_id',order.id).maybeSingle();
 if(projectError)return respond({error:'Não foi possível carregar sua implantação.'},503);
 if(!project)return respond({error:'A preparação da implantação ainda não foi registrada. Fale com a ORYNEO.'},503);
 const {data:milestones,error:milestoneError}=await db.from('crm_delivery_milestones')
  .select('id,position,title,state,due_at,note,completed_at,updated_at')
  .eq('order_id',order.id).order('position');
 if(milestoneError)return respond({error:'Não foi possível consultar os marcos.'},503);
 return respond({ok:true,order:{reference:order.reference,company:order.company,customer_name:order.customer_name,
  plan:(order.selection as {plan?:string})?.plan||'ORYNEO'},
  project,milestones:milestones||[]});
});
