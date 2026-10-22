import { Check, LockKeyhole, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

export type DirectCheckoutSelection = {
  plan: 'Start' | 'Growth' | 'Scale';
  cycle: 'monthly' | 'annual';
  addons: Array<'landing-page' | 'traffic'>;
  payment_method: 'card'|'boleto'|'pix';
  card_funding: 'credit'|'debit';
  customer_name: string;
  customer_email: string;
  company: string;
  tax_id: string;
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
const digits = (value: string) => value.replace(/\D/g, '');
const formatTaxId = (value: string) => { const id=digits(value).slice(0,14); if(id.length<=11) return id.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); return id.replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2'); };
const validTaxId = (value: string) => {
  const id = digits(value);
  if (![11, 14].includes(id.length) || /^([0-9])\1+$/.test(id)) return false;
  const calc = (base: string) => { let sum = 0; let weight = base.length === 9 ? 10 : base.length === 10 ? 11 : base.length - 7; for (const char of base) { sum += Number(char) * weight--; if (weight < 2) weight = 9; } const rest = sum % 11; return rest < 2 ? 0 : 11 - rest; };
  if (id.length === 11) return calc(id.slice(0, 9)) === Number(id[9]) && calc(id.slice(0, 10)) === Number(id[10]);
  return calc(id.slice(0, 12)) === Number(id[12]) && calc(id.slice(0, 13)) === Number(id[13]);
};
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
  const [paymentMethod,setPaymentMethod]=useState<DirectCheckoutSelection['payment_method']>('card');
  const [cardFunding,setCardFunding]=useState<DirectCheckoutSelection['card_funding']>('credit');
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [taxId, setTaxId] = useState('');
  const quote = useMemo(() => {
    const selected = plans[plan];
    const selectedAddons = addons.map(key => ({ key, ...additions[key] }));
    return {
      planAmount: selected[cycle], setup: selected.setup, selectedAddons,
      total: selected[cycle] + selected.setup + selectedAddons.reduce((sum, item) => sum + item.price, 0),
    };
  }, [addons, cycle, plan]);
  const valid = customerName.trim().length >= 2 && company.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && validTaxId(taxId);
  const toggle = (addon: DirectCheckoutSelection['addons'][number]) => setAddons(current => current.includes(addon) ? current.filter(item => item !== addon) : [...current, addon]);
  const submit = () => {
    if (!valid || busy) return;
    onContinue({ plan, cycle, addons, payment_method:paymentMethod, card_funding:cardFunding, customer_name: customerName.trim(), customer_email: email.trim().toLowerCase(), company: company.trim(), tax_id: digits(taxId) });
  };

  return <div className="checkout-configurator">
    <div className="checkout-config-head">
      <small>CONDIÇÕES COMERCIAIS</small><h1>Revise sua contratação.</h1>
      <p>Uma contratação clara para colocar sua operação em movimento, com implantação, plano escolhido e suporte contínuo.</p>
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
    <fieldset className="checkout-choice checkout-funding"><legend>Forma de pagamento</legend><div className="checkout-payment-options">
      <label className={paymentMethod==='card'&&cardFunding==='credit'?'selected':''}><input type="radio" name="checkout-payment" checked={paymentMethod==='card'&&cardFunding==='credit'} onChange={()=>{setPaymentMethod('card');setCardFunding('credit')}}/><span><strong>Cartão de crédito</strong><small>Renovação conforme a periodicidade do plano.</small></span></label>
      <label className={paymentMethod==='card'&&cardFunding==='debit'?'selected':''}><input type="radio" name="checkout-payment" checked={paymentMethod==='card'&&cardFunding==='debit'} onChange={()=>{setPaymentMethod('card');setCardFunding('debit')}}/><span><strong>Cartão de débito</strong><small>O emissor precisa permitir a transação e a recorrência escolhida.</small></span></label>
      <label className={paymentMethod==='boleto'?'selected':''}><input type="radio" name="checkout-payment" checked={paymentMethod==='boleto'} onChange={()=>setPaymentMethod('boleto')}/><span><strong>Boleto bancário recorrente</strong><small>Uma nova fatura chega por e-mail a cada período. Cada boleto precisa ser pago manualmente.</small></span></label>
      <label className={paymentMethod==='pix'?'selected':''}><input type="radio" name="checkout-payment" checked={paymentMethod==='pix'} onChange={()=>setPaymentMethod('pix')}/><span><strong>Pix</strong><small>Pagamento à vista por QR Code. A renovação é tratada pela central ORYNEO.</small></span></label>
    </div></fieldset>
    <fieldset className="checkout-choice checkout-contact"><legend>Dados para o pedido</legend>
      <label>Nome completo<input aria-label="Nome completo" autoComplete="name" value={customerName} onChange={event => setCustomerName(event.target.value)}/></label>
      <label>E-mail corporativo<input aria-label="E-mail corporativo" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
      <label>Empresa<input aria-label="Empresa" autoComplete="organization" value={company} onChange={event => setCompany(event.target.value)}/></label>
      <label>CPF ou CNPJ<input aria-label="CPF ou CNPJ" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00 ou 00.000.000/0000-00" value={taxId} onChange={event => setTaxId(formatTaxId(event.target.value))} onBlur={() => taxId && !validTaxId(taxId)}/>{taxId && !validTaxId(taxId) && <small className="checkout-field-error">Digite um CPF ou CNPJ válido para continuar.</small>}</label>
    </fieldset>
    <aside className="checkout-quote" aria-live="polite"><div><span>Plano {plan} · {cycle === 'annual' ? 'Anual' : 'Mensal'}</span><strong>{money(quote.planAmount)}</strong></div><div><span>Implantação</span><strong>{money(quote.setup)}</strong></div>{quote.selectedAddons.map(item => <div key={item.key}><span>{item.label}<small>{item.detail}</small></span><strong>{money(item.price)}</strong></div>)}<div className="checkout-total"><span>Total de hoje</span><strong>{money(quote.total)}</strong></div>{addons.includes('traffic') && <p>Gestão de tráfego: {money(additions.traffic.price)} a cada 3 meses após o período inicial. Verba de mídia não está incluída.</p>}</aside>
    {error && <p className="checkout-error" role="alert">{error}</p>}
    <button className="pay-submit" type="button" disabled={!valid || busy} onClick={submit}><LockKeyhole size={17}/>{busy ? 'Preparando pagamento…' : `Pagar ${money(quote.total)}`}</button>
    <p className="checkout-secure"><Check size={14}/> {paymentMethod==='pix'?'Pix à vista. A renovação é gerada pela equipe ORYNEO no CRM.':paymentMethod==='card'?`Cartão de ${cardFunding==='credit'?'crédito':'débito'} com cobrança conforme a periodicidade do plano.`:'Boleto recorrente enviado por e-mail; cada fatura é paga manualmente.'}</p>
  </div>;
}
