import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StripePayment, type PublicBillingOrder } from './PaymentPage';

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('../data', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckoutElements: () => mocks.checkout(),
  PaymentElement: () => <div>Campos Stripe</div>,
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const order: PublicBillingOrder = {
  reference: 'ORY-20261013-TESTE',
  company: 'Empresa de teste',
  customer_name: 'Cliente de teste',
  status: 'awaiting_payment',
  currency: 'brl',
  amount_total: 173980,
  items: [{key:'start',label:'Plano Start',detail:'Assinatura mensal',amount_cents:74990}],
  expires_at: '2026-10-14T20:00:00Z',
  test_mode: true,
};

async function consentAndPay() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));
}

describe('StripePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/pagar/?token=token-de-teste');
    mocks.invoke.mockResolvedValue({data:{ok:true},error:null});
  });

  it('não chama a Stripe se o aceite não puder ser registrado', async () => {
    const confirm=vi.fn();
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValueOnce({data:null,error:{message:'indisponível'}});
    render(<StripePayment order={order}/>);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível registrar seu aceite');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('mostra uma exceção retornada pela Stripe e permite tentar novamente', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('Não foi possível processar o cartão.'));
    mocks.checkout.mockReturnValue({ type: 'success', checkout: { canConfirm: true, confirm } });
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível processar o cartão.');
    await waitFor(() => expect(screen.getByRole('button', {name:'Confirmar pagamento'})).toBeEnabled());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('mostra uma falha conhecida da Stripe sem prender o botão em Processando', async () => {
    const confirm = vi.fn().mockResolvedValueOnce({ type:'error', error:{message:'Cartão recusado.'} });
    mocks.checkout.mockReturnValue({ type:'success', checkout:{canConfirm:true,confirm} });
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cartão recusado.');
    await waitFor(() => expect(screen.getByRole('button', {name:'Confirmar pagamento'})).toBeEnabled());
  });

  it('não anuncia pagamento como confirmado apenas pelo resultado do navegador', async () => {
    const confirm = vi.fn().mockResolvedValueOnce({ type: 'success' });
    mocks.checkout.mockReturnValue({ type:'success', checkout:{canConfirm:true,confirm} });
    mocks.invoke.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValue({ data:{order:{status:'awaiting_payment'}},error:null });
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('heading', {name:'Estamos confirmando seu pagamento.'})).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name:'Pagamento confirmado.'})).not.toBeInTheDocument();
  });

  it('usa a URL de retorno já configurada na Checkout Session', async () => {
    const confirm = vi.fn().mockResolvedValueOnce({ type: 'success' });
    mocks.checkout.mockReturnValue({ type:'success', checkout:{canConfirm:true,confirm} });
    mocks.invoke.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValue({ data:{order:{status:'awaiting_payment'}},error:null });
    render(<StripePayment order={order}/>);

    await consentAndPay();

    expect(confirm).toHaveBeenCalledWith();
  });

  it('só exibe confirmação depois de validação server-side', async () => {
    const confirm = vi.fn().mockResolvedValueOnce({type:'success'});
    mocks.checkout.mockReturnValue({type:'success', checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValue({data:{order:{status:'paid'}},error:null});
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('heading', {name:'Pagamento confirmado.'})).toBeInTheDocument();
  });

  it('não bloqueia o pagamento quando canConfirm está desatualizado', async () => {
    const confirm=vi.fn().mockResolvedValue({type:'error',error:{message:'Confira os dados do cartão.'}});
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:false,confirm}});
    render(<StripePayment order={order}/>);
    await consentAndPay();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('Confira os dados do cartão.');
  });
});
