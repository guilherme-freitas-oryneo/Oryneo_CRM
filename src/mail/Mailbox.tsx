import { AlertCircle, Edit3, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DealRow } from '../data';
import { getStatus, getThread, invokeMailAction, listFolders, listThreads, subscribeMail } from './api';
import { Composer, type ComposePayload } from './Composer';
import { Conversation } from './Conversation';
import { FolderList } from './FolderList';
import { ThreadList } from './ThreadList';
import type { MailFolder, MailMessage, MailSyncStatus, MailThreadDetail, MailThreadSummary } from './types';
import './mail.css';

export function Mailbox({ deals: _deals, onOpenDeal }: { deals: DealRow[]; onOpenDeal(id: string): void }) {
  const [folders, setFolders] = useState<MailFolder[]>([]), [threads, setThreads] = useState<MailThreadSummary[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null), [threadId, setThreadId] = useState<string | null>(null), [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [status, setStatus] = useState<MailSyncStatus>({ state: 'idle', backlog: 0 }), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true), [conversationLoading, setConversationLoading] = useState(false), [composer, setComposer] = useState<{ reply?: MailMessage } | null>(null), [error, setError] = useState('');
  const activeFolder = useMemo(() => folders.find(folder => folder.id === folderId), [folders, folderId]);
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextFolders, nextStatus] = await Promise.all([listFolders(), getStatus()]);
      const chosen = folderId ?? nextFolders.find(folder => folder.special_use === 'inbox')?.id ?? nextFolders[0]?.id ?? null;
      setFolders(nextFolders); setStatus(nextStatus); if (!folderId) setFolderId(chosen);
      setThreads(await listThreads(chosen, query, filter)); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a caixa de entrada.'); }
    finally { setLoading(false); }
  }, [filter, folderId, query]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), query ? 250 : 0); return () => clearTimeout(timer); }, [refresh, query, filter, folderId]);
  useEffect(() => subscribeMail(() => void refresh(true)), [refresh]);

  const openThread = async (thread: MailThreadSummary) => {
    setThreadId(thread.id); setConversationLoading(true);
    try {
      const next = await getThread(thread.id); setDetail(next);
      const unread = next.messages.flatMap(message => message.locations.map(location => ({ message, location }))).find(item => !item.location.flags.includes('\\Seen') && item.location.id);
      if (unread?.location.id) void invokeMailAction('set-flags', { locationId: unread.location.id, flag: 'seen', value: true }).then(() => refresh(true));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a conversa.'); }
    finally { setConversationLoading(false); }
  };
  const manualSync = async () => {
    setStatus(current => ({ ...current, state: 'syncing' }));
    try { await invokeMailAction('sync-now', {}); await refresh(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'A sincronização falhou.'); setStatus(current => ({ ...current, state: 'error' })); }
  };
  const send = async (payload: ComposePayload) => { await invokeMailAction('send', payload); await refresh(true); };
  const attachment = async (attachmentId: string) => {
    try { const result = await invokeMailAction<{ url: string }>('attachment-url', { attachmentId }); window.open(result.url, '_blank', 'noopener,noreferrer'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o anexo.'); }
  };
  return <div className="mailbox-shell">
    <aside className="mailbox-folders-panel"><button className="mail-compose-button" onClick={() => setComposer({})}><Edit3 size={17}/>Escrever</button><FolderList folders={folders} selected={folderId} onSelect={id => { setFolderId(id); setThreadId(null); setDetail(null); }}/><div className={`mail-sync-state ${status.state}`}><i/><span>{status.state === 'syncing' ? 'Sincronizando…' : status.state === 'error' ? 'Sincronização com atenção' : status.backlog ? `${status.backlog} mensagens na fila` : 'E-mail sincronizado'}</span></div></aside>
    <section className={`mailbox-list-panel ${threadId ? 'mobile-hidden' : ''}`}><header><div><h1>{activeFolder?.name ?? 'E-mail'}</h1><span>{activeFolder?.total_count ?? 0} mensagens</span></div><button className="mail-icon-button" aria-label="Sincronizar agora" onClick={() => void manualSync()} disabled={status.state === 'syncing'}><RefreshCw size={17} className={status.state === 'syncing' ? 'spinner' : ''}/></button></header><div className="mail-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar e-mails" aria-label="Buscar e-mails"/>{query && <button onClick={() => setQuery('')} aria-label="Limpar busca"><X size={14}/></button>}<label><SlidersHorizontal size={14}/><select aria-label="Filtrar e-mails" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option><option value="unread">Não lidos</option><option value="starred">Favoritos</option><option value="attachments">Com anexos</option></select></label></div>{error && <div className="mail-error" role="alert"><AlertCircle size={15}/>{error}<button onClick={() => setError('')}><X size={13}/></button></div>}<ThreadList threads={threads} selected={threadId} loading={loading} onSelect={thread => void openThread(thread)}/></section>
    <main className={`mailbox-reading-panel ${!threadId ? 'mobile-hidden' : ''}`}>{conversationLoading ? <div className="mail-reader-empty"><RefreshCw className="spinner"/>Abrindo conversa…</div> : detail ? <Conversation detail={detail} onBack={() => { setThreadId(null); setDetail(null); }} onReply={message => setComposer({ reply: message })} onAttachment={id => void attachment(id)} onOpenDeal={onOpenDeal}/> : <div className="mail-reader-empty"><span>✦</span><strong>Suas conversas em um só lugar</strong><p>Selecione um e-mail para ler, responder e relacionar ao negócio.</p></div>}</main>
    {composer && status.mailbox_id && <Composer mailboxId={status.mailbox_id} replyTo={composer.reply} onClose={() => setComposer(null)} onSend={send}/>} 
  </div>;
}
