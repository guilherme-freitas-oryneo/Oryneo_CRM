import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { Mailbox } from './mail/Mailbox';
import { getBoard } from './data';

const realtime=vi.hoisted(()=>({handler:null as null|(()=>void)}));

vi.mock('./mail/Mailbox', () => ({ Mailbox: vi.fn(() => <div>Caixa ORYNEO</div>) }));
vi.mock('./data', () => ({
  supabase: { auth: {
    getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-1', email: 'gestor@oryneo.com.br' } } } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signOut: vi.fn(() => Promise.resolve({ error: null })),
  },channel:vi.fn(()=>{const channel={on:vi.fn((_type:string,_filter:unknown,handler:()=>void)=>{realtime.handler=handler;return channel}),subscribe:vi.fn(()=>channel)};return channel}),removeChannel:vi.fn() },
  getBoard: vi.fn(() => Promise.resolve([])), mutate: vi.fn(), undo: vi.fn(), errorText: (error: unknown) => String(error),
  money: () => 'R$ 0,00', matches: () => true,
}));

describe('navegação da caixa ORYNEO', () => {
  beforeEach(() => {vi.mocked(Mailbox).mockClear();vi.mocked(getBoard).mockClear();realtime.handler=null});

  it('mantém Pipeline, E-mail e Atividades na ordem e carrega a caixa somente ao selecionar', async () => {
    render(<App/>);
    const navigation = await screen.findByRole('complementary');
    const buttons = within(navigation).getAllByRole('button').filter(button => ['Pipeline', 'E-mail', 'Atividades'].includes(button.getAttribute('aria-label') ?? ''));
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Pipeline', 'E-mail', 'Atividades']);
    expect(screen.getByRole('button', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
    expect(Mailbox).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'E-mail' }));
    expect(await screen.findByText('Caixa ORYNEO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-mail' })).toHaveAttribute('aria-current', 'page');
    expect(Mailbox).toHaveBeenCalledOnce();
  });

  it('recarrega o pipeline quando o banco publica uma alteração de oportunidade',async()=>{
    render(<App/>);
    await screen.findByRole('complementary');
    expect(getBoard).toHaveBeenCalledTimes(1);
    await act(async()=>{realtime.handler?.()});
    await waitFor(()=>expect(getBoard).toHaveBeenCalledTimes(2));
  });
});
