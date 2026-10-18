import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { publicCheckoutSnapshot, publicPaymentStatus } from '../_shared/billing/public-status.ts';

const future = '2026-10-19T00:00:00Z';
const past = '2026-10-17T00:00:00Z';
const now = Date.parse('2026-10-18T00:00:00Z');

Deno.test('Stripe pago aguarda reconciliação antes de mostrar pedido pago', () => {
  assertEquals(publicPaymentStatus('awaiting_payment', future, 'paid', now), 'processing');
  assertEquals(publicPaymentStatus('awaiting_payment', past, 'paid', now), 'processing');
});

Deno.test('expiração é apresentada sem criar confirmação financeira', () => {
  assertEquals(publicPaymentStatus('awaiting_payment', past, 'unpaid', now), 'expired');
  assertEquals(publicPaymentStatus('awaiting_payment', future, 'unpaid', now), 'awaiting_payment');
});

Deno.test('estado persistido pelo webhook prevalece sobre a sessão', () => {
  assertEquals(publicPaymentStatus('paid', past, 'unpaid', now), 'paid');
  assertEquals(publicPaymentStatus('payment_failed', future, 'paid', now), 'payment_failed');
});

Deno.test('consulta antes e depois do webhook não grava nem antecipa pagamento', async () => {
  const order = { status: 'awaiting_payment', expires_at: future, stripe_checkout_session_id: 'cs_test_fixture' };
  let stripeReads = 0;
  const retrieveSession = async (id: string) => {
    assertEquals(id, 'cs_test_fixture');
    stripeReads++;
    return { payment_status: 'paid', client_secret: 'secret_fixture' };
  };

  const beforeWebhook = await publicCheckoutSnapshot(order, retrieveSession, now);
  assertEquals(beforeWebhook, { status: 'processing', clientSecret: null });
  assertEquals(order.status, 'awaiting_payment');

  // Somente o webhook pode persistir a reconciliação financeira.
  const reconciledOrder = { ...order, status: 'paid' };
  const afterWebhook = await publicCheckoutSnapshot(reconciledOrder, retrieveSession, now);
  assertEquals(afterWebhook, { status: 'paid', clientSecret: null });
  assertEquals(stripeReads, 1);
});

Deno.test('leitura de sessão sem pagamento mantém checkout utilizável', async () => {
  const order = { status: 'awaiting_payment', expires_at: future, stripe_checkout_session_id: 'cs_test_fixture' };
  assertEquals(await publicCheckoutSnapshot(order, async () => ({
    payment_status: 'unpaid', client_secret: 'secret_fixture',
  }), now), { status: 'awaiting_payment', clientSecret: 'secret_fixture' });
});

Deno.test('falha ao consultar Stripe não vira falha de pagamento', async () => {
  const order = { status: 'awaiting_payment', expires_at: future, stripe_checkout_session_id: 'cs_test_fixture' };
  await assertRejects(
    () => publicCheckoutSnapshot(order, async () => null, now),
    Error,
    'BILLING_SESSION_UNAVAILABLE',
  );
  assertEquals(order.status, 'awaiting_payment');
});

Deno.test('exceção transitória da Stripe é sanitizada e não altera o estado persistido', async () => {
  const order = { status: 'awaiting_payment', expires_at: future, stripe_checkout_session_id: 'cs_test_fixture' };
  await assertRejects(
    () => publicCheckoutSnapshot(order, async () => { throw new Error('private upstream detail'); }, now),
    Error,
    'BILLING_SESSION_UNAVAILABLE',
  );
  assertEquals(order.status, 'awaiting_payment');
});

Deno.test('sessão sem client secret não é apresentada como falha de pagamento', async () => {
  const order = { status: 'awaiting_payment', expires_at: future, stripe_checkout_session_id: 'cs_test_fixture' };
  await assertRejects(
    () => publicCheckoutSnapshot(order, async () => ({ payment_status: 'unpaid' }), now),
    Error,
    'BILLING_SESSION_UNAVAILABLE',
  );
  assertEquals(order.status, 'awaiting_payment');
});

Deno.test('pedido vencido sem sessão Stripe continua identificável como expirado', async () => {
  const order = { status: 'awaiting_payment', expires_at: past, stripe_checkout_session_id: null };
  assertEquals(await publicCheckoutSnapshot(order, async () => null, now), { status: 'expired', clientSecret: null });
  assertEquals(order.status, 'awaiting_payment');
});
