import {assertEquals,assertRejects,assertThrows} from 'jsr:@std/assert';
import {verifyQaStripeSignature,stripeInvoiceSubscription,verifiedQaInvoice,verifiedQaPixSession,verifiedQaCardCheckoutSession,verifiedStripeInvoicePaymentProof,pixReconciliationDecision,qaOrderLinkPending,qaWebhookLinkDisposition}
 from '../_shared/billing/financial-qa-webhook-policy.ts';
const order={id:'00000000-0000-4000-8000-000000000001',environment:'test',method:'boleto',
 stripe_customer_id:'cus_qa',stripe_subscription_id:'sub_qa',
 stripe_invoice_id:'in_initial',amount_cents:173980};
const subscription={id:'sub_qa',customer:'cus_qa',livemode:false,
 metadata:{oryneo_qa_isolated:'true',oryneo_order_id:order.id,oryneo_billing_environment:'test'}};
const invoice={id:'in_initial',livemode:false,currency:'brl',customer:'cus_qa',
 parent:{subscription_details:{subscription:'sub_qa'}},total:173980,amount_paid:0,amount_remaining:173980,
 status:'open',paid:false,billing_reason:'subscription_create'};
Deno.test('issued boleto is pending; not access granting until bank compensation',()=>{
 const x=verifiedQaInvoice(invoice,subscription,order);
 assertEquals(x.paid,false);
 assertEquals(x.status,'open');
 assertEquals(x.amount,173980);
});
Deno.test('invoice.paid requires Stripe paid flag and exact amount_paid',()=>{
 assertThrows(()=>verifiedQaInvoice({...invoice,status:'paid',amount_remaining:173980},subscription,order),Error,'QA_INVOICE_COMPENSATION_UNCONFIRMED');
 assertThrows(()=>verifiedQaInvoice({...invoice,status:'paid',amount_paid:1,amount_remaining:0},subscription,order),Error,'QA_INVOICE_COMPENSATION_UNCONFIRMED');
 assertEquals(verifiedQaInvoice({...invoice,status:'paid',amount_paid:173980,amount_remaining:0},subscription,order).paid,true);
});
Deno.test('rejects amount, wrong subscription, wrong environment, wrong metadata',()=>{
 assertThrows(()=>verifiedQaInvoice({...invoice,total:1},subscription,order),Error,'QA_INITIAL_INVOICE_AMOUNT_MISMATCH');
 assertThrows(()=>verifiedQaInvoice({...invoice,livemode:true},subscription,order),Error,'QA_INVOICE_PROVIDER_MISMATCH');
 assertThrows(()=>verifiedQaInvoice({...invoice,customer:'cus_other'},subscription,order),Error,'QA_INVOICE_PROVIDER_MISMATCH');
 assertThrows(()=>verifiedQaInvoice(invoice,{...subscription,metadata:{}},order),Error,'QA_INVOICE_PROVIDER_MISMATCH');
 assertEquals(stripeInvoiceSubscription(invoice),'sub_qa');
});
Deno.test('bank compensation requires real Stripe InvoicePayment and succeeded PaymentIntent',()=>{
 const settled={...invoice,status:'paid',amount_paid:173980,amount_remaining:0};
 const payments={has_more:false,data:[{id:'inpay_qa',invoice:'in_initial',livemode:false,
  status:'paid',amount_paid:173980,payment:{type:'payment_intent',payment_intent:'pi_qa'}}]};
 const intent={id:'pi_qa',livemode:false,status:'succeeded',currency:'brl',
  customer:'cus_qa',amount_received:173980};
 assertEquals(verifiedStripeInvoicePaymentProof(settled,payments,intent),true);
 assertEquals(verifiedStripeInvoicePaymentProof({...settled,amount_paid_out_of_band:173980},payments,intent),false);
 assertEquals(verifiedStripeInvoicePaymentProof(settled,{has_more:false,data:[]},intent),false);
 assertEquals(verifiedStripeInvoicePaymentProof(settled,payments,{...intent,status:'processing'}),false);
 assertEquals(verifiedStripeInvoicePaymentProof(settled,payments,{...intent,amount_received:1}),false);
 assertEquals(verifiedStripeInvoicePaymentProof({...settled,amount_paid:1},payments,intent),false);
 assertEquals(verifiedStripeInvoicePaymentProof(settled,{
  has_more:false,data:[{...payments.data[0],payment:{type:'payment_record',payment_intent:null}}],
 },intent),false);
});
Deno.test('renewal invoice may differ in total but remains distinct',()=>{
 const renewal={...invoice,id:'in_renewal',total:74990,billing_reason:'subscription_cycle'};
 assertEquals(verifiedQaInvoice(renewal,subscription,order).amount,74990);
});
Deno.test('Pix completed without settlement is not paid',()=>{
 const qaPix={...order,method:'pix',stripe_checkout_session_id:'cs_test_qa'};
 const session={id:'cs_test_qa',livemode:false,mode:'payment',currency:'brl',amount_total:173980,
  metadata:{oryneo_qa_isolated:'true',oryneo_billing_environment:'test',oryneo_order_id:order.id},
  payment_method_types:['pix'],payment_status:'unpaid',status:'complete'};
 assertEquals(verifiedQaPixSession(session,qaPix).paid,false);
 assertEquals(verifiedQaPixSession({...session,payment_status:'paid'},qaPix).paid,true);
 assertThrows(()=>verifiedQaPixSession({...session,amount_total:1},qaPix),Error,'QA_PIX_PROVIDER_MISMATCH');
});
Deno.test('card Checkout session confirms selected funding type and linked TEST identities',()=>{
 const cardOrder={...order,method:'card',stripe_checkout_session_id:'cs_test_card',selection:{card_funding:'debit'}};
 const session={id:'cs_test_card',livemode:false,mode:'subscription',currency:'brl',amount_total:173980,status:'complete',payment_status:'paid',
  customer:'cus_card',subscription:'sub_card',invoice:'in_card',payment_method_types:['card'],
  metadata:{oryneo_qa_isolated:'true',oryneo_billing_environment:'test',oryneo_order_id:order.id,oryneo_payment_method:'card',oryneo_card_funding:'debit'}};
 assertEquals(verifiedQaCardCheckoutSession(session,cardOrder),{status:'paid',paid:true,amount:173980,customerId:'cus_card',subscriptionId:'sub_card',invoiceId:'in_card'});
 assertThrows(()=>verifiedQaCardCheckoutSession({...session,metadata:{...session.metadata,oryneo_card_funding:'credit'}},cardOrder),Error,'QA_CARD_CHECKOUT_PROVIDER_MISMATCH');
 assertThrows(()=>verifiedQaCardCheckoutSession({...session,livemode:true},cardOrder),Error,'QA_CARD_CHECKOUT_PROVIDER_MISMATCH');
});
Deno.test('Pix polling cannot persist paid before the signed webhook does',()=>{
 assertEquals(pixReconciliationDecision(true,'awaiting_payment'),{confirmedPaid:false,webhookPending:true});
 assertEquals(pixReconciliationDecision(true,'paid'),{confirmedPaid:true,webhookPending:false});
 assertEquals(pixReconciliationDecision(false,'awaiting_payment'),{confirmedPaid:false,webhookPending:false});
});
Deno.test('only a TEST event carrying a valid order identity is retried while its QA link is pending',()=>{
 assertEquals(qaWebhookLinkDisposition(false,{oryneo_qa_isolated:'true',oryneo_billing_environment:'test',oryneo_order_id:order.id}),'retry');
 assertEquals(qaWebhookLinkDisposition(true,undefined),'linked');
 assertEquals(qaWebhookLinkDisposition(false,{oryneo_qa_isolated:'true'}),'ignore');
 assertEquals(qaWebhookLinkDisposition(false,{oryneo_qa_isolated:'true',oryneo_billing_environment:'live',oryneo_order_id:order.id}),'ignore');
 assertEquals(qaOrderLinkPending({oryneo_qa_isolated:'true',oryneo_billing_environment:'test',oryneo_order_id:order.id}),true);
 assertEquals(qaOrderLinkPending({oryneo_qa_isolated:'true'}),false);
 assertEquals(qaOrderLinkPending({oryneo_qa_isolated:'true',oryneo_billing_environment:'live',oryneo_order_id:order.id}),false);
 assertEquals(qaOrderLinkPending({oryneo_qa_isolated:'false',oryneo_billing_environment:'test',oryneo_order_id:order.id}),false);
});
Deno.test('rejects forged, expired or future Stripe signatures',async()=>{
 const raw=JSON.stringify({id:'evt_qa',livemode:false});
 const secret='whsec_qa_test_only_123';
 const now=1760000000000;
 const timestamp=String(Math.floor(now/1000));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw))))
 .map(c=>c.toString(16).padStart(2,'0')).join('');
 assertEquals(await verifyQaStripeSignature(raw,'t='+timestamp+',v1='+signature,secret,now),true);
 assertEquals(await verifyQaStripeSignature(raw+' ', 't='+timestamp+',v1='+signature,secret,now),false);
 assertEquals(await verifyQaStripeSignature(raw,'t='+timestamp+',v1='+signature,secret,now+301000),false);
 assertEquals(await verifyQaStripeSignature(raw,'t=1,v1='+signature,secret,now),false);
});
