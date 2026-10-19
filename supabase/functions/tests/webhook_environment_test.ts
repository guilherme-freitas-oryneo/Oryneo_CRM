import assert from 'node:assert/strict';
import { verifiedWebhookEnvironment } from '../_shared/billing/webhook-environment.ts';

Deno.test('evento Stripe só entra no ambiente cuja assinatura foi validada', () => {
  assert.equal(verifiedWebhookEnvironment({ test: true, live: false }, false), 'test');
  assert.equal(verifiedWebhookEnvironment({ test: false, live: true }, true), 'live');
  assert.equal(verifiedWebhookEnvironment({ test: true, live: false }, true), null);
  assert.equal(verifiedWebhookEnvironment({ test: false, live: true }, false), null);
  assert.equal(verifiedWebhookEnvironment({ test: false, live: false }, false), null);
  assert.equal(verifiedWebhookEnvironment({ test: true, live: true }, false), null);
});
