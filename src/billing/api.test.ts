import { describe, expect, it } from 'vitest';
import { billingErrorText } from './api';

describe('billingErrorText', () => {
  it('mostra a mensagem segura devolvida pela Edge Function', async () => {
    const error = {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(
        JSON.stringify({ error: 'Não foi possível validar seu acesso agora.' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    };

    await expect(billingErrorText(error)).resolves.toBe(
      'Não foi possível validar seu acesso agora.',
    );
  });
});
