import { describe, expect, it, vi } from 'vitest';
import { requestAiReply } from '../../supabase/functions/_shared/whatsapp/aiProvider';

describe('WhatsApp AI provider adapter', () => {
  it('uses the OpenAI Responses API without exposing the key in the payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: '  Vamos marcar o diagnóstico?  ' }), { status: 200 }));
    const reply = await requestAiReply({ provider:'openai',apiKey:'sk-test-secret-key-123456789',model:'gpt-5-mini',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Quero conhecer o CRM'}] }, fetcher);
    expect(reply).toBe('Vamos marcar o diagnóstico?');
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ method:'POST', headers:expect.objectContaining({Authorization:'Bearer sk-test-secret-key-123456789'}) }));
    expect(String(fetcher.mock.calls[0][1].body)).not.toContain('sk-test-secret-key');
  });

  it('uses Anthropic Messages and reads the first text block', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content:[{type:'text',text:'Posso entender seu processo comercial?'}] }), { status: 200 }));
    const reply = await requestAiReply({ provider:'anthropic',apiKey:'sk-ant-test-secret-key-123456',model:'claude-sonnet-4-5',systemPrompt:'Seja breve.',messages:[{role:'user',content:'Olá'}] }, fetcher);
    expect(reply).toBe('Posso entender seu processo comercial?');
    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ headers:expect.objectContaining({'x-api-key':'sk-ant-test-secret-key-123456','anthropic-version':'2023-06-01'}) }));
  });
});
