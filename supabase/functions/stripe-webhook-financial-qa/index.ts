/**
 * ORYNEO Financial QA Stripe TEST webhook (separate from production webhook).
 * Stripe signature + server-side GET are required before any state transition.
 * This endpoint NEVER sends e-mail, provisions a CRM account or touches LIVE.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {
 QA_CHECKOUT_EVENTS,QA_INVOICE_EVENTS,stripeInvoiceSubscription,
 qaOrderLinkPending,qaWebhookLinkDisposition,verifiedStripeInvoicePaymentProof,verifiedQaInvoice,verifiedQaPixSession,verifyQaStripeSignature,
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
  if(qaOrderLinkPending(event.data?.object?.metadata))return response({error:'QA_LINK_PENDING'},503);
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
async function handlePendingSignedInvoice(event:EventShape){
 // Stripe's verified HMAC authenticates the original invoice event. This
 // fallback can record PENDING only, never a paid state without provider GET.
 const inv=event.data?.object;
 if(!inv||inv.livemode!==false||typeof inv.id!=='string'||!inv.id.startsWith('in_'))
  return response({error:'QA_SIGNED_INVOICE_INVALID'},422);
 const subId=stripeInvoiceSubscription(inv);
 if(!subId)return response({received:true,ignored:true});
 const order=await lookup('boleto',subId);
 const metadata=inv.parent?.subscription_details?.metadata;
 if(!order){
  if(qaOrderLinkPending(metadata))
   return response({error:'QA_LINK_PENDING'},503);
  return response({received:true,ignored:true});
 }
 if(metadata?.oryneo_qa_isolated!=='true'||metadata?.oryneo_order_id!==order.id||
  metadata?.oryneo_billing_environment!=='test'||inv.customer!==order.stripe_customer_id||
  inv.currency!=='brl'||!Number.isSafeInteger(inv.total)||inv.total<0||
  (inv.id===order.stripe_invoice_id&&inv.total!==order.amount_cents))
  return response({error:'QA_SIGNED_INVOICE_MISMATCH'},422);
 // Paid events or snapshots must be independently verified through Stripe.
 if(inv.status==='paid'||event.type==='invoice.paid'||event.type==='invoice.payment_succeeded')
  return response({error:'QA_COMPENSATION_API_SECRET_REQUIRED'},503);
 const status=event.type==='invoice.payment_failed'&&inv.status==='open'?'payment_failed':inv.status;
 if(!['draft','open','void','uncollectible','payment_failed'].includes(status))
  return response({error:'QA_INVOICE_STATUS_INVALID'},422);
 const {data,error}=await db.rpc('oryneo_qa_boleto_invoice_event',{
  p_order_id:order.id,p_invoice_id:inv.id,p_event_id:event.id,
  p_status:status,p_amount_cents:inv.total,
  p_billing_reason:typeof inv.billing_reason==='string'?inv.billing_reason:null,
  p_paid:false,
 });
 if(error||!data?.ok)throw Error('QA_PENDING_INVOICE_RECONCILIATION_FAILED');
 return response({received:true,method:'boleto',compensated:false,
  invoice_state:data.invoice_state,order_state:data.order_state,duplicate:data.duplicate===true});
}

async function handleInvoice(event:EventShape,key:string|null){
 if(!key)return await handlePendingSignedInvoice(event);
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
  if(qaOrderLinkPending(sub.metadata))
   return response({error:'QA_SUBSCRIPTION_LINK_PENDING'},503);
  return response({received:true,ignored:true});
 }
 const sub=await getStripeObject('subscriptions/'+encodeURIComponent(subscriptionId),key);
 const state=verifiedQaInvoice(invoice,sub,order);
 if(state.paid){
  // Stripe 2026 invoice.paid can represent an administrative paid-out-of-band
  // action. Confirm a real, succeeded Stripe PaymentIntent via InvoicePayment.
  if(Number(invoice.amount_paid_out_of_band||0)>0)
   return response({received:true,ignored:true,reason:'out_of_band_not_compensated'});
  const listResponse=await fetch('https://api.stripe.com/v1/invoice_payments?'+
   new URLSearchParams({invoice:invoice.id,status:'paid',limit:'100'}),{
   headers:{Authorization:'Bearer '+key,'Stripe-Version':'2026-08-26.dahlia'},
  });
  if(!listResponse.ok)throw Error('QA_INVOICE_PAYMENT_LOOKUP_UNAVAILABLE');
  const payments=await listResponse.json();
  const intentId=payments?.data?.[0]?.payment?.payment_intent;
  if(typeof intentId!=='string'||!/^pi_[a-zA-Z0-9_]+$/.test(intentId))
   return response({error:'QA_BANK_PAYMENT_PROOF_PENDING'},503);
  const intent=await getStripeObject('payment_intents/'+encodeURIComponent(intentId),key);
  if(!verifiedStripeInvoicePaymentProof(invoice,payments,intent))
   return response({error:'QA_BANK_PAYMENT_PROOF_UNVERIFIED'},503);
 }
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
 // Never use the legacy STRIPE_SECRET_KEY: it can belong to a different
 // Stripe testmode account. This QA endpoint targets an isolated TEST account.
 const secretKey=Deno.env.get('STRIPE_TEST_SECRET_KEY');
 const testKey=secretKey&&/^(?:sk|rk)_test_/.test(secretKey)?secretKey:null;
 try{
  if(QA_CHECKOUT_EVENTS.has(event.type)){
   const sessionId=event.data?.object?.id;
   if(typeof sessionId!=='string'||!sessionId.startsWith('cs_test_'))
    return response({received:true,ignored:true});
   const linkedOrder=await lookup('pix',sessionId);
   const linkDisposition=qaWebhookLinkDisposition(!!linkedOrder,event.data?.object?.metadata);
   if(linkDisposition==='ignore')
    return response({received:true,ignored:true});
   if(!testKey)return response({error:'QA_TEST_STRIPE_KEY_REQUIRED'},503);
   return await handlePix(event,testKey);
  }
  return await handleInvoice(event,testKey);
 }catch(cause){
  console.error('QA signed webhook pending retry',{code:cause instanceof Error?cause.message:'unknown'});
  return response({error:'QA_RECONCILIATION_RETRY'},503);
 }
});
