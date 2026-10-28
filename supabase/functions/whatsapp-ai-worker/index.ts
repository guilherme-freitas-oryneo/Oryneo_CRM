import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { requestAiReply, type AiMessage, type AiProvider } from '../_shared/whatsapp/aiProvider.ts';
import { processAiJob, type AiJobContext, type AiJobRecord } from '../_shared/whatsapp/aiJobProcessor.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

type ClaimedJob = {
  id: string;
  channel_id: string;
  conversation_id: string;
  inbound_message_id: string;
  lease_token: string;
  attempts: number;
};

function trainingDetails(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim())
    .map(([key, text]) => `${key.replaceAll('_', ' ').toUpperCase()}\n${text.trim()}`)
    .join('\n\n');
}

async function loadContext(job: AiJobRecord): Promise<AiJobContext> {
  const [conversationResult, settingsResult, latestResult, messagesResult, attachmentsResult, secretResult] = await Promise.all([
    db.from('crm_wa_conversations')
      .select('mode,opted_out,consent_granted,last_inbound_at,crm_wa_channels!inner(enabled)')
      .eq('id', job.conversationId).eq('channel_id', job.channelId).single(),
    db.from('crm_wa_ai_settings')
      .select('provider,model,mode,system_prompt,training_prompt,training_config,api_secret_id')
      .eq('channel_id', job.channelId).single(),
    db.from('crm_wa_messages').select('id').eq('conversation_id', job.conversationId)
      .eq('direction', 'inbound').is('reaction_to_provider_message_id', null)
      .order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('crm_wa_messages').select('direction,body,kind').eq('conversation_id', job.conversationId)
      .is('reaction_to_provider_message_id', null).order('occurred_at', { ascending: false }).limit(20),
    db.from('crm_wa_ai_attachments').select('file_name,extracted_text').eq('channel_id', job.channelId)
      .order('created_at', { ascending: true }).limit(20),
    db.rpc('crm_wa_ai_get_secret', { p_channel_id: job.channelId }),
  ]);

  const failure = [conversationResult.error, settingsResult.error, latestResult.error, messagesResult.error, attachmentsResult.error, secretResult.error].find(Boolean);
  if (failure) throw new Error('AI_CONTEXT_UNAVAILABLE');
  const conversation = conversationResult.data;
  const settings = settingsResult.data;
  if (!conversation || !settings || typeof secretResult.data !== 'string' || !secretResult.data) {
    throw new Error('AI_CONFIGURATION_UNAVAILABLE');
  }
  const channel = conversation.crm_wa_channels as unknown as { enabled: boolean };
  const messages = (messagesResult.data ?? []).reverse()
    .filter((row) => row.kind === 'text' && typeof row.body === 'string' && !!row.body.trim())
    .map((row) => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: row.body.trim().slice(0, 2000),
    } as AiMessage));
  const attachmentText = (attachmentsResult.data ?? [])
    .filter((row) => typeof row.extracted_text === 'string' && !!row.extracted_text.trim())
    .map((row) => `ARQUIVO: ${row.file_name}\n${row.extracted_text.trim().slice(0, 12000)}`)
    .join('\n\n')
    .slice(0, 30000);
  const structuredTraining = trainingDetails(settings.training_config);

  return {
    channelEnabled: channel.enabled,
    conversationMode: conversation.mode,
    optedOut: conversation.opted_out,
    consentGranted: conversation.consent_granted,
    lastInboundAt: conversation.last_inbound_at,
    globalMode: settings.mode,
    latestInboundMessageId: latestResult.data?.id ?? null,
    provider: settings.provider as AiProvider,
    model: settings.model,
    apiKey: secretResult.data,
    systemPrompt: settings.system_prompt,
    trainingPrompt: [settings.training_prompt, structuredTraining].filter(Boolean).join('\n\n'),
    attachmentText,
    messages,
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  const token = request.headers.get('x-oryneo-cron') ?? '';
  const verified = await db.rpc('crm_mail_verify_cron', { p_token: token });
  if (verified.error || verified.data !== true) return json({ error: 'Autenticação inválida.' }, 401);

  const claimed = await db.rpc('crm_wa_claim_ai_jobs', { p_limit: 5, p_lease_seconds: 60 });
  if (claimed.error) return json({ error: 'Não foi possível reservar os trabalhos.' }, 503);
  const results: Array<{ id: string; state: string }> = [];

  for (const row of (claimed.data ?? []) as ClaimedJob[]) {
    const job: AiJobRecord = {
      id: row.id,
      channelId: row.channel_id,
      conversationId: row.conversation_id,
      inboundMessageId: row.inbound_message_id,
      leaseToken: row.lease_token,
      attempts: row.attempts,
    };
    const decision = await processAiJob(job, {
      now: () => new Date(),
      loadContext,
      generate: requestAiReply,
      async completeGeneration(input) {
        const result = await db.rpc('crm_wa_complete_ai_generation', {
          p_job_id: input.jobId, p_lease_token: input.leaseToken, p_reply: input.reply,
          p_provider_response_id: input.providerResponseId, p_error_code: null, p_retryable: false,
        });
        if (result.error) throw new Error('AI_COMPLETION_PERSIST_FAILED');
        return result.data;
      },
      async completeFailure(input) {
        const result = await db.rpc('crm_wa_complete_ai_generation', {
          p_job_id: input.jobId, p_lease_token: input.leaseToken, p_reply: null,
          p_provider_response_id: input.providerResponseId, p_error_code: input.errorCode, p_retryable: input.retryable,
        });
        if (result.error) throw new Error('AI_FAILURE_PERSIST_FAILED');
        return result.data;
      },
      async cancel(input) {
        const result = await db.rpc('crm_wa_cancel_ai_job', {
          p_job_id: input.jobId, p_lease_token: input.leaseToken, p_state: input.state, p_reason: input.reason,
        });
        if (result.error) throw new Error('AI_CANCELLATION_PERSIST_FAILED');
        return result.data;
      },
    });
    results.push({ id: job.id, state: decision.state });
  }
  return json({ ok: true, claimed: results.length, results });
});
