import {Actions, More, type Action} from '../components';
import { ArrowLeft, Download, ExternalLink, ImageOff, Reply, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMailDate, participantLabel } from './format';
import { sanitizeMailHtml } from './security';
import type { MailMessage, MailThreadDetail } from './types';

export function Conversation({ detail, onBack, onReply, onAttachment, onOpenDeal, actions }: { actions?(message:MailMessage):Action[]; detail: MailThreadDetail; onBack(): void; onReply(message: MailMessage): void; onAttachment(id: string): void; onOpenDeal(id: string): void }) {
  return <section className="mail-conversation">
    <header><button className="mail-icon-button mail-back" onClick={onBack} aria-label="Voltar para conversas"><ArrowLeft size={19}/></button><div><h2>{detail.thread.subject || '(sem assunto)'}</h2><span>{detail.messages.length} {detail.messages.length === 1 ? 'mensagem' : 'mensagens'}</span></div></header>
    <div className="mail-messages">{detail.messages.map(message => <MessageCard actions={actions?.(message)} key={message.id} message={message} onReply={() => onReply(message)} onAttachment={onAttachment}/>)}</div>
    {Array.isArray(detail.thread.deal_links) && <div>{(detail.thread.deal_links as {deal_id:string;deal_title:string}[]).map(link => <button onClick={() => onOpenDeal(link.deal_id)} key={link.deal_id}><ExternalLink size={13}/>{link.deal_title}</button>)}</div>}
  </section>;
}

function MessageCard({ message, onReply, onAttachment, actions=[] }: { actions?:Action[]; message: MailMessage; onReply(): void; onAttachment(id: string): void }) {
  const [remote, setRemote] = useState(false);
  const safeHtml = useMemo(() => sanitizeMailHtml(message.body_html ?? '', remote), [message.body_html, remote]);
  const hasBlocked = !remote && /data-remote-src=/i.test(safeHtml);
  return <Actions items={actions} label={message.subject}><article className="mail-message">
    <header><span className="mail-message-avatar">{participantLabel(message.from).slice(0, 1).toUpperCase()}</span><div><strong>{participantLabel(message.from)}</strong><small>para {message.to.map(participantLabel).join(', ')}</small></div><time>{formatMailDate(message.sent_at || message.received_at)}</time>{message.starred && <Star size={15} fill="currentColor"/>}<More items={actions} label="Ações da mensagem"/></header>
    {hasBlocked && <button className="mail-remote-images" onClick={() => setRemote(true)}><ImageOff size={15}/>Exibir imagens externas deste e-mail</button>}
    <div className="mail-message-body">{message.body_html ? <div dangerouslySetInnerHTML={{ __html: safeHtml }}/> : <div className="mail-plain-text">{message.body_text}</div>}</div>
    {!!message.attachments.length && <div className="mail-attachments">{message.attachments.map(attachment => <button key={attachment.id} onClick={() => onAttachment(attachment.id)}><Download size={15}/><span>{attachment.filename}<small>{formatBytes(attachment.size_bytes)}</small></span></button>)}</div>}
    <footer><button onClick={onReply}><Reply size={15}/>Responder</button></footer>
  </article></Actions>;
}

function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
