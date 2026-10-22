import {assertEquals,assertThrows} from 'jsr:@std/assert';
import {checkoutPaymentConfiguration,assertPaymentMethodEnabled} from '../_shared/billing/checkout-payment-configuration.ts';
Deno.test('card preserves current live subscription Checkout',()=>{
 const p=checkoutPaymentConfiguration('card','monthly');
 assertEquals(p.workflow,'checkout_subscription');
 assertEquals(p.stripeMode,'subscription');
 assertEquals(p.readyForLive,true);
 assertPaymentMethodEnabled('card','monthly');
});
Deno.test('boleto uses recurring subscription invoices that require manual payment',()=>{
 for(const cycle of ['monthly','annual'] as const){
  const p=checkoutPaymentConfiguration('boleto',cycle);
  assertEquals(p.workflow,'subscription_invoicing');
  assertEquals(p.stripeMode,'subscription');
  assertEquals(p.customerPaysEachInvoice,true);
  assertEquals(p.readyForLive,true);
  assertPaymentMethodEnabled('boleto',cycle);
 }
});
Deno.test('Pix is one-time, never subscription, and is gated',()=>{
 const p=checkoutPaymentConfiguration('pix','annual');
 assertEquals(p.workflow,'one_time_checkout');
 assertEquals(p.stripeMode,'payment');
 assertEquals(p.readyForLive,false);
 assertThrows(()=>assertPaymentMethodEnabled('pix','annual'),Error,'PAYMENT_METHOD_NOT_HOMOLOGATED');
});
