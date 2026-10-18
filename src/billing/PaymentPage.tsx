import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  status: 'awaiting_payment' | 'processing' | 'paid' | 'expired' | 'canceled' | 'payment_failed';
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

const offboardingLink = () => {
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) return '';
  const url = new URL('../encerramento/',window.location.href);
  url.searchParams.set('token',token);
  return url.toString();
};

const deliveryLink = () => {
  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) return '';
  const url = new URL('../implantacao/',window.location.href);
  url.searchParams.set('token',token);
  return url.toString();
};

const shortDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  : '';

export function PaymentPageView({ order, paymentSlot, onPay, onRefresh, busy = false, portalUrl = '', accountUrl = '' }: {
  order: PublicBillingOrder;
  paymentSlot: ReactNode;
  onPay: () => void;
  onRefresh?: () => void;
  busy?: boolean;
  portalUrl?: string;
  accountUrl?: string;
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
          {ready ? paymentSlot : <StatusMessage status={order.status} onRefresh={onRefresh}/>}
          {order.status==='paid'&&portalUrl&&<p className="pay-help"><a href={portalUrl} rel="noreferrer">
            Acompanhar implantação e próximos passos</a></p>}
          {order.status==='paid'&&accountUrl&&<p className="pay-help"><a href={accountUrl} rel="noreferrer">Gerenciar assinatura e privacidade</a></p>} 
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
          <span>{order.status === 'paid' ? 'Pago' : order.status === 'processing' ? 'Em confirmação' : order.status === 'expired' ? 'Expirado' : 'Aguardando pagamento'}</span>
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
        {order.items.some(item=>item.key==='traffic') && <div className="pay-recurring" style={{marginTop:12}}>
          <span>Gestão de tráfego · renovação</span><strong>Após 3 meses iniciais</strong>
          <span>Valor trimestral</span><strong>{money(order.items.find(item=>item.key==='traffic')?.amount_cents||0)} a cada 3 meses</strong>
          <span style={{gridColumn:'1 / -1',lineHeight:1.7}}>Verba de mídia paga separadamente. A renovação é independente do ciclo do plano principal.</span>
        </div>}
        <p className="pay-help">Dúvidas sobre o pedido? Fale com a ORYNEO antes de concluir.</p>
      </aside>
    </div>
    <footer className="pay-shell pay-footer"><span>ORYNEO · Crescimento em sistema.</span><span>Privacidade · Termos comerciais · Suporte</span></footer>
  </main>;
}

function StatusMessage({ status, onRefresh }: { status: PublicBillingOrder['status']; onRefresh?: () => void }) {
  const copy = status === 'paid'
    ? ['Pagamento confirmado.', 'Este pedido já foi concluído. A equipe ORYNEO seguirá com os próximos passos.']
    : status === 'processing'
      ? ['Estamos confirmando seu pagamento.', 'Acompanhe por esta página. Não faça outro pagamento enquanto confirmamos sua transação.']
    : status === 'expired'
      ? ['Este link expirou.', 'Solicite um novo link à equipe ORYNEO para continuar.']
      : ['Pagamento indisponível.', 'Fale com a equipe ORYNEO para revisar este pedido.'];
  return <div className="pay-state"><ShieldCheck size={26}/><h2>{copy[0]}</h2><p>{copy[1]}</p>
    {status === 'processing' && onRefresh && <button type="button" className="pay-submit" onClick={onRefresh}>Verificar status</button>}
  </div>;
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
  const stripePromise = useMemo(() => checkout ? loadStripe(checkout.publishableKey) : null, [checkout?.publishableKey]);
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
  if(!checkout)return <PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={order.status==='paid'?deliveryLink():''} accountUrl={order.status==='paid'?offboardingLink():''}/>;
  return <CheckoutElementsProvider stripe={stripePromise} options={{clientSecret:checkout.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#5269ff',colorText:'#242931',colorBackground:'#ffffff',borderRadius:'9px',fontFamily:'DM Sans, sans-serif'}}}}}>
    <StripePayment order={order}/>
  </CheckoutElementsProvider>;
}

export function StripePayment({order}:{order:PublicBillingOrder}){
  const result=useCheckoutElements();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [completion,setCompletion]=useState<'idle'|'processing'|'paid'>('idle');

  useEffect(()=>{
    if(completion!=='processing')return;
    const token=new URLSearchParams(window.location.search).get('token');
    if(!token)return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let attempts=0;
    const verify=async()=>{
      try{
        const {data, error:lookupError}=await supabase.functions.invoke('billing-public',{body:{action:'read',token}});
        if(!active)return;
        if(!lookupError&&data?.order?.status==='paid'){
          setCompletion('paid');
          return;
        }
      }catch{/* Manter status pendente; confirmação financeira cabe ao servidor. */}
      if(active&&++attempts<8)timer=setTimeout(()=>void verify(),2000);
    };
    void verify();
    return()=>{active=false;if(timer)clearTimeout(timer)};
  },[completion]);

  const pay=async()=>{
    if(result.type!=='success'||busy||completion!=='idle')return;
    setBusy(true);
    setError('');
    try{
      const returnUrl=new URL(window.location.href);
      returnUrl.searchParams.set('retorno','1');
      const confirmation=await result.checkout.confirm({returnUrl:returnUrl.toString()});
      if(confirmation.type==='error'){
        setError(confirmation.error.message||'Confira os dados de pagamento e tente novamente.');
        return;
      }
      setCompletion('processing');
    }catch(cause){
      setError(cause instanceof Error&&cause.message?cause.message:'Não foi possível confirmar o pagamento. Tente novamente.');
    }finally{
      setBusy(false);
    }
  };

  if(completion!=='idle')return <PaymentPageView order={{...order,status:completion}} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={completion==='paid'?deliveryLink():''} accountUrl={completion==='paid'?offboardingLink():''}/>;
  const slot=<div className="pay-element">
    <div className="pay-element-head"><LockKeyhole size={16}/><span>Dados de pagamento</span><small>Processado com segurança</small></div>
    {result.type==='loading'?<PaymentSkeleton/>:result.type==='error'?<p role="alert">{result.error.message||'Não foi possível carregar os campos seguros.'}</p>:<PaymentElement/>}
    {error&&<p className="pay-inline-error" role="alert">{error}</p>}
  </div>;
  return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>void pay()} onRefresh={()=>window.location.reload()} busy={busy||result.type!=='success'}/>;
}
