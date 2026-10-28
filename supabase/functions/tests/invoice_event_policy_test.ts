import {assertEquals} from 'jsr:@std/assert';
import {classifyInvoiceEvent,canGrantInvoiceEntitlement} from '../_shared/billing/invoice-event-policy.ts';
Deno.test('invoice creation and finalization never provision access',()=>{
 for(const event of ['invoice.created','invoice.finalized','invoice.sent']){
  const decision=classifyInvoiceEvent(event,'open',false);
  assertEquals(decision,'track_pending');
  assertEquals(canGrantInvoiceEntitlement(decision),false);
 }
});
Deno.test('invoice payment requires paid invoice status and explicit paid flag',()=>{
 assertEquals(classifyInvoiceEvent('invoice.paid','paid',true),'settle');
 assertEquals(classifyInvoiceEvent('invoice.payment_succeeded','paid',true),'settle');
 assertEquals(classifyInvoiceEvent('invoice.paid','open',false),'ignore');
 assertEquals(classifyInvoiceEvent('invoice.paid','paid',false),'ignore');
});
Deno.test('failed and unknown invoice events do not provision',()=>{
 assertEquals(classifyInvoiceEvent('invoice.payment_failed','open',false),'mark_failed');
 assertEquals(canGrantInvoiceEntitlement(classifyInvoiceEvent('invoice.payment_failed','open',false)),false);
 assertEquals(classifyInvoiceEvent('invoice.voided','void',false),'ignore');
});
