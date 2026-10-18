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

type PublicOrderState = {
  status: string;
  expires_at: string;
  stripe_checkout_session_id: string | null;
};

type StripeSessionState = { payment_status?: string; client_secret?: string | null };

export async function publicCheckoutSnapshot(
  order: PublicOrderState,
  retrieveSession: (sessionId: string) => Promise<StripeSessionState | null>,
  now = Date.now(),
): Promise<{ status: string; clientSecret: string | null }> {
  const session = order.status === 'awaiting_payment' && order.stripe_checkout_session_id
    ? await retrieveSession(order.stripe_checkout_session_id)
    : null;
  const status = publicPaymentStatus(order.status, order.expires_at, session?.payment_status ?? null, now);
  return { status, clientSecret: status === 'awaiting_payment' ? session?.client_secret ?? null : null };
}
