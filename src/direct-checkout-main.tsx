import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './data';
import { CheckoutConfigurator, type DirectCheckoutSelection } from './billing/checkout/CheckoutConfigurator';
import './billing/payment.css';
import './billing/checkout/checkout.css';

const requestKey = 'oryneo.direct-checkout.request';
const request = () => {
  const current = window.sessionStorage.getItem(requestKey);
  if (current) {
    try { const parsed = JSON.parse(current) as { id?: string; token?: string }; if (parsed.id && parsed.token) return parsed as { id: string; token: string }; } catch { /* generate a new session request */ }
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const created = { id: crypto.randomUUID(), token: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') };
  window.sessionStorage.setItem(requestKey, JSON.stringify(created));
  return created;
};

export function DirectCheckoutPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const continueToPayment = async (selection: DirectCheckoutSelection) => {
    setBusy(true); setError('');
    try {
      const idempotency = request();
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
