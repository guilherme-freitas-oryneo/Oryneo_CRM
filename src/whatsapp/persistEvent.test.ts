import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppEventPersister } from '../../supabase/functions/_shared/whatsapp/persistEvent';

const payload = { object: 'whatsapp_business_account', entry: [{ id: 'account-1', changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'phone-1' },
  messages: [{ id: 'wamid.1', from: '5521999998888', timestamp: '1792860000', type: 'text', text: { body: 'Olá' } }],
} }] }] };

function fakeClient(state = 'pending', messageError: unknown = null) {
  const writes: string[] = [];
  const client = {
    from(table: string) {
      return {
        upsert: async () => { writes.push('upsert:' + table); return { error: table === 'crm_wa_messages' ? messageError : null }; },
        select: () => ({ eq: () => ({ single: async () => ({ data: { id: table === 'crm_wa_channels' ? 'channel-1' : 'raw-1', state }, error: null }), eq: () => ({ single: async () => ({ data: { id: 'channel-1' }, error: null }) }) }) }),
        update: () => ({ eq: async () => { writes.push('processed'); return { error: null }; } }),
      };
    },
    rpc(name: string) { writes.push('rpc:' + name); return Promise.resolve({ data: name === 'crm_wa_ensure_conversation' ? 'conversation-1' : null, error: null }); },
  };
  return { client, writes };
}

describe('createWhatsAppEventPersister', () => {
  it('grava o evento e a mensagem antes de marcar o evento como processado', async () => {
    const { client, writes } = fakeClient();
    await createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'a'.repeat(64), payload });
    expect(writes).toEqual(['upsert:crm_wa_webhook_events', 'rpc:crm_wa_ensure_conversation', 'upsert:crm_wa_messages', 'rpc:crm_wa_set_latest', 'processed']);
  });

  it('não processa novamente entrega já concluída', async () => {
    const { client, writes } = fakeClient('processed');
    await createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'a'.repeat(64), payload });
    expect(writes).toEqual(['upsert:crm_wa_webhook_events']);
  });

  it('mantém o evento pendente quando a gravação da mensagem falha', async () => {
    const { client, writes } = fakeClient('pending', { message: 'database unavailable' });
    await expect(createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'a'.repeat(64), payload })).rejects.toThrow('WHATSAPP_STORAGE_UNAVAILABLE');
    expect(writes).not.toContain('processed');
  });
});
