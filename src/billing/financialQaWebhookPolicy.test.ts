import { describe, expect, it } from 'vitest';
import { verifiedStripeInvoicePaymentProof } from '../../supabase/functions/_shared/billing/financial-qa-webhook-policy';

describe('financial QA boleto settlement proof', () => {
  const invoice = {
    id: 'in_test_123', status: 'paid', total: 1000, amount_paid: 1000,
    amount_remaining: 0, currency: 'brl', customer: 'cus_test_123',
  };
  const payments = {
    has_more: false,
    data: [{
      livemode: false, status: 'paid', invoice: 'in_test_123', amount_paid: 1000,
      payment: { type: 'payment_intent', payment_intent: 'pi_test_123' },
    }],
  };
  const intent = {
    livemode: false, id: 'pi_test_123', status: 'succeeded', currency: 'brl',
    customer: 'cus_test_123', amount_received: 1000,
  };

  it('requires actual settled PaymentIntent proof and rejects paid-out-of-band invoices', () => {
    expect(verifiedStripeInvoicePaymentProof(invoice, payments, intent)).toBe(true);
    expect(verifiedStripeInvoicePaymentProof({ ...invoice, amount_paid_out_of_band: 1000 }, payments, intent)).toBe(false);
  });
});
