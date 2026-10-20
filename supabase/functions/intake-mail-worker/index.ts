import { createClient } from '../_shared/mail/deps.ts';
import { safeToRetryOutbox, sendMail, type ComposeInput, type MailSendDependencies } from '../_shared/mail/actions.ts';
import { SupabaseMailDatabase } from '../_shared/mail/database.ts';
import { intakeConfirmationStateForError, processIntakeConfirmationJobs, type IntakeConfirmationDependencies } from '../_shared/mail/intake-confirmation.ts';
import type { MailCredentials } from '../_shared/mail/sync.ts';
import { ImapClient, SmtpClient } from '../_shared/mail/transport.ts';
import { createIntakeMailWorkerHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Configuração interna indisponível.');

const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const database = new SupabaseMailDatabase(client);

async function withImap<T>(credentials: MailCredentials, operation: (imap: ImapClient) => Promise<T>): Promise<T> {
  const imap = new ImapClient({ host: credentials.imapHost, port: credentials.imapPort, username: credentials.address, password: credentials.password });
  try {
    await imap.connect();
    await imap.login();
    const result = await operation(imap);
    await imap.logout();
    return result;
  } catch (error) {
    imap.close();
    throw error;
  }
}

async function sentFolder(imap: ImapClient): Promise<string> {
  const folders = await imap.list();
  const folder = folders.find((entry) => entry.attributes.some((attribute) => attribute.toLowerCase() === '\\sent'))
    ?? folders.find((entry) => /(^|[./])(sent|enviad)/i.test(entry.name));
  if (!folder) throw new Error('MAIL_APPEND');
  return folder.name;
}

const sendDependencies: MailSendDependencies = {
  getCredentials: (mailboxId) => database.getCredentials(mailboxId),
  async beginOutbox(userId, input, internetMessageId) {
    const insert = await client.from('crm_mail_outbox').insert({
      mailbox_id: input.mailboxId,
      created_by: userId,
      idempotency_key: input.idempotencyKey,
      internet_message_id: internetMessageId,
      payload: { ...input, attachments: [] },
      source: 'system',
      state: 'sending',
      attempts: 1,
    }).select('state,internet_message_id,accepted_at,created_by,attempts').maybeSingle();
    if (!insert.error && insert.data) {
      return { state: insert.data.state, internetMessageId: insert.data.internet_message_id, acceptedAt: insert.data.accepted_at };
    }
    if (insert.error?.code !== '23505') throw new Error('MAIL_SEND');
    const existing = await client.from('crm_mail_outbox')
      .select('state,internet_message_id,accepted_at,created_by,attempts,error_code,source')
      .eq('idempotency_key', input.idempotencyKey).single();
    const data = existing.data;
    if (existing.error || !data || data.created_by !== null || data.source !== 'system') throw new Error('MAIL_SEND');
    if (data.state === 'sending' && !data.accepted_at) throw new Error('MAIL_IN_PROGRESS');
    if (data.state === 'failed') {
      if (!safeToRetryOutbox(data.state, data.accepted_at, data.error_code)) throw new Error('MAIL_IN_PROGRESS');
      const update = await client.from('crm_mail_outbox').update({
        state: 'sending', attempts: Number(data.attempts) + 1, error_code: null,
      }).eq('idempotency_key', input.idempotencyKey).eq('state', 'failed').select('id').maybeSingle();
      if (update.error || !update.data) throw new Error('MAIL_IN_PROGRESS');
    }
    return { state: data.state, internetMessageId: data.internet_message_id, acceptedAt: data.accepted_at };
  },
  findSentMessage: (credentials, messageId) => withImap(credentials, async (imap) => {
    await imap.select(await sentFolder(imap));
    return (await imap.searchHeader('Message-ID', messageId)).length > 0;
  }),
  async smtpSend(credentials, envelope) {
    const smtp = new SmtpClient({ host: credentials.smtpHost, port: credentials.smtpPort, username: credentials.address, password: credentials.password });
    await smtp.send(envelope);
  },
  appendSent: (credentials, raw) => withImap(credentials, async (imap) => {
    await imap.append(await sentFolder(imap), raw, ['\\Seen']);
  }),
  async markAccepted(idempotencyKey) {
    const result = await client.from('crm_mail_outbox').update({ accepted_at: new Date().toISOString(), state: 'sending' }).eq('idempotency_key', idempotencyKey);
    if (result.error) throw new Error('MAIL_SEND');
  },
  async markSent(idempotencyKey) {
    const result = await client.from('crm_mail_outbox').update({ state: 'sent', error_code: null }).eq('idempotency_key', idempotencyKey);
    if (result.error) throw new Error('MAIL_SEND');
  },
  async markFailed(idempotencyKey, errorCode) {
    await client.from('crm_mail_outbox').update({ state: 'failed', error_code: errorCode }).eq('idempotency_key', idempotencyKey);
  },
};

let mailboxId: string | null = null;
async function activeMailboxId(): Promise<string> {
  if (mailboxId) return mailboxId;
  const result = await client.from('crm_mailboxes').select('id').eq('active', true).order('created_at').limit(1).maybeSingle();
  if (result.error || !result.data) throw new Error('INTAKE_CONFIRMATION_MAILBOX');
  mailboxId = result.data.id;
  return result.data.id;
}

const confirmationDependencies: IntakeConfirmationDependencies = {
  async claimDue(limit) {
    const result = await client.rpc('crm_claim_intake_confirmation_jobs', { p_limit: limit });
    if (result.error) throw new Error('INTAKE_CONFIRMATION_DB');
    return (result.data ?? []).map((row: { request_id: string; deal_id: string; data: Record<string, unknown> }) => ({
      requestId: row.request_id, dealId: row.deal_id, data: row.data,
      jobType: row.data._automation_job_type === 'implementation_started_email' ? 'implementation_started_email' : 'lead_received_email',
    }));
  },
  async send(input) {
    const compose: ComposeInput = { mailboxId: await activeMailboxId(), ...input };
    return await sendMail(sendDependencies, null, compose);
  },
  async markSent(requestId, internetMessageId) {
    const result = await client.rpc('crm_finish_intake_confirmation_job', {
      p_request_id: requestId, p_state: 'sent', p_internet_message_id: internetMessageId, p_error_code: null,
    });
    if (result.error) throw new Error('INTAKE_CONFIRMATION_DB');
  },
  async markFailed(requestId, errorCode) {
    const result = await client.rpc('crm_finish_intake_confirmation_job', {
      p_request_id: requestId,
      p_state: intakeConfirmationStateForError(errorCode),
      p_internet_message_id: null,
      p_error_code: errorCode,
    });
    if (result.error) throw new Error('INTAKE_CONFIRMATION_DB');
  },
};

const handler = createIntakeMailWorkerHandler({
  async verifyToken(token) {
    const result = await client.rpc('crm_mail_verify_cron', { p_token: token });
    return !result.error && result.data === true;
  },
  process: () => processIntakeConfirmationJobs(confirmationDependencies),
});

Deno.serve(handler);
