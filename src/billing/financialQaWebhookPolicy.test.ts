import { describe, expect, it } from 'vitest';
import { verifiedStripeInvoicePaymentProof } from '../../supabase/functions/_shared/billing/financial-qa-webhook-policy';
import { buildPixCheckoutForm, type PaymentOrderContext, type ServerBillingSelection } from '../../supabase/functions/_shared/billing/stripe-payment-forms';

describe('isolated QA Pix return URL', () => {
  const selection: ServerBillingSelection = {
    plan: 'Start', cycle: 'monthly', amountTotal: 173980, trafficRenewalPriceId: null,
    items: [
      { key: 'start_monthly', label: 'Start', amountCents: 74990, stripePriceId: 'price_month', recurring: true },
      { key: 'start_setup', label: 'Setup', amountCents: 98990, stripePriceId: 'price_setup', recurring: false },
    ],
  };
  const context: PaymentOrderContext = {
    orderId: '11111111-1111-4111-8111-111111111111', environment: 'test',
    customerEmail: 'qa@example.com', customerName: 'Cliente QA',
    returnUrl: 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/qa/pr-46/?qa_return=1',
  };

  it('retains the dedicated preview path for Stripe return', () => {
    expect(buildPixCheckoutForm(selection, context).get('return_url')).toBe(context.returnUrl);
  });

  it('rejects another path on the trusted Pages host', () => {
    expect(() => buildPixCheckoutForm(selection, {
      ...context, returnUrl: 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/admin/',
    })).toThrow('INVALID_RETURN_URL');
  });
});

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
