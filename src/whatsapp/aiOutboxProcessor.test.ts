import { describe, expect, it, vi } from 'vitest';
import {
  MetaSendError,
  processAiOutboxItem,
  type AiOutboxContext,
  type AiOutboxDependencies,
  type AiOutboxItem,
} from '../../supabase/functions/_shared/whatsapp/aiOutboxProcessor';

const item: AiOutboxItem = {
  id: 'outbox-1', jobId: 'job-1', conversationId: 'conversation-1',
  leaseToken: 'lease-1', body: 'Vamos entender seu cenário?', attempts: 1,
};
const context: AiOutboxContext = {
  channelEnabled: true,
  conversationMode: 'sdr_active',
  optedOut: false,
  consentGranted: true,
  lastInboundAt: '2026-10-28T20:00:00.000Z',
  globalMode: 'auto',
  recipient: '5521999999999',
  jobInboundMessageId: 'message-2',
  latestInboundMessageId: 'message-2',
};

function fixture(change: Partial<AiOutboxContext> = {}) {
  const finishes: unknown[] = [];
  const sendText = vi.fn().mockResolvedValue({ messageId: 'wamid.out.1' });
  const dependencies: AiOutboxDependencies = {
    now: () => new Date('2026-10-28T20:05:00.000Z'),
    loadContext: vi.fn().mockResolvedValue({ ...context, ...change }),
    sendText,
    finish: vi.fn(async (input) => { finishes.push(input); return input.outcome === 'retry' ? 'retry_wait' : input.outcome; }),
  };
  return { dependencies, sendText, finishes };
}

describe('processAiOutboxItem', () => {
  it('sends one eligible reply and durably records the provider message id', async () => {
    const test = fixture();
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'sent' });
    expect(test.sendText).toHaveBeenCalledWith({ to: context.recipient, text: item.body });
    expect(test.finishes).toEqual([{
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'sent', providerMessageId: 'wamid.out.1', errorCode: null,
    }]);
  });

  it.each([
    [{ conversationMode: 'review' as const }, 'REVIEW_REQUIRED'],
    [{ conversationMode: 'human_locked' as const }, 'HUMAN_LOCKED'],
    [{ optedOut: true }, 'OPTED_OUT'],
    [{ consentGranted: false }, 'CONSENT_REQUIRED'],
    [{ channelEnabled: false }, 'CHANNEL_DISABLED'],
    [{ globalMode: 'suggest' as const }, 'AUTO_MODE_DISABLED'],
    [{ lastInboundAt: '2026-10-27T19:59:59.000Z' }, 'SERVICE_WINDOW_CLOSED'],
  ])('cancels before Meta when current policy is ineligible: %s', async (change, errorCode) => {
    const test = fixture(change);
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'cancelled', reason: errorCode });
    expect(test.sendText).not.toHaveBeenCalled();
    expect(test.finishes).toEqual([{
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'cancelled', providerMessageId: null, errorCode,
    }]);
  });

  it('cancels a generated answer when a newer inbound already exists', async () => {
    const test = fixture({ latestInboundMessageId: 'message-3' });
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'cancelled', reason: 'NEWER_INBOUND' });
    expect(test.sendText).not.toHaveBeenCalled();
  });

  it('backs off after an explicit Meta rate limit response', async () => {
    const test = fixture();
    test.sendText.mockRejectedValue(new MetaSendError('META_RATE_LIMITED', true, false));
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'retry_wait', reason: 'META_RATE_LIMITED' });
  });

  it('requires human review when Meta rejects authentication', async () => {
    const test = fixture();
    test.sendText.mockRejectedValue(new MetaSendError('META_AUTH', false, false));
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'human_review', reason: 'META_AUTH' });
  });

  it('marks a timeout after dispatch uncertain and never retries blindly', async () => {
    const test = fixture();
    test.sendText.mockRejectedValue(new MetaSendError('META_RESULT_UNKNOWN', false, true));
    await expect(processAiOutboxItem(item, test.dependencies)).resolves.toEqual({ state: 'uncertain', reason: 'META_RESULT_UNKNOWN' });
    expect(test.finishes).toEqual([{
      outboxId: item.id, leaseToken: item.leaseToken, outcome: 'uncertain', providerMessageId: null, errorCode: 'META_RESULT_UNKNOWN',
    }]);
  });
});
