import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PaymentPageView, type PublicBillingOrder } from './PaymentPage';

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
  it('mostra o acompanhamento de implantação apenas após pagamento confirmado',()=>{
    const url='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/implantacao/?token=token-seguro';
    const {rerender}=render(<PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined} portalUrl={url}/>);
    expect(screen.queryByRole('link',{name:/Acompanhar implantação/})).not.toBeInTheDocument();
    rerender(<PaymentPageView order={{...order,status:'paid'}} paymentSlot={null} onPay={()=>undefined} portalUrl={url}/>);
    expect(screen.getByRole('link',{name:/Acompanhar implantação/})).toHaveAttribute('href',url);
  });

  it('expõe total, composição e recorrência antes do pagamento', () => {
    render(<PaymentPageView order={order} paymentSlot={<div>Pagamento seguro</div>} onPay={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Finalize sua contratação.' })).toBeInTheDocument();
    expect(screen.getByText('R$ 3.279,80')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.099,90 por mês')).toBeInTheDocument();
    expect(screen.getByText(/Ambiente de homologação/)).toBeInTheDocument();
  });

  it('só libera a confirmação após o aceite explícito', async () => {
    const user = userEvent.setup();
    render(<PaymentPageView order={order} paymentSlot={<div>Pagamento seguro</div>} onPay={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Confirmar pagamento' });
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

});
