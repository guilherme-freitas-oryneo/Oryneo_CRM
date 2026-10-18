/** Presentation only: the webhook is the sole writer of financial state. */
export function publicPaymentStatus(
  persistedStatus: string,
  expiresAt: string,
  stripePaymentStatus: string | null,
  now = Date.now(),
): string {
  if (persistedStatus !== 'awaiting_payment') return persistedStatus;
  if (stripePaymentStatus === 'paid') return 'processing';
  if (new Date(expiresAt).getTime() < now) return 'expired';
  return persistedStatus;
}
