/**
 * A checkout expiration without an internal order cannot settle money.
 * Only that terminal non-payment event may be acknowledged after a successful
 * lookup; missing paid/pending sessions must remain retryable for reconciliation.
 */
export type CheckoutLookupDisposition = 'process' | 'retry' | 'acknowledge_unlinked_expiration';

export function classifyCheckoutLookup(
  eventType: string,
  orderFound: boolean,
  lookupFailed: boolean,
): CheckoutLookupDisposition {
  if (lookupFailed) return 'retry';
  if (orderFound) return 'process';
  return eventType === 'checkout.session.expired'
    ? 'acknowledge_unlinked_expiration'
    : 'retry';
}
