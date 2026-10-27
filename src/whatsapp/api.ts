import { supabase } from '../data';
import type { WhatsAppDraft } from './WhatsAppComposer';

export type Channel = { id: string; enabled: boolean; display_phone_number: string };
export type Conversation = {
  id: string; channel_id: string; customer_wa_id: string; customer_name: string | null;
  deal_id: string | null; mode: 'sdr_active' | 'review' | 'human_locked' | 'resolved';
  opted_out: boolean; consent_granted: boolean; last_inbound_at?: string | null; last_message_at: string | null; last_preview: string;
  unread_count?: number; last_read_at?: string | null;
};
export type Message = {
  id: string; conversation_id: string; direction: 'inbound' | 'outbound';
  kind: 'text' | 'audio' | 'image' | 'document' | 'video' | 'other'; body: string;
  media_id: string | null; mime_type: string | null;
  delivery_status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  occurred_at: string;
};

export async function loadWhatsAppInbox(): Promise<{ channel: Channel | null; conversations: Conversation[] }> {
  const { data: channel, error: channelError } = await supabase.from('crm_wa_channels')
    .select('id,enabled,display_phone_number').eq('display_phone_number', '+5521974510932').maybeSingle();
  if (channelError) throw channelError;
  if (!channel) return { channel: null, conversations: [] };
  const { data, error } = await supabase.from('crm_wa_conversations')
    .select('id,channel_id,customer_wa_id,customer_name,deal_id,mode,opted_out,consent_granted,last_inbound_at,last_message_at,last_preview,unread_count,last_read_at')
    .eq('channel_id', channel.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(100);
  if (error) throw error;
  return { channel: channel as Channel, conversations: (data ?? []) as Conversation[] };
}

export async function loadWhatsAppMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase.from('crm_wa_messages')
    .select('id,conversation_id,direction,kind,body,media_id,mime_type,delivery_status,occurred_at')
    .eq('conversation_id', conversationId).order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as Message[]).reverse();
}

/** Confirms the latest inbound message as read only through the authenticated backend. */
export async function markWhatsAppRead(conversationId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('whatsapp-inbox', { body: { action: 'read', conversationId } });
  if (error || data?.ok !== true) throw new Error('Não foi possível confirmar a leitura na Meta.');
}

/**
 * Canal oficial: nunca simula envios. A função Edge confirma a mensagem na Meta
 * antes de a resposta retornar ok. Mantém o conteúdo no composer em caso de erro.
 */
export async function sendWhatsAppMessage(conversationId: string, draft: WhatsAppDraft, requestId: string = crypto.randomUUID()): Promise<string> {
  let body: Record<string, string> | FormData;
  if (draft.kind === 'text') {
    body = { action: 'send_text', conversationId, requestId, text: draft.text };
  } else {
    const file = draft.file;
    const form = new FormData();
    form.append('action', 'send_media');
    form.append('conversationId', conversationId);
    form.append('requestId', requestId);
    form.append('file', file, file.name);
    if (draft.kind === 'attachment' && draft.caption) form.append('text', draft.caption);
    body = form;
  }
  const { data, error } = await supabase.functions.invoke('whatsapp-inbox', { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const detail: unknown = await response.clone().json();
        if (detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string') {
          throw new Error(detail.error);
        }
      } catch (reason) {
        if (reason instanceof Error && reason.message !== 'Unexpected end of JSON input') {
          // Um erro controlado do servidor deve ser apresentado ao operador.
          if (!reason.name.includes('SyntaxError')) throw reason;
        }
      }
    }
    throw new Error('Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente.');
  }
  if (!data || data.ok !== true || typeof data.messageId !== 'string') {
    throw new Error('A resposta da Meta não confirmou o envio. Confira a conversa antes de tentar novamente.');
  }
  return data.messageId;
}

/** Busca mídia privada somente sob uma sessão autenticada. Nunca expõe token Meta no navegador. */
export async function loadWhatsAppMedia(messageId: string): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke('whatsapp-media', {
    body: { messageId },
  });
  if (error || !(data instanceof Blob)) {
    throw new Error('Não foi possível carregar a mídia. Verifique sua conexão e tente novamente.');
  }
  const type = data.type.split(';')[0].toLowerCase();
  const allowed = new Set(['image/jpeg', 'image/png', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'video/mp4', 'application/pdf']);
  if (!allowed.has(type) || data.size > 16 * 1024 * 1024) {
    throw new Error('Este formato de mídia não pode ser exibido no CRM.');
  }
  return data;
}
