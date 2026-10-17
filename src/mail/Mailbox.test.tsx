import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('carrega conversas seguintes pelo cursor sem apagar as já exibidas', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `thread-${index}`, subject: `Mensagem ${index}`, participants: [{ address: `cliente${index}@exemplo.com`, name: `Cliente ${index}` }],
      preview: 'Mensagem de teste', last_message_at: new Date(Date.UTC(2026, 9, 17, 12, 0, 50 - index)).toISOString(),
      unread: false, starred: false, has_attachments: false, message_count: 1, deal_links: [],
    }));
    const nextPage = [{
      id: 'thread-older', subject: 'Mensagem mais antiga', participants: [{ address: 'antigo@exemplo.com', name: 'Cliente antigo' }],
      preview: 'Página seguinte', last_message_at: '2026-10-16T12:00:00.000Z', unread: false, starred: false,
      has_attachments: false, message_count: 1, deal_links: [],
    }];
    vi.mocked(api.listThreads).mockImplementation(async (_folder, _query, _filter, cursor) => cursor ? nextPage : firstPage);

    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    expect(await screen.findByText('Mensagem 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /carregar mais conversas/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /carregar mais conversas/i }));

    expect(await screen.findByText('Mensagem mais antiga')).toBeInTheDocument();
    expect(screen.getByText('Mensagem 0')).toBeInTheDocument();
    expect(api.listThreads).toHaveBeenCalledWith('inbox', '', 'all', {
      beforeAt: firstPage[firstPage.length - 1].last_message_at, beforeId: 'thread-49',
    });
  });

  it('carrega automaticamente a próxima página ao rolar até o fim', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `scroll-${index}`, subject: `Conversa ${index}`, participants: [{ address: `scroll${index}@exemplo.com`, name: `Contato ${index}` }],
      preview: 'Mensagem', last_message_at: new Date(Date.UTC(2026, 9, 17, 12, 0, 50 - index)).toISOString(),
      unread: false, starred: false, has_attachments: false, message_count: 1, deal_links: [],
    }));
    const older = [{
      id: 'scroll-older', subject: 'Conversa anterior', participants: [{ address: 'anterior@exemplo.com', name: 'Contato anterior' }],
      preview: 'Mais antiga', last_message_at: '2026-10-16T12:00:00.000Z', unread: false, starred: false,
      has_attachments: false, message_count: 1, deal_links: [],
    }];
    vi.mocked(api.listThreads).mockImplementation(async (_folder, _query, _filter, cursor) => cursor ? older : firstPage);

    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    expect(await screen.findByText('Conversa 0')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Conversas' });
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 2400 },
      scrollTop: { configurable: true, value: 2200 },
      clientHeight: { configurable: true, value: 200 },
    });
    fireEvent.scroll(list);

    expect(await screen.findByText('Conversa anterior')).toBeInTheDocument();
    expect(api.listThreads).toHaveBeenCalledWith('inbox', '', 'all', {
      beforeAt: firstPage[firstPage.length - 1].last_message_at, beforeId: 'scroll-49',
    });
  });

  it('executa sincronização manual e atualiza a lista', async () => {
    vi.mocked(api.invokeMailAction).mockResolvedValue({ state: 'success' });
    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    await screen.findByText('Proposta ORYNEO');
    await userEvent.click(screen.getByRole('button', { name: /sincronizar agora/i }));
    await waitFor(() => expect(api.invokeMailAction).toHaveBeenCalledWith('sync-now', {}));
  });
});
