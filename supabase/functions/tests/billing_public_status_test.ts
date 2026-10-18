import { assertEquals } from 'jsr:@std/assert@1';
import { publicPaymentStatus } from '../_shared/billing/public-status.ts';

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
