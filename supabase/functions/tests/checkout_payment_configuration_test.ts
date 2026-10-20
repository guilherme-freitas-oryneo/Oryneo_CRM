import {assertEquals} from 'jsr:@std/assert';
import {checkoutPaymentConfiguration} from '../_shared/billing/checkout-payment-configuration.ts';
Deno.test('cartão conserva cobrança automática',()=>{
 const v=checkoutPaymentConfiguration('card','monthly');
 assertEquals(v.mode,'subscription');assertEquals(v.collectionMethod,'charge_automatically');assertEquals(v.paymentMethodTypes,['card']);
});
Deno.test('boleto recorrente gera faturas, não débito automático',()=>{
 for(const cycle of ['monthly','annual'] as const){
  const v=checkoutPaymentConfiguration('boleto',cycle);
  assertEquals(v.mode,'subscription');assertEquals(v.collectionMethod,'send_invoice');assertEquals(v.paymentMethodTypes,['boleto']);
 }
});
Deno.test('Pix avulso usa payment e não cria subscription',()=>{
 const v=checkoutPaymentConfiguration('pix','annual');
 assertEquals(v.mode,'payment');assertEquals(v.collectionMethod,null);assertEquals(v.paymentMethodTypes,['pix']);
});
