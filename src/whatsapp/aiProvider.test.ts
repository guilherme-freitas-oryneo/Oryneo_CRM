import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, requestAiReply } from '../../supabase/functions/_shared/whatsapp/aiProvider';

describe('WhatsApp AI provider adapter', () => {
  it('uses the OpenAI Responses API without exposing the key in the payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: '  Vamos marcar o diagnóstico?  ' }), { status: 200 }));
    const reply = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Quero conhecer o CRM'}] }, fetcher);
    expect(reply).toEqual({ text: 'Vamos marcar o diagnóstico?', providerResponseId: null });
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ method:'POST', headers:expect.objectContaining({Authorization:'Bearer sk-test-secret-key-123456789'}) }));
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({
      model: 'gpt-5-mini',
      max_output_tokens: 1200,
      reasoning: { effort: 'minimal' },
      text: { verbosity: 'low' },
    });
    expect(String(fetcher.mock.calls[0][1].body)).not.toContain('sk-test-secret-key');
  });

  it('uses Anthropic Messages and reads the first text block', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content:[{type:'text',text:'Posso entender seu processo comercial?'}] }), { status: 200 }));
    const reply = await requestAiReply({ provider:'anthropic',apiKey:'sk-ant-test-secret-key-123456',model:'claude-sonnet-4-5',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher);
    expect(reply).toEqual({ text: 'Posso entender seu processo comercial?', providerResponseId: null });
    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ headers:expect.objectContaining({'x-api-key':'sk-ant-test-secret-key-123456','anthropic-version':'2023-06-01'}) }));
  });

  it('reads nested OpenAI output text and keeps the provider response id', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_123', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Qual é o principal desafio hoje?' }] }],
    }), { status: 200 }));
    await expect(requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher))
      .resolves.toEqual({ text: 'Qual é o principal desafio hoje?', providerResponseId: 'resp_123' });
  });

  it('classifies incomplete OpenAI output as retryable without accepting an empty answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_incomplete', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
    }), { status: 200 }));
    const error = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher).catch(value => value);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ code: 'AI_INCOMPLETE_MAX_OUTPUT_TOKENS', retryable: true, providerResponseId: 'resp_incomplete' });
  });

  it('classifies a completed response without readable text as retryable', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'resp_empty', status: 'completed', output: [] }), { status: 200 }));
    const error = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher).catch(value => value);
    expect(error).toMatchObject({ code: 'AI_EMPTY_RESPONSE', retryable: true, providerResponseId: 'resp_empty' });
  });

  it.each([
    [429, 'AI_PROVIDER_RATE_LIMITED', true],
    [503, 'AI_PROVIDER_UNAVAILABLE', true],
    [401, 'AI_PROVIDER_AUTH', false],
    [400, 'AI_PROVIDER_REQUEST', false],
  ])('classifies provider HTTP %i without exposing its response body', async (status, code, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'sensitive provider detail' } }), { status }));
    const error = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher).catch(value => value);
    expect(error).toMatchObject({ code, retryable, status });
    expect(String(error)).not.toContain('sensitive provider detail');
  });

  it('classifies a provider timeout as retryable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const error = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher).catch(value => value);
    expect(error).toMatchObject({ code: 'AI_PROVIDER_TIMEOUT', retryable: true });
  });
});
