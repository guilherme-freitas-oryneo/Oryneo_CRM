import { describe, expect, it } from 'vitest';
import { advanceDeliveryStatus, evaluateOutboundPolicy, type OutboundPolicyInput } from '../../supabase/functions/_shared/whatsapp/policy';

const eligible: OutboundPolicyInput = {
  channelEnabled: true,
  actor: 'automation',
  conversationMode: 'sdr_active',
  optedOut: false,
  consentGranted: true,
  serviceWindowOpen: true,
  kind: 'freeform',
  templateApproved: false,
};

describe('evaluateOutboundPolicy', () => {
  it('allows an eligible automation inside the service window', () => {
    expect(evaluateOutboundPolicy(eligible)).toEqual({ allowed: true });
  });

  it.each([
    [{ conversationMode: 'human_locked' }, 'HUMAN_LOCKED'],
    [{ conversationMode: 'review' }, 'REVIEW_REQUIRED'],
    [{ optedOut: true }, 'OPTED_OUT'],
    [{ consentGranted: false }, 'CONSENT_REQUIRED'],
    [{ channelEnabled: false }, 'CHANNEL_DISABLED'],
    [{ serviceWindowOpen: false }, 'SERVICE_WINDOW_CLOSED'],
  ] as const)('blocks automated sends when %j', (change, reason) => {
    expect(evaluateOutboundPolicy({ ...eligible, ...change })).toEqual({ allowed: false, reason });
  });

  it('lets a human answer a human-locked conversation inside the window', () => {
    expect(evaluateOutboundPolicy({ ...eligible, actor: 'human', conversationMode: 'human_locked' })).toEqual({ allowed: true });
  });

  it('blocks a human on opt-out as a safe default', () => {
    expect(evaluateOutboundPolicy({ ...eligible, actor: 'human', optedOut: true })).toEqual({ allowed: false, reason: 'OPTED_OUT' });
  });

  it('allows an approved template outside the service window', () => {
    expect(evaluateOutboundPolicy({ ...eligible, serviceWindowOpen: false, kind: 'template', templateApproved: true })).toEqual({ allowed: true });
  });

  it('rejects a template whose approval is not confirmed', () => {
    expect(evaluateOutboundPolicy({ ...eligible, kind: 'template', templateApproved: false })).toEqual({ allowed: false, reason: 'TEMPLATE_NOT_APPROVED' });
  });
});

describe('advanceDeliveryStatus', () => {
  it('does not regress a read message when old webhooks arrive', () => {
    expect(advanceDeliveryStatus('read', 'delivered')).toBe('read');
    expect(advanceDeliveryStatus('read', 'failed')).toBe('read');
  });

  it('accepts delivery after an earlier failure report', () => {
    expect(advanceDeliveryStatus('failed', 'delivered')).toBe('delivered');
  });

  it('records failure after send but preserves later delivery', () => {
    expect(advanceDeliveryStatus('sent', 'failed')).toBe('failed');
    expect(advanceDeliveryStatus('delivered', 'failed')).toBe('delivered');
  });
});
