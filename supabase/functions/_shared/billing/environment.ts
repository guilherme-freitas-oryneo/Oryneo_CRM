export type BillingEnvironment = 'test' | 'live';

export type BillingEnvironmentConfig = {
  environment: BillingEnvironment;
  livemode: boolean;
  secretKey: string;
  publishableKey: string;
};

type EnvironmentReader = (name: string) => string | undefined;

const secretPattern = {
  test: /^(?:sk|rk)_test_/,
  live: /^(?:sk|rk)_live_/,
} as const;

const publishablePattern = {
  test: /^pk_test_/,
  live: /^pk_live_/,
} as const;

export function parseBillingEnvironment(value: string | undefined): BillingEnvironment {
  if (value === 'test' || value === 'live') return value;
  throw new Error('BILLING_ENVIRONMENT_NOT_CONFIGURED');
}

export function billingEnvironmentMatchesLivemode(
  environment: BillingEnvironment,
  livemode: boolean,
): boolean {
  return (environment === 'live') === livemode;
}

export function getBillingEnvironmentConfig(
  environment: BillingEnvironment,
  readEnvironment: EnvironmentReader,
): BillingEnvironmentConfig {
  const upper = environment.toUpperCase();
  // Legacy names are accepted only for the sandbox migration window.
  const secretKey = readEnvironment(`STRIPE_${upper}_SECRET_KEY`) ||
    (environment === 'test' ? readEnvironment('STRIPE_SECRET_KEY') : undefined);
  const publishableKey = readEnvironment(`STRIPE_${upper}_PUBLISHABLE_KEY`) ||
    (environment === 'test' ? readEnvironment('STRIPE_PUBLISHABLE_KEY') : undefined);
  if (!secretKey || !publishableKey) throw new Error('BILLING_ENVIRONMENT_NOT_CONFIGURED');
  if (!secretPattern[environment].test(secretKey) || !publishablePattern[environment].test(publishableKey)) {
    throw new Error('BILLING_ENVIRONMENT_MISMATCH');
  }
  return {
    environment,
    livemode: environment === 'live',
    secretKey,
    publishableKey,
  };
}
