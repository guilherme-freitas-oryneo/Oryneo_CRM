import { useEffect, useState, type ReactNode } from 'react';
import { Check, LockKeyhole, ShieldCheck } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { supabase } from '../data';
import './payment.css';

export type PublicBillingItem = {
  key: string;
  label: string;
  detail: string;
  amount_cents: number;
};

export type PublicBillingOrder = {
  reference: string;
  company: string;
  customer_name: string;
  status: 'awaiting_payment' | 'paid' | 'expired' | 'canceled' | 'payment_failed';
  currency: 'brl';
  amount_total: number;
  items: PublicBillingItem[];
  recurring?: {
    label: string;
    amount_cents: number;
    interval_label: string;
    next_charge_at?: string | null;
  } | null;
  expires_at: string;
  test_mode: boolean;
};

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);

const shortDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  : '';

export function PaymentPageView({ order, paymentSlot, onPay, busy = false }: {
  order: PublicBillingOrder;
  paymentSlot: ReactNode;
  onPay: () => void;
  busy?: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  const ready = order.status === 'awaiting_payment';
  return <main className="pay-page">
    <header className="pay-header">
      <div className="pay-shell pay-header-inner">
        <img src="../oryneo-wordmark-mono.png" alt="ORYNEO" />
        <span>Ambiente seguro de pagamento</span>
        <div><ShieldCheck size={17}/> Conexão protegida</div>
      </div>
    </header>
    <div className="pay-glow" aria-hidden="true"/>
    <div className="pay-shell pay-layout">
      <section className="pay-card pay-form-card">
        <div className="pay-intro">
          <small>PAGAMENTO</small>
          <h1>Finalize sua contratação.</h1>
          <p>Olá, {order.customer_name}. Revise os dados acordados e conclua com segurança. O escopo não pode ser alterado nesta etapa.</p>
        </div>
        <div className="pay-form-body">
          {ready ? paymentSlot : <StatusMessage status={order.status}/>} 
          {ready && <>
            <label className="pay-consent">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>
              <span><Check size={15}/> Li e aceito as condições comerciais e a recorrência descritas neste pedido.</span>
            </label>
            <button className="pay-submit" disabled={!accepted || busy} onClick={onPay}>
              <LockKeyhole size={17}/>{busy ? 'Processando…' : 'Confirmar pagamento'}
            </button>
            {order.test_mode && <p className="pay-test-note">Ambiente de homologação · nenhum pagamento real será processado.</p>}
          </>}
        </div>
      </section>
      <aside className="pay-summary">
        <div className="pay-summary-head">
          <div><small>PEDIDO {order.reference}</small><h2>{order.company}</h2></div>
          <span>{order.status === 'paid' ? 'Pago' : 'Aguardando pagamento'}</span>
        </div>
        <div className="pay-items">
          {order.items.map(item => <div key={item.key}>
            <span>{item.label}<small>{item.detail}</small></span>
            <strong>{money(item.amount_cents)}</strong>
          </div>)}
        </div>
        <div className="pay-total"><span>Total hoje</span><strong>{money(order.amount_total)}</strong></div>
        {order.recurring && <div className="pay-recurring">
          <span>Próxima cobrança</span><strong>{shortDate(order.recurring.next_charge_at) || 'Após o período inicial'}</strong>
          <span>Valor recorrente</span><strong>{money(order.recurring.amount_cents)} {order.recurring.interval_label}</strong>
        </div>}
        <p className="pay-help">Dúvidas sobre o pedido? Fale com a ORYNEO antes de concluir.</p>
      </aside>
    </div>
    <footer className="pay-shell pay-footer"><span>ORYNEO · Crescimento em sistema.</span><span>Privacidade · Termos comerciais · Suporte</span></footer>
  </main>;
}

function StatusMessage({ status }: { status: PublicBillingOrder['status'] }) {
  const copy = status === 'paid'
    ? ['Pagamento confirmado.', 'Este pedido já foi concluído. A equipe ORYNEO seguirá com os próximos passos.']
    : status === 'expired'
      ? ['Este link expirou.', 'Solicite um novo link à equipe ORYNEO para continuar.']
      : ['Pagamento indisponível.', 'Fale com a equipe ORYNEO para revisar este pedido.'];
  return <div className="pay-state"><ShieldCheck size={26}/><h2>{copy[0]}</h2><p>{copy[1]}</p></div>;
}

function PaymentSkeleton() {
  return <div className="pay-element" aria-label="Área segura de pagamento">
    <div className="pay-element-head"><LockKeyhole size={16}/><span>Dados de pagamento</span><small>Processado com segurança</small></div>
    <div className="pay-field"><span>Número do cartão</span><i/></div>
    <div className="pay-field-row"><div className="pay-field"><span>Validade</span><i/></div><div className="pay-field"><span>CVC</span><i/></div></div>
    <p>Os campos seguros de pagamento serão carregados aqui. A ORYNEO não armazena dados do cartão.</p>
  </div>;
}

export function PaymentPage() {
  const [order, setOrder] = useState<PublicBillingOrder | null>(null);
  const [checkout, setCheckout] = useState<{clientSecret:string;publishableKey:string}|null>(null);
  const [error, setError] = useState('');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  useEffect(() => {
    if (!token) { setError('Este link de pagamento está incompleto.'); return; }
    let active = true;
    supabase.functions.invoke('billing-public', { body: { action: 'read', token } }).then(({ data, error: invokeError }) => {
      if (!active) return;
      if (invokeError || !data?.order) setError('Não foi possível abrir este pedido. Confira o link ou fale com a ORYNEO.');
      else { setOrder(data.order as PublicBillingOrder); if(data.client_secret&&data.publishable_key)setCheckout({clientSecret:data.client_secret,publishableKey:data.publishable_key}); }
    });
    return () => { active = false; };
  }, [token]);
  if (error) return <main className="pay-page pay-center"><div className="pay-error"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><h1>Não conseguimos abrir o pedido.</h1><p>{error}</p></div></main>;
  if (!order) return <main className="pay-page pay-center"><div className="pay-loading" aria-label="Carregando pedido"><span/>Preparando seu ambiente seguro…</div></main>;
  if(order.status==='awaiting_payment'&&!checkout)return <PaymentPageView order={{...order,status:'payment_failed'}} paymentSlot={null} onPay={()=>undefined}/>;
  if(!checkout)return <PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined}/>;
  return <CheckoutElementsProvider stripe={loadStripe(checkout.publishableKey)} options={{clientSecret:checkout.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#5269ff',colorText:'#242931',colorBackground:'#ffffff',borderRadius:'9px',fontFamily:'DM Sans, sans-serif'}}}}}>
    <StripePayment order={order}/>
  </CheckoutElementsProvider>;
}

function StripePayment({order}:{order:PublicBillingOrder}){
 const result=useCheckoutElements();
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const pay=async()=>{if(result.type!=='success'||busy)return;setBusy(true);setError('');const confirmation=await result.checkout.confirm({returnUrl:window.location.href});if(confirmation.type==='error'){setError(confirmation.error.message||'Confira os dados de pagamento e tente novamente.');setBusy(false)}};
 const slot=<div className="pay-element"><div className="pay-element-head"><LockKeyhole size={16}/><span>Dados de pagamento</span><small>Processado com segurança</small></div>{result.type==='loading'?<PaymentSkeleton/>:result.type==='error'?<p role="alert">Não foi possível carregar os campos seguros.</p>:<PaymentElement/>}{error&&<p className="pay-inline-error" role="alert">{error}</p>}</div>;
 return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>void pay()} busy={busy||result.type!=='success'}/>;
}
