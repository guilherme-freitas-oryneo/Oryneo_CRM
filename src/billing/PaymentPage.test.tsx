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
});
