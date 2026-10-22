import {assertEquals,assertThrows} from 'jsr:@std/assert';
import {boletoInvoiceView} from '../_shared/billing/invoice-public-status.ts';
const order={amount_total:173980,stripe_customer_id:'cus_abc',stripe_subscription_id:'sub_abc',billing_environment:'test' as const};
const invoice={id:'in_abc',livemode:false,currency:'brl',customer:'cus_abc',subscription:'sub_abc',total:173980,status:'open',paid:false,hosted_invoice_url:'https://invoice.stripe.com/i/test'};
Deno.test('boleto unpaid invoice exposes only trusted Stripe-hosted URL',()=>{
 assertEquals(boletoInvoiceView(order,invoice),{status:'awaiting_payment',invoiceUrl:'https://invoice.stripe.com/i/test'});
});
Deno.test('paid Stripe invoice waits for verified DB reconciliation',()=>{
 assertEquals(boletoInvoiceView(order,{...invoice,status:'paid',paid:true}),{status:'processing',invoiceUrl:null});
});
Deno.test('draft and void invoices never expose a payment link',()=>{
 assertEquals(boletoInvoiceView(order,{...invoice,status:'draft'}).invoiceUrl,null);
 assertEquals(boletoInvoiceView(order,{...invoice,status:'void'}).status,'payment_failed');
});
Deno.test('invoice wrong total, customer, subscription or environment is rejected',()=>{
 for(const altered of [{total:1},{customer:'cus_other'},{subscription:'sub_other'},{livemode:true}]){
  assertThrows(()=>boletoInvoiceView(order,{...invoice,...altered}),Error,'BOLETO_INVOICE_IDENTITY_MISMATCH');
 }
});
Deno.test('arbitrary or non-HTTPS invoice URL rejected',()=>{
 assertThrows(()=>boletoInvoiceView(order,{...invoice,hosted_invoice_url:'https://attacker.example/'}),Error,'UNTRUSTED_INVOICE_HOST');
 assertThrows(()=>boletoInvoiceView(order,{...invoice,hosted_invoice_url:'http://invoice.stripe.com/'}),Error,'UNTRUSTED_INVOICE_HOST');
});
