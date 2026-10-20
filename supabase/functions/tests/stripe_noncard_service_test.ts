import {assertEquals,assertRejects} from 'jsr:@std/assert';
import {createStripeBoletoSubscription,createStripePixCheckout} from '../_shared/billing/stripe-noncard-service.ts';
import type {ServerBillingSelection,PaymentOrderContext} from '../_shared/billing/stripe-payment-forms.ts';
import type {BillingEnvironmentConfig} from '../_shared/billing/environment.ts';
const selection:ServerBillingSelection={plan:'Start',cycle:'monthly',amountTotal:173980,trafficRenewalPriceId:null,items:[
 {key:'start_monthly',label:'Start',amountCents:74990,stripePriceId:'price_month',recurring:true},
 {key:'start_setup',label:'Setup',amountCents:98990,stripePriceId:'price_setup',recurring:false},
]};
const context:PaymentOrderContext={orderId:'11111111-1111-4111-8111-111111111111',environment:'test',customerEmail:'qa@example.com',customerName:'Cliente QA',returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=qa'};
const config:BillingEnvironmentConfig={environment:'test',livemode:false,secretKey:'sk_test_placeholder',publishableKey:'pk_test_placeholder'};
const ok=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
Deno.test('sandbox boleto: customer and subscription idempotency, setup first invoice and exact total',async()=>{
 const calls:Array<{url:string;method:string;body:string;key:string|null}>=[];
 const mock=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),body=String(init?.body||'');
  calls.push({url,method:init?.method||'GET',body,key:new Headers(init?.headers).get('Idempotency-Key')});
  if(url.includes('/customers/search?'))return ok({data:[],has_more:false});
  if(url.endsWith('/customers'))return ok({id:'cus_test1',livemode:false});
  if(url.includes('/subscriptions?'))return ok({data:[],has_more:false});
  if(url.endsWith('/subscriptions'))return ok({id:'sub_test1',customer:'cus_test1',livemode:false,latest_invoice:{id:'in_test1',currency:'brl',total:173980,hosted_invoice_url:'https://invoice.stripe.com/test'}});
  throw Error('unexpected request');
 };
 const result=await createStripeBoletoSubscription(selection,context,config,mock as typeof fetch);
 assertEquals(result.subscriptionId,'sub_test1');
 assertEquals(result.invoiceId,'in_test1');
 assertEquals(calls[1].key,'oryneo-boleto-customer-'+context.orderId);
 assertEquals(calls[3].key,'oryneo-boleto-subscription-'+context.orderId);
 const subForm=new URLSearchParams(calls[3].body);
 assertEquals(subForm.get('items[0][price]'),'price_month');
 assertEquals(subForm.get('add_invoice_items[0][price]'),'price_setup');
 assertEquals(subForm.get('collection_method'),'send_invoice');
});
Deno.test('existing subscription recovered instead of charged twice',async()=>{
 let creates=0;
 const mock=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('/customers/search?'))return ok({data:[{id:'cus_test1',livemode:false,metadata:{oryneo_order_id:context.orderId}}],has_more:false});
  if(url.endsWith('/customers'))return ok({id:'cus_test1',livemode:false});
  if(url.includes('/subscriptions?'))return ok({data:[{id:'sub_existing',customer:'cus_test1',livemode:false,metadata:{oryneo_order_id:context.orderId,oryneo_payment_method:'boleto'},latest_invoice:'in_existing'}],has_more:false});
  if(init?.method==='POST')creates++;
  throw Error('unexpected request');
 };
 const result=await createStripeBoletoSubscription(selection,context,config,mock as typeof fetch);
 assertEquals(result.subscriptionId,'sub_existing');assertEquals(creates,0);
});
Deno.test('Pix creates one-time TEST Checkout and validates amount',async()=>{
 const mock=async(_input:RequestInfo|URL,init?:RequestInit)=>{
  const body=new URLSearchParams(String(init?.body||''));
  assertEquals(body.get('mode'),'payment');
  assertEquals(body.get('payment_method_types[0]'),'pix');
  return ok({id:'cs_test_pix1',livemode:false,client_secret:'cs_test_secret_abc',amount_total:173980});
 };
 const result=await createStripePixCheckout(selection,context,config,mock as typeof fetch);
 assertEquals(result.sessionId,'cs_test_pix1');
});
Deno.test('noncard LIVE is blocked before any network call',async()=>{
 let calls=0;
 const mock=async()=>{calls++;throw Error('unexpected network call')};
 await assertRejects(()=>createStripeBoletoSubscription(selection,{...context,environment:'live'},{...config,environment:'live',livemode:true,secretKey:'sk_live_x'},mock as typeof fetch),Error,'NONCARD_LIVE_NOT_HOMOLOGATED');
 await assertRejects(()=>createStripePixCheckout(selection,{...context,environment:'live'},{...config,environment:'live',livemode:true,secretKey:'sk_live_x'},mock as typeof fetch),Error,'NONCARD_LIVE_NOT_HOMOLOGATED');
 assertEquals(calls,0);
});
Deno.test('mismatched boleto invoice total fails closed',async()=>{
 const mock=async(input:RequestInfo|URL)=>{
  const url=String(input);
  if(url.includes('/customers/search?'))return ok({data:[],has_more:false});
  if(url.endsWith('/customers'))return ok({id:'cus_test1',livemode:false});
  if(url.includes('/subscriptions?'))return ok({data:[],has_more:false});
  return ok({id:'sub_test1',customer:'cus_test1',livemode:false,latest_invoice:{id:'in_test1',currency:'brl',total:1}});
 };
 await assertRejects(()=>createStripeBoletoSubscription(selection,context,config,mock as typeof fetch),Error,'BOLETO_INITIAL_INVOICE_TOTAL_MISMATCH');
});
