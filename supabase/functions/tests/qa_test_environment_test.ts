import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { getQaTestEnvironment } from '../_shared/billing/qa-test-environment.ts';

Deno.test('QA aceita o par legado somente quando ele pertence ao ambiente TEST', () => {
  const config = getQaTestEnvironment((name) => ({
    STRIPE_SECRET_KEY: 'sk_test_existing',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_existing',
  })[name]);
  assertEquals(config.secretKey, 'sk_test_existing');
  assertEquals(config.publishableKey, 'pk_test_existing');
});

Deno.test('QA continua rejeitando o par legado de produção', () => {
  assertThrows(() => getQaTestEnvironment((name) => ({
    STRIPE_SECRET_KEY: 'sk_live_forbidden',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_forbidden',
  })[name]), Error, 'QA_TEST_SECRET_KEY_INVALID');
});
