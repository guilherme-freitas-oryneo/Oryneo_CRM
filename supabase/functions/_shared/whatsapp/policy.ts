/** Pure guard for the final server-side send path. Call it with freshly read, trusted state. */
export type ConversationMode = 'sdr_active' | 'review' | 'human_locked' | 'resolved';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type OutboundPolicyInput = {
  channelEnabled: boolean;
  actor: 'human' | 'automation';
  conversationMode: ConversationMode;
  optedOut: boolean;
  consentGranted: boolean;
  serviceWindowOpen: boolean;
  kind: 'freeform' | 'template';
  templateApproved: boolean;
};

export type OutboundDecision = { allowed: true } | {
  allowed: false;
  reason: 'CHANNEL_DISABLED' | 'OPTED_OUT' | 'CONSENT_REQUIRED' | 'HUMAN_LOCKED'
    | 'REVIEW_REQUIRED' | 'CONVERSATION_CLOSED' | 'SERVICE_WINDOW_CLOSED' | 'TEMPLATE_NOT_APPROVED';
};

export function evaluateOutboundPolicy(input: OutboundPolicyInput): OutboundDecision {
  if (!input.channelEnabled) return { allowed: false, reason: 'CHANNEL_DISABLED' };
  if (input.optedOut) return { allowed: false, reason: 'OPTED_OUT' };
  if (!input.consentGranted) return { allowed: false, reason: 'CONSENT_REQUIRED' };
  if (input.actor === 'automation') {
    if (input.conversationMode === 'human_locked') return { allowed: false, reason: 'HUMAN_LOCKED' };
    if (input.conversationMode === 'review') return { allowed: false, reason: 'REVIEW_REQUIRED' };
    if (input.conversationMode === 'resolved') return { allowed: false, reason: 'CONVERSATION_CLOSED' };
  }
  if (input.kind === 'template') {
    if (!input.templateApproved) return { allowed: false, reason: 'TEMPLATE_NOT_APPROVED' };
  } else if (!input.serviceWindowOpen) {
    return { allowed: false, reason: 'SERVICE_WINDOW_CLOSED' };
  }
  return { allowed: true };
}

const progress: Record<Exclude<DeliveryStatus, 'failed'>, number> = {
  pending: 0, sent: 1, delivered: 2, read: 3,
};

/** Keep the strongest delivery evidence when provider status webhooks arrive out of order. */
export function advanceDeliveryStatus(current: DeliveryStatus, incoming: DeliveryStatus): DeliveryStatus {
  if (incoming === 'failed') return current === 'pending' || current === 'sent' ? 'failed' : current;
  if (current === 'failed') return incoming === 'pending' ? current : incoming;
  return progress[incoming] > progress[current] ? incoming : current;
}
