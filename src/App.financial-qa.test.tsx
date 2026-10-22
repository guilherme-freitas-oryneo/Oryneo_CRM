import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { supabase } from './data';
import { pixReconciliationDecision } from '../supabase/functions/_shared/billing/financial-qa-webhook-policy';

const stripeMocks = vi.hoisted(() => ({ confirm: vi.fn(), state: { type: 'success' as string, checkout: { confirm: vi.fn() }, error: { message: 'SDK indisponível' } } }));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => <div aria-label="Payment Element de teste">Payment Element de teste</div>,
  useCheckoutElements: () => stripeMocks.state,
}));

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
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockReset();
    stripeMocks.confirm.mockReset();
    stripeMocks.state = { type: 'success', checkout: { confirm: stripeMocks.confirm }, error: { message: 'SDK indisponível' } };
    window.history.replaceState({}, '', '/');
  });
  it('does not reconcile Pix paid from polling without prior signed webhook state', () => {
    expect(pixReconciliationDecision(true, 'awaiting_payment')).toEqual({ confirmedPaid: false, webhookPending: true });
    expect(pixReconciliationDecision(true, 'paid')).toEqual({ confirmedPaid: true, webhookPending: false });
    expect(pixReconciliationDecision(false, 'awaiting_payment')).toEqual({ confirmedPaid: false, webhookPending: false });
  });
  it('permite criar uma sessão Pix TEST, confirmar e consultar conciliação sem anunciar pagamento pelo navegador', async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce({
        data: { environment: 'test', payment_method: 'pix', order_id: 'qa-pix-1', session_id: 'cs_test_1', client_secret: 'cs_test_secret', publishable_key: 'pk_test_public' },
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: { ok: true, environment: 'test', method: 'pix', state: 'awaiting_payment', confirmed_paid: false }, error: null } as never);
    stripeMocks.confirm.mockResolvedValueOnce({ type: 'success' });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Plano' }), 'Growth');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ciclo' }), 'annual');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Landing page (cobrança única)' }));
    expect(screen.getByText(/14\.158,72/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Pix.*cobrança avulsa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar checkout QA Pix' }));

    expect(await screen.findByLabelText('Payment Element de teste')).toBeInTheDocument();
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'checkout-intake-noncard-test',
      expect.objectContaining({ body: expect.objectContaining({ action: 'create', payment_method: 'pix', plan: 'Growth', cycle: 'annual', addons: ['landing-page'] }) }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar Pix no ambiente TEST' }));
    expect(await screen.findByText(/pagamento permanece pendente até confirmação do Stripe/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar pagamento no Stripe TEST' }));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenLastCalledWith(
      'checkout-intake-noncard-test',
      expect.objectContaining({ body: expect.objectContaining({ action: 'reconcile', order_id: 'qa-pix-1' }) }),
    ));
    expect(screen.getByText(/ainda não confirmado/i)).toBeInTheDocument();
    expect(screen.queryByText(/pagamento confirmado/i)).not.toBeInTheDocument();
  });

  it('mostra o link Stripe TEST da fatura Boleto e a consulta de compensação', async () => {
    vi.mocked(supabase.functions.invoke)
      .mockResolvedValueOnce({
        data: { environment: 'test', payment_method: 'boleto', order_id: 'qa-boleto-1', invoice_ready: true, hosted_invoice_url: 'https://invoice.stripe.com/i/test_fixture' },
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: { ok: true, environment: 'test', method: 'boleto', state: 'awaiting_payment', confirmed_paid: false, reason: 'bank_compensation_webhook_pending' }, error: null } as never);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar assinatura QA Boleto' }));

    const invoice = await screen.findByRole('link', { name: 'Abrir fatura Stripe TEST' });
    expect(invoice).toHaveAttribute('href', 'https://invoice.stripe.com/i/test_fixture');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar pagamento no Stripe TEST' }));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenLastCalledWith(
      'checkout-intake-noncard-test',
      expect.objectContaining({ body: expect.objectContaining({ action: 'reconcile', order_id: 'qa-boleto-1' }) }),
    ));
    expect(screen.getByText(/prova de compensação ainda não chegou/i)).toBeInTheDocument();
  });

  it('retorno Pix restaura o valor persistido sem inventar plano ou ciclo', async () => {
    sessionStorage.setItem('oryneo.qa.last_order', 'qa-pix-return');
    window.history.replaceState({}, '', '/?qa_return=1');
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { environment: 'test', order: { id: 'qa-pix-return', method: 'pix', amount_cents: 1415872 } }, error: null,
    } as never);

    render(<App />);
    expect(await screen.findByText(/Valor persistido no pedido QA:/)).toHaveTextContent('R$ 14.158,72');
    expect(screen.queryByRole('combobox', { name: 'Plano' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Total inicial estimado:/)).not.toBeInTheDocument();
  });

  it('mostra erro do SDK de checkout Pix e oferece recuperação', async () => {
    stripeMocks.state = { type: 'error', checkout: { confirm: stripeMocks.confirm }, error: { message: 'falha controlada do SDK' } };
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { environment: 'test', payment_method: 'pix', order_id: 'qa-pix-sdk', client_secret: 'cs_test_secret', publishable_key: 'pk_test_public' }, error: null,
    } as never);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.click(screen.getByRole('radio', { name: /Pix.*cobrança avulsa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar checkout QA Pix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('falha controlada do SDK');
    expect(screen.getByRole('button', { name: 'Reiniciar a tela de teste' })).toBeInTheDocument();
  });

  it('envia uma solicitação Boleto exclusivamente para a função TEST', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { environment: 'test', payment_method: 'boleto', invoice_ready: true, reference: 'QA-0001' },
      error: null,
    } as never);

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar assinatura QA Boleto' }));

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

  it('não chama o endpoint QA sem uma sessão autenticada', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Entrar no CRM' })).toBeInTheDocument();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('mantém QA isolado em TEST e mostra falha sem sugerir cobrança criada', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') } as never);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'QA financeiro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar assinatura QA Boleto' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível preparar o pagamento de homologação.');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('checkout-intake-noncard-test', expect.any(Object));
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith('checkout-intake', expect.anything());
  });

});
