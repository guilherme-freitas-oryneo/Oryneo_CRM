import {assertEquals,assertRejects} from 'jsr:@std/assert';
import {finalizeStripeBoletoInvoice} from '../_shared/billing/stripe-noncard-service.ts';
const config={environment:'test' as const,livemode:false,secretKey:'sk_test_placeholder',publishableKey:'pk_test_placeholder'};
const context={orderId:'11111111-1111-4111-8111-111111111111',environment:'test' as const,customerEmail:'qa@example.com',customerName:'Cliente QA',returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=qa'};
const selection={plan:'Start',cycle:'monthly' as const,amountTotal:173980,trafficRenewalPriceId:null,items:[
 {key:'start_monthly',label:'Start',amountCents:74990,stripePriceId:'price_month',recurring:true},
 {key:'start_setup',label:'Setup',amountCents:98990,stripePriceId:'price_setup',recurring:false},
]};
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
Deno.test('invoice is finalized only after verifying subscription and total',async()=>{
 let calls=0;
 const mock=async()=>{
  calls++;
  const invoice={id:'in_test1',customer:'cus_test1',subscription:'sub_test1',livemode:false,currency:'brl',total:173980,paid:false};
  return response(calls===1?{...invoice,status:'draft'}:{...invoice,status:'open',hosted_invoice_url:'https://invoice.stripe.com/i/test'});
 };
 const url=await finalizeStripeBoletoInvoice('in_test1','cus_test1','sub_test1',selection,context,config,mock as typeof fetch);
 assertEquals(url,'https://invoice.stripe.com/i/test');
 assertEquals(calls,2);
});
Deno.test('mismatched invoice is never finalized',async()=>{
 let calls=0;
 const mock=async()=>{calls++;return response({id:'in_test1',customer:'cus_test1',subscription:'sub_other',livemode:false,currency:'brl',total:173980,status:'draft'})};
 await assertRejects(()=>finalizeStripeBoletoInvoice('in_test1','cus_test1','sub_test1',selection,context,config,mock as typeof fetch),Error,'BOLETO_INVOICE_CONTRACT_MISMATCH');
 assertEquals(calls,1);
});
