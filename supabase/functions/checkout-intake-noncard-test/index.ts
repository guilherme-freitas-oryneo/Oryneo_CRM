/**
 * ORYNEO finance QA — exclusively Stripe TEST and isolated QA database RPCs.
 * Does NOT write commercial CRM, customer delivery, email, or LIVE payment data.
 * Authentication: valid Supabase user AND crm_members membership AND order ownership.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {parseDirectCheckoutInput} from '../_shared/billing/direct-checkout.ts';
import {buildBillingSelection,resolveStripeBillingPrices} from '../_shared/billing/catalog.ts';
import {getBillingEnvironmentConfig} from '../_shared/billing/environment.ts';
import {checkStripeMethodAvailability} from '../_shared/billing/stripe-method-availability.ts';
import {createStripeBoletoSubscription,createStripePixCheckout,finalizeStripeBoletoInvoice} from '../_shared/billing/stripe-noncard-service.ts';
import type {PaymentOrderContext,ServerBillingSelection} from '../_shared/billing/stripe-payment-forms.ts';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false},
});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','http://localhost:4175','http://localhost:4173']);
const StripeApiVersion='2026-08-26.dahlia';
const qaEmail='qa@example.com';
const qaName='ORYNEO Homologacao';
const sha256=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(n=>n.toString(16).padStart(2,'0')).join('');
type QaOrder={id:string;reference?:string;method:'pix'|'boleto';state:string;amount_cents:number;environment:'test';currency:'brl';stripe_checkout_session_id:string|null;stripe_customer_id:string|null;stripe_subscription_id:string|null;stripe_invoice_id:string|null};
function errorCode(cause:unknown){return cause instanceof Error?cause.message:'unknown'}
async function stripeRead(path:string,key:string):Promise<Record<string,any>>{
 const r=await fetch('https://api.stripe.com/v1/'+path,{
  headers:{Authorization:'Bearer '+key,'Stripe-Version':StripeApiVersion},
 });
 if(!r.ok)throw Error('QA_STRIPE_READ_UNAVAILABLE_'+r.status);
 const value=await r.json();
 if(value?.livemode!==false||typeof value?.id!=='string')throw Error('QA_STRIPE_ENVIRONMENT_MISMATCH');
 return value;
}
async function loadOrder(orderId:string,userId:string):Promise<QaOrder>{
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orderId))throw Error('QA_ORDER_ID_INVALID');
 const {data,error}=await db.rpc('oryneo_qa_billing_read',{p_order_id:orderId,p_owner_id:userId});
 if(error||!data||data.environment!=='test')throw Error('QA_ORDER_UNAVAILABLE');
 return data as QaOrder;
}
async function reconcile(order:QaOrder,userId:string,key:string){
 const linked=order.method==='pix'?order.stripe_checkout_session_id:order.stripe_invoice_id;
 if(!linked)return {ok:false,reason:'provider_link_pending'};
 let provider:Record<string,any>;
 let providerStatus:string;
 let paid=false;
 let paidAmount=0;
 if(order.method==='pix'){
  provider=await stripeRead('checkout/sessions/'+encodeURIComponent(linked),key);
  if(provider.id!==linked||provider.mode!=='payment'||provider.currency!=='brl'
   ||provider.amount_total!==order.amount_cents
   ||provider.metadata?.oryneo_qa_isolated!=='true'
   ||provider.metadata?.oryneo_order_id!==order.id
   ||!Array.isArray(provider.payment_method_types)||!provider.payment_method_types.includes('pix'))
    throw Error('QA_PIX_PROVIDER_MISMATCH');
  providerStatus=provider.payment_status==='paid'?'paid':
   provider.status==='expired'?'expired':provider.payment_status||'unpaid';
  paid=provider.payment_status==='paid';
  paidAmount=provider.amount_total;
 }else{
  provider=await stripeRead('invoices/'+encodeURIComponent(linked),key);
  if(provider.id!==linked||provider.currency!=='brl'||provider.total!==order.amount_cents
    ||provider.customer!==order.stripe_customer_id)
    throw Error('QA_BOLETO_PROVIDER_MISMATCH');
  if(!order.stripe_subscription_id||!order.stripe_customer_id)throw Error('QA_BOLETO_NOT_LINKED');
  const sub=await stripeRead('subscriptions/'+encodeURIComponent(order.stripe_subscription_id),key);
  const invoiceSub=typeof provider.subscription==='string'?provider.subscription:
   provider.parent?.subscription_details?.subscription;
  if(sub.id!==order.stripe_subscription_id||sub.customer!==order.stripe_customer_id||
    sub.metadata?.oryneo_qa_isolated!=='true'||sub.metadata?.oryneo_order_id!==order.id||
    (invoiceSub&&invoiceSub!==sub.id))
    throw Error('QA_BOLETO_SUBSCRIPTION_MISMATCH');
  providerStatus=provider.status||'unknown';
  paid=providerStatus==='paid'&&provider.paid===true;
  paidAmount=Number(provider.amount_paid||0);
 }
 // Only trusted Stripe TEST GET results reach the service-role reconciliation RPC.
 const eventKey='qa_'+await sha256(JSON.stringify([
  order.id,linked,providerStatus,paid,paidAmount,
 ]));
 const {data,error}=await db.rpc('oryneo_qa_billing_reconcile',{
  p_order_id:order.id,p_owner_id:userId,p_provider_object_id:linked,
  p_provider_status:providerStatus,p_confirmed_paid:paid,p_paid_amount:paidAmount,
  p_event_key:eventKey,
 });
 if(error||!data?.ok)throw Error('QA_RECONCILIATION_UNAVAILABLE');
 return {ok:true,environment:'test',method:order.method,state:data.state,
  duplicate:data.duplicate===true,confirmed_paid:data.state==='paid'};
}

Deno.serve(async(req:Request)=>{
 const requestOrigin=req.headers.get('origin')||'';
 const headers:Record<string,string>={
  'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
 };
 if(origins.has(requestOrigin))headers['Access-Control-Allow-Origin']=requestOrigin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(requestOrigin&&!origins.has(requestOrigin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 if(Number(req.headers.get('content-length')||0)>12000)return respond({error:'Solicitação muito longa.'},413);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!jwt)return respond({error:'Autenticação necessária.'},401);
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return respond({error:'Autenticação inválida.'},401);
 const {data:member,error:memberError}=await db.from('crm_members')
   .select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError)return respond({error:'Acesso indisponível.'},503);
 if(!member)return respond({error:'Acesso não autorizado.'},403);
 try{
  const raw=await req.json();
  const action=raw?.action||'create';
  const config=getBillingEnvironmentConfig('test',name=>Deno.env.get(name));
  if(action==='read'||action==='reconcile'){
   const order=await loadOrder(raw?.order_id,user.id);
   if(action==='read')return respond({ok:true,environment:'test',order});
   return respond(await reconcile(order,user.id,config.secretKey));
  }
  if(action!=='create')return respond({error:'Ação inválida.'},422);
  const input=parseDirectCheckoutInput(raw);
  if(input.payment_method==='card')return respond({error:'Cartão usa o checkout original.'},422);
  if(input.addons.includes('traffic'))return respond({error:'Tráfego trimestral não homologado neste método.'},422);
  const availability=await checkStripeMethodAvailability(input.payment_method,config);
  if(!availability.available)return respond({error:'Método indisponível em TEST.',reason:availability.reason},503);
  const prices=await resolveStripeBillingPrices(config);
  const selection=buildBillingSelection({plan:input.plan,cycle:input.cycle,addons:input.addons},prices);
  const serverSelection:ServerBillingSelection={
   plan:selection.plan,cycle:selection.cycle,amountTotal:selection.amountTotal,
   items:selection.items,trafficRenewalPriceId:selection.trafficRenewalPriceId,
  };
  // No customer PII is retained or sent. TEST uses a non-deliverable example address.
  const quote={plan:selection.plan,cycle:selection.cycle,addons:input.addons,
   catalog_version:selection.catalogVersion,items:selection.items.map(i=>({key:i.key,price:i.stripePriceId,amount:i.amountCents}))};
  const {data:orderRaw,error:createError}=await db.rpc('oryneo_qa_billing_create',{
   p_request_id:input.request_id,p_owner_id:user.id,p_method:input.payment_method,
   p_plan:selection.plan,p_cycle:selection.cycle,p_selection:quote,
   p_quote_fingerprint:await sha256(JSON.stringify(quote)),
   p_amount_cents:selection.amountTotal,
  });
  if(createError||!orderRaw?.id)throw Error('QA_ORDER_PERSISTENCE_UNAVAILABLE');
  const created=orderRaw as QaOrder;
  if(created.state==='paid')return respond({ok:true,environment:'test',state:'paid',order_id:created.id});
  const context:PaymentOrderContext={
   orderId:created.id,environment:'test',customerEmail:qaEmail,customerName:qaName,
   returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/?qa_return=1',
  };
  if(input.payment_method==='pix'){
   if(!created.stripe_checkout_session_id){
    const session=await createStripePixCheckout(serverSelection,context,config);
    const {data:linked,error:linkError}=await db.rpc('oryneo_qa_billing_link',{
     p_order_id:created.id,p_owner_id:user.id,
     p_checkout_session_id:session.sessionId,p_customer_id:null,
     p_subscription_id:null,p_invoice_id:null,
    });
    if(linkError||!linked?.ok)throw Error('QA_PIX_LINK_PENDING');
    return respond({ok:true,environment:'test',payment_method:'pix',
     reference:created.reference,order_id:created.id,
     session_id:session.sessionId,client_secret:session.clientSecret,
     publishable_key:config.publishableKey});
   }
   const previous=await stripeRead('checkout/sessions/'+encodeURIComponent(created.stripe_checkout_session_id),config.secretKey);
   if(previous.id!==created.stripe_checkout_session_id||previous.mode!=='payment'
     ||previous.metadata?.oryneo_order_id!==created.id
     ||previous.metadata?.oryneo_qa_isolated!=='true'
     ||previous.amount_total!==selection.amountTotal)throw Error('QA_PIX_REPLAY_MISMATCH');
   return respond({ok:true,environment:'test',payment_method:'pix',
    order_id:created.id,session_id:previous.id,client_secret:previous.client_secret,
    publishable_key:config.publishableKey});
  }
  let ids={customerId:created.stripe_customer_id,subscriptionId:created.stripe_subscription_id,
   invoiceId:created.stripe_invoice_id};
  if(!ids.subscriptionId){
   const createdBoleto=await createStripeBoletoSubscription(serverSelection,context,config);
   ids={customerId:createdBoleto.customerId,subscriptionId:createdBoleto.subscriptionId,invoiceId:createdBoleto.invoiceId};
   if(!ids.invoiceId)throw Error('QA_BOLETO_INVOICE_PENDING');
   const {data:linked,error:linkError}=await db.rpc('oryneo_qa_billing_link',{
    p_order_id:created.id,p_owner_id:user.id,p_checkout_session_id:null,
    p_customer_id:ids.customerId,p_subscription_id:ids.subscriptionId,p_invoice_id:ids.invoiceId,
   });
   if(linkError||!linked?.ok)throw Error('QA_BOLETO_LINK_PENDING');
  }
  if(!ids.customerId||!ids.subscriptionId||!ids.invoiceId)
   throw Error('QA_BOLETO_IDENTITIES_INCOMPLETE');
  const invoiceUrl=await finalizeStripeBoletoInvoice(
   ids.invoiceId,ids.customerId,ids.subscriptionId,serverSelection,context,config);
  return respond({ok:true,environment:'test',payment_method:'boleto',
   order_id:created.id,reference:created.reference,invoice_ready:!!invoiceUrl,
   hosted_invoice_url:invoiceUrl});
 }catch(cause){
  console.error('ORYNEO isolated financial QA error',{code:errorCode(cause)});
  return respond({error:'A operação de homologação não foi concluída. Nenhuma cobrança LIVE foi criada.'},503);
 }
});
