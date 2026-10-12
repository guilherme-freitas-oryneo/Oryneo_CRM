import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MailAddress, MailMessage } from './types';

type AttachmentPayload = { filename: string; mimeType: string; contentBase64: string };
export type ComposePayload = { mailboxId: string; idempotencyKey: string; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; subject: string; text: string; html?: string; inReplyTo?: string; references?: string[]; attachments: AttachmentPayload[] };

export function Composer({ mailboxId, replyTo, onClose, onSend }: { mailboxId: string; replyTo?: MailMessage | null; onClose(): void; onSend(payload: ComposePayload): Promise<void> }) {
  const [to, setTo] = useState(replyTo ? participantLabelInput(replyTo.from) : ''), [cc, setCc] = useState(''), [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : ''), [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const send = async () => {
    const recipients = parseAddresses(to);
    if (!recipients.length) { setError('Informe pelo menos um destinatário.'); return; }
    if (files.some(file => file.size > 15 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { setError('Os anexos ultrapassam o limite permitido.'); return; }
    setBusy(true); setError('');
    try {
      await onSend({ mailboxId, idempotencyKey: crypto.randomUUID(), to: recipients, cc: parseAddresses(cc), bcc: parseAddresses(bcc), subject, text, inReplyTo: replyTo?.internet_message_id, references: replyTo ? [...replyTo.references, replyTo.internet_message_id].filter(Boolean) : undefined, attachments: await Promise.all(files.map(filePayload)) });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível enviar.'); }
    finally { setBusy(false); }
  };
  return <section className="mail-composer" role="dialog" aria-label="Nova mensagem">
    <header><strong>{replyTo ? 'Responder' : 'Nova mensagem'}</strong><button onClick={onClose} aria-label="Fechar composição"><X size={18}/></button></header>
    <div className="mail-compose-address"><label>Para<input aria-label="Para" value={to} onChange={event => setTo(event.target.value)} placeholder="nome@empresa.com"/></label><label>Cc<input aria-label="Cc" value={cc} onChange={event => setCc(event.target.value)}/></label><label>Cco<input aria-label="Cco" value={bcc} onChange={event => setBcc(event.target.value)}/></label></div>
    <label className="mail-compose-subject">Assunto<input aria-label="Assunto" value={subject} onChange={event => setSubject(event.target.value)}/></label>
    <textarea aria-label="Mensagem" value={text} onChange={event => setText(event.target.value)} placeholder="Escreva sua mensagem…" autoFocus/>
    {!!files.length && <div className="mail-compose-files">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button aria-label={`Remover ${file.name}`} onClick={() => setFiles(files.filter((_, item) => item !== index))}><X size={13}/></button></span>)}</div>}
    {error && <p className="mail-compose-error" role="alert">{error}</p>}
    <footer><input ref={fileInput} type="file" multiple hidden onChange={event => setFiles([...files, ...Array.from(event.target.files ?? [])])}/><button className="mail-attach" onClick={() => fileInput.current?.click()}><Paperclip size={16}/>Anexar</button><button className="mail-send" onClick={() => void send()} disabled={busy}>{busy ? <Loader2 className="spinner" size={16}/> : <Send size={16}/>}Enviar</button></footer>
  </section>;
}

function participantLabelInput(address: MailAddress) { return address.name ? `${address.name} <${address.address}>` : address.address; }
function parseAddresses(value: string): MailAddress[] {
  return value.split(/[;,]/).map(item => item.trim()).filter(Boolean).map(item => {
    const named = item.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
    return named ? { name: named[1].trim().replace(/^"|"$/g, ''), address: named[2].toLowerCase() } : { address: item.toLowerCase() };
  }).filter(item => /^[^\s@<>]+@[^\s@<>]+$/.test(item.address));
}
async function filePayload(file: File): Promise<AttachmentPayload> {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { filename: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: btoa(binary) };
}
