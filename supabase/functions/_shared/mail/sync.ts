import type { ImapFetchedFlags, ImapFetchedMessage, ImapListEntry, ImapSelectState } from './protocol.ts';

export type MailCredentials = {
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  password: string;
};

export type FolderUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'other';
export type DiscoveredFolder = { remoteName: string; name: string; delimiter: string | null; specialUse: FolderUse };
export type StoredFolder = {
  id: string;
  mailbox_id: string;
  remote_name: string;
  name: string;
  special_use: FolderUse;
  uid_validity: number;
  uid_next: number;
  last_synced_uid: number;
  history_before_uid: number | null;
};

export interface MailSyncDatabase {
  claimLock(mailboxId: string, owner: string, seconds: number): Promise<boolean>;
  releaseLock(mailboxId: string, owner: string): Promise<void>;
  getCredentials(mailboxId: string): Promise<MailCredentials>;
  startRun(mailboxId: string, trigger: 'cron' | 'manual' | 'bootstrap'): Promise<string>;
  finishRun(runId: string, values: Record<string, unknown>): Promise<void>;
  upsertFolder(mailboxId: string, folder: DiscoveredFolder): Promise<StoredFolder>;
  resetFolder(folderId: string, uidValidity: number): Promise<void>;
  saveMessage(folderId: string, uidValidity: number, message: ImapFetchedMessage): Promise<boolean>;
  reconcileFolder(folderId: string, uidValidity: number, flags: ImapFetchedFlags[]): Promise<number>;
  updateFolder(folderId: string, values: Record<string, unknown>): Promise<void>;
}

export interface MailSyncImap {
  connect(): Promise<void>;
  login(): Promise<void>;
  list(): Promise<ImapListEntry[]>;
  select(mailbox: string): Promise<ImapSelectState>;
  fetchUids(first: number, last: number | '*'): Promise<ImapFetchedMessage[]>;
  fetchFlags(first?: number, last?: number | '*'): Promise<ImapFetchedFlags[]>;
  logout(): Promise<void>;
  close(): void;
}

export type SyncDependencies = {
  db: MailSyncDatabase;
  imapFactory(credentials: MailCredentials): MailSyncImap;
  now?: () => Date;
  newId?: () => string;
};

export type SyncOptions = { batchSize?: number; timeBudgetMs?: number; trigger?: 'cron' | 'manual' | 'bootstrap' };
export type SyncResult = {
  state: 'success' | 'partial' | 'failed' | 'skipped';
  foldersProcessed: number;
  messagesImported: number;
  flagsUpdated: number;
  backlog: number;
  errorCode?: string;
};

function folderUse(entry: ImapListEntry): FolderUse {
  const attributes = new Set(entry.attributes.map((attribute) => attribute.toLowerCase()));
  if (attributes.has('\\inbox') || entry.name.toUpperCase() === 'INBOX') return 'inbox';
  if (attributes.has('\\sent') || /(^|[./])sent$/i.test(entry.name)) return 'sent';
  if (attributes.has('\\drafts') || /(^|[./])drafts$/i.test(entry.name)) return 'drafts';
  if (attributes.has('\\archive') || /(^|[./])archive$/i.test(entry.name)) return 'archive';
  if (attributes.has('\\junk') || /(^|[./])(junk|spam)$/i.test(entry.name)) return 'junk';
  if (attributes.has('\\trash') || /(^|[./])trash$/i.test(entry.name)) return 'trash';
  return 'other';
}

function displayFolder(use: FolderUse, remoteName: string): string {
  const labels: Record<Exclude<FolderUse, 'other'>, string> = {
    inbox: 'Caixa de entrada', sent: 'Enviados', drafts: 'Rascunhos', archive: 'Arquivados', junk: 'Spam', trash: 'Lixeira',
  };
  return use === 'other' ? remoteName : labels[use];
}

function classifyError(phase: string): string {
  if (phase === 'login' || phase === 'credentials') return 'MAIL_AUTH';
  if (phase === 'message') return 'MAIL_PARSE';
  return 'MAIL_NETWORK';
}

export async function syncMailbox(dependencies: SyncDependencies, mailboxId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const db = dependencies.db;
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? (() => crypto.randomUUID());
  const owner = newId();
  const batchSize = Math.min(Math.max(options.batchSize ?? 25, 1), 25);
  const timeBudgetMs = Math.min(Math.max(options.timeBudgetMs ?? 120_000, 10_000), 120_000);
  const trigger = options.trigger ?? 'cron';
  const empty: SyncResult = { state: 'skipped', foldersProcessed: 0, messagesImported: 0, flagsUpdated: 0, backlog: 0 };
  if (!await db.claimLock(mailboxId, owner, 130)) return empty;

  const startedAt = now().getTime();
  let runId: string | null = null;
  let imap: MailSyncImap | null = null;
  let phase = 'start';
  let foldersProcessed = 0;
  let messagesImported = 0;
  let flagsUpdated = 0;
  let backlog = 0;
  let loggedOut = false;
  try {
    runId = await db.startRun(mailboxId, trigger);
    phase = 'credentials';
    const credentials = await db.getCredentials(mailboxId);
    imap = dependencies.imapFactory(credentials);
    phase = 'connect';
    await imap.connect();
    phase = 'login';
    await imap.login();
    phase = 'folders';
    const discovered = (await imap.list())
      .filter((entry) => !entry.attributes.some((attribute) => attribute.toLowerCase() === '\\noselect'))
      .map((entry) => {
        const specialUse = folderUse(entry);
        return { entry, specialUse, priority: ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'other'].indexOf(specialUse) };
      })
      .sort((left, right) => left.priority - right.priority || left.entry.name.localeCompare(right.entry.name));

    for (const item of discovered) {
      if (now().getTime() - startedAt >= timeBudgetMs) break;
      let folder = await db.upsertFolder(mailboxId, {
        remoteName: item.entry.name,
        name: displayFolder(item.specialUse, item.entry.name),
        delimiter: item.entry.delimiter,
        specialUse: item.specialUse,
      });
      const selected = await imap.select(item.entry.name);
      if (folder.uid_validity > 0 && folder.uid_validity !== selected.uidValidity) {
        await db.resetFolder(folder.id, selected.uidValidity);
        folder = { ...folder, uid_validity: selected.uidValidity, last_synced_uid: 0, history_before_uid: null };
      }

      const newestUid = Math.max(selected.uidNext - 1, 0);
      let first: number | null = null;
      let last: number | null = null;
      let nextHistoryCursor = folder.history_before_uid;
      if (newestUid > folder.last_synced_uid) {
        first = folder.last_synced_uid > 0 ? folder.last_synced_uid + 1 : Math.max(1, selected.uidNext - batchSize);
        last = Math.min(newestUid, first + batchSize - 1);
        if (folder.last_synced_uid === 0) nextHistoryCursor = first > 1 ? first : null;
      } else if (folder.history_before_uid && folder.history_before_uid > 1) {
        last = folder.history_before_uid - 1;
        first = Math.max(1, last - batchSize + 1);
        nextHistoryCursor = first > 1 ? first : null;
      }

      if (first !== null && last !== null && last >= first) {
        phase = 'message';
        for (const message of await imap.fetchUids(first, last)) {
          if (await db.saveMessage(folder.id, selected.uidValidity, message)) messagesImported += 1;
        }
      }
      phase = 'flags';
      const remoteFlags = selected.exists > 0 ? await imap.fetchFlags(1, '*') : [];
      flagsUpdated += await db.reconcileFolder(folder.id, selected.uidValidity, remoteFlags);
      const unread = remoteFlags.filter((entry) => !entry.flags.some((flag) => flag.toLowerCase() === '\\seen')).length;
      backlog += Math.max((nextHistoryCursor ?? 1) - 1, 0);
      await db.updateFolder(folder.id, {
        uid_validity: selected.uidValidity,
        uid_next: selected.uidNext,
        highest_modseq: selected.highestModSeq,
        last_synced_uid: newestUid,
        history_before_uid: nextHistoryCursor,
        total_count: selected.exists,
        unread_count: unread,
        sync_state: 'ready',
        last_synced_at: now().toISOString(),
      });
      foldersProcessed += 1;
    }
    await imap.logout();
    loggedOut = true;
    const state = foldersProcessed < discovered.length ? 'partial' : 'success';
    const result: SyncResult = { state, foldersProcessed, messagesImported, flagsUpdated, backlog };
    await db.finishRun(runId, {
      state,
      folders_processed: foldersProcessed,
      messages_imported: messagesImported,
      flags_updated: flagsUpdated,
      backlog,
      finished_at: now().toISOString(),
    });
    return result;
  } catch {
    const errorCode = classifyError(phase);
    if (runId) await db.finishRun(runId, { state: 'failed', error_code: errorCode, finished_at: now().toISOString() });
    return { state: 'failed', foldersProcessed, messagesImported, flagsUpdated, backlog, errorCode };
  } finally {
    if (imap && !loggedOut) imap.close();
    await db.releaseLock(mailboxId, owner);
  }
}
