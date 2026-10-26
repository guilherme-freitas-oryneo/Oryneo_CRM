import { supabase } from '../data';

export type Channel = { id: string; enabled: boolean; display_phone_number: string };
export type Conversation = {
  id: string; channel_id: string; customer_wa_id: string; customer_name: string | null;
  deal_id: string | null; mode: 'sdr_active' | 'review' | 'human_locked' | 'resolved';
  opted_out: boolean; consent_granted: boolean; last_message_at: string | null; last_preview: string;
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
    .select('id,channel_id,customer_wa_id,customer_name,deal_id,mode,opted_out,consent_granted,last_message_at,last_preview')
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
