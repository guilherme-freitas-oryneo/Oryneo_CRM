export type BillingEnvironment = 'test' | 'live';

/**
 * The Stripe signature is verified before this function is called.  The
 * verified signing secret, not the JSON payload, selects the environment.
 */
export function verifiedWebhookEnvironment(
  verified: { test: boolean; live: boolean },
  livemode: unknown,
): BillingEnvironment | null {
  if (typeof livemode !== 'boolean' || verified.test === verified.live) return null;
  if (verified.test && livemode === false) return 'test';
  if (verified.live && livemode === true) return 'live';
  return null;
}
