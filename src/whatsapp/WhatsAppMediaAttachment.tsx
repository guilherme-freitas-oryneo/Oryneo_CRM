import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from './api';
import { loadWhatsAppMedia } from './api';

/** A mídia é privada: só busca após interação explícita do operador autenticado. */
export function WhatsAppMediaAttachment({ message }: { message: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const requested = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const open = useCallback(async () => {
    if (requested.current || url) return;
    requested.current = true;
    setLoading(true); setError('');
    try {
      const blob = await loadWhatsAppMedia(message.id);
      setUrl(URL.createObjectURL(blob));
    } catch (reason) {
      requested.current = false;
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o arquivo.');
    } finally { setLoading(false); }
  }, [message.id, url]);

  useEffect(() => {
    if (!message.media_id || (message.kind !== 'image' && message.kind !== 'video')) return;
    if (typeof IntersectionObserver === 'undefined' || !container.current) { void open(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { void open(); observer.disconnect(); }
    }, { rootMargin: '180px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [message.kind, message.media_id, open]);

  if (!message.media_id || !['audio', 'image', 'video', 'document'].includes(message.kind)) return null;
  const formattedDuration = duration == null ? null : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;

  return <div className="wa-media" ref={container}>
    {!url ? <button type="button" className="wa-media-load" disabled={loading} onClick={() => void open()}>
      {loading ? 'Carregando arquivo…' : message.kind === 'audio' ? 'Ouvir áudio' : message.kind === 'image' ? 'Visualizar imagem' : message.kind === 'video' ? 'Reproduzir vídeo' : 'Baixar documento'}
    </button> : message.kind === 'audio'
      ? <audio controls preload="none" src={url} aria-label="Áudio da conversa"/>
      : message.kind === 'image'
        ? <img loading="lazy" src={url} alt="Imagem recebida na conversa"/>
        : message.kind === 'video'
          ? <div className="wa-video-wrap"><video controls playsInline preload="metadata" src={url} aria-label="Vídeo da conversa" onLoadedMetadata={event => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds >= 0) setDuration(seconds);
          }}/>{formattedDuration && <span className="wa-media-duration" aria-label="Duração do vídeo">{formattedDuration}</span>}</div>
          : <a className="wa-media-load" href={url} download={'documento-oryneo-' + message.id.slice(0, 8) + '.pdf'}>Salvar PDF</a>}
    {error && <p className="wa-media-error" role="alert">{error}</p>}
  </div>;
}
