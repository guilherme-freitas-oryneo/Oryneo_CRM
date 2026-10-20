/**
 * ORYNEO Financial QA Stripe TEST webhook (separate from production webhook).
 * Stripe signature + server-side GET are required before any state transition.
 * This endpoint NEVER sends e-mail, provisions a CRM account or touches LIVE.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {getBillingEnvironmentConfig} from '../_shared/billing/environment.ts';
import {
 QA_CHECKOUT_EVENTS,QA_INVOICE_EVENTS,stripeInvoiceSubscription,
 permitsBoletoCompensation,verifiedQaInvoice,verifiedQaPixSession,verifyQaStripeSignature,
} from '../_shared/billing/financial-qa-webhook-policy.ts';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false},
});
const response=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
type EventShape={id?:string;type?:string;livemode?:boolean;data?:{object?:Record<string,any>}};
async function getStripeObject(path:string,key:string):Promise<Record<string,any>>{
 const r=await fetch('https://api.stripe.com/v1/'+path,{
  method:'GET',headers:{Authorization:'Bearer '+key,'Stripe-Version':'2026-08-26.dahlia'},
 });
 if(!r.ok)throw Error('QA_PROVIDER_UNAVAILABLE_'+r.status);
 const data=await r.json();
 if(data?.livemode!==false||typeof data?.id!=='string')throw Error('QA_PROVIDER_WRONG_ENVIRONMENT');
 return data;
}
async function lookup(method:'pix'|'boleto',providerId:string){
 const {data,error}=await db.rpc('oryneo_qa_webhook_lookup',{
  p_method:method,p_provider_id:providerId,
 });
 if(error)throw Error('QA_WEBHOOK_ORDER_LOOKUP_UNAVAILABLE');
 return data as Record<string,any>|null;
}
async function handlePix(event:EventShape,key:string){
 const sessionId=event.data?.object?.id;
 if(typeof sessionId!=='string'||!sessionId.startsWith('cs_test_'))
  return response({error:'QA_SESSION_ID_INVALID'},422);
 const order=await lookup('pix',sessionId);
 if(!order){
  // A request may precede linkage. Never acknowledge a marked QA event prematurely.
  if(event.data?.object?.metadata?.oryneo_qa_isolated==='true')return response({error:'QA_LINK_PENDING'},503);
  return response({received:true,ignored:true});
 }
 const session=await getStripeObject('checkout/sessions/'+encodeURIComponent(sessionId),key);
 const settlement=verifiedQaPixSession(session,order);
 const {data,error}=await db.rpc('oryneo_qa_billing_reconcile',{
  p_order_id:order.id,p_owner_id:order.owner_id,p_provider_object_id:sessionId,
  p_provider_status:settlement.status,p_confirmed_paid:settlement.paid,
  p_paid_amount:settlement.paid?settlement.amount:0,
  p_event_key:'qa_'+event.id,
 });
 if(error||!data?.ok)throw Error('QA_PIX_RECONCILIATION_FAILED');
 return response({received:true,method:'pix',state:data.state,duplicate:data.duplicate===true});
}
async function handleInvoice(event:EventShape,key:string){
 const incomingId=event.data?.object?.id;
 if(typeof incomingId!=='string'||!/^in_[A-Za-z0-9_]+$/.test(incomingId))
  return response({error:'QA_INVOICE_ID_INVALID'},422);
 // Never trust amount or paid state from the event. Fetch current Stripe invoice.
 const invoice=await getStripeObject('invoices/'+encodeURIComponent(incomingId),key);
 const subscriptionId=stripeInvoiceSubscription(invoice);
 if(!subscriptionId)return response({received:true,ignored:true,reason:'not_subscription_invoice'});
 const order=await lookup('boleto',subscriptionId);
 if(!order){
  const sub=await getStripeObject('subscriptions/'+encodeURIComponent(subscriptionId),key);
  if(sub.metadata?.oryneo_qa_isolated==='true'&&sub.metadata?.oryneo_billing_environment==='test')
   return response({error:'QA_SUBSCRIPTION_LINK_PENDING'},503);
  return response({received:true,ignored:true});
 }
 const sub=await getStripeObject('subscriptions/'+encodeURIComponent(subscriptionId),key);
 const state=verifiedQaInvoice(invoice,sub,order);
 // invoice.paid also fires for manual paid-out-of-band transactions.
 // Do not interpret it, or an older invoice event, as bank compensation.
 if(state.status==='paid'&&!permitsBoletoCompensation(event.type,invoice))
  return response({received:true,awaiting_compensation_proof:true});
 if(event.type==='invoice.payment_succeeded'&&!permitsBoletoCompensation(event.type,invoice))
  return response({error:'QA_BANK_COMPENSATION_NOT_CONFIRMED'},503);
 const recordedStatus=event.type==='invoice.payment_failed'&&!state.paid&&state.status==='open'
  ?'payment_failed':state.status;
 const {data,error}=await db.rpc('oryneo_qa_boleto_invoice_event',{
  p_order_id:order.id,p_invoice_id:state.invoiceId,p_event_id:event.id,
  p_status:recordedStatus,p_amount_cents:state.amount,
  p_billing_reason:state.billingReason,p_paid:state.paid,
 });
 if(error||!data?.ok)throw Error('QA_BOLETO_RECONCILIATION_FAILED');
 return response({received:true,method:'boleto',order_state:data.order_state,
  invoice_state:data.invoice_state,duplicate:data.duplicate===true});
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 const header=req.headers.get('Stripe-Signature')||'';
 if(!header)return response({error:'Missing signature'},400);
 const {data:secret,error:secretError}=await db.rpc('oryneo_qa_webhook_signing_secret');
 if(secretError||typeof secret!=='string'||!secret.startsWith('whsec_'))
  return response({error:'QA webhook secret unavailable'},503);
 let raw:string;
 try{raw=await req.text();if(raw.length>300_000)return response({error:'Payload too large'},413)}
 catch{return response({error:'Invalid payload'},400)}
 if(!await verifyQaStripeSignature(raw,header,secret))
  return response({error:'Invalid Stripe signature'},400);
 let event:EventShape;
 try{event=JSON.parse(raw)}catch{return response({error:'Invalid JSON'},400)}
 if(event.livemode!==false)return response({error:'LIVE events forbidden in QA'},400);
 if(!event.id||!/^evt_[A-Za-z0-9_]+$/.test(event.id)||!event.type)
  return response({error:'Invalid event'},400);
 if(!QA_CHECKOUT_EVENTS.has(event.type)&&!QA_INVOICE_EVENTS.has(event.type))
  return response({received:true,ignored:true});
 if(!event.data?.object?.id)return response({error:'Missing Stripe source'},400);
 const config=getBillingEnvironmentConfig('test',name=>Deno.env.get(name));
 try{
  if(QA_CHECKOUT_EVENTS.has(event.type))return await handlePix(event,config.secretKey);
  return await handleInvoice(event,config.secretKey);
 }catch(cause){
  console.error('QA signed webhook pending retry',{code:cause instanceof Error?cause.message:'unknown'});
  return response({error:'QA_RECONCILIATION_RETRY'},503);
 }
});
