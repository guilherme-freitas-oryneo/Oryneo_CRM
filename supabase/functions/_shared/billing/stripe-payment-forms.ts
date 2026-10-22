import type { BillingCycle } from './catalog.ts';
import type { BillingEnvironment } from './environment.ts';

/** Server-side validated catalog items only. Never accept Stripe price IDs or amounts from the browser. */
export type ServerBillingItem = Readonly<{key:string;label:string;amountCents:number;stripePriceId:string;recurring:boolean}>;
export type ServerBillingSelection = Readonly<{plan:string;cycle:BillingCycle;amountTotal:number;items:readonly ServerBillingItem[];trafficRenewalPriceId:string|null}>;
export type PaymentOrderContext = Readonly<{orderId:string;environment:BillingEnvironment;customerEmail:string;customerName:string;returnUrl:string}>;

function valid(selection:ServerBillingSelection):void{
 if(!['Start','Growth','Scale'].includes(selection.plan)||!['monthly','annual'].includes(selection.cycle))throw Error('INVALID_SELECTION');
 if(!Number.isSafeInteger(selection.amountTotal)||selection.amountTotal<=0||selection.items.length<2)throw Error('INVALID_SELECTION_TOTAL');
 if(selection.items.some(item=>!item.stripePriceId.startsWith('price_')||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0))throw Error('INVALID_SERVER_PRICE');
 if(selection.items.reduce((n,item)=>n+item.amountCents,0)!==selection.amountTotal)throw Error('TOTAL_MISMATCH');
 if(selection.items.filter(item=>item.recurring).length!==1)throw Error('RECURRING_PLAN_REQUIRED');
 // Traffic renewal must be separately implemented for invoice and one-off payments.
 if(selection.trafficRenewalPriceId||selection.items.some(item=>item.key==='traffic'))throw Error('NONCARD_TRAFFIC_RENEWAL_NOT_READY');
}
function contextValid(context:PaymentOrderContext):void{
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(context.orderId)||!['test','live'].includes(context.environment))throw Error('INVALID_ORDER_CONTEXT');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.customerEmail)||context.customerName.trim().length<2)throw Error('INVALID_CUSTOMER');
 const url=new URL(context.returnUrl);
 if(url.protocol!=='https:'||url.hostname!=='guilherme-freitas-oryneo.github.io'||url.port||url.username||url.password||url.hash||
   !['/Oryneo_CRM/','/Oryneo_CRM/pagar/','/Oryneo_CRM/qa/pr-46/'].includes(url.pathname))
  throw Error('INVALID_RETURN_URL');
}
/** Creates a subscription with recurring plan and one-time setup on the first invoice.
 * This builder does not send requests. Caller must persist the Stripe customer and
 * subscription IDs before acknowledging the initial invoice's paid webhook.
 */
export function buildBoletoSubscriptionForm(selection:ServerBillingSelection,context:PaymentOrderContext,customerId:string):URLSearchParams{
 valid(selection);contextValid(context);
 if(!/^cus_[a-zA-Z0-9]+$/.test(customerId))throw Error('INVALID_STRIPE_CUSTOMER');
 const form=new URLSearchParams();
 form.set('customer',customerId);
 form.set('collection_method','send_invoice');
 form.set('days_until_due','3');
 form.set('payment_settings[payment_method_types][0]','boleto');
 form.set('billing_mode[type]','flexible');
 form.set('metadata[oryneo_order_id]',context.orderId);
 form.set('metadata[oryneo_billing_environment]',context.environment);
 form.set('metadata[oryneo_payment_method]','boleto');
 if(context.environment==='test')form.set('metadata[oryneo_qa_isolated]','true');
 form.set('metadata[oryneo_role]','primary');
 let recurring=0,once=0;
 for(const item of selection.items){
  if(item.recurring){
   form.set(`items[${recurring}][price]`,item.stripePriceId);
   form.set(`items[${recurring}][quantity]`,'1');recurring++;
  }else{
   form.set(`add_invoice_items[${once}][price]`,item.stripePriceId);
   form.set(`add_invoice_items[${once}][quantity]`,'1');once++;
  }
 }
 return form;
}
/** Pix is a one-time initial payment. Future plan renewal requires an explicit
 * separate billing flow; this must be clearly disclosed before offering Pix.
 */
export function buildPixCheckoutForm(selection:ServerBillingSelection,context:PaymentOrderContext):URLSearchParams{
 valid(selection);contextValid(context);
 const form=new URLSearchParams();
 form.set('mode','payment');
 form.set('ui_mode','elements');
 form.set('allowed_payment_method_types[0]','pix');
 form.set('customer_email',context.customerEmail);
 form.set('customer_creation','always');
 form.set('locale','pt-BR');
 form.set('billing_address_collection','required');
 form.set('return_url',context.returnUrl);
 form.set('line_items[0][price_data][currency]','brl');
 form.set('line_items[0][price_data][unit_amount]',String(selection.amountTotal));
 form.set('line_items[0][price_data][product_data][name]',`Contratação ORYNEO ${selection.plan} · ${selection.cycle==='annual'?'anual':'mensal'}`);
 form.set('line_items[0][quantity]','1');
 form.set('metadata[oryneo_order_id]',context.orderId);
 form.set('metadata[oryneo_billing_environment]',context.environment);
 form.set('metadata[oryneo_payment_method]','pix');
 form.set('metadata[oryneo_qa_isolated]','true');
 form.set('payment_intent_data[metadata][oryneo_order_id]',context.orderId);
 return form;
}
