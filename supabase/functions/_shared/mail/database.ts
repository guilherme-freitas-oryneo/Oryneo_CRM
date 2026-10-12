import { normalizeMessage, type NormalizedMessage } from './mime.ts';
import type { ImapFetchedFlags, ImapFetchedMessage } from './protocol.ts';
import type { DiscoveredFolder, MailCredentials, MailSyncDatabase, StoredFolder } from './sync.ts';

type SupabaseLike = {
  from(name: string): any;
  rpc(name: string, params?: Record<string, unknown>): PromiseLike<{ data: any; error: { message?: string } | null }>;
  storage: { from(bucket: string): { upload(path: string, body: Uint8Array, options: Record<string, unknown>): Promise<{ error: { message?: string; statusCode?: string } | null }> } };
};

export type PreparedIncomingMessage = {
  parsed: NormalizedMessage;
  fingerprint: string;
  direction: 'inbound' | 'outbound';
  participantEmails: string[];
  snippet: string;
  receivedAt: string;
};

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function prepareIncomingMessage(message: ImapFetchedMessage, mailboxAddress: string): Promise<PreparedIncomingMessage> {
  const parsed = await normalizeMessage(message.raw);
  const rawCopy = new Uint8Array(message.raw.byteLength);
  rawCopy.set(message.raw);
  const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', rawCopy.buffer)));
  const participants = [parsed.from, ...parsed.to, ...parsed.cc, ...parsed.bcc]
    .map((participant) => participant.address.trim().toLowerCase())
    .filter(Boolean);
  const date = parsed.date ? new Date(parsed.date) : new Date();
  return {
    parsed,
    fingerprint,
    direction: parsed.from.address.toLowerCase() === mailboxAddress.toLowerCase() ? 'outbound' : 'inbound',
    participantEmails: [...new Set(participants)].sort(),
    snippet: parsed.text.replace(/\s+/g, ' ').trim().slice(0, 500),
    receivedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
  };
}

export function threadAnchors(message: Pick<NormalizedMessage, 'internetMessageId' | 'inReplyTo' | 'references'>): string[] {
  const candidates = [...message.references].reverse();
  if (message.inReplyTo) candidates.unshift(message.inReplyTo);
  if (message.internetMessageId) candidates.push(message.internetMessageId);
  return [...new Set(candidates.filter(Boolean))];
}

export function safeStorageName(filename: string): string {
  const leaf = filename.replaceAll('\\', '/').split('/').pop() || 'anexo';
  return leaf.normalize('NFKC').replace(/\s/g, '-').replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 180) || 'anexo';
}

function throwIf(error: { message?: string } | null, code: string): void {
  if (error) throw new Error(code);
}

export class SupabaseMailDatabase implements MailSyncDatabase {
  constructor(private readonly client: SupabaseLike) {}

  async claimLock(mailboxId: string, owner: string, seconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc('crm_mail_claim_lock', { p_mailbox_id: mailboxId, p_owner: owner, p_seconds: seconds });
    throwIf(error, 'DB_LOCK');
    return data === true;
  }

  async releaseLock(mailboxId: string, owner: string): Promise<void> {
    const { error } = await this.client.rpc('crm_mail_release_lock', { p_mailbox_id: mailboxId, p_owner: owner });
    throwIf(error, 'DB_UNLOCK');
  }

  async getCredentials(mailboxId: string): Promise<MailCredentials> {
    const { data, error } = await this.client.rpc('crm_mail_get_credentials', { p_mailbox_id: mailboxId });
    throwIf(error, 'DB_CREDENTIALS');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.password) throw new Error('DB_CREDENTIALS');
    return {
      address: row.address,
      displayName: row.display_name,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      password: row.password,
    };
  }

  async startRun(mailboxId: string, trigger: 'cron' | 'manual' | 'bootstrap'): Promise<string> {
    const { data, error } = await this.client.from('crm_mail_sync_runs').insert({ mailbox_id: mailboxId, state: 'running', trigger_source: trigger }).select('id').single();
    throwIf(error, 'DB_SYNC_RUN');
    return data.id;
  }

  async finishRun(runId: string, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from('crm_mail_sync_runs').update(values).eq('id', runId);
    throwIf(error, 'DB_SYNC_RUN');
  }

  async upsertFolder(mailboxId: string, folder: DiscoveredFolder): Promise<StoredFolder> {
    const { data, error } = await this.client.from('crm_mail_folders').upsert({
      mailbox_id: mailboxId,
      remote_name: folder.remoteName,
      name: folder.name,
      delimiter: folder.delimiter,
      special_use: folder.specialUse,
    }, { onConflict: 'mailbox_id,remote_name' }).select('*').single();
    throwIf(error, 'DB_FOLDER');
    return data as StoredFolder;
  }

  async resetFolder(folderId: string, uidValidity: number): Promise<void> {
    const now = new Date().toISOString();
    const locations = await this.client.from('crm_mail_locations').update({ removed_at: now }).eq('folder_id', folderId).is('removed_at', null);
    throwIf(locations.error, 'DB_FOLDER_RESET');
    const folder = await this.client.from('crm_mail_folders').update({ uid_validity: uidValidity, uid_next: 1, last_synced_uid: 0, history_before_uid: null, sync_state: 'pending' }).eq('id', folderId);
    throwIf(folder.error, 'DB_FOLDER_RESET');
  }

  async saveMessage(folderId: string, uidValidity: number, message: ImapFetchedMessage): Promise<boolean> {
    const { data: folder, error: folderError } = await this.client.from('crm_mail_folders').select('mailbox_id,crm_mailboxes(address)').eq('id', folderId).single();
    throwIf(folderError, 'DB_FOLDER');
    const mailboxAddress = folder.crm_mailboxes.address as string;
    const prepared = await prepareIncomingMessage(message, mailboxAddress);
    let existing: { id: string; thread_id: string } | null = null;
    if (prepared.parsed.internetMessageId) {
      const lookup = await this.client.from('crm_mail_messages').select('id,thread_id').eq('mailbox_id', folder.mailbox_id).eq('internet_message_id', prepared.parsed.internetMessageId).limit(1).maybeSingle();
      throwIf(lookup.error, 'DB_MESSAGE_LOOKUP');
      existing = lookup.data;
    }
    if (!existing) {
      const lookup = await this.client.from('crm_mail_messages').select('id,thread_id').eq('mailbox_id', folder.mailbox_id).eq('content_fingerprint', prepared.fingerprint).maybeSingle();
      throwIf(lookup.error, 'DB_MESSAGE_LOOKUP');
      existing = lookup.data;
    }
    if (existing) {
      await this.#saveLocation(existing.id, folderId, uidValidity, message);
      return false;
    }

    let threadId: string | null = null;
    const anchors = threadAnchors(prepared.parsed);
    if (anchors.length) {
      const { data, error } = await this.client.from('crm_mail_messages').select('thread_id').eq('mailbox_id', folder.mailbox_id).in('internet_message_id', anchors).limit(1).maybeSingle();
      throwIf(error, 'DB_THREAD_LOOKUP');
      threadId = data?.thread_id ?? null;
    }
    const normalizedSubject = prepared.parsed.subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^\s*(?:(?:re|res|resp|fw|fwd|enc|rv)(?:\[\d+\])?\s*:\s*)+/iu, '').trim().toLowerCase();
    if (!threadId && normalizedSubject) {
      const { data, error } = await this.client.from('crm_mail_threads').select('id').eq('mailbox_id', folder.mailbox_id).eq('subject_normalized', normalizedSubject).gte('last_message_at', new Date(Date.now() - 30 * 86400_000).toISOString()).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      throwIf(error, 'DB_THREAD_LOOKUP');
      threadId = data?.id ?? null;
    }
    if (!threadId) {
      const participants = [prepared.parsed.from, ...prepared.parsed.to, ...prepared.parsed.cc, ...prepared.parsed.bcc];
      const { data, error } = await this.client.from('crm_mail_threads').insert({
        mailbox_id: folder.mailbox_id,
        subject: prepared.parsed.subject,
        subject_normalized: normalizedSubject,
        participants,
        snippet: prepared.snippet,
        last_message_at: prepared.receivedAt,
      }).select('id').single();
      throwIf(error, 'DB_THREAD_CREATE');
      threadId = data.id;
    }

    const { data: saved, error: saveError } = await this.client.from('crm_mail_messages').insert({
      mailbox_id: folder.mailbox_id,
      thread_id: threadId,
      internet_message_id: prepared.parsed.internetMessageId,
      content_fingerprint: prepared.fingerprint,
      in_reply_to: prepared.parsed.inReplyTo,
      reference_ids: prepared.parsed.references,
      subject: prepared.parsed.subject,
      sender: prepared.parsed.from,
      recipients_to: prepared.parsed.to,
      recipients_cc: prepared.parsed.cc,
      recipients_bcc: prepared.parsed.bcc,
      participant_emails: prepared.participantEmails,
      sent_at: prepared.parsed.date,
      received_at: prepared.receivedAt,
      body_text: prepared.parsed.text.slice(0, 10 * 1024 * 1024),
      body_html: prepared.parsed.html.slice(0, 10 * 1024 * 1024),
      snippet: prepared.snippet,
      size_bytes: message.size,
      has_attachments: prepared.parsed.attachments.length > 0,
      direction: prepared.direction,
    }).select('id').single();
    throwIf(saveError, 'DB_MESSAGE_CREATE');
    await this.#saveLocation(saved.id, folderId, uidValidity, message);
    await this.#saveAttachments(folder.mailbox_id, saved.id, prepared.parsed.attachments);
    await this.#linkDeals(saved.id, prepared.participantEmails);
    const refreshed = await this.client.rpc('crm_mail_refresh_thread', { p_thread: threadId });
    throwIf(refreshed.error, 'DB_THREAD_REFRESH');
    return true;
  }

  async reconcileFolder(folderId: string, uidValidity: number, flags: ImapFetchedFlags[]): Promise<number> {
    const { data: local, error } = await this.client.from('crm_mail_locations').select('id,uid,flags,message_id,crm_mail_messages(thread_id)').eq('folder_id', folderId).eq('uid_validity', uidValidity).is('removed_at', null);
    throwIf(error, 'DB_FLAGS');
    const remote = new Map(flags.map((entry) => [entry.uid, entry.flags]));
    const touchedThreads = new Set<string>();
    let changed = 0;
    for (const row of local ?? []) {
      const remoteFlags = remote.get(Number(row.uid));
      const values = remoteFlags ? { flags: remoteFlags } : { removed_at: new Date().toISOString() };
      if (!remoteFlags || JSON.stringify([...row.flags].sort()) !== JSON.stringify([...remoteFlags].sort())) {
        const update = await this.client.from('crm_mail_locations').update(values).eq('id', row.id);
        throwIf(update.error, 'DB_FLAGS');
        changed += 1;
        if (row.crm_mail_messages?.thread_id) touchedThreads.add(row.crm_mail_messages.thread_id);
      }
    }
    for (const threadId of touchedThreads) {
      const refreshed = await this.client.rpc('crm_mail_refresh_thread', { p_thread: threadId });
      throwIf(refreshed.error, 'DB_THREAD_REFRESH');
    }
    return changed;
  }

  async updateFolder(folderId: string, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from('crm_mail_folders').update(values).eq('id', folderId);
    throwIf(error, 'DB_FOLDER');
  }

  async #saveLocation(messageId: string, folderId: string, uidValidity: number, message: ImapFetchedMessage): Promise<void> {
    const { error } = await this.client.from('crm_mail_locations').upsert({
      message_id: messageId,
      folder_id: folderId,
      uid_validity: uidValidity,
      uid: message.uid,
      flags: message.flags,
      removed_at: null,
    }, { onConflict: 'folder_id,uid_validity,uid' });
    throwIf(error, 'DB_LOCATION');
  }

  async #saveAttachments(mailboxId: string, messageId: string, attachments: NormalizedMessage['attachments']): Promise<void> {
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      if (attachment.content.length > 15 * 1024 * 1024) continue;
      const path = `${mailboxId}/${messageId}/${index}-${safeStorageName(attachment.filename)}`;
      const upload = await this.client.storage.from('crm-mail-attachments').upload(path, attachment.content, { contentType: attachment.mimeType, upsert: false });
      if (upload.error && upload.error.statusCode !== '409') throw new Error('DB_ATTACHMENT_UPLOAD');
      const { error } = await this.client.from('crm_mail_attachments').upsert({
        message_id: messageId,
        filename: attachment.filename,
        mime_type: attachment.mimeType,
        size_bytes: attachment.content.length,
        content_id: attachment.contentId,
        inline: attachment.inline,
        storage_path: path,
      }, { onConflict: 'message_id,storage_path' });
      throwIf(error, 'DB_ATTACHMENT');
    }
  }

  async #linkDeals(messageId: string, participantEmails: string[]): Promise<void> {
    if (!participantEmails.length) return;
    const { data, error } = await this.client.from('crm_records').select('id,data').eq('kind', 'deal').eq('deleted', false);
    throwIf(error, 'DB_DEAL_LOOKUP');
    const emailSet = new Set(participantEmails);
    const links = (data ?? []).filter((record: { data?: { email?: string } }) => emailSet.has(record.data?.email?.trim().toLowerCase() ?? '')).map((record: { id: string }) => ({ message_id: messageId, deal_id: record.id, automatic: true }));
    if (links.length) {
      const result = await this.client.from('crm_mail_deal_links').upsert(links, { onConflict: 'message_id,deal_id', ignoreDuplicates: true });
      throwIf(result.error, 'DB_DEAL_LINK');
    }
  }
}
