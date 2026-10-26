import { TermsDialog } from '../../legal/TermsDialog';
import { CreditCard, Plus } from 'lucide-react';
import { paymentAsset } from './payment-assets';
import { useEffect, useMemo, useState } from 'react';
import { OrderSummary } from '../OrderSummary';

export type DirectCheckoutSelection = {
  plan: 'Start' | 'Growth' | 'Scale';
  cycle: 'monthly' | 'annual';
  addons: Array<'landing-page' | 'traffic'>;
  payment_method: 'card'|'boleto'|'pix';
  card_funding: 'credit'|'debit'|null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  cnpj: string;
};

export type DirectCheckoutDraft = Omit<DirectCheckoutSelection,'payment_method'> & {payment_method:DirectCheckoutSelection['payment_method']|null};
export type DirectCheckoutDraftResult = {cnpj_status?:'partial'|'invalid'|'not_found'|'unavailable'|'found';company?:{legal_name:string;trade_name?:string;status?:string}};
type Props = { onContinue: (selection: DirectCheckoutSelection) => void; onDraft?:(draft:DirectCheckoutDraft)=>Promise<DirectCheckoutDraftResult|void>; busy?: boolean; error?: string };

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
const normalizedCnpj=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14);
const formatCnpj=(value:string)=>{
  const raw=normalizedCnpj(value);
  return raw.slice(0,2)+(raw.length>2?'.'+raw.slice(2,5):'')+(raw.length>5?'.'+raw.slice(5,8):'')+(raw.length>8?'/'+raw.slice(8,12):'')+(raw.length>12?'-'+raw.slice(12,14):'');
};
const cnpjDigit=(base:string)=>{let sum=0,weight=base.length===12?5:6;for(const char of base){sum+=(char.charCodeAt(0)-48)*weight--;if(weight<2)weight=9}const rest=sum%11;return rest<2?0:11-rest};
const validCnpj=(value:string)=>{const cnpj=normalizedCnpj(value);return /^[A-Z0-9]{12}\d{2}$/.test(cnpj)&&!/^([A-Z0-9])\1{11}/.test(cnpj)&&cnpjDigit(cnpj.slice(0,12))===Number(cnpj[12])&&cnpjDigit(cnpj.slice(0,13))===Number(cnpj[13])};
const validDdds=new Set(['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']);
const phoneDigits=(value:string)=>{const raw=digits(value).slice(0,13);return raw.length===13&&raw.startsWith('55')?raw.slice(2):raw};
const formatPhone=(value:string)=>phoneDigits(value).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2');
const validPhone=(value:string)=>{const phone=phoneDigits(value),subscriber=phone.slice(3);return phone.length===11&&validDdds.has(phone.slice(0,2))&&phone[2]==='9'&&!/^(\d)\1+$/.test(phone)&&!/^(\d)\1{7}$/.test(subscriber)};
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


export function CheckoutConfigurator({ onContinue, onDraft, busy = false, error = '' }: Props) {
  const [initialSelection] = useState(() => parseCheckoutPrefill(window.location.search));
  const { plan, cycle } = initialSelection;
  const [addons, setAddons] = useState<DirectCheckoutSelection['addons']>(initialSelection.addons);
  const [paymentMethod,setPaymentMethod]=useState<DirectCheckoutSelection['payment_method']|null>(null);
  const [cardFunding,setCardFunding]=useState<DirectCheckoutSelection['card_funding']>(null);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone,setPhone]=useState('');
  const [cnpj,setCnpj]=useState('');
  const [cnpjLookup,setCnpjLookup]=useState<DirectCheckoutDraftResult|null>(null);
  const [termsAccepted,setTermsAccepted]=useState(false);
  const [lookupAttempt,setLookupAttempt]=useState(0);
  const quote = useMemo(() => {
    const selected = plans[plan];
    const selectedAddons = addons.map(key => ({ key, ...additions[key] }));
    return {
      planAmount: selected[cycle], setup: selected.setup, selectedAddons,
      total: selected[cycle] + selected.setup + selectedAddons.reduce((sum, item) => sum + item.price, 0),
    };
  }, [addons, cycle, plan]);
  const hasPaymentSelection = paymentMethod !== null && (paymentMethod !== 'card' || cardFunding !== null);
  const cnpjVerified=!onDraft||cnpjLookup?.cnpj_status==='found';
  const valid = customerName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && validPhone(phone) && validCnpj(cnpj) && cnpjVerified && hasPaymentSelection;
  const toggle = (addon: DirectCheckoutSelection['addons'][number]) => setAddons(current => current.includes(addon) ? current.filter(item => item !== addon) : [...current, addon]);
  useEffect(()=>{
    if(!onDraft||![customerName,email,phone,cnpj].some(value=>value.replace(/\s/g,'').length>=2))return;
    let active=true;
    const timer=window.setTimeout(()=>{
      void onDraft({plan,cycle,addons,payment_method:paymentMethod,card_funding:paymentMethod==='card'?cardFunding:null,customer_name:customerName.trim(),customer_email:email.trim().toLowerCase(),customer_phone:phoneDigits(phone),cnpj:normalizedCnpj(cnpj)})
        .then(result=>{if(active&&result)setCnpjLookup(result)}).catch(()=>{if(active&&validCnpj(cnpj))setCnpjLookup({cnpj_status:'unavailable'})});
    },650);
    return()=>{active=false;window.clearTimeout(timer)};
  },[addons,cardFunding,cnpj,customerName,cycle,email,onDraft,paymentMethod,phone,plan,lookupAttempt]);
  const submit = () => {
    if (!valid || !termsAccepted || busy || !paymentMethod) return;
    onContinue({ plan, cycle, addons, payment_method:paymentMethod, card_funding:paymentMethod==='card'?cardFunding:null, customer_name: customerName.trim(), customer_email: email.trim().toLowerCase(), customer_phone:`+55${phoneDigits(phone)}`, cnpj:normalizedCnpj(cnpj) });
  };

  return <div className="checkout-configurator">
    <div className="checkout-main-flow">
    <div className="checkout-config-head">
      <span>Contratação ORYNEO</span><h1>Revise e conclua.</h1>
      <p>Plano, serviços e forma de pagamento em uma única revisão.</p>
    </div>
    <section className="checkout-choice checkout-locked-selection" aria-label="Plano e periodicidade selecionados">
      <div className="checkout-locked-heading"><span>Plano selecionado</span></div>
      <div className="checkout-locked-grid">
        <div><small>Plano</small><strong>ORYNEO {plan}</strong><span>{money(plans[plan][cycle])} {cycle === 'annual' ? 'por ano' : 'por mês'}</span></div>
        <div><small>Periodicidade</small><strong>{cycle === 'annual' ? 'Anual' : 'Mensal'}</strong><span>{cycle === 'annual' ? 'Pagamento anual antecipado' : 'Cobrança a cada mês'}</span></div>
      </div>

    </section>
    <fieldset className="checkout-choice"><legend>Serviços adicionais</legend><div className="checkout-addons">
      {(Object.keys(additions) as DirectCheckoutSelection['addons'][number][]).map(key => <label key={key} className={addons.includes(key) ? 'selected' : ''}>
        <input type="checkbox" checked={addons.includes(key)} onChange={() => toggle(key)}/><span><strong>{additions[key].label}</strong><small>{additions[key].detail}</small></span><b><Plus size={14}/>{money(additions[key].price)}</b>
      </label>)}
    </div></fieldset>
    <fieldset className="checkout-choice checkout-funding"><legend>Forma de pagamento</legend><div className="checkout-payment-options">
      <label className={paymentMethod==='card'?'selected':''}><input aria-label="Cartão" type="radio" name="checkout-payment" checked={paymentMethod==='card'} onChange={()=>{setPaymentMethod('card');setCardFunding(null)}}/><span className="checkout-payment-art checkout-card-art" aria-hidden="true"><CreditCard size={23}/></span><span className="checkout-payment-copy"><strong>Cartão</strong></span></label>
      <label className={paymentMethod==='pix'?'selected':''}><input aria-label="Pix" type="radio" name="checkout-payment" checked={paymentMethod==='pix'} onChange={()=>{setPaymentMethod('pix');setCardFunding(null)}}/><span className="checkout-payment-art" aria-hidden="true"><img className="checkout-pix" src={paymentAsset.pix} alt=""/></span><span className="checkout-payment-copy"><strong>Pix</strong></span></label>
      <label className={paymentMethod==='boleto'?'selected':''}><input aria-label="Boleto bancário" type="radio" name="checkout-payment" checked={paymentMethod==='boleto'} onChange={()=>{setPaymentMethod('boleto');setCardFunding(null)}}/><span className="checkout-payment-art" aria-hidden="true"><img className="checkout-boleto" src={paymentAsset.boleto} alt=""/></span><span className="checkout-payment-copy"><strong>Boleto</strong></span></label>
    </div>{paymentMethod==='card'&&<div className="checkout-card-funding checkout-card-funding-compact" role="radiogroup" aria-label="Tipo do cartão"><span>Usar no</span><div><label className={cardFunding==='credit'?'selected':''}><input aria-label="Cartão de crédito" type="radio" name="checkout-card-funding" checked={cardFunding==='credit'} onChange={()=>setCardFunding('credit')}/><strong>Crédito</strong></label><label className={cardFunding==='debit'?'selected':''}><input aria-label="Cartão de débito" type="radio" name="checkout-card-funding" checked={cardFunding==='debit'} onChange={()=>setCardFunding('debit')}/><strong>Débito</strong></label></div></div>}
    {paymentMethod==='pix'&&<p className="checkout-payment-note">Um novo Pix será gerado em cada período.</p>}
    {paymentMethod==='boleto'&&<p className="checkout-payment-note">Pagamento manual por período; cada boleto chega por e-mail.</p>}</fieldset>
    <fieldset className="checkout-choice checkout-contact"><legend>Dados para o pedido</legend>
      {onDraft && <p className="checkout-draft-notice">Ao começar a preencher, seus dados são salvos automaticamente como rascunho da solicitação no CRM, antes da conclusão. Isso não confirma a contratação nem autoriza cobrança.</p>}
      <label>CNPJ<input aria-label="CNPJ" inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder="00.000.000/0000-00" value={cnpj} onChange={event=>{const next=formatCnpj(event.target.value);setCnpj(next);setCnpjLookup(validCnpj(next)?{cnpj_status:'partial'}:null)}}/>{cnpj&&normalizedCnpj(cnpj).length===14&&!validCnpj(cnpj)&&<small className="checkout-field-error">Digite um CNPJ válido para continuar.</small>}{cnpjLookup?.cnpj_status==='partial'&&validCnpj(cnpj)&&<small className="checkout-field-note">Consultando o cadastro…</small>}{cnpjLookup?.cnpj_status==='found'&&cnpjLookup.company&&<small className="checkout-company-found">Empresa identificada: {cnpjLookup.company.trade_name||cnpjLookup.company.legal_name}</small>}{cnpjLookup?.cnpj_status==='not_found'&&<small className="checkout-field-error">CNPJ não encontrado na Receita Federal.</small>}{cnpjLookup?.cnpj_status==='unavailable'&&<small className="checkout-field-error">Não foi possível consultar o CNPJ agora. Tente novamente.</small>}</label>
      {onDraft && cnpjLookup?.cnpj_status==='unavailable' && <button className="checkout-retry" type="button" disabled={busy} onClick={()=>{setCnpjLookup({cnpj_status:'partial'});setLookupAttempt(value=>value+1)}}>Tentar consultar CNPJ novamente</button>}
      <label>Nome completo<input aria-label="Nome completo" autoComplete="name" value={customerName} onChange={event => setCustomerName(event.target.value)}/></label>
      <label>E-mail<input aria-label="E-mail" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/>{email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && <small className="checkout-field-error">Digite um e-mail válido, como nome@empresa.com.br.</small>}</label>
      <label>WhatsApp<input aria-label="WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" value={phone} onChange={event=>setPhone(formatPhone(event.target.value))}/>{phoneDigits(phone).length===11&&!validPhone(phone)&&<small className="checkout-field-error">Digite um WhatsApp válido com DDD.</small>}<small className="checkout-field-note">Usaremos este número para falar sobre esta contratação.</small></label>
    </fieldset>
    </div>
    <div className="checkout-mobile-total" aria-hidden="true"><span>Total para pagar agora</span><strong>{money(quote.total)}</strong></div>
    <div className="checkout-mobile-terms">
      <strong>Próximos períodos</strong>
      <p>{paymentMethod==='pix'?'Cada período futuro exige um novo Pix.':paymentMethod==='boleto'?'Um novo boleto será enviado e pago manualmente.':paymentMethod==='card'?'O cartão será cobrado conforme a periodicidade.':'A forma de pagamento ainda será escolhida.'} <b>{money(quote.planAmount)} {cycle==='annual'?'por ano':'por mês'}</b></p>
      {addons.includes('traffic')&&<p>Gestão de tráfego: <b>{money(additions.traffic.price)} a cada 3 meses</b> após o período inicial, independentemente do plano. Verba de mídia à parte.</p>}
    </div>
    <div className="checkout-side-flow">
    <OrderSummary
      heading={`Plano ${plan} · ${cycle === 'annual' ? 'Anual' : 'Mensal'}`}
      items={[
        { key: `${plan}-${cycle}`, label: `Plano ${plan}`, detail: cycle === 'annual' ? 'Assinatura anual antecipada' : 'Assinatura mensal', amount_cents: quote.planAmount },
        { key: 'setup', label: 'Implantação', detail: 'Cobrança única', amount_cents: quote.setup },
        ...quote.selectedAddons.map(item => ({ key: item.key, label: item.label, detail: item.detail, amount_cents: item.price })),
      ]}
      totalCents={quote.total}
      paymentMethod={paymentMethod}
      recurring={{ amount_cents: quote.planAmount, interval_label: cycle === 'annual' ? 'por ano' : 'por mês' }}
    />
    <div className="checkout-consent"><label><input type="checkbox" checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)} /><span>Li e aceito os termos e as condições comerciais deste pedido.</span></label><TermsDialog label="Ler termos completos" /></div>
    {error && <p className="checkout-error" role="alert">{error}</p>}
    <button className="pay-submit" type="button" disabled={!valid || !termsAccepted || busy} onClick={submit}>{busy ? 'Preparando pagamento…' : paymentMethod==='pix'?`Continuar para o Pix · ${money(quote.total)}`:`Continuar para o pagamento · ${money(quote.total)}`}</button>
    <p className="checkout-secure">{paymentMethod==='pix'?'Pix pago uma vez. Nada será debitado automaticamente.':paymentMethod==='card'&&cardFunding?`Cartão de ${cardFunding==='credit'?'crédito':'débito'} com cobrança conforme a periodicidade do plano.`:paymentMethod==='card'?'Escolha crédito ou débito para continuar.':paymentMethod==='boleto'?'Um novo boleto será enviado a cada período; o pagamento é manual.':'Escolha uma forma de pagamento para continuar.'}</p>
    </div>
  </div>;
}
