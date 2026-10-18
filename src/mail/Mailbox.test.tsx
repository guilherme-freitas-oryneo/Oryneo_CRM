import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mailbox } from './Mailbox';
import * as api from './api';

vi.mock('./api', () => ({
  MAIL_THREADS_PAGE_SIZE: 50, listDrafts: vi.fn().mockResolvedValue([]), getDraft: vi.fn(), saveDraft: vi.fn(), getQuota: vi.fn().mockResolvedValue(null),
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

  it('marca todas as mensagens não lidas da conversa como lidas', async () => {
    vi.mocked(api.invokeMailAction).mockResolvedValue({ ok: true });
    vi.mocked(api.getThread).mockResolvedValue({
      thread: { id: 'thread', subject: 'Proposta ORYNEO' },
      messages: [
        { id: 'message-1', thread_id: 'thread', internet_message_id: '<m1@x>', references: [], subject: 'Proposta ORYNEO', from: { address: 'cliente@exemplo.com', name: 'Cliente' }, to: [{ address: 'contato@oryneo.com.br' }], cc: [], bcc: [], sent_at: '2026-10-12T15:00:00Z', received_at: '2026-10-12T15:00:00Z', body_text: 'Primeira mensagem não lida.', direction: 'inbound', unread: true, starred: false, attachments: [], locations: [{ id: 'location-1', folder_id: 'inbox', uid: 1, flags: [] }] },
        { id: 'message-2', thread_id: 'thread', internet_message_id: '<m2@x>', references: [], subject: 'Re: Proposta ORYNEO', from: { address: 'cliente@exemplo.com', name: 'Cliente' }, to: [{ address: 'contato@oryneo.com.br' }], cc: [], bcc: [], sent_at: '2026-10-12T16:00:00Z', received_at: '2026-10-12T16:00:00Z', body_text: 'Segunda mensagem não lida.', direction: 'inbound', unread: true, starred: false, attachments: [], locations: [{ id: 'location-2', folder_id: 'inbox', uid: 2, flags: [] }] },
      ],
    });
    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    await screen.findByText('Proposta ORYNEO');
    await userEvent.click(screen.getByRole('button', { name: /abrir conversa proposta oryneo/i }));

    await waitFor(() => expect(api.invokeMailAction).toHaveBeenCalledTimes(2));
    expect(api.invokeMailAction).toHaveBeenCalledWith('set-flags', { locationId: 'location-1', flag: 'seen', value: true });
    expect(api.invokeMailAction).toHaveBeenCalledWith('set-flags', { locationId: 'location-2', flag: 'seen', value: true });
  });

  it('executa sincronização manual e atualiza a lista', async () => {
    vi.mocked(api.invokeMailAction).mockResolvedValue({ state: 'success' });
    render(<Mailbox deals={[]} onOpenDeal={vi.fn()} />);
    await screen.findByText('Proposta ORYNEO');
    await userEvent.click(screen.getByRole('button', { name: /sincronizar agora/i }));
    await waitFor(() => expect(api.invokeMailAction).toHaveBeenCalledWith('sync-now', {}));
  });
});

it('ignora resposta atrasada de uma conversa que deixou de estar selecionada',async()=>{
  const thread=(id:string)=>({id,subject:id,participants:[],preview:'',last_message_at:'2026-10-17',unread:false,starred:false,has_attachments:false,message_count:0,deal_links:[]});
  vi.mocked(api.listFolders).mockResolvedValue([{id:'inbox',mailbox_id:'box',name:'Entrada',remote_name:'INBOX',special_use:'inbox',total_count:2,unread_count:0}]);
  vi.mocked(api.getStatus).mockResolvedValue({state:'idle',backlog:0,mailbox_id:'box'});
  vi.mocked(api.listThreads).mockResolvedValue([thread('Primeira'),thread('Segunda')]);
  let finish!:(value:Awaited<ReturnType<typeof api.getThread>>)=>void;
  vi.mocked(api.getThread).mockImplementation(id=>id==='Primeira'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({thread:{id,subject:'Segunda aberta'},messages:[]}));
  render(<Mailbox deals={[]} onOpenDeal={vi.fn()}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Abrir conversa Primeira'}));
  await userEvent.click(screen.getByRole('button',{name:'Abrir conversa Segunda'}));
  expect(await screen.findByRole('heading',{name:'Segunda aberta'})).toBeInTheDocument();
  finish({thread:{id:'Primeira',subject:'Primeira atrasada'},messages:[]});
  await waitFor(()=>expect(screen.queryByRole('heading',{name:'Primeira atrasada'})).not.toBeInTheDocument());
});
