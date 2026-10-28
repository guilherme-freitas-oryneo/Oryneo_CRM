import { assertEquals } from 'jsr:@std/assert@1';
import { classifyAssistedPaymentEvent } from '../_shared/billing/assisted-payment-webhook.ts';

const obligation = {
  id: 'caee4a1e-1bf7-4d45-847f-1d7e741b55ab',
  billing_environment: 'test' as const,
  stripe_checkout_session_id: 'cs_test_assisted',
  amount_total: 109990,
  currency: 'brl',
  state: 'open' as const,
};

Deno.test('liquida Pix TEST válido e cancela apenas os lembretes da obrigação', () => {
  assertEquals(classifyAssistedPaymentEvent({
    eventType: 'checkout.session.async_payment_succeeded',
    livemode: false,
    duplicate: false,
    obligation,
    session: { id: 'cs_test_assisted', amount_total: 109990, currency: 'brl', payment_status: 'paid' },
  }), { outcome: 'paid', cancelReminders: true, enqueueConfirmation: true });
});

Deno.test('evento duplicado e falha tardia não desfazem pagamento confirmado', () => {
  assertEquals(classifyAssistedPaymentEvent({
    eventType: 'checkout.session.async_payment_succeeded', livemode: false, duplicate: true, obligation,
    session: { id: 'cs_test_assisted', amount_total: 109990, currency: 'brl', payment_status: 'paid' },
  }), { outcome: 'ignored', cancelReminders: false, enqueueConfirmation: false });
  assertEquals(classifyAssistedPaymentEvent({
    eventType: 'checkout.session.async_payment_failed', livemode: false, duplicate: false,
    obligation: { ...obligation, state: 'paid' },
    session: { id: 'cs_test_assisted', amount_total: 109990, currency: 'brl', payment_status: 'unpaid' },
  }), { outcome: 'ignored', cancelReminders: false, enqueueConfirmation: false });
});

Deno.test('valor, ambiente ou sessão divergentes exigem revisão sem atingir outra obrigação', () => {
  for (const input of [
    { livemode: true, session: { id: 'cs_test_assisted', amount_total: 109990, currency: 'brl', payment_status: 'paid' } },
    { livemode: false, session: { id: 'cs_test_assisted', amount_total: 1, currency: 'brl', payment_status: 'paid' } },
    { livemode: false, session: { id: 'cs_test_other', amount_total: 109990, currency: 'brl', payment_status: 'paid' } },
  ]) {
    assertEquals(classifyAssistedPaymentEvent({
      eventType: 'checkout.session.async_payment_succeeded', duplicate: false, obligation, ...input,
    }), { outcome: 'requires_review', cancelReminders: false, enqueueConfirmation: false });
  }
});
