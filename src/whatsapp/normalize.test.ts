import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppWebhook } from '../../supabase/functions/_shared/whatsapp/normalize';

const account = 'account-example';
const phone = 'phone-example';
const event = (value: Record<string, unknown>, accountId = account, phoneId = phone) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: accountId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, ...value } }] }],
});

describe('normalizeWhatsAppWebhook', () => {
  it('normaliza mensagem recebida e estado sem vincular automaticamente uma oportunidade', () => {
    const result = normalizeWhatsAppWebhook(event({
      contacts: [{ wa_id: '5521999998888', profile: { name: 'Marina' } }],
      messages: [{ id: 'wamid.ABC', from: '5521999998888', timestamp: '1792860000', type: 'text', text: { body: 'Olá' } }],
      statuses: [{ id: 'wamid.XYZ', timestamp: '1792860001', status: 'delivered' }],
    }), account, phone);
    expect(result.messages).toEqual([{ providerMessageId: 'wamid.ABC', customerWaId: '5521999998888', customerName: 'Marina', kind: 'text', body: 'Olá', mediaId: null, mimeType: null, replyToProviderMessageId: null, reactionToProviderMessageId: null, reactionEmoji: null, occurredAt: '2026-10-24T16:40:00.000Z' }]);
    expect(result.statuses).toEqual([{ providerMessageId: 'wamid.XYZ', status: 'delivered', occurredAt: '2026-10-24T16:40:01.000Z' }]);
    expect(JSON.stringify(result)).not.toContain('deal_id');
  });

  it('isola conta e número de produção configurados', () => {
    const value = { messages: [{ id: 'wamid.ABC', from: '5521999998888', timestamp: '1792860000', type: 'text', text: { body: 'Olá' } }] };
    expect(normalizeWhatsAppWebhook(event(value, 'other-account'), account, phone).messages).toEqual([]);
    expect(normalizeWhatsAppWebhook(event(value, account, 'other-phone'), account, phone).messages).toEqual([]);
    expect(normalizeWhatsAppWebhook({ ...event(value), object: 'other' }, account, phone).messages).toEqual([]);
  });

  it('preserva metadados de mídia e ignora identificadores ou datas inválidos', () => {
    const result = normalizeWhatsAppWebhook(event({ messages: [
      { id: 'wamid.MEDIA', from: '5521999998888', timestamp: '1792860000', type: 'audio', audio: { id: 'media-id', mime_type: 'audio/ogg' } },
      { id: 'wamid.BAD', from: 'not-a-number', timestamp: '1792860000', type: 'text', text: { body: 'Nope' } },
      { id: 'wamid.FUTURE', from: '5521999998888', timestamp: '9999999999', type: 'text', text: { body: 'Nope' } },
    ] }), account, phone);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ kind: 'audio', mediaId: 'media-id', mimeType: 'audio/ogg', body: '' });
  });

  it('preserva resposta citada e reação sem inventar conteúdo', () => {
    const result = normalizeWhatsAppWebhook(event({ messages: [
      { id: 'wamid.REPLY', from: '5521999998888', timestamp: '1792860000', type: 'text', context: { id: 'wamid.ORIGINAL' }, text: { body: 'Resposta' } },
      { id: 'wamid.REACTION', from: '5521999998888', timestamp: '1792860001', type: 'reaction', reaction: { message_id: 'wamid.ORIGINAL', emoji: '❤️' } },
    ] }), account, phone);
    expect(result.messages[0]).toMatchObject({ replyToProviderMessageId: 'wamid.ORIGINAL', reactionToProviderMessageId: null, reactionEmoji: null });
    expect(result.messages[1]).toMatchObject({ kind: 'other', body: '', replyToProviderMessageId: null, reactionToProviderMessageId: 'wamid.ORIGINAL', reactionEmoji: '❤️' });
  });
});
