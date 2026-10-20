import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { supabase } from './data';

vi.mock('./data', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-1', email: 'gestor@oryneo.com.br' } } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
    functions: { invoke: vi.fn() },
  },
  getBoard: vi.fn(() => Promise.resolve([])),
  mutate: vi.fn(),
  undo: vi.fn(),
  errorText: (error: unknown) => String(error),
  money: () => 'R$ 0,00',
  matches: () => true,
}));

describe('homologação financeira', () => {
  it('envia uma solicitação Boleto exclusivamente para a função TEST', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { environment: 'test', payment_method: 'boleto', invoice_ready: true, reference: 'QA-0001' },
      error: null,
    } as never);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar fatura QA Boleto' }));

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'checkout-intake-noncard-test',
      expect.objectContaining({
        body: expect.objectContaining({
          action: 'create',
          payment_method: 'boleto',
          plan: 'Start',
          cycle: 'monthly',
          addons: [],
          customer_email: 'qa@example.com',
        }),
      }),
    );
  });
});
