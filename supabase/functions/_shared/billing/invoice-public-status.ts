/** Public invoice presentation: never trusts a browser-supplied URL or payment state. */
export type BoletoInvoiceView=Readonly<{status:'awaiting_payment'|'processing'|'payment_failed';invoiceUrl:string|null}>;
export type BoletoOrderSnapshot=Readonly<{amount_total:number;stripe_customer_id:string|null;stripe_subscription_id:string|null;billing_environment:'test'|'live'}>;
export function boletoInvoiceView(order:BoletoOrderSnapshot,invoice:Record<string,unknown>):BoletoInvoiceView{
 if(invoice.livemode!==(order.billing_environment==='live')||
    invoice.currency!=='brl'||invoice.customer!==order.stripe_customer_id||
    !order.stripe_customer_id||!order.stripe_subscription_id||
    (invoice.subscription!==order.stripe_subscription_id&&
      (invoice.parent as {subscription_details?:{subscription?:string}}|null)?.subscription_details?.subscription!==order.stripe_subscription_id)||
    typeof invoice.total!=='number'||invoice.total!==order.amount_total)
  throw Error('BOLETO_INVOICE_IDENTITY_MISMATCH');
 if(invoice.status==='paid'&&invoice.paid===true)return {status:'processing',invoiceUrl:null};
 if(invoice.status==='void'||invoice.status==='uncollectible')return {status:'payment_failed',invoiceUrl:null};
 if(invoice.status!=='open')return {status:'processing',invoiceUrl:null};
 const raw=typeof invoice.hosted_invoice_url==='string'?invoice.hosted_invoice_url:'';
 let url:URL;
 try{url=new URL(raw)}catch{return {status:'processing',invoiceUrl:null}}
 if(url.protocol!=='https:'||!['invoice.stripe.com','pay.stripe.com'].includes(url.hostname))
  throw Error('UNTRUSTED_INVOICE_HOST');
 return {status:'awaiting_payment',invoiceUrl:url.toString()};
}
