import { createClient } from '../_shared/mail/deps.ts';
import { createWhatsAppWebhookHandler } from '../_shared/whatsapp/webhookHandler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const appSecret = Deno.env.get('WHATSAPP_META_APP_SECRET');
const verifyToken = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
if (!supabaseUrl || !serviceRoleKey || !appSecret || !verifyToken) {
  throw new Error('WhatsApp webhook configuration is incomplete');
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const handler = createWhatsAppWebhookHandler({
  appSecret,
  verifyToken,
  async persist(event) {
    const { error } = await client.from('crm_wa_webhook_events').upsert(
      { event_sha256: event.eventSha256, payload: event.payload },
      { onConflict: 'event_sha256', ignoreDuplicates: true },
    );
    if (error) throw new Error('WEBHOOK_PERSIST_FAILED');
  },
});

Deno.serve(handler);
