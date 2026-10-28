import { describe, expect, it, vi } from 'vitest';
import { AiProviderError } from '../../supabase/functions/_shared/whatsapp/aiProvider';
import { processAiJob, type AiJobContext, type AiJobDependencies, type AiJobRecord } from '../../supabase/functions/_shared/whatsapp/aiJobProcessor';

const job: AiJobRecord = {
  id: 'job-1', channelId: 'channel-1', conversationId: 'conversation-1',
  inboundMessageId: 'message-2', leaseToken: 'lease-1', attempts: 1,
};

const context: AiJobContext = {
  channelEnabled: true,
  conversationMode: 'sdr_active',
  optedOut: false,
  consentGranted: true,
  lastInboundAt: '2026-10-28T20:00:00.000Z',
  globalMode: 'auto',
  latestInboundMessageId: 'message-2',
  provider: 'openai',
  model: 'gpt-5-mini',
  apiKey: 'sk-test-only',
  systemPrompt: 'Seja breve e não invente informações.',
  trainingPrompt: 'Entenda o contexto comercial antes de responder.',
  attachmentText: '',
  messages: [{ role: 'user', content: 'Olá' }],
};

function dependencies(change: Partial<AiJobContext> = {}) {
  const completions: unknown[] = [];
  const generate = vi.fn().mockResolvedValue({ text: 'Como posso ajudar?', providerResponseId: 'resp_1' });
  const deps: AiJobDependencies = {
    now: () => new Date('2026-10-28T20:05:00.000Z'),
    loadContext: vi.fn().mockResolvedValue({ ...context, ...change }),
    generate,
    completeGeneration: vi.fn(async (input: unknown) => { completions.push(input); return 'generated' as const; }),
    completeFailure: vi.fn(async (input: unknown) => { completions.push(input); return 'retry_wait' as const; }),
    cancel: vi.fn(async (input: unknown) => { completions.push(input); return 'cancelled' as const; }),
  };
  return {
    completions,
    generate,
    dependencies: deps,
  };
}

describe('processAiJob', () => {
  it('generates one response for a currently eligible conversation', async () => {
    const fixture = dependencies();
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'generated' });
    expect(fixture.completions).toEqual([{
      jobId: 'job-1', leaseToken: 'lease-1', reply: 'Como posso ajudar?', providerResponseId: 'resp_1',
    }]);
  });

  it.each([
    [{ conversationMode: 'review' as const }, 'REVIEW_REQUIRED'],
    [{ conversationMode: 'human_locked' as const }, 'HUMAN_LOCKED'],
    [{ conversationMode: 'resolved' as const }, 'CONVERSATION_CLOSED'],
    [{ optedOut: true }, 'OPTED_OUT'],
    [{ consentGranted: false }, 'CONSENT_REQUIRED'],
    [{ channelEnabled: false }, 'CHANNEL_DISABLED'],
    [{ globalMode: 'suggest' as const }, 'AUTO_MODE_DISABLED'],
    [{ lastInboundAt: '2026-10-27T19:59:59.000Z' }, 'SERVICE_WINDOW_CLOSED'],
  ])('cancels without provider cost when the conversation is not eligible: %s', async (change, reason) => {
    const fixture = dependencies(change);
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'cancelled', reason });
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.completions).toEqual([{ jobId: 'job-1', leaseToken: 'lease-1', reason, state: 'cancelled' }]);
  });

  it('supersedes a job when a newer inbound message already exists', async () => {
    const fixture = dependencies({ latestInboundMessageId: 'message-3' });
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'superseded', reason: 'NEWER_INBOUND' });
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.completions).toEqual([{ jobId: 'job-1', leaseToken: 'lease-1', reason: 'NEWER_INBOUND', state: 'superseded' }]);
  });

  it('persists a retryable provider failure instead of losing the inbound message', async () => {
    const fixture = dependencies();
    fixture.generate.mockRejectedValue(new AiProviderError('AI_EMPTY_RESPONSE', true, 200, 'resp_empty'));
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'retry_wait', reason: 'AI_EMPTY_RESPONSE' });
    expect(fixture.completions).toEqual([{
      jobId: 'job-1', leaseToken: 'lease-1', errorCode: 'AI_EMPTY_RESPONSE', retryable: true, providerResponseId: 'resp_empty',
    }]);
  });

  it('moves terminal provider configuration failures to human review', async () => {
    const fixture = dependencies();
    fixture.dependencies.completeFailure = vi.fn(async (input: unknown) => { fixture.completions.push(input); return 'human_review' as const; });
    fixture.generate.mockRejectedValue(new AiProviderError('AI_PROVIDER_AUTH', false, 401));
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'human_review', reason: 'AI_PROVIDER_AUTH' });
    expect(fixture.completions).toEqual([{
      jobId: 'job-1', leaseToken: 'lease-1', errorCode: 'AI_PROVIDER_AUTH', retryable: false, providerResponseId: null,
    }]);
  });

  it('persists a context loading failure for retry without calling the provider', async () => {
    const fixture = dependencies();
    vi.mocked(fixture.dependencies.loadContext).mockRejectedValue(new Error('database unavailable'));
    await expect(processAiJob(job, fixture.dependencies)).resolves.toEqual({ state: 'retry_wait', reason: 'AI_CONTEXT_UNAVAILABLE' });
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.completions).toEqual([{
      jobId: 'job-1', leaseToken: 'lease-1', errorCode: 'AI_CONTEXT_UNAVAILABLE', retryable: true, providerResponseId: null,
    }]);
  });
});
