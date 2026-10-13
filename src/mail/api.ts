import { supabase } from '../data';
import type { MailFolder, MailMessage, MailSyncStatus, MailThreadDetail, MailThreadSummary } from './types';

export async function listFolders(): Promise<MailFolder[]> {
  const { data, error } = await supabase.from('crm_mail_folders').select('id,mailbox_id,name,remote_name,special_use,total_count,unread_count').order('special_use').order('name');
  if (error) throw error;
  return data as MailFolder[];
}

export async function listThreads(folderId: string | null, query = '', filter = 'all'): Promise<MailThreadSummary[]> {
  const { data, error } = await supabase.rpc('crm_mail_list_threads', { p_folder: folderId, p_query: query, p_filter: filter, p_limit: 50 });
  if (error) throw error;
  return (data ?? []) as MailThreadSummary[];
}

type RawMessage = Record<string, unknown> & {
  sender: MailMessage['from']; recipients_to: MailMessage['to']; recipients_cc: MailMessage['cc']; recipients_bcc: MailMessage['bcc'];
  reference_ids: string[]; locations?: MailMessage['locations']; attachments?: MailMessage['attachments'];
};

export async function getThread(threadId: string): Promise<MailThreadDetail> {
  const { data, error } = await supabase.rpc('crm_mail_get_thread', { p_thread: threadId });
  if (error) throw error;
  if (!data?.thread) throw new Error('Conversa não encontrada.');
  const messages = (data.messages ?? []).map((raw: RawMessage) => {
    const locations = raw.locations ?? [];
    const flags = locations.flatMap((location) => location.flags ?? []);
    return {
      ...raw,
      from: raw.sender,
      to: raw.recipients_to ?? [], cc: raw.recipients_cc ?? [], bcc: raw.recipients_bcc ?? [],
      references: raw.reference_ids ?? [], locations, attachments: raw.attachments ?? [],
      unread: !flags.includes('\\Seen'), starred: flags.includes('\\Flagged'),
    } as unknown as MailMessage;
  });
  return { thread: data.thread, messages };
}

export async function getStatus(): Promise<MailSyncStatus> {
  const { data, error } = await supabase.rpc('crm_mail_get_status');
  if (error) throw error;
  const run = data?.last_run;
  return {
    mailbox_id: data?.mailbox_id, address: data?.address, backlog: Number(data?.backlog ?? 0),
    state: run?.state === 'failed' ? 'error' : run?.state === 'running' ? 'syncing' : Number(data?.backlog ?? 0) > 0 ? 'degraded' : 'idle',
    last_success_at: run?.state === 'success' ? run.finished_at : null,
    last_error_code: run?.error_code ?? null,
  };
}

export async function invokeMailAction<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mail-api', { body: { action, ...payload } });
  if (data?.ok === false) throw new Error(data.error ?? 'Não foi possível concluir a ação.');
  if (error) throw error;
  if (!data?.ok) throw new Error('Não foi possível concluir a ação.');
  return data.data as T;
}

export function subscribeMail(onChange: () => void): () => void {
  const channel = supabase.channel(`crm-mail-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mail_threads' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mail_folders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mail_sync_runs' }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
