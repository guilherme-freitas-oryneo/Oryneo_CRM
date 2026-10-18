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
  let session: StripeSessionState | null = null;
  if (order.status === 'awaiting_payment') {
    if (!order.stripe_checkout_session_id) {
      const status = publicPaymentStatus(order.status, order.expires_at, null, now);
      if (status === 'expired') return { status, clientSecret: null };
      throw new Error('BILLING_SESSION_UNAVAILABLE');
    }
    try {
      session = await retrieveSession(order.stripe_checkout_session_id);
    } catch {
      throw new Error('BILLING_SESSION_UNAVAILABLE');
    }
    if (!session) throw new Error('BILLING_SESSION_UNAVAILABLE');
  }
  const status = publicPaymentStatus(order.status, order.expires_at, session?.payment_status ?? null, now);
  const clientSecret = status === 'awaiting_payment' ? session?.client_secret ?? null : null;
  if (status === 'awaiting_payment' && !clientSecret) throw new Error('BILLING_SESSION_UNAVAILABLE');
  return { status, clientSecret };
}
