/** A Checkout form completion is not a payment for asynchronous methods. */
export function checkoutEventIsSettled(eventType:string,paymentStatus:string|null|undefined):boolean{
 return paymentStatus==='paid'&&
  (eventType==='checkout.session.completed'||eventType==='checkout.session.async_payment_succeeded');
}
export function checkoutEventIsTerminalFailure(eventType:string):boolean{
 return eventType==='checkout.session.async_payment_failed'||eventType==='checkout.session.expired';
}
