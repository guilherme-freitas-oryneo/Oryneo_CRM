import assert from 'node:assert/strict';
import {
  canTransitionObligation,
  competenceKey,
  obligationIdentity,
} from '../_shared/billing/obligations.ts';

Deno.test('cria competências mensais e trimestrais canônicas', () => {
  assert.equal(competenceKey('plan_monthly', '2026-01-31T23:59:59.000Z'), '2026-01');
  assert.equal(competenceKey('traffic_quarterly', '2026-01-01T00:00:00.000Z'), '2026-Q1');
  assert.equal(competenceKey('traffic_quarterly', '2026-10-01T00:00:00.000Z'), '2026-Q4');
});

Deno.test('não rebaixa uma obrigação já liquidada', () => {
  assert.equal(canTransitionObligation('paid', 'failed'), false);
  assert.equal(canTransitionObligation('paid', 'expired'), false);
  assert.equal(canTransitionObligation('processing', 'paid'), true);
  assert.equal(canTransitionObligation('open', 'processing'), true);
});

Deno.test('a identidade da obrigação separa TEST de LIVE', () => {
  const base = {
    orderId: 'd5393032-ea5c-4c44-99e4-44558b3be112',
    method: 'pix_assisted' as const,
    kind: 'plan_monthly',
    dueAt: '2026-02-01T12:00:00.000Z',
  };
  assert.notEqual(
    obligationIdentity({ ...base, environment: 'test' }),
    obligationIdentity({ ...base, environment: 'live' }),
  );
});
