import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mailbox } from './Mailbox';
import * as api from './api';

vi.mock('./api', () => ({
  listFolders: vi.fn(), listThreads: vi.fn(), getThread: vi.fn(), getStatus: vi.fn(), invokeMailAction: vi.fn(), subscribeMail: vi.fn(() => () => {}),
}));

describe('Mailbox', () => {
  beforeEach(() => {
    vi.mocked(api.listFolders).mockResolvedValue([{ id: 'inbox', mailbox_id: 'mailbox', name: 'Caixa de entrada', remote_name: 'INBOX', special_use: 'inbox', total_count: 1, unread_count: 1 }]);
    vi.mocked(api.listThreads).mockResolvedValue([{ id: 'thread', subject: 'Proposta ORYNEO', participants: [{ address: 'cliente@exemplo.com', name: 'Cliente' }], preview: 'Quero avançar', last_message_at: '2026-10-12T15:00:00Z', unread: true, starred: false, has_attachments: false, message_count: 1, deal_links: [] }]);
    vi.mocked(api.getStatus).mockResolvedValue({ state: 'idle', backlog: 0, mailbox_id: 'mailbox', address: 'contato@oryneo.com.br' });
    vi.mocked(api.getThread).mockResolvedValue({
      thread: { id: 'thread', subject: 'Proposta ORYNEO' },
      messages: [{ id: 'message', thread_id: 'thread', internet_message_id: '<m@x>', references: [], subject: 'Proposta ORYNEO', from: { address: 'cliente@exemplo.com', name: 'Cliente' }, to: [{ address: 'contato@oryneo.com.br' }], cc: [], bcc: [], sent_at: '2026-10-12T15:00:00Z', received_at: '2026-10-12T15:00:00Z', body_text: 'Quero avançar com o projeto.', direction: 'inbound', unread: true, starred: false, attachments: [], locations: [] }],
    });
  });

  it('carrega pastas, lista e abre a conversa', async () => {
    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    expect(await screen.findByText('Proposta ORYNEO')).toBeInTheDocument();
    expect(screen.getAllByText('Caixa de entrada')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /abrir conversa proposta oryneo/i }));
    expect(await screen.findByText('Quero avançar com o projeto.')).toBeInTheDocument();
    await waitFor(() => expect(api.getThread).toHaveBeenCalledWith('thread'));
  });

  it('executa sincronização manual e atualiza a lista', async () => {
    vi.mocked(api.invokeMailAction).mockResolvedValue({ state: 'success' });
    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    await screen.findByText('Proposta ORYNEO');
    await userEvent.click(screen.getByRole('button', { name: /sincronizar agora/i }));
    await waitFor(() => expect(api.invokeMailAction).toHaveBeenCalledWith('sync-now', {}));
  });
});
