import { createClient } from '../_shared/mail/deps.ts';
import { SupabaseMailDatabase } from '../_shared/mail/database.ts';
import { syncMailbox } from '../_shared/mail/sync.ts';
import { ImapClient } from '../_shared/mail/transport.ts';
import { createMailSyncHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Configuração interna indisponível.');

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const database = new SupabaseMailDatabase(client);

const handler = createMailSyncHandler({
  async verifyToken(token) {
    const { data, error } = await client.rpc('crm_mail_verify_cron', { p_token: token });
    return !error && data === true;
  },
  async listActiveMailboxIds() {
    const { data, error } = await client.from('crm_mailboxes').select('id').eq('active', true).order('created_at');
    if (error) throw new Error('DB_MAILBOX_LIST');
    return (data ?? []).map((row) => row.id);
  },
  sync(mailboxId) {
    return syncMailbox({
      db: database,
      imapFactory: (credentials) => new ImapClient({
        host: credentials.imapHost,
        port: credentials.imapPort,
        username: credentials.address,
        password: credentials.password,
      }),
    }, mailboxId, { trigger: 'cron' });
  },
});

Deno.serve(handler);
