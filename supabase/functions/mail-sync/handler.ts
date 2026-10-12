import type { SyncResult } from '../_shared/mail/sync.ts';

export type MailSyncHandlerDependencies = {
  verifyToken(token: string): Promise<boolean>;
  listActiveMailboxIds(): Promise<string[]>;
  sync(mailboxId: string): Promise<SyncResult>;
};

const json = (body: unknown, status: number): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function createMailSyncHandler(dependencies: MailSyncHandlerDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    const token = request.headers.get('x-oryneo-cron') ?? '';
    if (!token || !await dependencies.verifyToken(token)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    try {
      const mailboxIds = await dependencies.listActiveMailboxIds();
      const results = [];
      for (const mailboxId of mailboxIds) {
        results.push({ mailboxId, ...await dependencies.sync(mailboxId) });
      }
      return json({ ok: true, results }, 200);
    } catch {
      return json({ ok: false, error: 'MAIL_SYNC_INTERNAL' }, 500);
    }
  };
}
