import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { requestAiReply, type AiMessage, type AiProvider } from '../_shared/whatsapp/aiProvider.ts';
import { processAiJob, type AiJobContext, type AiJobRecord } from '../_shared/whatsapp/aiJobProcessor.ts';
import { MetaSendError, processAiOutboxItem, type AiOutboxContext, type AiOutboxItem } from '../_shared/whatsapp/aiOutboxProcessor.ts';
import { buildOutboundMessage } from '../_shared/whatsapp/outboundMessage.ts';
import {resolveSdrRuntimeTraining} from '../_shared/sdr/runtimeRelease.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const accessToken = Deno.env.get('WHATSAPP_SYSTEM_USER_TOKEN') ?? '';
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const graphVersion = 'v26.0';
// Deployment-safe opt-in: undefined/false preserves the already-live legacy SDR.
const semanticOptIn = Deno.env.get('ORYNEO_SDR_INTELLIGENCE_ENABLED') === 'true';
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

type ClaimedOutbox = {
  id: string;
  job_id: string;
  conversation_id: string;
  lease_token: string;
  body: string;
  attempts: number;
};

function trainingDetails(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim())
    .map(([key, text]) => `${key.replaceAll('_', ' ').toUpperCase()}\n${text.trim()}`)
    .join('\n\n');
}

async function approvedSdrTraining(input:{
 latestUserMessage:string;mode:string;consent:boolean;optedOut:boolean;
}):Promise<{authoritativeTraining:string;policyHumanReview:boolean}>{
 // Guard is evaluated only for an explicitly enabled future release.
 // No release, stale pointer or unavailable DB cannot silently fall back to
 // the previous unversioned training prompt while this opt-in is enabled.
 const workspace=await db.from('automation_workspaces')
  .select('id').eq('slug','oryneo-crm').maybeSingle();
 if(workspace.error||!workspace.data)throw Error('SDR_RELEASE_SOURCE_UNAVAILABLE');
 const w=workspace.data.id;
 const active=await db.from('automation_sdr_active_release')
  .select('enabled,knowledge_release_id,dictionary_release_id')
  .eq('workspace_id',w).maybeSingle();
 if(active.error)throw Error('SDR_RELEASE_POINTER_UNAVAILABLE');
 if(!active.data?.enabled||!active.data.knowledge_release_id||!active.data.dictionary_release_id)
   return {authoritativeTraining:'',policyHumanReview:true};
 const [knowledge,dictionary]=await Promise.all([
  db.from('automation_knowledge_release')
   .select('id,release_version,status,approved_by,content_sha256,source_refs')
   .eq('workspace_id',w).eq('id',active.data.knowledge_release_id).maybeSingle(),
  db.from('automation_intent_dictionary')
   .select('id,release_version,status,approved_by,content_sha256,examples,synonyms')
   .eq('workspace_id',w).eq('id',active.data.dictionary_release_id).maybeSingle(),
 ]);
 if(knowledge.error||dictionary.error)throw Error('SDR_RELEASE_READ_UNAVAILABLE');
 const result=await resolveSdrRuntimeTraining({
  sources:{active:active.data,knowledge:knowledge.data,dictionary:dictionary.data},
  latestUserMessage:input.latestUserMessage,conversationMode:input.mode,
  optedOut:input.optedOut,consent:input.consent,
  canonicalPaymentVerified:false,
 });
 return {authoritativeTraining:result.training,policyHumanReview:result.humanReview};
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
  const latestUserMessage=messages.filter(m=>m.role==='user').at(-1)?.content||'';
  const semantic=semanticOptIn
    ?await approvedSdrTraining({
      latestUserMessage,mode:conversation.mode,consent:conversation.consent_granted,
      optedOut:conversation.opted_out,
    })
    :null;

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
    ...(semantic?{authoritativeTraining:semantic.authoritativeTraining,
      policyHumanReview:semantic.policyHumanReview}:{}),
  };
}

async function loadOutboxContext(item: AiOutboxItem): Promise<AiOutboxContext> {
  const [conversationResult, jobResult, latestResult] = await Promise.all([
    db.from('crm_wa_conversations')
      .select('mode,opted_out,consent_granted,last_inbound_at,customer_wa_id,crm_wa_channels!inner(enabled,phone_number_id)')
      .eq('id', item.conversationId).single(),
    db.from('crm_wa_ai_jobs').select('channel_id,inbound_message_id').eq('id', item.jobId).single(),
    db.from('crm_wa_messages').select('id').eq('conversation_id', item.conversationId)
      .eq('direction', 'inbound').is('reaction_to_provider_message_id', null)
      .order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (jobResult.error || !jobResult.data) throw new Error('META_JOB_CONTEXT_UNAVAILABLE');
  const settings = await db.from('crm_wa_ai_settings').select('mode').eq('channel_id', jobResult.data.channel_id).single();
  const failure = [conversationResult.error, settings.error, latestResult.error].find(Boolean);
  if (failure || !conversationResult.data || !settings.data) throw new Error('META_CONTEXT_UNAVAILABLE');
  const conversation = conversationResult.data;
  const channel = conversation.crm_wa_channels as unknown as { enabled: boolean; phone_number_id: string };
  if (!phoneNumberId || channel.phone_number_id !== phoneNumberId) throw new Error('META_CHANNEL_MISMATCH');
  return {
    channelEnabled: channel.enabled,
    conversationMode: conversation.mode,
    optedOut: conversation.opted_out,
    consentGranted: conversation.consent_granted,
    lastInboundAt: conversation.last_inbound_at,
    globalMode: settings.data.mode,
    recipient: conversation.customer_wa_id,
    jobInboundMessageId: jobResult.data.inbound_message_id,
    latestInboundMessageId: latestResult.data?.id ?? null,
  };
}

async function sendMetaText(input: { to: string; text: string }): Promise<{ messageId: string }> {
  if (!accessToken || !phoneNumberId) throw new MetaSendError('META_CONFIGURATION_MISSING', false, false);
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...buildOutboundMessage({ to: input.to, kind: 'text', text: input.text }) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MetaSendError('META_RESULT_UNKNOWN', false, true);
  }
  const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: unknown }>; error?: { code?: unknown } } | null;
  if (!response.ok) {
    if (response.status === 429) throw new MetaSendError('META_RATE_LIMITED', true, false);
    if (response.status >= 500) throw new MetaSendError('META_UNAVAILABLE', true, false);
    if (response.status === 401 || response.status === 403 || payload?.error?.code === 190) {
      throw new MetaSendError('META_AUTH', false, false);
    }
    throw new MetaSendError('META_REQUEST_REJECTED', false, false);
  }
  const messageId = typeof payload?.messages?.[0]?.id === 'string' ? payload.messages[0].id : '';
  if (!messageId) throw new MetaSendError('META_RESULT_UNKNOWN', false, true);
  return { messageId };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  const token = request.headers.get('x-oryneo-cron') ?? '';
  const verified = await db.rpc('crm_mail_verify_cron', { p_token: token });
  if (verified.error || verified.data !== true) return json({ error: 'Autenticação inválida.' }, 401);

  const claimed = await db.rpc('crm_wa_claim_ai_jobs', { p_limit: 3, p_lease_seconds: 180 });
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
  const claimedOutbox = await db.rpc('crm_wa_claim_ai_outbox', { p_limit: 5, p_lease_seconds: 180 });
  if (claimedOutbox.error) return json({ error: 'Não foi possível reservar os envios.', generated: results }, 503);
  const sends: Array<{ id: string; state: string }> = [];
  for (const row of (claimedOutbox.data ?? []) as ClaimedOutbox[]) {
    const item: AiOutboxItem = {
      id: row.id, jobId: row.job_id, conversationId: row.conversation_id,
      leaseToken: row.lease_token, body: row.body, attempts: row.attempts,
    };
    const decision = await processAiOutboxItem(item, {
      now: () => new Date(),
      loadContext: loadOutboxContext,
      sendText: sendMetaText,
      async finish(input) {
        const result = await db.rpc('crm_wa_finish_ai_send', {
          p_outbox_id: input.outboxId, p_lease_token: input.leaseToken, p_outcome: input.outcome,
          p_provider_message_id: input.providerMessageId, p_error_code: input.errorCode,
        });
        if (result.error) throw new Error('META_SEND_PERSIST_FAILED');
        return result.data;
      },
    });
    sends.push({ id: item.id, state: decision.state });
    if (decision.state === 'sent') {
      await db.rpc('crm_wa_set_latest', {
        p_conversation_id: item.conversationId, p_occurred_at: new Date().toISOString(), p_preview: item.body.slice(0, 160),
      });
    }
  }
  return json({ ok: true, generated: results.length, sent: sends.length, results, sends });
});
