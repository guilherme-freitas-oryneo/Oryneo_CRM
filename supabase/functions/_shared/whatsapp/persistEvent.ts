import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWhatsAppWebhook } from './normalize.ts';
import type { WebhookEvent } from './webhookHandler.ts';
import { requestAiReply, type AiMessage, type AiProvider } from './aiProvider.ts';

function requireData<T>(data: T | null, error: { message?: string } | null): T {
  if (error || data === null) throw new Error('WHATSAPP_STORAGE_UNAVAILABLE');
  return data;
}

const previewFor = (kind: string, body: string) => body.slice(0, 160) || ({ audio: 'Mensagem de áudio', image: 'Imagem', document: 'Documento', video: 'Vídeo' } as Record<string, string>)[kind] || 'Mensagem recebida';

async function autoReply(client: SupabaseClient, channelId: string, conversationId: string, customerWaId: string) {
  const deno = (globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } }).Deno;
  const token = deno?.env.get('WHATSAPP_SYSTEM_USER_TOKEN') ?? '';
  const phoneId = deno?.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!token || !phoneId) return;
  const [{ data: conversation }, { data: settings }, { data: attachments }] = await Promise.all([
    client.from('crm_wa_conversations').select('mode,opted_out').eq('id', conversationId).eq('channel_id', channelId).maybeSingle(),
    client.from('crm_wa_ai_settings').select('provider,model,mode,system_prompt,training_prompt,api_secret_id').eq('channel_id', channelId).maybeSingle(),
    client.from('crm_wa_ai_attachments').select('file_name,extracted_text').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(20),
  ]);
  if (!conversation || conversation.opted_out || conversation.mode === 'human_locked' || conversation.mode === 'resolved' || settings?.mode !== 'auto' || !settings.api_secret_id) return;
  const { data: apiKey } = await client.rpc('crm_wa_ai_get_secret', { p_channel_id: channelId });
  if (typeof apiKey !== 'string' || !apiKey) return;
  const { data: rows } = await client.from('crm_wa_messages').select('direction,body,kind').eq('conversation_id', conversationId).is('reaction_to_provider_message_id', null).order('occurred_at', { ascending: false }).limit(20);
  const messages: AiMessage[] = (rows ?? []).reverse().filter(row => row.kind === 'text' && String(row.body ?? '').trim()).map(row => ({ role: row.direction === 'inbound' ? 'user' : 'assistant', content: String(row.body).slice(0, 2000) }));
  if (!messages.length) return;
  const attachmentText = (attachments ?? []).filter(item => item.extracted_text).map(item => `\n[${item.file_name}]\n${item.extracted_text.slice(0, 20000)}`).join('');
  const systemPrompt = `${settings.system_prompt}\n\nTREINAMENTO GERAL DO SDR\n${settings.training_prompt}\n\nMATERIAL ANEXADO${attachmentText || ': nenhum texto extraído disponível.'}`;
  let reply: string;
  try { reply = await requestAiReply({ provider: settings.provider as AiProvider, apiKey, model: settings.model, systemPrompt, messages }); } catch (error) { console.error('whatsapp auto reply provider failed', { code: error instanceof Error ? error.message : 'unknown' }); return; }
  if (!reply.trim()) return;
  const graph = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: customerWaId, type: 'text', text: { body: reply.trim().slice(0, 4096) } }), signal: AbortSignal.timeout(15000) });
  const result = await graph.json().catch(() => null) as { messages?: { id?: string }[] } | null;
  const providerMessageId = result?.messages?.[0]?.id;
  if (!graph.ok || !providerMessageId) { console.error('whatsapp auto reply meta rejected', { status: graph.status }); return; }
  const occurredAt = new Date().toISOString();
  const { error } = await client.from('crm_wa_messages').insert({ conversation_id: conversationId, provider_message_id: providerMessageId, direction: 'outbound', kind: 'text', body: reply.trim().slice(0, 4096), occurred_at: occurredAt, delivery_status: 'pending' });
  if (error) { console.error('whatsapp auto reply persist failed', { code: error.code }); return; }
  await client.rpc('crm_wa_set_latest', { p_conversation_id: conversationId, p_occurred_at: occurredAt, p_preview: reply.trim().slice(0, 160) });
}

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
    for (const message of normalized.messages) {
      if (message.kind === 'text' && !message.reactionToProviderMessageId) {
        await autoReply(client, channel.id, (await client.from('crm_wa_conversations').select('id').eq('channel_id', channel.id).eq('customer_wa_id', message.customerWaId).single()).data?.id ?? '', message.customerWaId).catch(error => console.error('whatsapp auto reply failed', { code: error instanceof Error ? error.message : 'unknown' }));
      }
    }
  };
}
