import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { evaluateOutboundPolicy } from '../_shared/whatsapp/policy.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const accessToken = Deno.env.get('WHATSAPP_SYSTEM_USER_TOKEN') ?? '';
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const graphVersion = 'v26.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function metaMessage(body: Record<string, unknown>) {
  const result = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await result.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: number } } | null;
  return { ok: result.ok, messageId: payload?.messages?.[0]?.id, errorCode: payload?.error?.code };
}

async function uploadMedia(file: File): Promise<string | null> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.type.split(';')[0]);
  form.append('file', file, file.name);
  const result = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form, signal: AbortSignal.timeout(25000),
  });
  const payload = await result.json().catch(() => null) as { id?: string } | null;
  return result.ok && typeof payload?.id === 'string' ? payload.id : null;
}

const mediaKinds: Record<string, 'audio' | 'image' | 'document' | 'video'> = {
  'audio/ogg': 'audio', 'audio/mpeg': 'audio', 'audio/mp4': 'audio',
  'image/jpeg': 'image', 'image/png': 'image', 'application/pdf': 'document', 'video/mp4': 'video',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return json({ error: 'Autenticação necessária.' }, 401);
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth.user) return json({ error: 'Sessão inválida.' }, 401);
  const { data: member, error: memberError } = await db.from('crm_members').select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (memberError) return json({ error: 'Falha ao verificar acesso.' }, 503);
  if (!member) return json({ error: 'Acesso restrito à equipe do CRM.' }, 403);
  let input: Record<string, unknown>;
  let mediaFile: File | null = null;
  try {
    if (request.headers.get('Content-Type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      input = Object.fromEntries(form.entries());
      mediaFile = form.get('file') instanceof File ? form.get('file') as File : null;
    } else input = await request.json();
  } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const conversationId = typeof input.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(input.conversationId) ? input.conversationId : '';
  if (!conversationId) return json({ error: 'Conversa inválida.' }, 400);
  const { data: conversation, error: lookupError } = await db.from('crm_wa_conversations')
    .select('id,customer_wa_id,last_inbound_at,mode,opted_out,consent_granted,channel_id,crm_wa_channels!inner(enabled,phone_number_id)')
    .eq('id', conversationId).eq('crm_wa_channels.phone_number_id', phoneId).maybeSingle();
  if (lookupError) return json({ error: 'Falha ao consultar conversa.' }, 503);
  if (!conversation) return json({ error: 'Conversa não encontrada.' }, 404);
  const action = input.action;
  if (action === 'read') {
    if (!accessToken || !phoneId) return json({ error: 'Canal ainda sem credencial operacional.' }, 503);
    const { data: latest, error: latestError } = await db.from('crm_wa_messages').select('provider_message_id,occurred_at')
      .eq('conversation_id', conversationId).eq('direction', 'inbound').order('occurred_at', { ascending: false }).limit(1).maybeSingle();
    if (latestError) return json({ error: 'Falha ao consultar mensagem.' }, 503);
    if (!latest) return json({ ok: true });
    try {
      const result = await metaMessage({ status: 'read', message_id: latest.provider_message_id });
      if (!result.ok) return json({ error: 'Meta não confirmou a leitura.' }, 502);
    } catch { return json({ error: 'Meta indisponível. Tente novamente.' }, 503); }
    const { error } = await db.rpc('crm_wa_mark_conversation_read', { p_conversation_id: conversationId, p_read_through: latest.occurred_at });
    return error ? json({ error: 'Falha ao registrar leitura.' }, 503) : json({ ok: true });
  }
  if (action !== 'send_text' && action !== 'send_media') return json({ error: 'Ação inválida.' }, 400);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const requestId = typeof input.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(input.requestId) ? input.requestId : '';
  if (text.length > 4096 || !requestId || (action === 'send_text' && !text)) return json({ error: 'Mensagem ou identificação inválida.' }, 400);
  const kind = mediaFile ? mediaKinds[mediaFile.type.split(';')[0]] : null;
  if (action === 'send_media' && (!mediaFile || !kind || !mediaFile.size || mediaFile.size > 16 * 1024 * 1024)) return json({ error: 'Arquivo incompatível ou acima de 16 MB.' }, 400);
  if (action === 'send_media' && kind === 'image' && mediaFile && mediaFile.size > 5 * 1024 * 1024) return json({ error: 'Imagem acima do limite de 5 MB da Meta.' }, 400);
  if (mediaFile?.type.split(';')[0] === 'audio/ogg' && !/codecs\s*=\s*opus/i.test(mediaFile.type)) return json({ error: 'O áudio OGG deve usar codec Opus.' }, 400);
  if (kind === 'audio' && text) return json({ error: 'Envie o áudio sem legenda; escreva o texto em uma mensagem separada.' }, 400);
  const channel = conversation.crm_wa_channels as unknown as { enabled: boolean; phone_number_id: string };
  if (!accessToken || !phoneId) return json({ error: 'Credencial operacional ainda não configurada.' }, 503);
  if (conversation.mode !== 'human_locked' && conversation.mode !== 'review') return json({ error: 'A conversa não está em atendimento humano.' }, 409);
  const elapsedSinceInbound = conversation.last_inbound_at ? Date.now() - Date.parse(conversation.last_inbound_at) : Number.POSITIVE_INFINITY;
  const serviceWindowOpen = elapsedSinceInbound >= 0 && elapsedSinceInbound < 24 * 60 * 60 * 1000;
  // Uma mensagem recebida permite uma resposta de atendimento na janela; opt-out explícito sempre prevalece.
  const decision = evaluateOutboundPolicy({
    channelEnabled: channel.enabled, actor: 'human', conversationMode: conversation.mode,
    optedOut: conversation.opted_out, consentGranted: conversation.consent_granted || serviceWindowOpen,
    serviceWindowOpen, kind: 'freeform', templateApproved: false,
  });
  if (!decision.allowed) {
    const messageByReason: Record<string, string> = {
      CHANNEL_DISABLED: 'Envio desabilitado neste canal.',
      OPTED_OUT: 'O contato não aceita mensagens. Envio bloqueado.',
      CONSENT_REQUIRED: 'É necessário consentimento para enviar mensagens.',
      SERVICE_WINDOW_CLOSED: 'A janela de 24 horas terminou. Use um template aprovado.',
    };
    return json({ error: messageByReason[decision.reason] ?? 'Esta mensagem não está autorizada.' }, 409);
  }
  const { error: reserveError } = await db.from('crm_wa_outbox').insert({ request_id: requestId, conversation_id: conversationId, operator_id: auth.user.id, kind: kind ?? 'text', state: 'sending' });
  if (reserveError) return json({ error: 'Esta tentativa já existe ou não pôde ser reservada. Confira a conversa antes de reenviar.' }, reserveError.code === '23505' ? 409 : 503);
  try {
    let mediaId: string | null = null;
    if (mediaFile) {
      mediaId = await uploadMedia(mediaFile);
      if (!mediaId) {
        await db.from('crm_wa_outbox').update({ state: 'failed', error_code: 'MEDIA_UPLOAD_REJECTED', updated_at: new Date().toISOString() }).eq('request_id', requestId);
        return json({ error: 'A Meta recusou o arquivo. Confira o formato e tente novamente.' }, 502);
      }
    }
    const mediaObject = mediaId && kind ? { [kind]: { id: mediaId, ...(text && kind !== 'audio' ? { caption: text } : {}), ...(kind === 'document' ? { filename: mediaFile?.name } : {}), ...(kind === 'audio' && mediaFile?.type.includes('codecs=opus') ? { voice: true } : {}) } } : {};
    const sent = await metaMessage(mediaId && kind ? { to: conversation.customer_wa_id, type: kind, ...mediaObject } : { to: conversation.customer_wa_id, type: 'text', text: { body: text, preview_url: false } });
    if (!sent.ok || !sent.messageId) {
      await db.from('crm_wa_outbox').update({ state: 'failed', error_code: String(sent.errorCode ?? 'META_REJECTED'), updated_at: new Date().toISOString() }).eq('request_id', requestId);
      return json({ error: 'A Meta recusou a mensagem. Confira o canal e tente outra mensagem.' }, 502);
    }
    const { error: messageError } = await db.from('crm_wa_messages').insert({
      conversation_id: conversationId, provider_message_id: sent.messageId, direction: 'outbound',
      kind: kind ?? 'text', body: text, media_id: mediaId, mime_type: mediaFile?.type.split(';')[0] ?? null,
      occurred_at: new Date().toISOString(), delivery_status: 'pending',
    });
    if (messageError) {
      await db.from('crm_wa_outbox').update({ state: 'unknown', provider_message_id: sent.messageId, error_code: 'LOCAL_PERSIST_FAILED', updated_at: new Date().toISOString() }).eq('request_id', requestId);
      return json({ error: 'A Meta aceitou a mensagem, mas o CRM ainda não conseguiu registrá-la. Não reenvie.' }, 503);
    }
    await db.from('crm_wa_outbox').update({ state: 'sent', provider_message_id: sent.messageId, updated_at: new Date().toISOString() }).eq('request_id', requestId);
    await db.rpc('crm_wa_set_latest', { p_conversation_id: conversationId, p_occurred_at: new Date().toISOString(), p_preview: (text || (kind ? { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Documento' }[kind] : 'Mensagem')).slice(0, 160) });
    return json({ ok: true, messageId: sent.messageId });
  } catch {
    await db.from('crm_wa_outbox').update({ state: 'unknown', error_code: 'META_RESULT_UNKNOWN', updated_at: new Date().toISOString() }).eq('request_id', requestId);
    return json({ error: 'Resultado do envio incerto. Confira a conversa antes de tentar outra mensagem.' }, 503);
  }
});
