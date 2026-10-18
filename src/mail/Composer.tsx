import { Loader2, Paperclip, Save, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MailAddress, MailMessage } from './types';
import { addressInput, assertPayloadSize, filePayload, MAX_ATTACHMENTS_BYTES, MAX_FILE_BYTES, parseAddresses, payloadFile, type AttachmentPayload } from './compose';
export type ComposePayload = { mailboxId: string; idempotencyKey: string; draftId?:string; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; subject: string; text: string; html?: string; inReplyTo?: string; references?: string[]; attachments: AttachmentPayload[] };
export type DraftSnapshot = {id:string;revision:number;to:string;cc:string;bcc:string;subject:string;text:string;attachments:AttachmentPayload[];replyToMessageId?:string;inReplyTo?:string;references?:string[];locked?:boolean};
type Props = {mailboxId:string; replyTo?:MailMessage|null; initialDraft?:DraftSnapshot; initialAttachments?:AttachmentPayload[]; initialSubject?:string; onClose():void; onSend(payload:ComposePayload):Promise<void>; onSaveDraft?(draft:DraftSnapshot):Promise<{revision:number}>; onDiscardDraft?(id:string):Promise<void>};
export function Composer({ mailboxId, replyTo, initialDraft, initialAttachments=[], initialSubject, onClose, onSend, onSaveDraft, onDiscardDraft }: Props) {
  const [to,setTo]=useState(initialDraft?.to??(replyTo?addressInput([replyTo.from]):'')),[cc,setCc]=useState(initialDraft?.cc??''),[bcc,setBcc]=useState(initialDraft?.bcc??'');
  const [subject,setSubject]=useState(initialDraft?.subject??initialSubject??(replyTo?(/^re:/i.test(replyTo.subject)?replyTo.subject:`Re: ${replyTo.subject}`):'')),[text,setText]=useState(initialDraft?.text??'');
  const [files,setFiles]=useState<File[]>(()=> (initialDraft?.attachments??initialAttachments).map(payloadFile)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dragging,setDragging]=useState(false),[saveState,setSaveState]=useState(initialDraft?'Salvo':'');
  const [locked,setLocked]=useState(initialDraft?.locked??false);
  const id=useRef(initialDraft?.id??crypto.randomUUID()),revision=useRef(initialDraft?.revision??0),fileInput=useRef<HTMLInputElement>(null),queue=useRef<Promise<unknown>>(Promise.resolve()),sending=useRef(false),lastSaved=useRef('');
  const attachmentCache=useRef(new WeakMap<File,Promise<AttachmentPayload>>());
  const inReplyTo=initialDraft?.inReplyTo??replyTo?.internet_message_id;
  const references=initialDraft?.references??(replyTo?[...replyTo.references,replyTo.internet_message_id].filter(Boolean):undefined);
  const dirty=!!(to||cc||bcc||subject||text||files.length||revision.current);
  const snapshot=async ():Promise<DraftSnapshot>=>({id:id.current,revision:revision.current,to,cc,bcc,subject,text,replyToMessageId:initialDraft?.replyToMessageId??replyTo?.id,inReplyTo,references,locked,attachments:await Promise.all(files.map(file=>{if(!attachmentCache.current.has(file))attachmentCache.current.set(file,filePayload(file));return attachmentCache.current.get(file)!;}))});
  const persist=async()=>{
    if(!onSaveDraft||!dirty||locked)return;
    const current=await snapshot();
    const serialized=JSON.stringify({...current,revision:0});
    const operation=queue.current.catch(()=>{}).then(async()=>{
      if(lastSaved.current===serialized)return;
      setSaveState('Salvando…');
      try {assertPayloadSize({action:'save-draft',...current});const saved=await onSaveDraft({...current,revision:revision.current});revision.current=saved.revision;lastSaved.current=serialized;setSaveState('Salvo');}
      catch(reason){setSaveState('Falha ao salvar');throw reason;}
    });queue.current=operation;await operation;
  };
  useEffect(()=>{if(!onSaveDraft||!dirty||busy||locked)return;setSaveState('Alterações pendentes');const timer=setTimeout(()=>{void persist().catch(reason=>setError(reason instanceof Error?reason.message:'Não foi possível salvar o rascunho.'));},1000);return()=>clearTimeout(timer);},[to,cc,bcc,subject,text,files,locked,busy]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty&&saveState!=='Salvo'){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,saveState]);
  const close=async()=>{if(sending.current)return;setBusy(true);try{if(!locked)await persist();onClose();}catch(reason){setError(reason instanceof Error?reason.message:'Salve o rascunho antes de fechar.');}finally{setBusy(false);}};
  const addFiles=(incoming:File[])=>{
    if(busy||locked)return;
    const unique=incoming.filter(f=>!files.some(old=>old.name===f.name&&old.size===f.size&&old.lastModified===f.lastModified));
    const all=[...files,...unique];
    if(all.some(f=>f.size>MAX_FILE_BYTES)||all.reduce((n,f)=>n+f.size,0)>MAX_ATTACHMENTS_BYTES){setError('Limite: 15 MiB por arquivo e 18 MiB no total.');return;}
    setFiles(all);setError('');
  };
  const send=async()=>{
    if(sending.current)return;
    try {
      const recipients=parseAddresses(to);if(!recipients.length)throw new Error('Informe pelo menos um destinatário.');
      const carbon=parseAddresses(cc),blind=parseAddresses(bcc);
      sending.current=true;setBusy(true);setError('');
      const draft=await snapshot();
      const payload:ComposePayload={mailboxId,idempotencyKey:id.current,...(onSaveDraft?{draftId:id.current}:{}),to:recipients,cc:carbon,bcc:blind,subject,text,inReplyTo,references,attachments:draft.attachments};
      assertPayloadSize({action:'send',...payload});
      if(!locked)await persist();
      // Save the immutable attempt before submitting; reopening retries the same message/key.
      if(onSaveDraft&&!locked){const saved=await onSaveDraft({...draft,revision:revision.current,locked:true});revision.current=saved.revision;}
      setLocked(true);await onSend(payload);onClose();
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível enviar.');}
    finally{sending.current=false;setBusy(false);}
  };
  return <section className={`mail-composer ${dragging?'is-dragging':''}`} role="dialog" aria-label="Nova mensagem" onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();setDragging(true);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);addFiles(Array.from(event.dataTransfer.files));}}>
    <header><strong>{replyTo?'Responder':initialDraft?'Rascunho':'Nova mensagem'}</strong><button disabled={busy} onClick={()=>void close()} aria-label="Salvar e fechar composição"><X size={18}/></button></header>
    <div className="mail-compose-address">{([['Para',to,setTo],['Cc',cc,setCc],['Cco',bcc,setBcc]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} value={value} disabled={busy||locked} onChange={event=>set(event.target.value)}/></label>)}</div>
    <label className="mail-compose-subject">Assunto<input aria-label="Assunto" maxLength={998} value={subject} disabled={busy||locked} onChange={event=>setSubject(event.target.value)}/></label>
    <textarea aria-label="Mensagem" value={text} disabled={busy||locked} onChange={event=>setText(event.target.value)} onPaste={event=>{const images=Array.from(event.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(images.length){event.preventDefault();addFiles(images);}}} placeholder="Escreva sua mensagem…" autoFocus/>
    {dragging&&<div className="mail-drop-hint">Solte os arquivos para anexar</div>}
    {!!files.length&&<div className="mail-compose-files">{files.map((file,index)=><span key={index}>{file.name} · {(file.size/1024).toFixed(0)} KiB<button disabled={busy||locked} aria-label={`Remover ${file.name}`} onClick={()=>setFiles(files.filter((_,i)=>i!==index))}><X size={13}/></button></span>)}</div>}
    <small className="mail-compose-meta">15 MiB por arquivo · 18 MiB no total <span role="status">{saveState}</span></small>
    {locked&&<p className="mail-compose-meta">Envio iniciado. Tentar novamente usa a mesma mensagem para evitar duplicação.</p>}
    {error&&<p className="mail-compose-error" role="alert">{error}</p>}
    <footer><input aria-label="Anexar arquivos" ref={fileInput} type="file" multiple hidden onChange={event=>{addFiles(Array.from(event.target.files??[]));event.target.value='';}}/><button className="mail-attach" disabled={busy||locked} onClick={()=>fileInput.current?.click()}><Paperclip size={16}/>Anexar</button>{onSaveDraft&&<button disabled={busy} onClick={()=>void close()} aria-label="Salvar rascunho"><Save size={16}/></button>}{onDiscardDraft&&!locked&&<button disabled={busy} aria-label="Descartar rascunho" onClick={()=>{if(window.confirm('Descartar este rascunho?')){setBusy(true);void queue.current.catch(()=>{}).then(()=>onDiscardDraft(id.current)).then(onClose).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}}}><Trash2 size={16}/></button>}<button className="mail-send" onClick={()=>void send()} disabled={busy}>{busy?<Loader2 className="spinner" size={16}/>:<Send size={16}/>} {locked?'Tentar novamente':'Enviar'}</button></footer>
  </section>;
}
