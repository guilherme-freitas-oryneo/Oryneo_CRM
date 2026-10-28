import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { createWhatsAppWebhookHandler } from '../_shared/whatsapp/webhookHandler.ts';
import { createWhatsAppEventPersister } from '../_shared/whatsapp/persistEvent.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const appSecret = Deno.env.get('WHATSAPP_META_APP_SECRET');
const verifyToken = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
const accountId = Deno.env.get('WHATSAPP_MESSAGING_ACCOUNT_ID');
const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
if (!supabaseUrl || !serviceRoleKey || !appSecret || !verifyToken || !accountId || !phoneNumberId) {
  throw new Error('WhatsApp webhook configuration is incomplete');
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const handler = createWhatsAppWebhookHandler({
  appSecret,
  verifyToken,
  persist: createWhatsAppEventPersister(client, accountId, phoneNumberId),
});

Deno.serve(handler);
