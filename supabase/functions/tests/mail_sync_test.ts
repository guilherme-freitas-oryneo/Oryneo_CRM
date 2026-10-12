import assert from 'node:assert/strict';
import { syncMailbox, type DiscoveredFolder, type MailSyncDatabase, type MailSyncImap, type StoredFolder } from '../_shared/mail/sync.ts';
import type { ImapFetchedFlags, ImapFetchedMessage, ImapListEntry, ImapSelectState } from '../_shared/mail/protocol.ts';
import { prepareIncomingMessage, safeStorageName, threadAnchors } from '../_shared/mail/database.ts';
import { createMailSyncHandler } from '../mail-sync/handler.ts';

const rawMessage = new TextEncoder().encode([
  'Message-ID: <sync-1@exemplo.com>',
  'From: Cliente <cliente@exemplo.com>',
  'To: contato@oryneo.com.br',
  'Subject: Interesse no CRM',
  'Date: Mon, 12 Oct 2026 15:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Quero conhecer o produto.',
].join('\r\n'));

class FakeDatabase implements MailSyncDatabase {
  claimed = true;
  released = false;
  runState: Record<string, unknown> | null = null;
  saved: { folderId: string; uidValidity: number; message: ImapFetchedMessage }[] = [];
  reconciled: { folderId: string; uidValidity: number; flags: ImapFetchedFlags[] }[] = [];
  resets: { folderId: string; uidValidity: number }[] = [];
  updates: { folderId: string; values: Record<string, unknown> }[] = [];
  folder: StoredFolder = {
    id: 'folder-inbox', mailbox_id: 'mailbox-1', remote_name: 'INBOX', name: 'Caixa de entrada',
    special_use: 'inbox', uid_validity: 0, uid_next: 1, last_synced_uid: 0, history_before_uid: null,
  };
  saveResult = true;

  claimLock(): Promise<boolean> { return Promise.resolve(this.claimed); }
  releaseLock(): Promise<void> { this.released = true; return Promise.resolve(); }
  getCredentials() { return Promise.resolve({ address: 'contato@oryneo.com.br', displayName: 'ORYNEO', imapHost: 'imap.hostinger.com', imapPort: 993, smtpHost: 'smtp.hostinger.com', smtpPort: 465, password: 'secret' }); }
  startRun(): Promise<string> { return Promise.resolve('run-1'); }
  finishRun(_runId: string, values: Record<string, unknown>): Promise<void> { this.runState = values; return Promise.resolve(); }
  upsertFolder(_mailboxId: string, _folder: DiscoveredFolder): Promise<StoredFolder> { return Promise.resolve({ ...this.folder }); }
  resetFolder(folderId: string, uidValidity: number): Promise<void> { this.resets.push({ folderId, uidValidity }); this.folder = { ...this.folder, uid_validity: uidValidity, last_synced_uid: 0, history_before_uid: null }; return Promise.resolve(); }
  saveMessage(folderId: string, uidValidity: number, message: ImapFetchedMessage): Promise<boolean> { this.saved.push({ folderId, uidValidity, message }); return Promise.resolve(this.saveResult); }
  reconcileFolder(folderId: string, uidValidity: number, flags: ImapFetchedFlags[]): Promise<number> { this.reconciled.push({ folderId, uidValidity, flags }); return Promise.resolve(1); }
  updateFolder(folderId: string, values: Record<string, unknown>): Promise<void> { this.updates.push({ folderId, values }); return Promise.resolve(); }
}

class FakeImap implements MailSyncImap {
  loggedOut = false;
  loginError: Error | null = null;
  fetchedRanges: [number, number | '*'][] = [];
  listResult: ImapListEntry[] = [{ attributes: ['\\HasNoChildren', '\\Inbox'], delimiter: '/', name: 'INBOX' }];
  selectResult: ImapSelectState = { exists: 1, recent: 0, uidValidity: 9, uidNext: 3, highestModSeq: null };
  messages: ImapFetchedMessage[] = [{ sequence: 1, uid: 2, flags: [], size: rawMessage.length, raw: rawMessage }];
  flags: ImapFetchedFlags[] = [{ sequence: 1, uid: 2, flags: [] }];

  connect(): Promise<void> { return Promise.resolve(); }
  login(): Promise<void> { return this.loginError ? Promise.reject(this.loginError) : Promise.resolve(); }
  list(): Promise<ImapListEntry[]> { return Promise.resolve(this.listResult); }
  select(): Promise<ImapSelectState> { return Promise.resolve(this.selectResult); }
  fetchUids(first: number, last: number | '*'): Promise<ImapFetchedMessage[]> { this.fetchedRanges.push([first, last]); return Promise.resolve(this.messages); }
  fetchFlags(): Promise<ImapFetchedFlags[]> { return Promise.resolve(this.flags); }
  logout(): Promise<void> { this.loggedOut = true; return Promise.resolve(); }
  close(): void { this.loggedOut = true; }
}

const fixedDeps = (db: FakeDatabase, imap: FakeImap) => ({
  db,
  imapFactory: () => imap,
  now: () => new Date('2026-10-12T18:00:00.000Z'),
  newId: () => '00000000-0000-4000-8000-000000000001',
});

Deno.test('syncMailbox importa mensagem recente, reconcilia flags e confirma cursor', async () => {
  const db = new FakeDatabase();
  const imap = new FakeImap();
  const result = await syncMailbox(fixedDeps(db, imap), 'mailbox-1', { batchSize: 25, timeBudgetMs: 120_000, trigger: 'cron' });
  assert.equal(result.state, 'success');
  assert.equal(result.messagesImported, 1);
  assert.deepEqual(imap.fetchedRanges, [[1, 2]]);
  assert.equal(db.saved[0].uidValidity, 9);
  assert.deepEqual(db.reconciled[0].flags, imap.flags);
  assert.equal(db.updates[0].values.last_synced_uid, 2);
  assert.equal(db.runState?.state, 'success');
  assert.equal(db.released, true);
  assert.equal(imap.loggedOut, true);
});

Deno.test('syncMailbox reinicia somente a pasta quando UIDVALIDITY muda', async () => {
  const db = new FakeDatabase();
  db.folder = { ...db.folder, uid_validity: 8, last_synced_uid: 50 };
  const imap = new FakeImap();
  imap.selectResult = { ...imap.selectResult, uidValidity: 9, uidNext: 51, exists: 50 };
  imap.messages = [];
  imap.flags = [];
  await syncMailbox(fixedDeps(db, imap), 'mailbox-1', { batchSize: 25, timeBudgetMs: 120_000, trigger: 'cron' });
  assert.deepEqual(db.resets, [{ folderId: 'folder-inbox', uidValidity: 9 }]);
  assert.deepEqual(imap.fetchedRanges, [[26, 50]]);
});

Deno.test('syncMailbox ignora execução sobreposta sem abrir IMAP', async () => {
  const db = new FakeDatabase();
  db.claimed = false;
  const imap = new FakeImap();
  let created = false;
  const result = await syncMailbox({ ...fixedDeps(db, imap), imapFactory: () => { created = true; return imap; } }, 'mailbox-1');
  assert.equal(result.state, 'skipped');
  assert.equal(created, false);
  assert.equal(db.released, false);
});

Deno.test('syncMailbox sanitiza falha de autenticação e sempre libera o lock', async () => {
  const db = new FakeDatabase();
  const imap = new FakeImap();
  imap.loginError = new Error('Operação IMAP recusada. password=secret');
  const result = await syncMailbox(fixedDeps(db, imap), 'mailbox-1');
  assert.equal(result.state, 'failed');
  assert.equal(result.errorCode, 'MAIL_AUTH');
  assert.deepEqual(db.runState, { state: 'failed', error_code: 'MAIL_AUTH', finished_at: '2026-10-12T18:00:00.000Z' });
  assert.equal(JSON.stringify(db.runState).includes('secret'), false);
  assert.equal(db.released, true);
});

Deno.test('syncMailbox não contabiliza conteúdo já deduplicado', async () => {
  const db = new FakeDatabase();
  db.saveResult = false;
  const result = await syncMailbox(fixedDeps(db, new FakeImap()), 'mailbox-1');
  assert.equal(result.messagesImported, 0);
  assert.equal(result.state, 'success');
});

Deno.test('prepareIncomingMessage gera fingerprint, direção, snippet e participantes normalizados', async () => {
  const prepared = await prepareIncomingMessage({ sequence: 1, uid: 2, flags: [], size: rawMessage.length, raw: rawMessage }, 'contato@oryneo.com.br');
  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(prepared.direction, 'inbound');
  assert.equal(prepared.snippet, 'Quero conhecer o produto.');
  assert.deepEqual(prepared.participantEmails, ['cliente@exemplo.com', 'contato@oryneo.com.br']);
});

Deno.test('threadAnchors prioriza referências e safeStorageName neutraliza caminho', () => {
  assert.deepEqual(threadAnchors({ internetMessageId: '<atual@x>', inReplyTo: '<pai@x>', references: ['<raiz@x>', '<pai@x>'] }), ['<pai@x>', '<raiz@x>', '<atual@x>']);
  assert.equal(safeStorageName('../../proposta final?.pdf'), 'proposta-final-.pdf');
});

Deno.test('mail-sync rejeita segredo ausente antes de consultar caixas', async () => {
  let listed = false;
  const handler = createMailSyncHandler({
    verifyToken: () => Promise.resolve(false),
    listActiveMailboxIds: () => { listed = true; return Promise.resolve(['mailbox-1']); },
    sync: () => Promise.resolve({ state: 'success', foldersProcessed: 0, messagesImported: 0, flagsUpdated: 0, backlog: 0 }),
  });
  const response = await handler(new Request('https://example.test/mail-sync', { method: 'POST' }));
  assert.equal(response.status, 401);
  assert.equal(listed, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

Deno.test('mail-sync valida token e sincroniza somente caixas ativas', async () => {
  const synced: string[] = [];
  const handler = createMailSyncHandler({
    verifyToken: (token) => Promise.resolve(token === 'correto'),
    listActiveMailboxIds: () => Promise.resolve(['mailbox-1', 'mailbox-2']),
    sync: (mailboxId) => {
      synced.push(mailboxId);
      return Promise.resolve({ state: 'success', foldersProcessed: 1, messagesImported: 2, flagsUpdated: 0, backlog: 0 });
    },
  });
  const response = await handler(new Request('https://example.test/mail-sync', {
    method: 'POST',
    headers: { 'x-oryneo-cron': 'correto' },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(synced, ['mailbox-1', 'mailbox-2']);
  assert.deepEqual(await response.json(), {
    ok: true,
    results: [
      { mailboxId: 'mailbox-1', state: 'success', foldersProcessed: 1, messagesImported: 2, flagsUpdated: 0, backlog: 0 },
      { mailboxId: 'mailbox-2', state: 'success', foldersProcessed: 1, messagesImported: 2, flagsUpdated: 0, backlog: 0 },
    ],
  });
});
