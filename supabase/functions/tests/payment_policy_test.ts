import { assertEquals, assertThrows } from 'jsr:@std/assert';
import {canProvisionAfterSettlement,resolvePaymentPolicy,shouldDisplayAwaitingPayment} from '../_shared/billing/payment-policy.ts';

Deno.test('cartão conserva assinatura recorrente',()=>{
 const p=resolvePaymentPolicy('card','monthly');
 assertEquals(p.stripeMode,'subscription');
 assertEquals(p.automaticallyRenews,true);
 assertEquals(p.asynchronousSettlement,false);
});
Deno.test('boleto conserva ciclo de faturas mas aguarda liquidação',()=>{
 const p=resolvePaymentPolicy('boleto','annual');
 assertEquals(p.stripeMode,'subscription');
 assertEquals(p.automaticallyRenews,true);
 assertEquals(p.asynchronousSettlement,true);
 assertEquals(p.accessRequiresSettlement,true);
 assertEquals(shouldDisplayAwaitingPayment('boleto','awaiting_payment'),true);
});
Deno.test('Pix avulso nunca representa Pix Automático',()=>{
 const p=resolvePaymentPolicy('pix','monthly');
 assertEquals(p.stripeMode,'payment');
 assertEquals(p.automaticallyRenews,false);
 assertEquals(p.asynchronousSettlement,true);
});
Deno.test('nenhum estado pendente, falho ou cancelado provisiona acesso',()=>{
 for(const state of ['created','awaiting_payment','failed','expired','cancelled'] as const){
   assertEquals(canProvisionAfterSettlement(state),false);
 }
 assertEquals(canProvisionAfterSettlement('paid'),true);
});
Deno.test('rejeita periodicidade desconhecida',()=>{
 assertThrows(()=>resolvePaymentPolicy('card','weekly' as never),Error,'INVALID_BILLING_CYCLE');
});
