export type AiOutboxItem = {
  id: string;
  jobId: string;
  conversationId: string;
  leaseToken: string;
  body: string;
  attempts: number;
};

export type AiOutboxContext = {
  channelEnabled: boolean;
  conversationMode: 'sdr_active' | 'review' | 'human_locked' | 'resolved';
  optedOut: boolean;
  consentGranted: boolean;
  lastInboundAt: string | null;
  globalMode: 'off' | 'suggest' | 'auto';
  recipient: string;
  jobInboundMessageId: string;
  latestInboundMessageId: string | null;
};

type SendOutcome = 'sent' | 'retry' | 'uncertain' | 'cancelled' | 'human_review';
type FinishedState = 'sent' | 'retry_wait' | 'uncertain' | 'cancelled' | 'human_review' | 'stale';

export type AiOutboxDependencies = {
  now(): Date;
  loadContext(item: AiOutboxItem): Promise<AiOutboxContext>;
  sendText(input: { to: string; text: string }): Promise<{ messageId: string }>;
  finish(input: {
    outboxId: string;
    leaseToken: string;
    outcome: SendOutcome;
    providerMessageId: string | null;
    errorCode: string | null;
  }): Promise<FinishedState>;
};

export type AiSendDecision = { state: FinishedState; reason?: string };

export class MetaSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly uncertain: boolean,
  ) {
    super(code);
    this.name = 'MetaSendError';
  }
}

function serviceWindowOpen(lastInboundAt: string | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  const timestamp = Date.parse(lastInboundAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp < 24 * 60 * 60 * 1000;
}

function blockedReason(context: AiOutboxContext, now: Date): string | null {
  if (!context.channelEnabled) return 'CHANNEL_DISABLED';
  if (context.optedOut) return 'OPTED_OUT';
  if (!context.consentGranted) return 'CONSENT_REQUIRED';
  if (context.conversationMode === 'human_locked') return 'HUMAN_LOCKED';
  if (context.conversationMode === 'review') return 'REVIEW_REQUIRED';
  if (context.conversationMode === 'resolved') return 'CONVERSATION_CLOSED';
  if (context.globalMode !== 'auto') return 'AUTO_MODE_DISABLED';
  if (!serviceWindowOpen(context.lastInboundAt, now)) return 'SERVICE_WINDOW_CLOSED';
  if (context.latestInboundMessageId !== context.jobInboundMessageId) return 'NEWER_INBOUND';
  return null;
}

export async function processAiOutboxItem(item: AiOutboxItem, dependencies: AiOutboxDependencies): Promise<AiSendDecision> {
  let context: AiOutboxContext;
  try {
    context = await dependencies.loadContext(item);
  } catch {
    const state = await dependencies.finish({
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'retry',
      providerMessageId: null, errorCode: 'META_CONTEXT_UNAVAILABLE',
    });
    return { state, reason: 'META_CONTEXT_UNAVAILABLE' };
  }

  const reason = blockedReason(context, dependencies.now());
  if (reason) {
    const state = await dependencies.finish({
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'cancelled',
      providerMessageId: null, errorCode: reason,
    });
    return state === 'stale' ? { state } : { state, reason };
  }

  try {
    const sent = await dependencies.sendText({ to: context.recipient, text: item.body });
    const state = await dependencies.finish({
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'sent',
      providerMessageId: sent.messageId, errorCode: null,
    });
    return { state };
  } catch (error) {
    const classified = error instanceof MetaSendError
      ? error
      : new MetaSendError('META_RESULT_UNKNOWN', false, true);
    const outcome: SendOutcome = classified.uncertain
      ? 'uncertain'
      : classified.retryable ? 'retry' : 'human_review';
    const state = await dependencies.finish({
      outboxId: item.id, leaseToken: item.leaseToken, outcome,
      providerMessageId: null, errorCode: classified.code,
    });
    return { state, reason: classified.code };
  }
}
