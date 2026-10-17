import type { UIEvent } from 'react';
import { Paperclip, Star } from 'lucide-react';
import { formatMailDate, participantLabel } from './format';
import type { MailThreadSummary } from './types';

export function ThreadList({ threads, selected, loading, loadingMore, hasMore, onLoadMore, onScroll, onSelect }: { threads: MailThreadSummary[]; selected: string | null; loading: boolean; loadingMore: boolean; hasMore: boolean; onLoadMore(): void; onScroll(event: UIEvent<HTMLDivElement>): void; onSelect(thread: MailThreadSummary): void }) {
  if (loading) return <div className="mail-list-state">Atualizando mensagens…</div>;
  if (!threads.length) return <div className="mail-list-state"><MailIcon/><strong>Nenhuma conversa aqui</strong><span>Novas mensagens aparecerão automaticamente.</span></div>;
  return <div className="mail-thread-list" aria-label="Conversas" role="region" tabIndex={0} onScroll={onScroll}>
    {threads.map(thread => <button key={thread.id} className={`${thread.unread ? 'unread' : ''} ${selected === thread.id ? 'active' : ''}`} onClick={() => onSelect(thread)} aria-label={`Abrir conversa ${thread.subject || 'Sem assunto'}`}>
      <span className="mail-thread-avatar">{participantLabel(thread.participants[0] ?? { address: '?' }).slice(0, 1).toUpperCase()}</span>
      <span className="mail-thread-copy"><span className="mail-thread-line"><strong>{participantLabel(thread.participants[0] ?? { address: '' })}</strong><time>{formatMailDate(thread.last_message_at)}</time></span><span className="mail-thread-subject">{thread.subject || '(sem assunto)'}</span><span className="mail-thread-preview">{thread.preview}</span></span>
      <span className="mail-thread-marks">{thread.has_attachments && <Paperclip size={14}/>} {thread.starred && <Star size={14} fill="currentColor"/>}</span>
    </button>)}
    {hasMore && <button className="mail-load-more" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Carregando…' : 'Carregar mais conversas'}</button>}
  </div>;
}

function MailIcon() { return <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>; }
