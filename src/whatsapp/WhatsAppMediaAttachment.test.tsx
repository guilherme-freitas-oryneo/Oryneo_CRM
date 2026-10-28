import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWhatsAppMedia, type Message } from './api';
import { WhatsAppMediaAttachment } from './WhatsAppMediaAttachment';

vi.mock('./api', () => ({ loadWhatsAppMedia: vi.fn() }));

const message = (kind: 'image' | 'video'): Message => ({
  id: `message-${kind}`,
  provider_message_id: `wamid.${kind}`,
  conversation_id: 'conversation-1',
  direction: 'inbound',
  kind,
  body: '',
  media_id: `media-${kind}`,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  delivery_status: null,
  occurred_at: '2026-10-28T10:22:03Z',
});

describe('WhatsAppMediaAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:whatsapp-media'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('carrega a foto automaticamente na conversa autenticada', async () => {
    vi.mocked(loadWhatsAppMedia).mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
    render(<WhatsAppMediaAttachment message={message('image')}/>);
    expect(await screen.findByRole('img', { name: 'Imagem recebida na conversa' })).toHaveAttribute('src', 'blob:whatsapp-media');
    expect(loadWhatsAppMedia).toHaveBeenCalledWith('message-image');
  });

  it('abre a imagem em um visualizador e permite fechá-la', async () => {
    vi.mocked(loadWhatsAppMedia).mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
    render(<WhatsAppMediaAttachment message={message('image')}/>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir imagem' }));
    expect(screen.getByRole('dialog', { name: 'Visualizar imagem' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar imagem' }));
    expect(screen.queryByRole('dialog', { name: 'Visualizar imagem' })).not.toBeInTheDocument();
  });

  it('carrega o vídeo, solicita metadados e mostra a duração', async () => {
    vi.mocked(loadWhatsAppMedia).mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    render(<WhatsAppMediaAttachment message={message('video')}/>);
    const video = await screen.findByLabelText('Vídeo da conversa');
    expect(video).toHaveAttribute('preload', 'metadata');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12.4 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('Duração do vídeo')).toHaveTextContent('0:12');
  });
});
