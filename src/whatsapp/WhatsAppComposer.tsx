import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Mic, Paperclip, Send, Square, Trash2, X } from 'lucide-react';

export type WhatsAppDraft =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; file: File }
  | { kind: 'attachment'; file: File; caption: string };

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_MS = 2 * 60 * 1000;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'application/pdf', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'video/mp4']);

export type WhatsAppQuickReply = { label: string; text: string };

export function WhatsAppComposer({ enabled, disabledReason, replyPreview, quickReplies = [], onCancelReply, onSuggest, onSend }: { enabled: boolean; disabledReason: string; replyPreview?: string; quickReplies?: WhatsAppQuickReply[]; onCancelReply?: () => void; onSuggest?: () => Promise<string>; onSend?: (draft: WhatsAppDraft) => Promise<void> }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioUrl = useAudioUrl(audio);
  const canCompose = enabled && !!onSend;

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); if (timerRef.current) clearTimeout(timerRef.current); }; }, []);
  const stopRecording = () => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null; if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };
  const startRecording = async () => {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Gravação indisponível neste navegador.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const mimeType = ['audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Este navegador grava apenas em formatos de áudio que a Meta não aceita. Anexe um áudio OGG/Opus ou M4A.');
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => setError('A gravação falhou. Tente novamente.');
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        if (!mountedRef.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!blob.size) return;
        if (blob.size > MAX_ATTACHMENT_BYTES) { setError('O áudio excede 16 MB.'); return; }
        const extension = blob.type.includes('mp4') ? 'm4a' : 'ogg';
        setAudio(new File([blob], 'audio-' + Date.now() + '.' + extension, { type: blob.type }));
      };
      recorder.start(1000);
      setRecording(true);
      timerRef.current = setTimeout(stopRecording, MAX_AUDIO_MS);
    } catch (reason) { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; if (mountedRef.current) setError(reason instanceof Error ? reason.message : 'Não foi possível acessar o microfone.'); }
  };
  const chooseFile = (chosen?: File) => {
    if (!chosen) return;
    setError('');
    if (!allowedTypes.has(chosen.type)) { setError('Formato não aceito. Use imagem, PDF, áudio ou vídeo MP4.'); return; }
    if (chosen.size > (chosen.type.startsWith('image/') ? 5 * 1024 * 1024 : MAX_ATTACHMENT_BYTES)) { setError(chosen.type.startsWith('image/') ? 'Imagem acima de 5 MB.' : 'O arquivo excede 16 MB.'); return; }
    if (chosen.type === 'audio/ogg' && !chosen.name.toLowerCase().endsWith('.ogg')) { setError('Anexe um arquivo .ogg codificado em Opus.'); return; }
    setAudio(null); setFile(chosen);
  };
  const send = async () => {
    if (!canCompose || sending || recording) return;
    const draft: WhatsAppDraft | null = audio ? { kind: 'audio', file: audio } : file ? { kind: 'attachment', file, caption: text.trim() } : text.trim() ? { kind: 'text', text: text.trim() } : null;
    if (!draft) return;
    setSending(true); setError('');
    try { await onSend(draft); setText(''); setFile(null); setAudio(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível enviar. O rascunho foi mantido.'); }
    finally { setSending(false); }
  };
  const suggest = async () => {
    if (!onSuggest || suggesting) return;
    setSuggesting(true); setError('');
    try { setText(await onSuggest()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível gerar a sugestão.'); }
    finally { setSuggesting(false); }
  };
  return <div className="wa-compose">
    <div className="wa-compose-lock" role="status"><span aria-hidden="true">◈</span><span>{canCompose ? 'Envio sujeito à janela de atendimento, consentimento e confirmação do servidor.' : disabledReason}</span></div>
    {error && <div className="wa-compose-error" role="alert">{error}<button type="button" aria-label="Fechar erro" onClick={() => setError('')}><X size={14}/></button></div>}
    {replyPreview && <div className="wa-compose-reply"><span>Respondendo a: {replyPreview}</span><button type="button" aria-label="Cancelar resposta" onClick={onCancelReply}><X size={14}/></button></div>}
    {file && <div className="wa-draft-media"><Paperclip size={15}/><span>{file.name}</span><button type="button" aria-label="Remover anexo" onClick={() => setFile(null)}><X size={16}/></button></div>}
    {audio && <div className="wa-draft-media"><audio controls src={audioUrl ?? undefined} aria-label="Prévia do áudio"/><button type="button" aria-label="Descartar áudio" onClick={() => setAudio(null)}><Trash2 size={16}/></button></div>}
    <div className="wa-compose-row"><input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,application/pdf,audio/ogg,audio/mpeg,audio/mp4,video/mp4" onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }}/><button type="button" className="wa-icon" disabled={!canCompose || sending || recording || !!audio} aria-label="Anexar arquivo" onClick={() => inputRef.current?.click()}><Paperclip size={19}/></button><textarea aria-label="Mensagem" placeholder={canCompose ? 'Escreva uma mensagem' : 'Conecte o canal para escrever uma mensagem'} disabled={!canCompose || sending || recording || !!audio} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1}/><button type="button" className="wa-icon" disabled={!canCompose || sending || !!file || !!audio} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? <Square size={17}/> : <Mic size={19}/>}</button><button type="button" className="wa-send" disabled={!canCompose || sending || recording || !(text.trim() || file || audio)} onClick={() => void send()}><Send size={17}/><span>{sending ? 'Enviando…' : 'Enviar'}</span></button></div>
    <div className="wa-compose-actions"><div className="wa-compose-tools">{quickReplies.length>0&&<label className="wa-quick-replies"><span className="sr-only">Inserir modelo de resposta</span><select aria-label="Inserir modelo de resposta" disabled={!canCompose||sending} value="" onChange={event=>{const selected=quickReplies.find(item=>item.label===event.target.value);if(selected)setText(selected.text)}}><option value="">Modelos de conversa</option>{quickReplies.map(item=><option key={item.label} value={item.label}>{item.label}</option>)}</select><ChevronDown size={14}/></label>}{onSuggest&&<button type="button" className="wa-ai-suggest" disabled={!canCompose||sending||suggesting} onClick={()=>void suggest()}><Bot size={15}/>{suggesting?'Gerando…':'Sugerir com IA'}</button>}</div><span>{recording ? 'Gravando áudio · máximo 2 minutos' : 'Enter envia · Shift+Enter quebra linha'}</span></div>
  </div>;
}

function useAudioUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!file) { setUrl(null); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url;
}
