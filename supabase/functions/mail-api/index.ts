import { createClient } from '../_shared/mail/deps.ts';
import { safeToDiscardAttempt, safeToRetryOutbox, sendMail, type ComposeInput, type MailSendDependencies } from '../_shared/mail/actions.ts';
import { SupabaseMailDatabase } from '../_shared/mail/database.ts';
import type { MailboxAddress, OutgoingAttachment } from '../_shared/mail/mime.ts';
import { syncMailbox, type MailCredentials } from '../_shared/mail/sync.ts';
import { ImapClient, SmtpClient } from '../_shared/mail/transport.ts';
import { sameSavedDraft, validateDraftBody } from './drafts.ts';
import { createMailApiHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Configuração interna indisponível.');

const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const database = new SupabaseMailDatabase(client);

function requiredString(value: unknown, code = 'INVALID_MESSAGE'): string {
  if (typeof value !== 'string' || !value) throw new Error(code);
  return value;
}

function addresses(value: unknown): MailboxAddress[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('INVALID_RECIPIENT');
    const item = entry as Record<string, unknown>;
    return { address: requiredString(item.address, 'INVALID_RECIPIENT'), name: typeof item.name === 'string' ? item.name : undefined };
  });
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error('INVALID_ATTACHMENT');
  }
}

function attachments(value: unknown): OutgoingAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('INVALID_ATTACHMENT');
    const item = entry as Record<string, unknown>;
    return {
      filename: requiredString(item.filename, 'INVALID_ATTACHMENT'),
      mimeType: requiredString(item.mimeType, 'INVALID_ATTACHMENT'),
      content: decodeBase64(typeof item.contentBase64==='string'?item.contentBase64:requiredString(undefined,'INVALID_ATTACHMENT')),
      contentId: typeof item.contentId === 'string' ? item.contentId : undefined,
      inline: item.inline === true,
    };
  });
}

function composeInput(body: Record<string, unknown>): ComposeInput {
  return {
    mailboxId: requiredString(body.mailboxId),
    idempotencyKey: requiredString(body.idempotencyKey),
    draftId: typeof body.draftId === 'string' ? body.draftId : null,
    to: addresses(body.to), cc: addresses(body.cc), bcc: addresses(body.bcc),
    subject: typeof body.subject === 'string' ? body.subject : '',
    text: typeof body.text === 'string' ? body.text : '',
    html: typeof body.html === 'string' ? body.html : undefined,
    inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : undefined,
    references: Array.isArray(body.references) ? body.references.map(String) : undefined,
    attachments: attachments(body.attachments),
  };
}

function payloadForStorage(input: ComposeInput): Record<string, unknown> {
  return {
    mailboxId: input.mailboxId, idempotencyKey: input.idempotencyKey, draftId: input.draftId,
    to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text, html: input.html,
    inReplyTo: input.inReplyTo, references: input.references,
    attachments: (input.attachments ?? []).map((attachment) => ({
      filename: attachment.filename, mimeType: attachment.mimeType, contentBase64: bytesToBase64(attachment.content),
      contentId: attachment.contentId, inline: attachment.inline,
    })),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

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
      mailbox_id: input.mailboxId, created_by: userId, draft_id: input.draftId ?? null,
      idempotency_key: input.idempotencyKey, internet_message_id: internetMessageId,
      payload: payloadForStorage(input), state: 'sending', attempts: 1,
    }).select('state,internet_message_id,accepted_at,created_by,attempts').maybeSingle();
    if (!insert.error && insert.data) {
      return { state: insert.data.state, internetMessageId: insert.data.internet_message_id, acceptedAt: insert.data.accepted_at };
    }
    if (insert.error?.code !== '23505') throw new Error('MAIL_SEND');
    const { data, error } = await client.from('crm_mail_outbox').select('state,internet_message_id,accepted_at,created_by,attempts,error_code').eq('idempotency_key', input.idempotencyKey).single();
    if (error || data.created_by !== userId) throw new Error('MAIL_SEND');
    if (data.state === 'sending' && !data.accepted_at) throw new Error('MAIL_IN_PROGRESS');
    if (data.state === 'failed') {
      if(!safeToRetryOutbox(data.state,data.accepted_at,data.error_code))throw new Error('MAIL_IN_PROGRESS');
      const update = await client.from('crm_mail_outbox').update({ state: 'sending', attempts: Number(data.attempts) + 1, error_code: null }).eq('idempotency_key', input.idempotencyKey).eq('state', 'failed').select('id').maybeSingle();
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
    const { error } = await client.from('crm_mail_outbox').update({ accepted_at: new Date().toISOString(), state: 'sending' }).eq('idempotency_key', idempotencyKey);
    if (error) throw new Error('MAIL_SEND');
  },
  async markSent(idempotencyKey) {
    const { error } = await client.from('crm_mail_outbox').update({ state: 'sent', error_code: null }).eq('idempotency_key', idempotencyKey);
    if (error) throw new Error('MAIL_SEND');
  },
  async markFailed(idempotencyKey, errorCode) {
    await client.from('crm_mail_outbox').update({ state: 'failed', error_code: errorCode }).eq('idempotency_key', idempotencyKey);
  },
};

async function saveDraft(userId: string, body: Record<string, unknown>): Promise<unknown> {
  validateDraftBody(body);
  const values = {
    compose_meta: body.composeMeta ?? {},
    mailbox_id: requiredString(body.mailboxId), created_by: userId,
    thread_id: typeof body.threadId === 'string' ? body.threadId : null,
    reply_to_message_id: typeof body.replyToMessageId === 'string' ? body.replyToMessageId : null,
    recipients_to: addresses(body.to), recipients_cc: addresses(body.cc), recipients_bcc: addresses(body.bcc),
    subject: typeof body.subject === 'string' ? body.subject : '', body_text: typeof body.text === 'string' ? body.text : '',
    body_html: typeof body.html === 'string' ? body.html : '', attachment_manifest: Array.isArray(body.attachmentManifest) ? body.attachmentManifest : [],
  };
  if (body.revision === 0) {
    const { data, error } = await client.from('crm_mail_drafts').insert({ ...values, ...(typeof body.draftId === 'string' ? {id: body.draftId} : {}) }).select('*').single();
    if(error?.code==='23505'&&typeof body.draftId==='string'){
      const existing=await client.from('crm_mail_drafts').select('*').eq('id',body.draftId).eq('created_by',userId).maybeSingle();
      if(!existing.error&&existing.data&&sameSavedDraft(existing.data,values,1))return existing.data;
    }
    if (error) throw new Error('DRAFT_CONFLICT');
    return data;
  }
  const revision = Number(body.revision);
  if (typeof body.draftId!=='string'||!Number.isSafeInteger(revision) || revision < 1) throw new Error('DRAFT_CONFLICT');
  const { data, error } = await client.from('crm_mail_drafts').update({ ...values, revision: revision + 1 }).eq('id', body.draftId).eq('created_by', userId).eq('revision', revision).eq('state', 'active').not('compose_meta','cs','{"locked":true}').select('*').maybeSingle();
  if(error||!data){
    const existing=await client.from('crm_mail_drafts').select('*').eq('id',body.draftId).eq('created_by',userId).maybeSingle();
    if(!existing.error&&existing.data&&sameSavedDraft(existing.data,values,revision+1))return existing.data;
    throw new Error('DRAFT_CONFLICT');
  }
  return data;
}

async function location(body: Record<string, unknown>) {
  const { data, error } = await client.from('crm_mail_locations').select('id,uid,uid_validity,flags,message_id,folder:crm_mail_folders!inner(remote_name,mailbox_id),message:crm_mail_messages!inner(thread_id)').eq('id', requiredString(body.locationId)).is('removed_at', null).single();
  if (error || !data) throw new Error('NOT_FOUND');
  const raw = data as unknown as {
    id: string; uid: number; uid_validity: number; flags: string[]; message_id: string;
    folder: { remote_name: string; mailbox_id: string } | { remote_name: string; mailbox_id: string }[];
    message: { thread_id: string } | { thread_id: string }[];
  };
  const folder = Array.isArray(raw.folder) ? raw.folder[0] : raw.folder;
  const message = Array.isArray(raw.message) ? raw.message[0] : raw.message;
  if (!folder || !message) throw new Error('NOT_FOUND');
  return { ...raw, folder, message };
}

async function setFlags(body: Record<string, unknown>): Promise<unknown> {
  const item = await location(body);
  const flag = body.flag === 'seen' ? '\\Seen' : body.flag === 'starred' ? '\\Flagged' : null;
  if (!flag || typeof body.value !== 'boolean') throw new Error('INVALID_MESSAGE');
  const credentials = await database.getCredentials(item.folder.mailbox_id);
  await withImap(credentials, async (imap) => {
    const selected=await imap.select(item.folder.remote_name);
    if(selected.uidValidity!==Number(item.uid_validity))throw new Error('MESSAGE_CHANGED');
    await imap.storeFlags(Number(item.uid), [flag], body.value ? '+' : '-');
  });
  const flags = new Set<string>(item.flags ?? []);
  body.value ? flags.add(flag) : flags.delete(flag);
  const { error } = await client.from('crm_mail_locations').update({ flags: [...flags] }).eq('id', item.id);
  if (error) throw new Error('MAIL_API_INTERNAL');
  await client.rpc('crm_mail_refresh_thread', { p_thread: item.message.thread_id });
  return { locationId: item.id, flags: [...flags] };
}

async function moveMessage(body: Record<string, unknown>): Promise<unknown> {
  const item = await location(body);
  const { data: target, error } = await client.from('crm_mail_folders').select('id,remote_name,mailbox_id').eq('id', requiredString(body.targetFolderId)).single();
  if (error || !target || target.mailbox_id !== item.folder.mailbox_id) throw new Error('NOT_FOUND');
  const credentials = await database.getCredentials(target.mailbox_id);
  await withImap(credentials, async (imap) => {
    const selected=await imap.select(item.folder.remote_name);
    if(selected.uidValidity!==Number(item.uid_validity))throw new Error('MESSAGE_CHANGED');
    await imap.move(Number(item.uid), target.remote_name);
  });
  const update = await client.from('crm_mail_locations').update({ removed_at: new Date().toISOString() }).eq('id', item.id);
  if (update.error) throw new Error('MAIL_API_INTERNAL');
  await client.rpc('crm_mail_refresh_thread', { p_thread: item.message.thread_id });
  return { moved: true };
}

async function syncNow(): Promise<unknown> {
  const { data, error } = await client.from('crm_mailboxes').select('id').eq('active', true).order('created_at').limit(1).single();
  if (error) throw new Error('NOT_FOUND');
  return await syncMailbox({
    db: database,
    imapFactory: (credentials) => new ImapClient({ host: credentials.imapHost, port: credentials.imapPort, username: credentials.address, password: credentials.password }),
  }, data.id, { trigger: 'manual' });
}

async function execute(userId: string, body: Record<string, unknown>): Promise<unknown> {
  const action = String(body.action);
  if (action === 'send' || action === 'retry-send') {
    let source = body;
    if (action === 'retry-send' && !body.to) {
      const { data, error } = await client.from('crm_mail_outbox').select('payload').eq('idempotency_key', requiredString(body.idempotencyKey)).eq('created_by', userId).single();
      if (error) throw new Error('NOT_FOUND');
      source = data.payload;
    }
    const draftId=source.draftId?requiredString(source.draftId):null;
    if(draftId){
      if(draftId!==requiredString(source.idempotencyKey))throw new Error('INVALID_MESSAGE');
      // Both send and discard claim the same active row. Only one can win.
      const claim=await client.from('crm_mail_drafts').update({state:'sending'}).eq('id',draftId).eq('created_by',userId).eq('mailbox_id',requiredString(source.mailboxId)).eq('state','active').contains('compose_meta',{locked:true}).select('id').maybeSingle();
      if(claim.error)throw new Error('MAIL_API_INTERNAL');
      if(!claim.data){
        const finished=await client.from('crm_mail_outbox').select('state,internet_message_id').eq('idempotency_key',draftId).eq('created_by',userId).eq('state','sent').maybeSingle();
        if(!finished.error&&finished.data){await client.from('crm_mail_drafts').update({state:'sent'}).eq('id',draftId).eq('created_by',userId).eq('state','sending');return {internetMessageId:finished.data.internet_message_id,alreadyAccepted:true};}
        throw new Error('MAIL_IN_PROGRESS');
      }
    }
    try{
      const result=await sendMail(sendDependencies,userId,composeInput(source));
      if(draftId){const finished=await client.from('crm_mail_drafts').update({state:'sent'}).eq('id',draftId).eq('created_by',userId).eq('state','sending');if(finished.error)throw new Error('MAIL_API_INTERNAL');}
      return result;
    }catch(reason){
      if(draftId){
        const attempt=await client.from('crm_mail_outbox').select('state,accepted_at,error_code').eq('idempotency_key',draftId).eq('created_by',userId).maybeSingle();
        // A missing outbox or a known pre-SMTP failure is safe to edit/retry.
        if(!attempt.error&&(!attempt.data||safeToRetryOutbox(attempt.data.state,attempt.data.accepted_at,attempt.data.error_code)))
          await client.from('crm_mail_drafts').update({state:'active'}).eq('id',draftId).eq('created_by',userId).eq('state','sending');
      }
      throw reason;
    }
  }
  if(action==='list-drafts'){
    const offset=Math.max(0,Math.min(100000,Number(body.offset)||0));
    const {data,error}=await client.from('crm_mail_drafts').select('id,subject,updated_at,revision,mailbox_id,state').eq('mailbox_id',requiredString(body.mailboxId)).eq('created_by',userId).in('state',['active','sending']).order('updated_at',{ascending:false}).order('id').range(offset,offset+49);
    if(error)throw new Error('MAIL_API_INTERNAL');return data;
  }
  if(action==='get-draft'){
    const {data,error}=await client.from('crm_mail_drafts').select('*').eq('id',requiredString(body.draftId)).eq('created_by',userId).in('state',['active','sending']).single();
    if(error)throw new Error('NOT_FOUND');return data;
  }
  if(action==='quota'){
    const credentials=await database.getCredentials(requiredString(body.mailboxId));
    try{return {quota:await withImap(credentials,imap=>imap.quota()),checkedAt:new Date().toISOString()};}
    catch{return {quota:null,checkedAt:new Date().toISOString()};}
  }
  if(action==='export-message'){
    const item=await location(body);
    const credentials=await database.getCredentials(item.folder.mailbox_id);
    const raw=await withImap(credentials,async imap=>{
      const selected=await imap.select(item.folder.remote_name);
      if(selected.uidValidity!==Number(item.uid_validity))throw new Error('MESSAGE_CHANGED');
      const result=(await imap.fetchUids(Number(item.uid),Number(item.uid))).find(m=>m.uid===Number(item.uid));
      if(!result)throw new Error('NOT_FOUND');
      if(result.raw.byteLength>15*1024*1024)throw new Error('ATTACHMENT_TOO_LARGE');
      return result.raw;
    });
    return {filename:'mensagem-original.eml',mimeType:'message/rfc822',contentBase64:bytesToBase64(raw)};
  }
  if (action === 'save-draft') return await saveDraft(userId, body);
  if (action === 'delete-draft') {
    const draftId=requiredString(body.draftId);
    const outbox=await client.from('crm_mail_outbox').select('state,accepted_at,error_code').eq('idempotency_key',draftId).eq('created_by',userId).maybeSingle();
    if(outbox.error)throw new Error('MAIL_API_INTERNAL');
    if(outbox.data&&!safeToDiscardAttempt(outbox.data.state,outbox.data.accepted_at,outbox.data.error_code))throw new Error('MAIL_IN_PROGRESS');
    const { data, error } = await client.from('crm_mail_drafts').update({ state: 'discarded' }).eq('id', draftId).eq('created_by', userId).eq('state', 'active').select('id').maybeSingle();
    if (error || !data) throw new Error('NOT_FOUND');
    return { deleted: true };
  }
  if (action === 'set-flags') return await setFlags(body);
  if (action === 'move') return await moveMessage(body);
  if (action === 'attachment-url') {
    const { data, error } = await client.from('crm_mail_attachments').select('storage_path').eq('id', requiredString(body.attachmentId)).single();
    if (error) throw new Error('NOT_FOUND');
    const signed = await client.storage.from('crm-mail-attachments').createSignedUrl(data.storage_path, 60);
    if (signed.error) throw new Error('NOT_FOUND');
    return { url: signed.data.signedUrl, expiresIn: 60 };
  }
  if (action === 'link-deal') {
    const { error } = await client.from('crm_mail_deal_links').upsert({ message_id: requiredString(body.messageId), deal_id: requiredString(body.dealId), linked_by: userId, automatic: false }, { onConflict: 'message_id,deal_id' });
    if (error) throw new Error('NOT_FOUND');
    return { linked: true };
  }
  if (action === 'unlink-deal') {
    const { error } = await client.from('crm_mail_deal_links').delete().eq('message_id', requiredString(body.messageId)).eq('deal_id', requiredString(body.dealId));
    if (error) throw new Error('NOT_FOUND');
    return { linked: false };
  }
  if (action === 'sync-now') return await syncNow();
  throw new Error('INVALID_MESSAGE');
}

const handler = createMailApiHandler({
  async authenticate(token) {
    const { data, error } = await client.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  async isMember(userId) {
    const { data, error } = await client.from('crm_members').select('user_id').eq('user_id', userId).maybeSingle();
    return !error && data !== null;
  },
  execute,
});

Deno.serve(handler);
