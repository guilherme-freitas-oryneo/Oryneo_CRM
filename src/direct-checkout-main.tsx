import { useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './data';
import { CheckoutConfigurator, type DirectCheckoutDraft, type DirectCheckoutDraftResult, type DirectCheckoutSelection } from './billing/checkout/CheckoutConfigurator';
import { PaymentPage } from './billing/PaymentPage';
import './billing/payment.css';
import './billing/checkout/checkout.css';

const requestKey = 'oryneo.direct-checkout.request';
type Journey={id:string;token:string;plan:string;cycle:string;createdAt:number};
const newJourney=(plan:string,cycle:string):Journey=>{
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return {id:crypto.randomUUID(),token:btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,''),plan,cycle,createdAt:Date.now()};
};
// One browser journey maps to one CRM opportunity, even while the person edits fields.
const request = (plan:string,cycle:string) => {
  const current = window.sessionStorage.getItem(requestKey);
  if (current) {
    try {
      const parsed = JSON.parse(current) as Journey;
      const fresh=Number.isFinite(parsed.createdAt)&&Date.now()-parsed.createdAt<24*60*60*1000;
      if (parsed.id&&parsed.token&&parsed.plan===plan&&parsed.cycle===cycle&&fresh) return parsed;
    } catch { /* generate a new session request */ }
  }
  const created=newJourney(plan,cycle);
  window.sessionStorage.setItem(requestKey, JSON.stringify(created));
  return created;
};

export function DirectCheckoutPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentReady,setPaymentReady]=useState(false);
  const saveDraft=useCallback(async(draft:DirectCheckoutDraft):Promise<DirectCheckoutDraftResult|void>=>{
    const idempotency=request(draft.plan,draft.cycle);
    const {data,error:invokeError}=await supabase.functions.invoke('checkout-intake',{body:{action:'draft',request_id:idempotency.id,payment_token:idempotency.token,...draft}});
    if(invokeError)throw new Error(data?.error||'Não foi possível salvar o andamento.');
    return data as DirectCheckoutDraftResult;
  },[]);
  const continueToPayment = async (selection: DirectCheckoutSelection) => {
    setBusy(true); setError('');
    try {
      const idempotency = request(selection.plan,selection.cycle);
      const { data, error: invokeError } = await supabase.functions.invoke('checkout-intake', { body: { action:'checkout',request_id: idempotency.id, payment_token: idempotency.token, ...selection } });
      if (invokeError || !data?.url) throw new Error(data?.error || 'Não foi possível preparar o pagamento agora. Nenhuma cobrança foi realizada.');
      const paymentUrl=new URL(data.url as string,window.location.href);
      const token=paymentUrl.searchParams.get('token');
      if(!paymentUrl.pathname.endsWith('/pagar/')||!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('O pagamento seguro retornou um endereço inválido. Nenhuma cobrança foi realizada.');
      window.history.pushState({oryneoPayment:true},'',`${paymentUrl.pathname}${paymentUrl.search}`);
      setPaymentReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o pagamento agora. Nenhuma cobrança foi realizada.');
    } finally { setBusy(false); }
  };
  if(paymentReady)return <PaymentPage/>;
  return <main className="pay-page"><header className="pay-header"><div className="pay-shell pay-header-inner"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><span>Contratação</span></div></header><section className="pay-shell checkout-page-shell"><div className="pay-card checkout-review-card"><div className="checkout-progress" aria-label="Etapas da contratação"><span aria-current="step"><b>1</b> Revisão</span><span><b>2</b> Pagamento</span></div><div className="pay-form-body"><CheckoutConfigurator onContinue={selection => void continueToPayment(selection)} onDraft={saveDraft} busy={busy} error={error}/></div></div></section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DirectCheckoutPage/>);
