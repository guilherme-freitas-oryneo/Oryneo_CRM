/** Stripe TEST event validation. Provider GET snapshots, not webhook order, are authoritative. */
export const QA_CHECKOUT_EVENTS=new Set([
 'checkout.session.completed','checkout.session.async_payment_succeeded',
 'checkout.session.async_payment_failed','checkout.session.expired',
]);
export const QA_INVOICE_EVENTS=new Set([
 'invoice.created','invoice.finalized','invoice.sent','invoice.paid','invoice.payment_succeeded',
 'invoice.payment_failed','invoice.voided','invoice.marked_uncollectible',
]);
/** Polling may observe payment, but only the separately verified webhook persists Pix settlement. */
export function pixReconciliationDecision(providerPaid:boolean,orderState:string){
 return {confirmedPaid:providerPaid&&orderState==='paid',
  webhookPending:providerPaid&&orderState!=='paid'};
}
/** A missing link is retryable only when the provider object names a valid isolated TEST order. */
export function qaOrderLinkPending(metadata:Record<string,unknown>|null|undefined):boolean{
 return metadata?.oryneo_qa_isolated==='true'&&metadata?.oryneo_billing_environment==='test'&&
  typeof metadata.oryneo_order_id==='string'&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.oryneo_order_id);
}
export function qaWebhookLinkDisposition(orderFound:boolean,metadata:Record<string,unknown>|null|undefined):'linked'|'retry'|'ignore'{
 if(orderFound)return 'linked';
 return qaOrderLinkPending(metadata)?'retry':'ignore';
}
export function stripeInvoiceSubscription(invoice:Record<string,any>):string|null{
 const raw=invoice.subscription??invoice.parent?.subscription_details?.subscription;
 return typeof raw==='string'?raw:typeof raw?.id==='string'?raw.id:null;
}
/** invoice.paid is not sufficient: Stripe also emits it after manual paid-out-of-band.
 * Require a paid InvoicePayment backed by a succeeded PaymentIntent.
 */
export function verifiedStripeInvoicePaymentProof(
 invoice:Record<string,any>,
 invoicePayments:Record<string,any>,
 intent:Record<string,any>,
):boolean{
 if(invoice.status!=='paid'||Number(invoice.amount_paid_out_of_band||0)>0||
   !Number.isSafeInteger(invoice.total)||invoice.total<=0||
   invoice.amount_paid!==invoice.total||invoice.amount_remaining!==0 ||
   invoicePayments.has_more!==false||!Array.isArray(invoicePayments.data)||
   invoicePayments.data.length!==1)return false;
 const payment=invoicePayments.data[0];
 const piId=payment.payment?.payment_intent;
 if(payment.livemode!==false||payment.status!=='paid'||payment.invoice!==invoice.id||
    !Number.isSafeInteger(payment.amount_paid)||payment.amount_paid!==invoice.total||
    payment.payment?.type!=='payment_intent'||typeof piId!=='string'||!piId.startsWith('pi_'))
  return false;
 return intent.livemode===false&&intent.id===piId&&intent.status==='succeeded'&&
  intent.currency===invoice.currency&&intent.customer===invoice.customer&&
  intent.amount_received===invoice.total;
}
export function verifiedQaInvoice(
 invoice:Record<string,any>,subscription:Record<string,any>,
 order:Record<string,any>,
):Readonly<{status:string;paid:boolean;amount:number;invoiceId:string;billingReason:string|null}>{
 if(invoice.livemode!==false||subscription.livemode!==false||
  !invoice.id?.startsWith('in_')||invoice.customer!==order.stripe_customer_id||
  stripeInvoiceSubscription(invoice)!==order.stripe_subscription_id||
  subscription.id!==order.stripe_subscription_id||
  subscription.customer!==order.stripe_customer_id||
  subscription.metadata?.oryneo_qa_isolated!=='true'||
  subscription.metadata?.oryneo_billing_environment!=='test'||
  subscription.metadata?.oryneo_order_id!==order.id||
  order.environment!=='test'||order.method!=='boleto'||invoice.currency!=='brl'||
  !Number.isSafeInteger(invoice.total)||invoice.total<0)
  throw Error('QA_INVOICE_PROVIDER_MISMATCH');
 const paid=invoice.status==='paid'&&
  invoice.amount_paid===invoice.total&&invoice.amount_remaining===0&&
  invoice.total>0;
 if(invoice.status==='paid'&&!paid)throw Error('QA_INVOICE_COMPENSATION_UNCONFIRMED');
 if(invoice.id===order.stripe_invoice_id&&invoice.total!==order.amount_cents)
  throw Error('QA_INITIAL_INVOICE_AMOUNT_MISMATCH');
 if(!['draft','open','paid','void','uncollectible'].includes(invoice.status))
  throw Error('QA_INVOICE_STATE_UNKNOWN');
 return {status:invoice.status,paid,amount:invoice.total,invoiceId:invoice.id,
  billingReason:typeof invoice.billing_reason==='string'?invoice.billing_reason:null};
}
export function verifiedQaPixSession(
 session:Record<string,any>,order:Record<string,any>,
):Readonly<{status:string;paid:boolean;amount:number}>{
 if(session.livemode!==false||session.id!==order.stripe_checkout_session_id||
  order.environment!=='test'||order.method!=='pix'||
  session.mode!=='payment'||session.currency!=='brl'||
  session.metadata?.oryneo_qa_isolated!=='true'||
  session.metadata?.oryneo_billing_environment!=='test'||
  session.metadata?.oryneo_order_id!==order.id||
  session.amount_total!==order.amount_cents||
  !Array.isArray(session.payment_method_types)||!session.payment_method_types.includes('pix'))
  throw Error('QA_PIX_PROVIDER_MISMATCH');
 return {status:session.payment_status==='paid'?'paid':
   session.status==='expired'?'expired':session.payment_status||'unpaid',
   paid:session.payment_status==='paid',amount:session.amount_total};
}
const encoder=new TextEncoder();
function secureEqual(a:Uint8Array,b:Uint8Array){
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
/** Verify timestamp tolerance and HMAC on original unmodified payload bytes. */
export async function verifyQaStripeSignature(raw:string,header:string,secret:string,now=Date.now()):Promise<boolean>{
 if(!secret.startsWith('whsec_'))return false;
 const entries=header.split(',').map(part=>part.trim().split('='));
 const timestamp=entries.find(([key])=>key==='t')?.[1];
 if(!timestamp||!/^\d{10,12}$/.test(timestamp))return false;
 const time=Number(timestamp);
 if(!Number.isSafeInteger(time)||Math.abs(Math.floor(now/1000)-time)>300)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(timestamp+'.'+raw)));
 return entries.some(([name,hex])=>{
  if(name!=='v1'||!hex||!/^[a-f0-9]{64}$/i.test(hex))return false;
  const bytes=new Uint8Array(hex.match(/.{2}/g)!.map(n=>parseInt(n,16)));
  return secureEqual(expected,bytes);
 });
}
