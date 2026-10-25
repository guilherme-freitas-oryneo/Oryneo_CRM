import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './data';
import { CheckoutConfigurator, type DirectCheckoutSelection } from './billing/checkout/CheckoutConfigurator';
import { PaymentPage } from './billing/PaymentPage';
import './billing/payment.css';
import './billing/checkout/checkout.css';

const requestKey = 'oryneo.direct-checkout.request';
// Retain idempotency for retries of the *same* order, never for a different customer/selection.
const request = async (selection: DirectCheckoutSelection) => {
  const canonical = JSON.stringify({
    ...selection,
    customer_email: selection.customer_email.toLowerCase().trim(),
    addons: [...selection.addons].sort(),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const selectionHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const current = window.sessionStorage.getItem(requestKey);
  if (current) {
    try {
      const parsed = JSON.parse(current) as { id?: string; token?: string; selectionHash?: string };
      if (parsed.id && parsed.token && parsed.selectionHash === selectionHash) return { id: parsed.id, token: parsed.token };
    } catch { /* generate a new session request */ }
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const created = { id: crypto.randomUUID(), token: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''), selectionHash };
  window.sessionStorage.setItem(requestKey, JSON.stringify(created));
  return {id:created.id, token:created.token};
};

export function DirectCheckoutPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentReady,setPaymentReady]=useState(false);
  const continueToPayment = async (selection: DirectCheckoutSelection) => {
    setBusy(true); setError('');
    try {
      const idempotency = await request(selection);
      const { data, error: invokeError } = await supabase.functions.invoke('checkout-intake', { body: { request_id: idempotency.id, payment_token: idempotency.token, ...selection } });
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
  return <main className="pay-page"><header className="pay-header"><div className="pay-shell pay-header-inner"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><span>Contratação</span></div></header><section className="pay-shell checkout-page-shell"><div className="pay-card checkout-review-card"><div className="checkout-progress" aria-label="Etapas da contratação"><span aria-current="step"><b>1</b> Revisão</span><span><b>2</b> Pagamento</span></div><div className="pay-form-body"><CheckoutConfigurator onContinue={selection => void continueToPayment(selection)} busy={busy} error={error}/></div></div></section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DirectCheckoutPage/>);
