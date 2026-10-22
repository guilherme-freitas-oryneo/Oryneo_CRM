export type AssistedPaymentMethod = 'pix_assisted' | 'boleto_assisted';

export type ObligationState =
  | 'scheduled'
  | 'open'
  | 'processing'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'overdue'
  | 'canceled'
  | 'requires_review';

export type BillingEnvironment = 'test' | 'live';

const transitionTargets: Readonly<Record<ObligationState, readonly ObligationState[]>> = {
  scheduled: ['open', 'canceled', 'requires_review'],
  open: ['processing', 'paid', 'expired', 'failed', 'canceled', 'requires_review'],
  processing: ['paid', 'failed', 'expired', 'overdue', 'requires_review'],
  paid: [],
  expired: ['paid', 'requires_review'],
  failed: ['open', 'processing', 'paid', 'expired', 'requires_review'],
  overdue: ['paid', 'requires_review', 'canceled'],
  canceled: [],
  requires_review: ['open', 'processing', 'paid', 'canceled'],
};

const asUtcDate = (value: string): Date => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_DUE_AT');
  return date;
};

export function competenceKey(kind: string, dueAt: string): string {
  const date = asUtcDate(dueAt);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (kind.includes('quarterly')) return `${year}-Q${Math.ceil(month / 3)}`;
  if (kind.includes('annual') || kind.includes('yearly')) return String(year);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function canTransitionObligation(from: ObligationState, to: ObligationState): boolean {
  return from === to || transitionTargets[from].includes(to);
}

export function obligationIdentity(input: {
  orderId: string;
  method: AssistedPaymentMethod;
  kind: string;
  dueAt: string;
  environment: BillingEnvironment;
}): string {
  return [input.environment, input.orderId, input.method, input.kind, competenceKey(input.kind, input.dueAt)].join(':');
}
