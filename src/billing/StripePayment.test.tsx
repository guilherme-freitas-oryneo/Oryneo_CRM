import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentPage, StripePayment, type PublicBillingOrder } from './PaymentPage';
import { paymentAsset } from './checkout/payment-assets';

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  invoke: vi.fn(),
  cardDetailsOn: vi.fn(),
  cardDetailsOff: vi.fn(),
}));

vi.mock('../data', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@stripe/stripe-js',()=>({loadStripe:vi.fn(()=>Promise.resolve({}))}));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckoutElements: () => mocks.checkout(),
  // The real Stripe Element signals onReady asynchronously, after rendering.
  PaymentElement: ({onReady}: {onReady?:(element:unknown)=>void}) => <div>Campos Stripe{onReady&&<button type="button" onClick={()=>onReady({on:mocks.cardDetailsOn,off:mocks.cardDetailsOff})}>Simular Stripe pronta</button>}</div>,
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
  await user.click(screen.getByRole('button', { name: /Pagar R\$\s*1\.739,80 agora/ }));
}

describe('StripePayment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/pagar/?token=token-de-teste');
    mocks.invoke.mockResolvedValue({data:{ok:true},error:null});
  });

  it('abre o Pix após o aceite anterior, sem segundo clique nem novo checkbox',async()=>{
    const confirm=vi.fn().mockResolvedValue({type:'success'});
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValue({data:{order:{status:'awaiting_payment'}},error:null});
    render(<StripePayment order={{...order,payment_method:'pix'}} onChoosePaymentMethod={vi.fn()}/>);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Conectando à Stripe para gerar seu Pix/)).toBeInTheDocument();
    const user=userEvent.setup();
    fireEvent.click(screen.getByRole('button',{name:'Simular Stripe pronta',hidden:true}));
    await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pagar.*Pix/})).not.toBeInTheDocument();
    expect(screen.getByText('Campos Stripe').closest('.pay-pix-stripe-host')).toHaveClass('is-ready');
    expect(await screen.findByText(/Escaneie o QR Code ou copie o Pix abaixo/)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('não revela o placeholder Stripe antes de receber confirmação do Pix',async()=>{
    const confirm=vi.fn().mockResolvedValueOnce({type:'error',error:{type:'validation_error',code:'payment_method_unavailable',message:'Não foi possível criar o Pix.'}});
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValue({data:{ok:true},error:null});
    render(<StripePayment order={{...order,payment_method:'pix'}} onChoosePaymentMethod={vi.fn()}/>);
    expect(screen.getByText('Campos Stripe').closest('.pay-pix-stripe-host')).toHaveClass('is-preparing');
    expect(screen.queryByText(/Escaneie o QR Code ou copie o Pix abaixo/)).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    const user=userEvent.setup();
    fireEvent.click(screen.getByRole('button',{name:'Simular Stripe pronta',hidden:true}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não conseguimos gerar este Pix. Nenhuma cobrança foi realizada. Tente novamente ou escolha outra forma de pagamento.');
    expect(screen.getByText('Campos Stripe').closest('.pay-pix-stripe-host')).toHaveClass('is-preparing');
    expect(screen.getByRole('button',{name:'Tentar gerar Pix novamente'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Escolher outra forma de pagamento'})).toBeEnabled();
    expect(screen.queryByText(/Escaneie o QR Code ou copie o Pix abaixo/)).not.toBeInTheDocument();
  });

  it('o Pix é confirmado uma vez mesmo que a Stripe dispare onReady repetidamente',async()=>{
    const confirm=vi.fn().mockResolvedValue({type:'success'});
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValueOnce({data:{ok:true},error:null}).mockResolvedValue({data:{order:{status:'awaiting_payment'}},error:null});
    render(<StripePayment order={{...order,payment_method:'pix'}}/>);
    const user=userEvent.setup();
    const ready=screen.getByRole('button',{name:'Simular Stripe pronta',hidden:true});
    fireEvent.click(ready);
    fireEvent.click(ready);
    await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('não chama a Stripe se o aceite não puder ser registrado', async () => {
    const confirm=vi.fn();
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    mocks.invoke.mockResolvedValueOnce({data:null,error:{message:'indisponível'}});
    render(<StripePayment order={order}/>);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível registrar o aceite anterior');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('mostra uma exceção retornada pela Stripe e permite tentar novamente', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('Não foi possível processar o cartão.'));
    mocks.checkout.mockReturnValue({ type: 'success', checkout: { canConfirm: true, confirm } });
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível processar o cartão.');
    await waitFor(() => expect(screen.getByRole('button', {name:/Pagar R\$\s*1\.739,80 agora/})).toBeEnabled());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('mostra uma falha conhecida da Stripe sem prender o botão em Processando', async () => {
    const confirm = vi.fn().mockResolvedValueOnce({ type:'error', error:{message:'Cartão recusado.'} });
    mocks.checkout.mockReturnValue({ type:'success', checkout:{canConfirm:true,confirm} });
    render(<StripePayment order={order} />);
    await consentAndPay();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir com este cartão. Confira os dados ou escolha outra forma de pagamento.');
    await waitFor(() => expect(screen.getByRole('button', {name:/Pagar R\$\s*1\.739,80 agora/})).toBeEnabled());
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir com este cartão. Confira os dados ou escolha outra forma de pagamento.');
  });

  it('identifica Visa pela Stripe e bloqueia bandeira fora de Visa ou Mastercard antes da confirmação', async () => {
    const confirm = vi.fn();
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm}});
    const {container}=render(<StripePayment order={{...order,payment_method:'card',card_funding:'credit'}}/>);
    const user = userEvent.setup();
    const preview=screen.getByRole('button',{name:'Ver verso do cartão'});
    const entry=container.querySelector('.pay-card-entry');
    expect(entry).toContainElement(preview);
    expect(entry).toContainElement(screen.getByText('Campos Stripe'));
    expect(preview).toHaveAttribute('aria-pressed','false');
    await user.click(preview);
    expect(screen.getByRole('button',{name:'Ver frente do cartão'})).toHaveAttribute('aria-pressed','true');
    expect(container.querySelector('.pay-card-detected')).toBeNull();
    expect(screen.queryByRole('note',{name:'Bandeiras de cartão'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Simular Stripe pronta'}));
    const cardDetailsHandler = mocks.cardDetailsOn.mock.calls.find(([event]) => event === 'carddetailschange')?.[1];
    expect(cardDetailsHandler).toEqual(expect.any(Function));

    cardDetailsHandler({details:{brands:['visa'],funding:'credit'}});
    await waitFor(()=>expect(container.querySelector('.pay-visual-card')).toHaveClass('is-recognized'));
    expect(screen.queryByText(/Visa reconhecida/)).not.toBeInTheDocument();
    expect(container.querySelector('.pay-visual-card-front img')).toHaveAttribute('src',paymentAsset.visa);

    cardDetailsHandler({details:{brands:['mastercard'],funding:'credit'}});
    await waitFor(()=>expect(container.querySelector('.pay-visual-card-front img')).toHaveAttribute('src',paymentAsset.mastercard));
    expect(screen.queryByText(/Mastercard reconhecida/)).not.toBeInTheDocument();

    cardDetailsHandler({details:{brands:null,funding:null}});
    await waitFor(()=>expect(container.querySelector('.pay-visual-card-front img')).toBeNull());
    expect(screen.queryByText(/Digite o cartão para a Stripe validar/)).not.toBeInTheDocument();
    expect(container.querySelector('.pay-visual-card')).not.toHaveClass('is-recognized');

    cardDetailsHandler({details:{brands:['amex'],funding:'credit'}});
    const alert=await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bandeira não aceita. Use Visa ou Mastercard.');
    expect(screen.getByText('Campos Stripe').compareDocumentPosition(alert)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.pay-visual-card')).toHaveClass('has-error');
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button',{name:/Pagar R\$\s*1\.739,80 agora/})).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('remove o ouvinte de bandeira ao desmontar o formulário',()=>{
    mocks.checkout.mockReturnValue({type:'success',checkout:{canConfirm:true,confirm:vi.fn()}});
    const {unmount}=render(<StripePayment order={{...order,payment_method:'card',card_funding:'credit'}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Simular Stripe pronta'}));
    const handler=mocks.cardDetailsOn.mock.calls.find(([event])=>event==='carddetailschange')?.[1];
    expect(handler).toEqual(expect.any(Function));
    unmount();
    expect(mocks.cardDetailsOff).toHaveBeenCalledWith('carddetailschange',handler);
  });
});

describe('seleção de crédito/débito no Checkout',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();window.history.replaceState({},'', '/pagar/?token=token-de-teste');
 });
 it('persiste a escolha do comprador no servidor antes de carregar o formulário de pagamento',async()=>{
  const user=userEvent.setup();
  mocks.checkout.mockReturnValue({type:'success',checkout:{confirm:vi.fn()}});
  mocks.invoke.mockResolvedValueOnce({data:{order:{...order,payment_method:'card',card_funding:null}},error:null})
   .mockResolvedValueOnce({data:{ok:true,recorded:true},error:null})
   .mockResolvedValueOnce({data:{ok:true,client_secret:'cs_test_secret',publishable_key:'pk_test_key'},error:null});
  render(<PaymentPage/>);
  await user.click(await screen.findByRole('radio',{name:'Cartão'}));
  await user.click(screen.getByRole('radio',{name:'Cartão de débito'}));
  await user.click(screen.getByRole('checkbox',{name:/Li e aceito as condições comerciais/}));
  await user.click(screen.getByRole('button',{name:'Continuar com esta opção'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenLastCalledWith('billing-public',{body:{action:'set_checkout_method',token:'token-de-teste',payment_method:'card',card_funding:'debit'}}));
  expect((await screen.findAllByText('Cartão de débito')).length).toBeGreaterThanOrEqual(1);
  expect(await screen.findByText('Campos Stripe')).toBeInTheDocument();
 });
 it('permite escolher faturas Boleto recorrentes sem criar assinatura de cartão',async()=>{
  const user=userEvent.setup();mocks.checkout.mockReturnValue({type:'success',checkout:{confirm:vi.fn()}});
  mocks.invoke.mockResolvedValueOnce({data:{order:{...order,card_funding:null}},error:null})
   .mockResolvedValueOnce({data:{ok:true,recorded:true},error:null})
   .mockResolvedValueOnce({data:{ok:true,invoice_url:'https://invoice.stripe.com/test_invoice'},error:null});
  render(<PaymentPage/>);
  await user.click(await screen.findByRole('radio',{name:/Boleto bancário/}));
  await user.click(screen.getByRole('checkbox',{name:/Li e aceito as condições comerciais/}));
  await user.click(screen.getByRole('button',{name:'Continuar com esta opção'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenLastCalledWith('billing-public',{body:{action:'set_checkout_method',token:'token-de-teste',payment_method:'boleto',card_funding:undefined}}));
  expect((await screen.findAllByText(/Boleto bancário/)).length).toBeGreaterThanOrEqual(1);
  expect(await screen.findByRole('button',{name:/Abrir boleto seguro/})).toBeInTheDocument();
  expect(screen.queryByText('Campos Stripe')).not.toBeInTheDocument();
 });
});
