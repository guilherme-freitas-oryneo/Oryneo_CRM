import {assertEquals} from 'jsr:@std/assert';
import {checkoutEventIsSettled,checkoutEventIsTerminalFailure} from '../_shared/billing/checkout-settlement-policy.ts';
Deno.test('Pix checkout completed unpaid must not provision',()=>{
 assertEquals(checkoutEventIsSettled('checkout.session.completed','unpaid'),false);
 assertEquals(checkoutEventIsSettled('checkout.session.completed','no_payment_required'),false);
 assertEquals(checkoutEventIsSettled('checkout.session.completed','paid'),true);
});
Deno.test('Pix asynchronous confirmation alone grants settlement eligibility',()=>{
 assertEquals(checkoutEventIsSettled('checkout.session.async_payment_succeeded','paid'),true);
 assertEquals(checkoutEventIsSettled('checkout.session.async_payment_succeeded','unpaid'),false);
 assertEquals(checkoutEventIsSettled('checkout.session.async_payment_failed','paid'),false);
});
Deno.test('expired and failed Checkout events never fulfill',()=>{
 for(const event of ['checkout.session.expired','checkout.session.async_payment_failed']){
  assertEquals(checkoutEventIsSettled(event,'paid'),false);
  assertEquals(checkoutEventIsTerminalFailure(event),true);
 }
});
