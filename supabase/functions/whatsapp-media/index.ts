import { createClient } from 'npm:@supabase/supabase-js@2.90.1';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const accessToken = Deno.env.get('WHATSAPP_SYSTEM_USER_TOKEN') ?? '';
const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const fail = (status: number) => new Response(JSON.stringify({ error: 'Mídia indisponível.' }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail(405);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return fail(401);
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth.user) return fail(401);
  const { data: member, error: memberError } = await db.from('crm_members').select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (memberError) return fail(503);
  if (!member) return fail(403);
  if (!accessToken || !phoneId) return fail(503);
  let input: { messageId?: string };
  try { input = await request.json(); } catch { return fail(400); }
  if (typeof input?.messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.messageId)) return fail(400);
  const { data: message, error: messageError } = await db.from('crm_wa_messages').select('media_id,mime_type,conversation_id')
    .eq('id', input.messageId).maybeSingle();
  if (messageError) return fail(503);
  if (!message?.media_id || !/^[A-Za-z0-9_-]{1,200}$/.test(message.media_id)) return fail(404);
  const { data: conversation, error: conversationError } = await db.from('crm_wa_conversations')
    .select('id,channel_id').eq('id', message.conversation_id).maybeSingle();
  if (conversationError) return fail(503);
  if (!conversation) return fail(404);
  const [adminGrant, conversationGrant] = await Promise.all([
    db.from('crm_wa_access').select('id').eq('user_id', auth.user.id)
      .eq('channel_id', conversation.channel_id).is('conversation_id', null).eq('role', 'admin').maybeSingle(),
    db.from('crm_wa_access').select('id').eq('user_id', auth.user.id)
      .eq('conversation_id', conversation.id).maybeSingle(),
  ]);
  if (adminGrant.error || conversationGrant.error) return fail(503);
  if (!adminGrant.data && !conversationGrant.data) return fail(404);
  try {
    const meta = await fetch(`https://graph.facebook.com/v26.0/${message.media_id}?phone_number_id=${phoneId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12000),
    });
    if (!meta.ok) return fail(502);
    const metadata = await meta.json() as { url?: string; mime_type?: string };
    if (!metadata.url) return fail(502);
    const mediaUrl = new URL(metadata.url);
    if (mediaUrl.protocol !== 'https:' || !(mediaUrl.hostname === 'lookaside.fbsbx.com' || mediaUrl.hostname.endsWith('.fbsbx.com') || mediaUrl.hostname.endsWith('.fbcdn.net'))) return fail(502);
    const file = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!file.ok || Number(file.headers.get('content-length') ?? 0) > 16 * 1024 * 1024) return fail(502);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 16 * 1024 * 1024) return fail(413);
    const mime = metadata.mime_type || message.mime_type || 'application/octet-stream';
    return new Response(bytes, { headers: { ...cors, 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return fail(503); }
});
