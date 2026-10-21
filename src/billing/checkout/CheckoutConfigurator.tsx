import { Check, LockKeyhole, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

export type DirectCheckoutSelection = {
  plan: 'Start' | 'Growth' | 'Scale';
  cycle: 'monthly' | 'annual';
  addons: Array<'landing-page' | 'traffic'>;
  customer_name: string;
  customer_email: string;
  company: string;
};

type Props = { onContinue: (selection: DirectCheckoutSelection) => void; busy?: boolean; error?: string };

const plans = {
  Start: { monthly: 74_990, annual: 809_892, setup: 98_990 },
  Growth: { monthly: 109_990, annual: 1_187_892, setup: 138_990 },
  Scale: { monthly: 147_990, annual: 1_598_292, setup: 184_990 },
} as const;
const additions = {
  'landing-page': { label: 'Landing page de conversão', price: 88_990, detail: 'Cobrança única' },
  traffic: { label: 'Gestão de tráfego pago', price: 296_970, detail: 'Primeiros 3 meses antecipados' },
} as const;
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
/** Client-side convenience only: catalog prices and permitted combinations are validated server-side. */
export function parseCheckoutPrefill(search: string): Pick<DirectCheckoutSelection,'plan'|'cycle'|'addons'> {
  const params=new URLSearchParams(search);
  const selectedPlan=params.get('plan');
  const selectedCycle=params.get('cycle');
  const plan:DirectCheckoutSelection['plan']=selectedPlan==='Growth'||selectedPlan==='Scale'?selectedPlan:'Start';
  const cycle:DirectCheckoutSelection['cycle']=selectedCycle==='annual'?'annual':'monthly';
  const addons:Array<'landing-page'|'traffic'>=[];
  for(const raw of params.getAll('services').flatMap(value=>value.split(','))) {
    if ((raw==='landing-page'||raw==='traffic')&&!addons.includes(raw))addons.push(raw);
  }
  return {plan,cycle,addons};
}


export function CheckoutConfigurator({ onContinue, busy = false, error = '' }: Props) {
  const [initialSelection] = useState(() => parseCheckoutPrefill(window.location.search));
  const { plan, cycle } = initialSelection;
  const [addons, setAddons] = useState<DirectCheckoutSelection['addons']>(initialSelection.addons);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const quote = useMemo(() => {
    const selected = plans[plan];
    const selectedAddons = addons.map(key => ({ key, ...additions[key] }));
    return {
      planAmount: selected[cycle], setup: selected.setup, selectedAddons,
      total: selected[cycle] + selected.setup + selectedAddons.reduce((sum, item) => sum + item.price, 0),
    };
  }, [addons, cycle, plan]);
  const valid = customerName.trim().length >= 2 && company.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const toggle = (addon: DirectCheckoutSelection['addons'][number]) => setAddons(current => current.includes(addon) ? current.filter(item => item !== addon) : [...current, addon]);
  const submit = () => {
    if (!valid || busy) return;
    onContinue({ plan, cycle, addons, customer_name: customerName.trim(), customer_email: email.trim().toLowerCase(), company: company.trim() });
  };

  return <div className="checkout-configurator">
    <div className="checkout-config-head">
      <small>CONDIÇÕES COMERCIAIS</small><h1>Revise sua contratação.</h1>
      <p>O plano e a periodicidade já foram definidos na sua escolha anterior. Você pode adicionar serviços opcionais antes de continuar.</p>
    </div>
    <section className="checkout-choice checkout-locked-selection" aria-label="Plano e periodicidade selecionados">
      <div className="checkout-locked-heading"><span>SELEÇÃO CONFIRMADA</span><LockKeyhole size={15} aria-hidden="true"/></div>
      <div className="checkout-locked-grid">
        <div><small>PLANO</small><strong>ORYNEO {plan}</strong><span>{money(plans[plan][cycle])} {cycle === 'annual' ? 'por ano' : 'por mês'}</span></div>
        <div><small>PERIODICIDADE</small><strong>{cycle === 'annual' ? 'Anual' : 'Mensal'}</strong><span>{cycle === 'annual' ? 'Pagamento anual antecipado' : 'Cobrança a cada mês'}</span></div>
      </div>
      <p>Para escolher outro plano ou período, volte à <a href="https://oryneo.com.br/">página de planos</a>. Isso não altera os serviços adicionais abaixo.</p>
    </section>
    <fieldset className="checkout-choice"><legend>Serviços adicionais</legend><div className="checkout-addons">
      {(Object.keys(additions) as DirectCheckoutSelection['addons'][number][]).map(key => <label key={key} className={addons.includes(key) ? 'selected' : ''}>
        <input type="checkbox" checked={addons.includes(key)} onChange={() => toggle(key)}/><span><strong>{additions[key].label}</strong><small>{additions[key].detail}</small></span><b><Plus size={14}/>{money(additions[key].price)}</b>
      </label>)}
    </div></fieldset>
    <fieldset className="checkout-choice checkout-contact"><legend>Dados para o pedido</legend>
      <label>Nome completo<input aria-label="Nome completo" autoComplete="name" value={customerName} onChange={event => setCustomerName(event.target.value)}/></label>
      <label>E-mail corporativo<input aria-label="E-mail corporativo" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
      <label>Empresa<input aria-label="Empresa" autoComplete="organization" value={company} onChange={event => setCompany(event.target.value)}/></label>
    </fieldset>
    <aside className="checkout-quote" aria-live="polite"><div><span>Plano {plan} · {cycle === 'annual' ? 'Anual' : 'Mensal'}</span><strong>{money(quote.planAmount)}</strong></div><div><span>Implantação</span><strong>{money(quote.setup)}</strong></div>{quote.selectedAddons.map(item => <div key={item.key}><span>{item.label}<small>{item.detail}</small></span><strong>{money(item.price)}</strong></div>)}<div className="checkout-total"><span>Total de hoje</span><strong>{money(quote.total)}</strong></div>{addons.includes('traffic') && <p>Gestão de tráfego: {money(additions.traffic.price)} a cada 3 meses após o período inicial. Verba de mídia não está incluída.</p>}</aside>
    {error && <p className="checkout-error" role="alert">{error}</p>}
    <button className="pay-submit" type="button" disabled={!valid || busy} onClick={submit}><LockKeyhole size={17}/>{busy ? 'Preparando pagamento…' : 'Continuar para o pagamento'}</button>
    <p className="checkout-secure"><Check size={14}/> Seus dados servem apenas para preparar este pedido. Os meios de pagamento disponíveis serão apresentados com as condições e o período coberto antes da confirmação.</p>
  </div>;
}
