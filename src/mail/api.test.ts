import { describe, expect, it, vi } from 'vitest';
import { supabase } from '../data';
import { invokeMailAction } from './api';

vi.mock('../data', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

describe('invokeMailAction', () => {
  it('preserva o código público da Edge Function mesmo em resposta HTTP não-2xx', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: false, error: 'FIRST_CONTACT_STAGE' },
      error: new Error('Edge Function returned a non-2xx status code'),
    } as never);
    await expect(invokeMailAction('send-first-contact', {})).rejects.toThrow('FIRST_CONTACT_STAGE');
  });
});
