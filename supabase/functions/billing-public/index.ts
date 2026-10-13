import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';const headers:Record<string,string>={'Content-Type':'application/json','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 let body:{token?:string};try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 const publicToken=typeof body.token==='string'?body.token:'';if(publicToken.length<40)return respond({error:'Link inválido.'},400);
 const {data:order}=await db.from('crm_billing_orders').select('*').eq('public_token_hash',await hash(publicToken)).maybeSingle();
 if(!order)return respond({error:'Pedido não encontrado.'},404);
 let status=order.status;if(status==='awaiting_payment'&&new Date(order.expires_at).getTime()<Date.now()){status='expired';await db.from('crm_billing_orders').update({status}).eq('id',order.id)}
 let clientSecret:string|null=null;
 if(status==='awaiting_payment'&&order.stripe_checkout_session_id){const stripe=await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}`,{headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')||''}`,'Stripe-Version':'2026-08-26.dahlia'}});const session=await stripe.json();if(stripe.ok){clientSecret=session.client_secret||null;if(session.payment_status==='paid'){status='paid';clientSecret=null;await db.from('crm_billing_orders').update({status:'paid',paid_at:new Date().toISOString(),stripe_customer_id:session.customer||null,stripe_subscription_id:session.subscription||null,stripe_invoice_id:session.invoice||null,updated_at:new Date().toISOString()}).eq('id',order.id)}}}
 const selection=order.selection as {plan:string;cycle:string};
 return respond({order:{reference:order.reference,company:order.company,customer_name:order.customer_name,status,currency:'brl',amount_total:order.amount_total,items:order.items,recurring:{label:`Plano ${selection.plan}`,amount_cents:(order.items as any[])[0]?.amount_cents||0,interval_label:selection.cycle==='annual'?'por ano':'por mês',next_charge_at:null},expires_at:order.expires_at,test_mode:true},client_secret:clientSecret,publishable_key:'pk_test_51UQ90aCi4hhgz3b9Ma0YIjlRWbMTJBfOYVvIpKg7e2OB9zf3bWkSmVqrzWuCYJbvsmoAbRYqq9AX0xMPpQH9gPzV00rtDgVQOp'});
});
