/** Stripe TEST event validation. Provider GET snapshots, not webhook order, are authoritative. */
export const QA_CHECKOUT_EVENTS=new Set([
 'checkout.session.completed','checkout.session.async_payment_succeeded',
 'checkout.session.async_payment_failed','checkout.session.expired',
]);
export const QA_INVOICE_EVENTS=new Set([
 'invoice.created','invoice.finalized','invoice.sent','invoice.paid','invoice.payment_succeeded',
 'invoice.payment_failed','invoice.voided','invoice.marked_uncollectible',
]);
export function stripeInvoiceSubscription(invoice:Record<string,any>):string|null{
 const raw=invoice.subscription??invoice.parent?.subscription_details?.subscription;
 return typeof raw==='string'?raw:typeof raw?.id==='string'?raw.id:null;
}
/** invoice.paid also fires after a manual paid-out-of-band mark. Only invoice.payment_succeeded\n * is the Stripe webhook proof for a real successful collection. */\nexport function permitsBoletoCompensation(eventType:string,invoice:Record<string,any>):boolean{\n return eventType==='invoice.payment_succeeded'&&invoice.status==='paid'&&\n   invoice.paid===true&&invoice.paid_out_of_band!==true&&\n   Number.isSafeInteger(invoice.total)&&invoice.total>0&&\n   invoice.amount_paid===invoice.total;\n}\nexport function verifiedQaInvoice(
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
 const paid=invoice.status==='paid'&&invoice.paid===true&&
  invoice.amount_paid===invoice.total;
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
