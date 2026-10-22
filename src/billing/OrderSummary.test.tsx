import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderSummary } from './OrderSummary';

describe('OrderSummary', () => {
  const items = [
    { key: 'growth', label: 'Plano Growth', detail: 'Assinatura mensal', amount_cents: 109_990 },
    { key: 'setup', label: 'Implantação', detail: 'Cobrança única', amount_cents: 138_990 },
  ];

  it('apresenta totais e recorrência Pix sem bloco interno nem promessa de renovação automática', () => {
    const { container } = render(<OrderSummary
      reference="ORY-00142"
      company="Acme Comércio Ltda."
      items={items}
      totalCents={248_980}
      paymentMethod="pix"
      recurring={{ amount_cents: 109_990, interval_label: 'por mês' }}
      status="Aguardando pagamento"
    />);

    expect(screen.getByRole('complementary', { name: 'Resumo do pedido' })).toBeInTheDocument();
    expect(screen.getByText('Resumo do pedido')).toBeInTheDocument();
    expect(screen.getByText('R$ 2.489,80')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Próximos pagamentos' })).toBeInTheDocument();
    expect(screen.getByText('Novo Pix necessário por período')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.099,90 por mês')).toBeInTheDocument();
    expect(screen.getByText('Nada será debitado automaticamente.')).toBeInTheDocument();
    expect(screen.queryByText('Cobrança avulsa gerada pelo CRM')).not.toBeInTheDocument();
    expect(container.querySelector('.order-summary-recurring')).not.toHaveClass('order-summary-inset');
    expect(container.querySelector('.order-summary-recurring')).not.toHaveStyle({ border: expect.stringContaining('1px') });
  });

  it('separa a renovação trimestral de tráfego da assinatura principal', () => {
    render(<OrderSummary
      company="Acme Comércio Ltda."
      items={[...items, { key: 'traffic', label: 'Gestão de tráfego pago', detail: 'Primeiros 3 meses antecipados', amount_cents: 296_970 }]}
      totalCents={545_950}
      paymentMethod="card"
      recurring={{ amount_cents: 109_990, interval_label: 'por mês', next_charge_at: '2026-11-13' }}
    />);

    expect(screen.getByText('Próximos pagamentos')).toBeInTheDocument();
    expect(screen.getByText('Gestão de tráfego')).toBeInTheDocument();
    expect(screen.getByText(/R\$ 2\.969,70 a cada 3 meses após o período inicial/)).toBeInTheDocument();
    expect(screen.getByText(/Verba de mídia não está incluída; paga separadamente/)).toBeInTheDocument();
  });
});
