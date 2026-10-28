import { describe, expect, it, vi } from 'vitest';
import { supabase } from '../data';
import { invokeMailAction, listThreads, MAIL_THREADS_PAGE_SIZE } from './api';

vi.mock('../data', () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() },
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


describe('listThreads', () => {
  it('encaminha o cursor composto para carregar a próxima página sem repetir conversas', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
    const cursor = { beforeAt: '2026-10-17T12:00:00.000Z', beforeId: 'thread-last' };

    await listThreads('inbox', 'proposta', 'unread', cursor);

    expect(supabase.rpc).toHaveBeenCalledWith('crm_mail_list_threads', {
      p_folder: 'inbox', p_query: 'proposta', p_filter: 'unread',
      p_before_at: cursor.beforeAt, p_before_id: cursor.beforeId, p_limit: MAIL_THREADS_PAGE_SIZE,
    });
  });
});
