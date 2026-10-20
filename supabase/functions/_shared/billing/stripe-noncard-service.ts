import {boletoInvoiceView} from './invoice-public-status.ts';
import {buildBoletoSubscriptionForm,buildPixCheckoutForm,type PaymentOrderContext,type ServerBillingSelection} from './stripe-payment-forms.ts';
import type {BillingEnvironmentConfig} from './environment.ts';

const STRIPE_VERSION='2026-08-26.dahlia';
type StripeObject={id?:string;livemode?:boolean;customer?:string;subscription?:string;latest_invoice?:string|{id?:string;total?:number;currency?:string;hosted_invoice_url?:string|null};amount_total?:number;client_secret?:string;metadata?:Record<string,string>;error?:{code?:string}};
type Fetch=typeof fetch;
export type BoletoCreation=Readonly<{customerId:string;subscriptionId:string;invoiceId:string|null;hostedInvoiceUrl:string|null}>;
export type PixCreation=Readonly<{sessionId:string;clientSecret:string}>;

function sandboxOnly(config:BillingEnvironmentConfig,context:PaymentOrderContext){
 if(config.environment!=='test'||config.livemode||context.environment!=='test')throw Error('NONCARD_LIVE_NOT_HOMOLOGATED');
 if(!config.secretKey.startsWith('sk_test_')&&!config.secretKey.startsWith('rk_test_'))throw Error('STRIPE_TEST_KEY_REQUIRED');
}
async function stripeCall(path:string,config:BillingEnvironmentConfig,fetchImpl:Fetch,form?:URLSearchParams,idempotencyKey?:string):Promise<StripeObject>{
 const response=await fetchImpl('https://api.stripe.com/v1'+path,{
  method:form?'POST':'GET',
  headers:{
   Authorization:'Bearer '+config.secretKey,
   'Stripe-Version':STRIPE_VERSION,
   ...(form?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey!}:{}),
  },
  ...(form?{body:form}:{}),
 });
 const result=await response.json() as StripeObject;
 if(!response.ok||!result?.id)throw Error('STRIPE_NONCARD_REQUEST_FAILED_'+response.status+'_'+(result?.error?.code||'unknown'));
 if(result.livemode!==false)throw Error('STRIPE_NONCARD_ENVIRONMENT_MISMATCH');
 return result;
}
/** Staged sandbox-only implementation; persist returned IDs atomically before exposing invoice links.
 * Idempotency protects short retries; the subscription lookup recovers after the Stripe window.
 */
export async function createStripeBoletoSubscription(
 selection:ServerBillingSelection,context:PaymentOrderContext,config:BillingEnvironmentConfig,fetchImpl:Fetch=fetch,
):Promise<BoletoCreation>{
 sandboxOnly(config,context);
 const customerForm=new URLSearchParams();
 customerForm.set('email',context.customerEmail);
 customerForm.set('name',context.customerName);
 customerForm.set('preferred_locales[0]','pt-BR');
 customerForm.set('metadata[oryneo_order_id]',context.orderId);
 customerForm.set('metadata[oryneo_billing_environment]','test');
 // Recover a customer after the Stripe idempotency retention window expires.
 const searchQuery=`metadata['oryneo_order_id']:'${context.orderId}'`;
 const search=await fetchImpl('https://api.stripe.com/v1/customers/search?'+new URLSearchParams({query:searchQuery,limit:'10'}),{
  headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':STRIPE_VERSION},
 });
 if(!search.ok)throw Error('STRIPE_CUSTOMER_RECONCILIATION_UNAVAILABLE');
 const found=await search.json() as {data?:StripeObject[];has_more?:boolean};
 if(found.has_more||!Array.isArray(found.data)||found.data.length>1)throw Error('STRIPE_CUSTOMER_RECONCILIATION_AMBIGUOUS');
 let customer=found.data[0];
 if(customer){
  if(customer.livemode!==false||customer.metadata?.oryneo_order_id!==context.orderId)
   throw Error('STRIPE_EXISTING_CUSTOMER_MISMATCH');
 }else customer=await stripeCall('/customers',config,fetchImpl,customerForm,'oryneo-boleto-customer-'+context.orderId);
 if(!customer.id?.startsWith('cus_'))throw Error('INVALID_CUSTOMER_RESPONSE');
 const history=await fetchImpl('https://api.stripe.com/v1/subscriptions?'+new URLSearchParams({
  customer:customer.id,status:'all',limit:'100',
 }),{headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':STRIPE_VERSION}});
 if(!history.ok)throw Error('STRIPE_SUBSCRIPTION_RECONCILIATION_UNAVAILABLE');
 const historyData=await history.json() as {data?:StripeObject[];has_more?:boolean};
 if(historyData.has_more||!Array.isArray(historyData.data))throw Error('STRIPE_SUBSCRIPTION_HISTORY_INCOMPLETE');
 let sub=historyData.data.find(item=>item.metadata?.oryneo_order_id===context.orderId&&item.metadata?.oryneo_payment_method==='boleto');
 if(sub){
  if(sub.livemode!==false||sub.customer!==customer.id)throw Error('STRIPE_EXISTING_SUBSCRIPTION_MISMATCH');
 }else{
  const form=buildBoletoSubscriptionForm(selection,context,customer.id);
  form.append('expand[]','latest_invoice');
  sub=await stripeCall('/subscriptions',config,fetchImpl,form,'oryneo-boleto-subscription-'+context.orderId);
 }
 if(!sub.id?.startsWith('sub_')||sub.customer!==customer.id)throw Error('INVALID_SUBSCRIPTION_RESPONSE');
 const invoice=typeof sub.latest_invoice==='object'?sub.latest_invoice:null;
 if(invoice&&((invoice.currency&&invoice.currency!=='brl')||(typeof invoice.total==='number'&&invoice.total!==selection.amountTotal)))
  throw Error('BOLETO_INITIAL_INVOICE_TOTAL_MISMATCH');
 const invoiceId=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id||null;
 return {customerId:customer.id,subscriptionId:sub.id,invoiceId,hostedInvoiceUrl:invoice?.hosted_invoice_url||null};
}
/** One-off Pix checkout, with no subscription or automatic renewal claim. */
export async function createStripePixCheckout(
 selection:ServerBillingSelection,context:PaymentOrderContext,config:BillingEnvironmentConfig,fetchImpl:Fetch=fetch,
):Promise<PixCreation>{
 sandboxOnly(config,context);
 const form=buildPixCheckoutForm(selection,context);
 const session=await stripeCall('/checkout/sessions',config,fetchImpl,form,'oryneo-pix-checkout-'+context.orderId);
 if(!session.id?.startsWith('cs_test_')||!session.client_secret||session.amount_total!==selection.amountTotal)
  throw Error('PIX_SESSION_CONTRACT_MISMATCH');
 return {sessionId:session.id,clientSecret:session.client_secret};
}

/** Finalize only after the order/subscription/customer links are persisted.
 * Never finalize an invoice with a mismatched amount or identity.
 */
export async function finalizeStripeBoletoInvoice(
 invoiceId:string,customerId:string,subscriptionId:string,
 selection:ServerBillingSelection,context:PaymentOrderContext,
 config:BillingEnvironmentConfig,fetchImpl:Fetch=fetch,
):Promise<string|null>{
 sandboxOnly(config,context);
 if(!/^in_[a-zA-Z0-9_]+$/.test(invoiceId)||!/^cus_[a-zA-Z0-9_]+$/.test(customerId)||
    !/^sub_[a-zA-Z0-9_]+$/.test(subscriptionId))throw Error('INVALID_STRIPE_INVOICE_CONTEXT');
 let invoice=await stripeCall('/invoices/'+encodeURIComponent(invoiceId),config,fetchImpl);
 const validate=(item:StripeObject)=>{
  const parent=item as StripeObject&{subscription?:string;parent?:{subscription_details?:{subscription?:string}};status?:string;currency?:string;total?:number};
  if(item.id!==invoiceId||item.customer!==customerId||
    (parent.subscription!==subscriptionId&&parent.parent?.subscription_details?.subscription!==subscriptionId)||
    parent.currency!=='brl'||parent.total!==selection.amountTotal)
   throw Error('BOLETO_INVOICE_CONTRACT_MISMATCH');
 };
 validate(invoice);
 if((invoice as StripeObject&{status?:string}).status==='draft'){
  invoice=await stripeCall('/invoices/'+encodeURIComponent(invoiceId)+'/finalize',config,fetchImpl,new URLSearchParams(),
   'oryneo-boleto-finalize-'+context.orderId);
  validate(invoice);
 }
 const view=boletoInvoiceView({
  amount_total:selection.amountTotal,stripe_customer_id:customerId,stripe_subscription_id:subscriptionId,
  billing_environment:'test',
 },invoice as Record<string,unknown>);
 return view.invoiceUrl;
}
