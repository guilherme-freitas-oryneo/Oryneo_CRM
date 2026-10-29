import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWhatsAppWebhook } from './normalize.ts';
import type { WebhookEvent } from './webhookHandler.ts';

function requireData<T>(data: T | null, error: { message?: string } | null): T {
  if (error || data === null) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
  return data;
}

const previewFor = (kind: string, body: string) => body.slice(0, 160) || ({ audio: 'Mensagem de áudio', image: 'Imagem', document: 'Documento', video: 'Vídeo' } as Record<string, string>)[kind] || 'Mensagem recebida';

/** Persist raw signed delivery and its read model before webhook ACK. Safe to retry. */
export function createWhatsAppEventPersister(client: SupabaseClient, expectedAccountId: string, expectedPhoneNumberId: string) {
  return async (event: WebhookEvent): Promise<void> => {
    const { error: rawError } = await client.from('crm_wa_webhook_events').upsert(
      { event_sha256: event.eventSha256, payload: event.payload },
      { onConflict: 'event_sha256', ignoreDuplicates: true },
    );
    if (rawError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
    const { data: rawRow, error: lookupError } = await client.from('crm_wa_webhook_events').select('id,state').eq('event_sha256', event.eventSha256).single();
    const raw = requireData(rawRow as { id: string; state: string } | null, lookupError);
    if (raw.state === 'processed') return;

    const { data: channelRow, error: channelError } = await client.from('crm_wa_channels')
      .select('id').eq('messaging_account_id', expectedAccountId).eq('phone_number_id', expectedPhoneNumberId).single();
    const channel = requireData(channelRow as { id: string } | null, channelError);
    const normalized = normalizeWhatsAppWebhook(event.payload, expectedAccountId, expectedPhoneNumberId);
    for (const message of normalized.messages) {
      const { data: conversationId, error: conversationError } = await client.rpc('crm_wa_ensure_conversation', {
        p_channel_id: channel.id,
        p_customer_wa_id: message.customerWaId,
        p_customer_name: message.customerName,
      });
      const id = requireData(conversationId as string | null, conversationError);
      const { error: messageError } = await client.from('crm_wa_messages').upsert({
        conversation_id: id, provider_message_id: message.providerMessageId, direction: 'inbound',
        kind: message.kind, body: message.body, media_id: message.mediaId, mime_type: message.mimeType,
        reply_to_provider_message_id: message.replyToProviderMessageId,
        reaction_to_provider_message_id: message.reactionToProviderMessageId,
        reaction_emoji: message.reactionEmoji,
        occurred_at: message.occurredAt,
      }, { onConflict: 'provider_message_id', ignoreDuplicates: true });
      if (messageError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
      const { error: latestError } = await client.rpc('crm_wa_set_latest', {
        p_conversation_id: id,
        p_occurred_at: message.occurredAt,
        p_preview: previewFor(message.kind, message.body),
      });
      if (latestError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
      if (message.kind === 'text' && !message.reactionToProviderMessageId) {
        const { data: storedMessage, error: storedMessageError } = await client.from('crm_wa_messages')
          .select('id').eq('provider_message_id', message.providerMessageId).single();
        const stored = requireData(storedMessage as { id: string } | null, storedMessageError);
        const { error: enqueueError } = await client.rpc('crm_wa_enqueue_ai_job', {
          p_conversation_id: id,
          p_inbound_message_id: stored.id,
        });
        if (enqueueError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
      }
    }
    for (const status of normalized.statuses) {
      const { error: statusError } = await client.from('crm_wa_delivery_events').upsert({
        provider_message_id: status.providerMessageId, status: status.status, occurred_at: status.occurredAt,
      }, { onConflict: 'provider_message_id,status,occurred_at', ignoreDuplicates: true });
      if (statusError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
    }
    const { error: doneError } = await client.from('crm_wa_webhook_events').update({
      state: 'processed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', raw.id);
    if (doneError) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
  };
}
