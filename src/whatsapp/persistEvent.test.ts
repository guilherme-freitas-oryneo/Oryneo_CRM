import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppEventPersister } from '../../supabase/functions/_shared/whatsapp/persistEvent';

const payload = { object: 'whatsapp_business_account', entry: [{ id: 'account-1', changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'phone-1' },
  messages: [{ id: 'wamid.1', from: '5521999998888', timestamp: '1792860000', type: 'text', text: { body: 'Olá' } }],
} }] }] };

function fakeClient(state = 'pending', messageError: unknown = null, enqueueError: unknown = null) {
  const writes: string[] = [];
  const client = {
    from(table: string) {
      return {
        upsert: async () => { writes.push('upsert:' + table); return { error: table === 'crm_wa_messages' ? messageError : null }; },
        select: () => {
          const query = {
            eq: () => query,
            single: async () => ({ data: table === 'crm_wa_webhook_events'
              ? { id: 'raw-1', state }
              : table === 'crm_wa_channels'
                ? { id: 'channel-1' }
                : { id: 'message-1' }, error: null }),
          };
          return query;
        },
        update: () => ({ eq: async () => { writes.push('processed'); return { error: null }; } }),
      };
    },
    rpc(name: string) {
      writes.push('rpc:' + name);
      return Promise.resolve({
        data: name === 'crm_wa_ensure_conversation' ? 'conversation-1' : name === 'crm_wa_enqueue_ai_job' ? 'job-1' : null,
        error: name === 'crm_wa_enqueue_ai_job' ? enqueueError : null,
      });
    },
  };
  return { client, writes };
}

describe('createWhatsAppEventPersister', () => {
  it('grava o evento e a mensagem antes de marcar o evento como processado', async () => {
    const { client, writes } = fakeClient();
    await createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'a'.repeat(64), payload });
    expect(writes).toEqual(['upsert:crm_wa_webhook_events', 'rpc:crm_wa_ensure_conversation', 'upsert:crm_wa_messages', 'rpc:crm_wa_set_latest', 'rpc:crm_wa_enqueue_ai_job', 'processed']);
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

  it('mantém o evento pendente quando o job durável não pode ser enfileirado', async () => {
    const { client, writes } = fakeClient('pending', null, { message: 'queue unavailable' });
    await expect(createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'a'.repeat(64), payload })).rejects.toThrow('WHATSAPP_STORAGE_UNAVAILABLE');
    expect(writes).toContain('rpc:crm_wa_enqueue_ai_job');
    expect(writes).not.toContain('processed');
  });

  it('não enfileira reação para geração automática', async () => {
    const reactionPayload = { object: 'whatsapp_business_account', entry: [{ id: 'account-1', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'phone-1' },
      messages: [{ id: 'wamid.reaction', from: '5521999998888', timestamp: '1792860000', type: 'reaction', reaction: { message_id: 'wamid.1', emoji: '👍' } }],
    } }] }] };
    const { client, writes } = fakeClient();
    await createWhatsAppEventPersister(client as never, 'account-1', 'phone-1')({ eventSha256: 'b'.repeat(64), payload: reactionPayload });
    expect(writes).not.toContain('rpc:crm_wa_enqueue_ai_job');
    expect(writes.at(-1)).toBe('processed');
  });
});
