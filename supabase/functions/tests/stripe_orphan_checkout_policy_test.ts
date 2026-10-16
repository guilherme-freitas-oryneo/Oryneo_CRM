import {assertEquals} from 'jsr:@std/assert@1';
import {classifyCheckoutLookup} from '../_shared/billing/checkout-webhook-policy.ts';

Deno.test('expiração sem pedido não exige retentativa perpétua',()=>{
  assertEquals(classifyCheckoutLookup('checkout.session.expired',false,false),'acknowledge_unlinked_expiration');
});

Deno.test('falha de leitura do banco nunca é reconhecida como resolvida',()=>{
  assertEquals(classifyCheckoutLookup('checkout.session.expired',false,true),'retry');
});

Deno.test('eventos financeiros com pedido ausente seguem retornando erro recuperável',()=>{
  for(const type of [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
  ]){
    assertEquals(classifyCheckoutLookup(type,false,false),'retry');
  }
});

Deno.test('eventos de um pedido existente seguem para reconciliação normal',()=>{
  assertEquals(classifyCheckoutLookup('checkout.session.expired',true,false),'process');
  assertEquals(classifyCheckoutLookup('checkout.session.completed',true,false),'process');
});
