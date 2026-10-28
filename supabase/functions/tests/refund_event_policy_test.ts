import { assertEquals } from 'jsr:@std/assert@1';
import { classifyRefundEvent } from '../_shared/billing/refund-event-policy.ts';

Deno.test('accepts successful and pending Stripe refund snapshots', () => {
  assertEquals(classifyRefundEvent('refund.created',{object:'refund',status:'succeeded',amount:5000,currency:'brl'}),'record');
  assertEquals(classifyRefundEvent('refund.updated',{object:'refund',status:'pending',amount:5000,currency:'brl'}),'record');
});

Deno.test('records a failed refund so the order is never marked refunded', () => {
  assertEquals(classifyRefundEvent('refund.failed',{object:'refund',status:'failed',amount:5000,currency:'brl'}),'record');
});

Deno.test('rejects malformed or non BRL refund snapshots', () => {
  assertEquals(classifyRefundEvent('refund.created',{object:'charge',status:'succeeded',amount:5000,currency:'brl'}),'reject');
  assertEquals(classifyRefundEvent('refund.created',{object:'refund',status:'succeeded',amount:0,currency:'brl'}),'reject');
  assertEquals(classifyRefundEvent('refund.created',{object:'refund',status:'succeeded',amount:5000,currency:'usd'}),'reject');
  assertEquals(classifyRefundEvent('charge.refunded',{object:'charge',amount_refunded:5000,currency:'brl'}),'ignore');
});
