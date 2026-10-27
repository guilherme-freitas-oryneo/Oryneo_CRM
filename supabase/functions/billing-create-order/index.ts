import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { buildBillingSelection, resolveStripeBillingPrices } from '../_shared/billing/catalog.ts';
import { getBillingEnvironmentConfig } from '../_shared/billing/environment.ts';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origin='https://guilherme-freitas-oryneo.github.io';
const defaultCorsHeaders={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};

const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const token=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const reference=()=>`ORY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
const integrationIdentifier=()=>{const bytes=crypto.getRandomValues(new Uint8Array(8));return 'oryneo_'+Array.from(bytes,v=>String.fromCharCode(97+v%26)).join('')};

Deno.serve(async req=>{
 const requestOrigin=req.headers.get('origin')||'';
 const approvedOrigins=new Set([origin,'https://crm.oryneo.com.br']);
 const headers={...defaultCorsHeaders,'Vary':'Origin','Access-Control-Allow-Origin':approvedOrigins.has(requestOrigin)?requestOrigin:origin};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(requestOrigin&&!approvedOrigins.has(requestOrigin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user}}=await db.auth.getUser(jwt);
 if(!user)return respond({error:'Autenticação necessária.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError){console.error('billing-create-order membership lookup failed',{code:memberError.code,message:memberError.message});return respond({error:'Não foi possível validar seu acesso agora.'},503)}
 if(!member)return respond({error:'Acesso não autorizado.'},403);
 let body:{deal_id?:string;payment_method?:string};try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 if(body.payment_method&&body.payment_method!=='card')return respond({error:'Esta forma de pagamento ainda não foi homologada para propostas comerciais.'},409);
 const {data:deal}=await db.from('crm_records').select('id,data').eq('id',body.deal_id||'').eq('kind','deal').eq('deleted',false).maybeSingle();
 if(!deal)return respond({error:'Oportunidade não encontrada.'},404);
 const data=deal.data as Record<string,any>,quote=data.quote;
 if(!quote?.plan||!quote?.cycle)return respond({error:'Revise e confirme uma proposta antes de preparar a cobrança.'},422);
 let config:ReturnType<typeof getBillingEnvironmentConfig>;
 let prices:Awaited<ReturnType<typeof resolveStripeBillingPrices>>;
 try{
  const environment='live' as const;
  config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
  prices=await resolveStripeBillingPrices(config);
 }catch(error){
  console.error('billing environment/catalog unavailable',{code:error instanceof Error?error.message:'unknown'});
  return respond({error:'A cobrança está temporariamente indisponível para este ambiente.'},503);
 }
 let selection:ReturnType<typeof buildBillingSelection>;
 try{selection=buildBillingSelection({plan:quote.plan,cycle:quote.cycle,addons:(quote.addons||[]).map((a:{key:string})=>a.key)},prices)}catch{return respond({error:'A proposta não corresponde ao catálogo vigente.'},422)}
 // F01: somente a última proposta imutável e aceita habilita o checkout.
 const {data:proposal,error:proposalError}=await db.from('crm_proposals')
  .select('id,status,snapshot,contact_email,expires_at')
  .eq('deal_id',deal.id).order('version',{ascending:false}).limit(1).maybeSingle();
 if(proposalError)return respond({error:'Não foi possível validar o aceite da proposta.'},503);
 if(!proposal||proposal.status!=='accepted')return respond({error:'O cliente precisa aceitar a versão atual da proposta antes da cobrança.'},409);
 const snapshot=proposal.snapshot as {plan?:string;cycle?:string;addons?:string[];amount_total?:number;catalog_version?:string};
 const addons=[...new Set((quote.addons||[]).map((addon:{key:string})=>addon.key))].sort();
 if(snapshot?.plan!==selection.plan||snapshot?.cycle!==selection.cycle||
    JSON.stringify(snapshot.addons)!==JSON.stringify(addons)||
    snapshot.amount_total!==selection.amountTotal||
    snapshot.catalog_version!==selection.catalogVersion||
    proposal.contact_email!==String(data.email||'').trim().toLowerCase())
  return respond({error:'A seleção comercial mudou após o aceite. Emita uma nova versão da proposta.'},409);
 const {data:previous,error:previousError}=await db.from('crm_billing_orders').select('reference')
  .eq('proposal_id',proposal.id).maybeSingle();
 if(previousError)return respond({error:'Não foi possível conferir pedidos anteriores.'},503);
 if(previous)return respond({error:'Já existe um pedido para esta proposta. Revise-o antes de gerar outra cobrança.'},409);
 const publicToken=token(),orderId=crypto.randomUUID(),ref=reference();
 const items=selection.items.map(item=>({key:item.key,label:item.label,detail:item.detail,amount_cents:item.amountCents}));
 const {error:insertError}=await db.from('crm_billing_orders').insert({id:orderId,deal_id:deal.id,proposal_id:proposal.id,reference:ref,public_token_hash:await hash(publicToken),catalog_version:selection.catalogVersion,billing_environment:config.environment,stripe_traffic_renewal_price_id:selection.trafficRenewalPriceId,selection:{plan:selection.plan,cycle:selection.cycle,addons:(quote.addons||[]).map((a:{key:string})=>a.key)},items,amount_total:selection.amountTotal,customer_name:data.contact||'Cliente ORYNEO',customer_email:data.email,company:data.company||data.title,created_by:user.id});
 if(insertError){
  if(insertError.code==='23505')return respond({error:'Este aceite já possui um pedido vinculado.'},409);
  return respond({error:'Não foi possível preparar o pedido.'},503);
 }
 const form=new URLSearchParams();
 form.set('mode','subscription');form.set('ui_mode','elements');form.set('customer_email',String(data.email));
 form.set('integration_identifier',integrationIdentifier());
 form.set('locale','pt-BR');form.set('billing_address_collection','required');
 form.set('return_url',`${origin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(publicToken)}&retorno=1`);
 form.set('metadata[oryneo_order_id]',orderId);form.set('metadata[oryneo_deal_id]',deal.id);
 form.set('metadata[oryneo_billing_environment]',config.environment);
 if(selection.trafficRenewalPriceId)form.set('metadata[oryneo_traffic_renewal_price]',selection.trafficRenewalPriceId);
 form.set('subscription_data[metadata][oryneo_order_id]',orderId);form.set('subscription_data[billing_mode][type]','flexible');
 selection.stripePriceIds.forEach((price,index)=>{form.set(`line_items[${index}][price]`,price);form.set(`line_items[${index}][quantity]`,'1')});
 const stripe=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-order-${config.environment}-${orderId}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
 const session=await stripe.json();
 if(!stripe.ok||!session?.id||session.livemode!==config.livemode){await db.from('crm_billing_orders').update({status:'requires_review'}).eq('id',orderId);return respond({error:'O Stripe não conseguiu preparar o pagamento. Revise a configuração da conta.'},502)}
 await db.from('crm_billing_orders').update({stripe_checkout_session_id:session.id,updated_at:new Date().toISOString()}).eq('id',orderId);
 return respond({ok:true,reference:ref,url:`${origin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(publicToken)}`});
});
