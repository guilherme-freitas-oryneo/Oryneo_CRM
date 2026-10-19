import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './data';
import { CheckoutConfigurator, type DirectCheckoutSelection } from './billing/checkout/CheckoutConfigurator';
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
  const continueToPayment = async (selection: DirectCheckoutSelection) => {
    setBusy(true); setError('');
    try {
      const idempotency = await request(selection);
      const { data, error: invokeError } = await supabase.functions.invoke('checkout-intake', { body: { request_id: idempotency.id, payment_token: idempotency.token, ...selection } });
      if (invokeError || !data?.url) throw new Error(data?.error || 'Não foi possível preparar o pagamento agora. Nenhuma cobrança foi realizada.');
      window.location.assign(data.url as string);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o pagamento agora. Nenhuma cobrança foi realizada.');
    } finally { setBusy(false); }
  };
  return <main className="pay-page"><header className="pay-header"><div className="pay-shell pay-header-inner"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><span>Contratação segura</span></div></header><div className="pay-glow" aria-hidden="true"/><section className="pay-shell" style={{ position: 'relative', zIndex: 1, width: 'min(760px, calc(100% - 40px))', padding: '42px 0 32px' }}><div className="pay-card"><div className="pay-form-body"><CheckoutConfigurator onContinue={selection => void continueToPayment(selection)} busy={busy} error={error}/></div></div></section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DirectCheckoutPage/>);
