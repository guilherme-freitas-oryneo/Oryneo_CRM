import './order-summary.css';

export type OrderSummaryItem = {
  key: string;
  label: string;
  detail: string;
  amount_cents: number;
};

export type OrderSummaryRecurring = {
  amount_cents: number;
  interval_label: string;
  next_charge_at?: string | null;
};

type PaymentMethod = 'card' | 'boleto' | 'pix';

type Props = {
  company?: string;
  heading?: string;
  reference?: string;
  status?: string;
  items: OrderSummaryItem[];
  totalCents: number;
  paymentMethod: PaymentMethod;
  recurring?: OrderSummaryRecurring | null;
};

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);

const shortDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  : null;

export function OrderSummary({ company, heading, reference, status, items, totalCents, paymentMethod, recurring }: Props) {
  const traffic = items.find(item => item.key === 'traffic');
  const nextCharge = shortDate(recurring?.next_charge_at);
  const recurringLabel = paymentMethod === 'pix'
    ? 'Novo Pix necessário por período'
    : paymentMethod === 'boleto'
      ? 'Novo boleto enviado por período'
      : 'Cartão cobrado automaticamente';

  return <aside className="order-summary" aria-label="Resumo do pedido">
    <header className="order-summary-header">
      <div>
        <h2>Resumo do pedido</h2>
        <p>{reference ? `Pedido ${reference}` : heading || 'Condições selecionadas'}</p>
        {company && <strong>{company}</strong>}
      </div>
      {status && <span className="order-summary-status"><i aria-hidden="true"/>{status}</span>}
    </header>

    <dl className="order-summary-items">
      {items.map(item => <div key={item.key}>
        <dt>{item.label}<small>{item.detail}</small></dt>
        <dd>{money(item.amount_cents)}</dd>
      </div>)}
    </dl>

    <div className="order-summary-total"><span>Total de hoje</span><strong>{money(totalCents)}</strong></div>

    {recurring && <section className="order-summary-recurring" aria-label="Próximos pagamentos">
      <h3>Próximos pagamentos</h3>
      <div className="order-summary-recurring-line"><span>{recurringLabel}</span><strong>{money(recurring.amount_cents)} {recurring.interval_label}</strong></div>
      {paymentMethod === 'pix'
        ? <p>Nada será debitado automaticamente.</p>
        : paymentMethod === 'boleto'
          ? <p>Cada boleto exige pagamento manual.</p>
          : <p>{nextCharge ? `Próxima cobrança em ${nextCharge}.` : 'Conforme o período contratado.'}</p>}
    </section>}

    {traffic && <section className="order-summary-traffic" aria-label="Renovação de gestão de tráfego">
      <div><h3>Gestão de tráfego</h3><span>Valor trimestral</span><strong>{money(traffic.amount_cents)} a cada 3 meses após o período inicial</strong></div>
      <p>Verba de mídia não está incluída; paga separadamente. A renovação é independente do plano principal.</p>
    </section>}
  </aside>;
}
