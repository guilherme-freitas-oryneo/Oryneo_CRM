import type { ObligationState } from './obligations.ts';

type AssistedObligation = {
  id: string;
  billing_environment: 'test' | 'live';
  stripe_checkout_session_id: string | null;
  amount_total: number;
  currency: string;
  state: ObligationState;
};

type CheckoutSession = {
  id: string;
  amount_total: number;
  currency: string;
  payment_status: string;
};

export type AssistedPaymentOutcome = 'paid' | 'processing' | 'failed' | 'expired' | 'ignored' | 'requires_review';

export function classifyAssistedPaymentEvent(input: {
  eventType: string;
  livemode: boolean;
  duplicate: boolean;
  obligation: AssistedObligation;
  session: CheckoutSession;
}): { outcome: AssistedPaymentOutcome; cancelReminders: boolean; enqueueConfirmation: boolean } {
  const ignored = { outcome: 'ignored' as const, cancelReminders: false, enqueueConfirmation: false };
  const review = { outcome: 'requires_review' as const, cancelReminders: false, enqueueConfirmation: false };
  if (input.duplicate || input.obligation.state === 'paid') return ignored;
  if ((input.obligation.billing_environment === 'live') !== input.livemode ||
      input.obligation.stripe_checkout_session_id !== input.session.id ||
      input.obligation.amount_total !== input.session.amount_total ||
      input.obligation.currency !== input.session.currency) return review;
  if (input.eventType === 'checkout.session.completed' || input.eventType === 'checkout.session.async_payment_succeeded') {
    return input.session.payment_status === 'paid'
      ? { outcome: 'paid', cancelReminders: true, enqueueConfirmation: true }
      : { outcome: 'processing', cancelReminders: false, enqueueConfirmation: false };
  }
  if (input.eventType === 'checkout.session.async_payment_failed') return { outcome: 'failed', cancelReminders: false, enqueueConfirmation: false };
  if (input.eventType === 'checkout.session.expired') return { outcome: 'expired', cancelReminders: false, enqueueConfirmation: false };
  return ignored;
}
