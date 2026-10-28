/** ORYNEO billing policy. Pure functions; never trusts client-side price or settlement state. */
export type PaymentMethod = 'card' | 'boleto' | 'pix';
export type PaymentCycle = 'monthly' | 'annual';
export type SettlementState = 'created' | 'awaiting_payment' | 'paid' | 'failed' | 'expired' | 'cancelled';
export type PaymentPolicy = Readonly<{
  method: PaymentMethod;
  cycle: PaymentCycle;
  stripeMode: 'subscription' | 'payment';
  automaticallyRenews: boolean;
  asynchronousSettlement: boolean;
  /** Invoice collection is recurring, not automatic debit of a stored bank payment method. */
  requiresCustomerActionForEachInvoice: boolean;
  accessRequiresSettlement: true;
  label: string;
}>;
export function resolvePaymentPolicy(method: PaymentMethod, cycle: PaymentCycle): PaymentPolicy {
  if (cycle !== 'monthly' && cycle !== 'annual') throw new Error('INVALID_BILLING_CYCLE');
  switch (method) {
    case 'card': return {method,cycle,stripeMode:'subscription',automaticallyRenews:true,asynchronousSettlement:false,requiresCustomerActionForEachInvoice:false,accessRequiresSettlement:true,label:'Cartão'};
    case 'boleto': return {method,cycle,stripeMode:'subscription',automaticallyRenews:true,asynchronousSettlement:true,requiresCustomerActionForEachInvoice:true,accessRequiresSettlement:true,label:'Boleto recorrente — uma nova fatura por período'};
    case 'pix': return {method,cycle,stripeMode:'payment',automaticallyRenews:false,asynchronousSettlement:true,requiresCustomerActionForEachInvoice:true,accessRequiresSettlement:true,label:'Pix avulso — sem débito automático'};
    default: throw new Error('UNSUPPORTED_PAYMENT_METHOD');
  }
}
/** Settlement is authoritative only after a trusted server-side webhook or provider reconciliation. */
export function canProvisionAfterSettlement(state: SettlementState): boolean {
  return state === 'paid';
}
export function shouldDisplayAwaitingPayment(method: PaymentMethod, state: SettlementState): boolean {
  return (method === 'boleto' || method === 'pix') && (state === 'created' || state === 'awaiting_payment');
}
