import { type BillingEnvironmentConfig } from './environment.ts';

/**
 * QA always receives a TEST pair. The established legacy names remain valid
 * during migration, but `getBillingEnvironmentConfig` rejects any LIVE value.
 */
export function getQaTestEnvironment(
  readEnvironment: (name: string) => string | undefined,
): BillingEnvironmentConfig {
  const secretKey = readEnvironment('STRIPE_TEST_SECRET_KEY') || readEnvironment('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('QA_TEST_SECRET_KEY_MISSING');
  if (!/^(?:sk|rk)_test_/.test(secretKey)) throw new Error('QA_TEST_SECRET_KEY_INVALID');

  const publishableKey = readEnvironment('STRIPE_TEST_PUBLISHABLE_KEY') ||
    readEnvironment('STRIPE_PUBLISHABLE_KEY');
  if (!publishableKey) throw new Error('QA_TEST_PUBLISHABLE_KEY_MISSING');
  if (!/^pk_test_/.test(publishableKey)) throw new Error('QA_TEST_PUBLISHABLE_KEY_INVALID');

  return { environment: 'test', livemode: false, secretKey, publishableKey };
}

export function getQaTestSecret(
  readEnvironment: (name: string) => string | undefined,
): string {
  return getQaTestEnvironment(readEnvironment).secretKey;
}
