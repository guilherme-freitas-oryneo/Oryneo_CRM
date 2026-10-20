/** Stripe invoices have separate creation, finalization, payment and expiry phases.
 * Only confirmed payment events may transition an order to paid.
 */
export type InvoiceEventDecision='settle'|'mark_failed'|'track_pending'|'ignore';
export function classifyInvoiceEvent(eventType:string,invoiceStatus:unknown,paid:unknown):InvoiceEventDecision{
 if(eventType==='invoice.paid'||eventType==='invoice.payment_succeeded'){
  return paid===true&&invoiceStatus==='paid'?'settle':'ignore';
 }
 if(eventType==='invoice.payment_failed')return 'mark_failed';
 if(eventType==='invoice.created'||eventType==='invoice.finalized'||eventType==='invoice.sent')return 'track_pending';
 return 'ignore';
}
export function canGrantInvoiceEntitlement(decision:InvoiceEventDecision):boolean{
 return decision==='settle';
}
