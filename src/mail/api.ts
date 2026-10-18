import { addressInput, parseAddresses } from './compose';
import { supabase } from '../data';
import type { MailFolder, MailMessage, MailSyncStatus, MailThreadDetail, MailThreadSummary } from './types';

export async function listFolders(): Promise<MailFolder[]> {
  const { data, error } = await supabase.from('crm_mail_folders').select('id,mailbox_id,name,remote_name,special_use,total_count,unread_count').order('special_use').order('name');
  if (error) throw error;
  return data as MailFolder[];
}

export const MAIL_THREADS_PAGE_SIZE = 50;
export type MailThreadCursor = { beforeAt: string; beforeId: string };

export async function listThreads(folderId: string | null, query = '', filter = 'all', cursor?: MailThreadCursor): Promise<MailThreadSummary[]> {
  const { data, error } = await supabase.rpc('crm_mail_list_threads', {
    p_folder: folderId, p_query: query, p_filter: filter,
    p_before_at: cursor?.beforeAt ?? null, p_before_id: cursor?.beforeId ?? null,
    p_limit: MAIL_THREADS_PAGE_SIZE,
  });
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

export type DraftSummary = {id:string;subject:string;updated_at:string;revision:number;mailbox_id:string;state:'active'|'sending'};
export async function listDrafts(mailboxId:string,offset=0) { return invokeMailAction<DraftSummary[]>('list-drafts',{mailboxId,offset}); }
export async function getDraft(draftId:string):Promise<import('./Composer').DraftSnapshot> {
  const raw=await invokeMailAction<{id:string;revision:number;recipients_to:MailMessage['to'];recipients_cc:MailMessage['cc'];recipients_bcc:MailMessage['bcc'];subject:string;body_text:string;attachment_manifest:import('./compose').AttachmentPayload[];reply_to_message_id?:string;compose_meta?:{inReplyTo?:string;references?:string[];locked?:boolean}}>('get-draft',{draftId});
  return {id:raw.id,revision:raw.revision,to:addressInput(raw.recipients_to),cc:addressInput(raw.recipients_cc),bcc:addressInput(raw.recipients_bcc),subject:raw.subject,text:raw.body_text,attachments:raw.attachment_manifest,replyToMessageId:raw.reply_to_message_id,...raw.compose_meta};
}
export async function saveDraft(mailboxId:string,draft:import('./Composer').DraftSnapshot){
  return invokeMailAction<{revision:number}>('save-draft',{mailboxId,draftId:draft.id,revision:draft.revision,to:parseAddresses(draft.to,false),cc:parseAddresses(draft.cc,false),bcc:parseAddresses(draft.bcc,false),subject:draft.subject,text:draft.text,attachmentManifest:draft.attachments,replyToMessageId:draft.replyToMessageId,composeMeta:{inReplyTo:draft.inReplyTo,references:draft.references,locked:!!draft.locked}});
}
export async function getQuota(mailboxId:string) {return invokeMailAction<{quota:{usedBytes:number;limitBytes:number}|null;checkedAt:string}>('quota',{mailboxId});}
