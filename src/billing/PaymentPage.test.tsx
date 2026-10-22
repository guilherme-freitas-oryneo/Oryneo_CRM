import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoletoPayment, PaymentPage, PaymentPageView, PixPayment, type PublicBillingOrder } from './PaymentPage';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../data', () => ({ supabase: { functions: { invoke } } }));

const order: PublicBillingOrder = {
  reference: 'ORY-00142',
  company: 'Acme Comércio Ltda.',
  customer_name: 'Rafael',
  status: 'awaiting_payment',
  currency: 'brl',
  amount_total: 327980,
  items: [
    { key: 'growth', label: 'Plano Growth', detail: 'Assinatura mensal', amount_cents: 109990 },
    { key: 'setup', label: 'Implantação', detail: 'Cobrança única', amount_cents: 138990 },
    { key: 'landing', label: 'Landing page', detail: 'Cobrança única', amount_cents: 88900 },
  ],
  recurring: { label: 'Plano Growth', amount_cents: 109990, interval_label: 'por mês', next_charge_at: '2026-11-13' },
  expires_at: '2026-10-14T12:00:00Z',
  test_mode: true,
};

describe('Pix apresentado a partir da cobrança já criada na Stripe',()=>{
  const qr={status:'ready' as const,copy_paste:'00020101021226890014br.gov.bcb.pix520400005303986',
    qr_code_url:'https://qr.stripe.com/test_oryneo.png',expires_at:'2030-10-22T15:00:00Z'};
  it('mostra imediatamente QR e Copia e Cola existentes sem segunda confirmação',async()=>{
    invoke.mockResolvedValue({data:{order:{...order,payment_method:'pix'},pix:qr,client_secret:null,publishable_key:null},error:null});
    window.history.replaceState({},'', '/pagar/?token='+'t'.repeat(48));
    render(<PaymentPage/>);
    expect(await screen.findByRole('heading',{name:'Pague com Pix.'})).toBeInTheDocument();
    expect(screen.getByRole('region',{name:'QR Code e Pix Copia e Cola'})).toBeInTheDocument();
    expect(screen.getByAltText('QR Code Pix deste pedido, gerado pela Stripe')).toHaveAttribute('src',qr.qr_code_url);
    expect(screen.getByRole('textbox',{name:'Código Pix Copia e Cola'})).toHaveValue(qr.copy_paste);
    expect(screen.getByRole('button',{name:'Copiar código'})).toBeInTheDocument();
    expect(screen.queryByText(/Um código QR será exibido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pagamento não concluído/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('bloqueia QR e botão de copiar depois da expiração',()=>{
    render(<PixPayment order={{...order,payment_method:'pix'}} pix={{...qr,expires_at:'2025-01-01T00:00:00Z'}}/>);
    expect(screen.getByText('Este Pix expirou.')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Copiar código'})).not.toBeInTheDocument();
    expect(screen.queryByAltText('QR Code Pix deste pedido, gerado pela Stripe')).not.toBeInTheDocument();
  });
  it('em conciliação não expõe outro código de pagamento',()=>{
    render(<PixPayment order={{...order,payment_method:'pix'}} pix={{status:'processing'}}/>);
    expect(screen.getByRole('heading',{name:'Estamos confirmando seu pagamento.'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Copiar código'})).not.toBeInTheDocument();
  });
});

describe('PaymentPageView', () => {
  it('mostra indisponibilidade temporária sem rotular o pagamento como recusado', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Edge Function returned a non-2xx status code') });
    window.history.pushState({}, '', '/pagar/?token=' + 't'.repeat(48));

    render(<PaymentPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Não foi possível verificar agora.' })).toBeInTheDocument());
    expect(screen.getByText(/Nenhum pagamento foi confirmado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.queryByText('Pagamento indisponível.')).not.toBeInTheDocument();
  });

  it('não confunde ausência temporária da sessão Stripe com pagamento recusado', async () => {
    invoke.mockResolvedValue({data:{order:{...order,payment_method:'pix'},client_secret:null,publishable_key:null},error:null});
    window.history.pushState({}, '', '/pagar/?token='+'t'.repeat(48));
    render(<PaymentPage/>);
    expect(await screen.findByRole('heading',{name:'Não foi possível carregar o pagamento agora.'})).toBeInTheDocument();
    expect(screen.getByText(/não significa que seu pagamento foi recusado ou confirmado/i)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Consultar novamente'})).toBeInTheDocument();
    expect(screen.queryByText('Pagamento indisponível.')).not.toBeInTheDocument();
  });

  it('não solicita segundo aceite ou botão de confirmação na tela Pix',()=>{
    render(<PaymentPageView order={{...order,payment_method:'pix'}} paymentSlot={<div>QR Code e Pix Copia e Cola da Stripe</div>} onPay={vi.fn()}/>);
    expect(screen.getByText('QR Code e Pix Copia e Cola da Stripe')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pagar.*Pix/})).not.toBeInTheDocument();
  });

  it('permite selecionar Pix em pedido assistido e envia escolha ao backend',async()=>{
    const user=userEvent.setup();
    invoke.mockImplementation(async (_fn: string, args: {body:{action:string}})=>{
      if(args.body.action==='read')return {data:{order:{...order,payment_method:undefined,card_funding:null},client_secret:null,publishable_key:null},error:null};
      if(args.body.action==='set_checkout_method')return {data:{ok:true,payment_method:'pix',client_secret:null,publishable_key:null},error:null};
      return {data:{ok:true},error:null};
    });
    window.history.pushState({},'', '/pagar/?token='+'t'.repeat(48));
    render(<PaymentPage/>);
    await screen.findByRole('heading',{name:'Como você vai pagar?'});
    await user.click(screen.getByRole('radio',{name:/Pix/}));
    expect(screen.getByText(/Não há renovação automática/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito as condições comerciais/}));
    await user.click(screen.getByRole('button',{name:'Continuar'}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('billing-public',expect.objectContaining({body:expect.objectContaining({action:'set_checkout_method',payment_method:'pix'})})));
  });

  it('mostra o acompanhamento de implantação apenas após pagamento confirmado',()=>{
    const url='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/implantacao/?token=token-seguro';
    const {rerender}=render(<PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined} portalUrl={url}/>);
    expect(screen.queryByRole('link',{name:/Acompanhar implantação/})).not.toBeInTheDocument();
    rerender(<PaymentPageView order={{...order,status:'paid'}} paymentSlot={null} onPay={()=>undefined} portalUrl={url}/>);
    expect(screen.getByRole('link',{name:/Acompanhar implantação/})).toHaveAttribute('href',url);
  });

  it('permite consultar novamente enquanto o webhook confirma o pagamento', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<PaymentPageView order={{ ...order, status: 'processing' }} paymentSlot={null} onPay={() => undefined} onRefresh={onRefresh} />);
    expect(screen.getByRole('heading', { name: 'Estamos confirmando seu pagamento.' })).toBeInTheDocument();
    expect(screen.getByText('Em confirmação')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verificar status' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('expõe total, composição e recorrência antes do pagamento', () => {
    const {container}=render(<PaymentPageView order={order} paymentSlot={<div>Pagamento seguro</div>} onPay={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Finalize sua contratação.' })).toBeInTheDocument();
    expect(screen.getByText('R$ 3.279,80')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.099,90 por mês')).toBeInTheDocument();
    expect(screen.getByText(/Ambiente de homologação/)).toBeInTheDocument();
    expect(screen.getByRole('complementary',{name:'Resumo do pedido'})).toBeInTheDocument();
    expect(container.querySelector('.pay-glow')).toBeNull();
    expect(screen.getByRole('region',{name:'Forma de pagamento: Cartão'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Pagar R\$\s*3\.279,80 agora/})).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', 'https://guilherme-freitas-oryneo.github.io/Oryneo_Landing_Page/privacidade.html');
    expect(screen.getByRole('link', { name: 'Suporte' })).toHaveAttribute('href', 'mailto:contato@oryneo.com.br');
  });

  it('só libera a confirmação após o aceite explícito', async () => {
    const user = userEvent.setup();
    render(<PaymentPageView order={order} paymentSlot={<div>Pagamento seguro</div>} onPay={() => undefined} />);
    const button = screen.getByRole('button', { name: /Pagar R\$\s*3\.279,80 agora/ });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });
  it('informa renovação trimestral separada e verba de mídia quando tráfego é contratado', () => {
    const withTraffic = {...order,
      items:[...order.items,{key:'traffic',label:'Gestão de tráfego pago',detail:'Primeiros 3 meses antecipados',amount_cents:296970}],
      amount_total:order.amount_total+296970,
    };
    render(<PaymentPageView order={withTraffic} paymentSlot={<div>Campos seguros</div>} onPay={() => undefined}/>);
    expect(screen.getByText(/Valor trimestral/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 2.969,70 a cada 3 meses/)).toBeInTheDocument();
    expect(screen.getByText(/Verba de mídia não está incluída; paga separadamente/)).toBeInTheDocument();
  });

  it('boleto exige aceite antes de abrir a fatura e esclarece liquidação assíncrona',async()=>{
    const user=userEvent.setup();
    const onPay=vi.fn();
    render(<PaymentPageView order={{...order,payment_method:'boleto'}} paymentSlot={<div>Boleto Stripe</div>} onPay={onPay} payLabel="Abrir boleto seguro"/>);
    expect(screen.getByText(/novas faturas Boleto recorrentes serão enviadas por e-mail/i)).toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Forma de pagamento: Boleto bancário'})).toBeInTheDocument();
    const button=screen.getByRole('button',{name:'Abrir boleto seguro'});
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(button);
    expect(onPay).toHaveBeenCalledOnce();
  });
  it('boleto mostra instruções sem afirmar que a fatura foi paga',()=>{
    render(<BoletoPayment order={{...order,payment_method:'boleto'}} invoiceUrl="https://invoice.stripe.com/example"/>);
    expect(screen.getByText(/Seu boleto está disponível na fatura segura/i)).toBeInTheDocument();
    expect(screen.getByText(/código de barras e o vencimento/i)).toBeInTheDocument();
    expect(screen.getByText(/depende da confirmação financeira/i)).toBeInTheDocument();
    expect(screen.queryByText('Pagamento confirmado')).not.toBeInTheDocument();
  });

  it('mantém resumo e aceite em cartão sem exigir dados sensíveis fora da Stripe', async ()=>{
    const user=userEvent.setup();
    const onPay=vi.fn();
    render(<PaymentPageView order={{...order,payment_method:'card',card_funding:'credit'}} paymentSlot={<div>Stripe Payment Element</div>} onPay={onPay}/>);
    expect(screen.getByRole('region',{name:'Forma de pagamento: Cartão de crédito'})).toBeInTheDocument();
    expect(screen.getByText('Stripe Payment Element')).toBeInTheDocument();
    expect(screen.getByText('R$ 3.279,80')).toBeInTheDocument();
    const pay=screen.getByRole('button',{name:/Pagar R\$\s*3\.279,80 agora/});
    expect(pay).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(pay).toBeEnabled();
  });

  it('Pix em processamento preserva acompanhamento sem disponibilizar nova cobrança', async () => {
    const user=userEvent.setup();
    const onRefresh=vi.fn();
    render(<PaymentPageView order={{...order,payment_method:'pix',status:'processing'}} paymentSlot={<div>QR Code Pix</div>} onPay={vi.fn()} onRefresh={onRefresh}/>);
    expect(screen.getByRole('heading',{name:'Estamos confirmando seu pagamento.'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pagar.*Pix/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Verificar status'}));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('Pix expirado não disponibiliza nova cobrança pelo pedido original', () => {
    render(<PaymentPageView order={{...order,payment_method:'pix',status:'expired'}} paymentSlot={null} onPay={vi.fn()}/>);
    expect(screen.getByRole('heading',{name:'Este link expirou.'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pagar.*Pix/})).not.toBeInTheDocument();
  });

  it('exibe o Pix aprovado localmente sem segundo aceite e com título direto',()=>{
    const {container}=render(<PaymentPageView order={{...order,payment_method:'pix'}} paymentSlot={<div>Área Stripe para Pix</div>} onPay={vi.fn()}/>);
    expect(screen.getByRole('heading',{name:'Pague com Pix.'})).toBeInTheDocument();
    const image=container.querySelector('.pay-pix-brand') as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.src).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Área Stripe para Pix')).toBeInTheDocument();
  });

  it('Pix orienta QR Code e copia e cola sem afirmar liquidação antecipada',()=>{
    render(<PaymentPageView order={{...order,payment_method:'pix'}} paymentSlot={<div>Stripe PaymentElement</div>} onPay={()=>undefined}/>);
    expect(screen.queryByText(/Stripe apresenta as instruções/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Stripe PaymentElement')).toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'Pagamento confirmado.'})).not.toBeInTheDocument();
  });

  it('Pix avulso não promete renovação automática',()=>{
    render(<PaymentPageView order={{...order,payment_method:'pix'}} paymentSlot={<div>QR Code Pix</div>} onPay={()=>undefined}/>);
    expect(screen.getByRole('region',{name:'Forma de pagamento: Pix'})).toBeInTheDocument();
    expect(screen.getByText(/Cobrança avulsa gerada pelo CRM/i)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pagar.*Pix/})).not.toBeInTheDocument();
  });

});
