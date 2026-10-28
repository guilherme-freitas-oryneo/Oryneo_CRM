import { useEffect, useState } from 'react';
import type { Message } from './api';
import { loadWhatsAppMedia } from './api';

/** A mídia é privada: só busca após interação explícita do operador autenticado. */
export function WhatsAppMediaAttachment({ message }: { message: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!message.media_id || !['audio', 'image', 'video', 'document'].includes(message.kind)) return null;
  const open = async () => {
    if (loading || url) return;
    setLoading(true); setError('');
    try {
      const blob = await loadWhatsAppMedia(message.id);
      setUrl(URL.createObjectURL(blob));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o arquivo.');
    } finally { setLoading(false); }
  };

  return <div className="wa-media">
    {!url ? <button type="button" className="wa-media-load" disabled={loading} onClick={() => void open()}>
      {loading ? 'Carregando arquivo…' : message.kind === 'audio' ? 'Ouvir áudio' : message.kind === 'image' ? 'Visualizar imagem' : message.kind === 'video' ? 'Reproduzir vídeo' : 'Baixar documento'}
    </button> : message.kind === 'audio'
      ? <audio controls preload="none" src={url} aria-label="Áudio da conversa"/>
      : message.kind === 'image'
        ? <img loading="lazy" src={url} alt="Imagem recebida na conversa"/>
        : message.kind === 'video'
          ? <video controls preload="none" src={url} aria-label="Vídeo da conversa"/>
          : <a className="wa-media-load" href={url} download={'documento-oryneo-' + message.id.slice(0, 8) + '.pdf'}>Salvar PDF</a>}
    {error && <p className="wa-media-error" role="alert">{error}</p>}
  </div>;
}
