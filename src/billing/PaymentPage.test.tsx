import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoletoPayment, PaymentPage, PaymentPageView, type PublicBillingOrder } from './PaymentPage';

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
    expect(screen.getByText(/Verba de mídia paga separadamente/)).toBeInTheDocument();
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

  it('Pix avulso não promete renovação automática',()=>{
    render(<PaymentPageView order={{...order,payment_method:'pix'}} paymentSlot={<div>QR Code Pix</div>} onPay={()=>undefined}/>);
    expect(screen.getByText(/não renova automaticamente/i)).toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Forma de pagamento: Pix'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Pagar R\$\s*3\.279,80 com Pix/})).toBeDisabled();
  });

});
