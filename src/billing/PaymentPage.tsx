import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { Barcode, Check, CreditCard, LockKeyhole, QrCode, ShieldCheck } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { supabase } from '../data';
import './payment.css';
import { TermsDialog } from '../legal/TermsDialog';
import { paymentAsset } from './checkout/payment-assets';

export type PublicBillingItem = {
  key: string;
  label: string;
  detail: string;
  amount_cents: number;
};

export type PublicPixDetails =
  | {status:'ready';copy_paste:string;qr_code_url:string;expires_at:string}
  | {status:'expired'|'processing'};

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
  payment_method?: 'card' | 'boleto' | 'pix';
  card_funding?: 'credit'|'debit'|null;
};

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);

const paymentMethods = {
  card: { label: 'Cartão', Icon: CreditCard },
  pix: { label: 'Pix', Icon: QrCode },
  boleto: { label: 'Boleto bancário', Icon: Barcode },
} as const;

// Previously approved transparent Pix artwork, bundled locally to avoid dependency on an external image host.
function PixBrand({ className = '' }: { className?: string }) {
  return <img className={`pay-pix-brand ${className}`} src={paymentAsset.pix} alt="Pix" loading="eager" decoding="async" />;
}

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

export function PaymentPageView({ order, paymentSlot, onPay, onRefresh, busy = false, portalUrl = '', accountUrl = '', payLabel }: {
  order: PublicBillingOrder;
  paymentSlot: ReactNode;
  onPay: () => void;
  onRefresh?: () => void;
  busy?: boolean;
  portalUrl?: string;
  accountUrl?: string;
  payLabel?: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const ready = order.status === 'awaiting_payment';
  const method = paymentMethods[order.payment_method || 'card'];
  const methodLabel=order.payment_method==='card'?`Cartão de ${order.card_funding==='debit'?'débito':'crédito'}`:method.label;
  const defaultPayLabel = order.payment_method === 'pix'
    ? `Pagar ${money(order.amount_total)} com Pix`
    : `Pagar ${money(order.amount_total)} agora`;
  return <main className="pay-page">
    <header className="pay-header">
      <div className="pay-shell pay-header-inner">
        <img src="../oryneo-wordmark-mono.png" alt="ORYNEO" />
        <span>Ambiente seguro de pagamento</span>
        <div><ShieldCheck size={17}/> Pagamento processado com segurança</div>
      </div>
    </header>
    <div className="pay-shell pay-layout">
      <section className="pay-card pay-form-card">
        <div className={`pay-method-badge${order.payment_method === 'pix' ? ' pay-method-badge-pix' : ''}`} role="region" aria-label={`Forma de pagamento: ${methodLabel}`}>
          <span className="pay-method-mark" aria-hidden="true">{order.payment_method === 'pix' ? <PixBrand/> : order.payment_method==='boleto' ? <img className="pay-boleto-brand" src={paymentAsset.boleto} alt=""/> : <method.Icon size={19}/>}</span>
          <span className="pay-method-copy"><small>FORMA DE PAGAMENTO</small><strong>{methodLabel}</strong></span>
        </div>
        <div className="pay-intro">
          <small>{order.payment_method === 'pix' ? 'PAGAMENTO INSTANTÂNEO' : 'PAGAMENTO'}</small>
          <h1>{order.payment_method === 'pix' ? 'Pague com Pix.' : 'Finalize sua contratação.'}</h1>
          <p>{order.payment_method === 'pix' ? 'Escaneie o QR Code ou copie o código para pagar no aplicativo do seu banco.' : `Olá, ${order.customer_name}. Confira o pagamento acordado e conclua com segurança.`}</p>
        </div>
        <div className="pay-form-body">

          {ready ? paymentSlot : <StatusMessage status={order.status} onRefresh={onRefresh}/>}
          {order.status==='paid'&&portalUrl&&<p className="pay-help"><a href={portalUrl} rel="noreferrer">
            Acompanhar implantação e próximos passos</a></p>}
          {order.status==='paid'&&accountUrl&&<p className="pay-help"><a href={accountUrl} rel="noreferrer">Gerenciar assinatura e privacidade</a></p>} 
          {ready && order.payment_method !== 'pix' && <>
            <label className="pay-consent">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>
              <span><Check size={15}/> {order.payment_method==='boleto'?'Li e aceito as condições comerciais. Entendo que novas faturas Boleto recorrentes serão enviadas por e-mail e cada uma exige pagamento manual.':'Li e aceito as condições comerciais e a recorrência descritas neste pedido.'}</span>
            </label>
            <div className="pay-terms-access"><TermsDialog /></div>
            <button className="pay-submit" disabled={!accepted || busy} onClick={onPay}>
              <LockKeyhole size={17}/>{busy ? 'Processando…' : payLabel || defaultPayLabel}
            </button>
            {order.test_mode && <p className="pay-test-note">Ambiente de homologação · nenhum pagamento real será processado.</p>}
          </>}
        </div>
      </section>
      <aside className="pay-summary" aria-label="Resumo do pedido">
        <small className="pay-summary-kicker">RESUMO DO PEDIDO</small>
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
          {order.payment_method==='pix'?<><span>Renovação</span><strong>Cobrança avulsa gerada pelo CRM</strong><span>Valor por período</span><strong>{money(order.recurring.amount_cents)} {order.recurring.interval_label}</strong></>:<><span>Próxima cobrança</span><strong>{shortDate(order.recurring.next_charge_at) || 'Após o período inicial'}</strong><span>{order.payment_method==='boleto'?'Fatura recorrente':'Valor recorrente'}</span><strong>{money(order.recurring.amount_cents)} {order.recurring.interval_label}</strong></>}
        </div>}
        {order.items.some(item=>item.key==='traffic') && <div className="pay-recurring" style={{marginTop:12}}>
          <span>Gestão de tráfego · renovação</span><strong>Após 3 meses iniciais</strong>
          <span>Valor trimestral</span><strong>{money(order.items.find(item=>item.key==='traffic')?.amount_cents||0)} a cada 3 meses</strong>
          <span style={{gridColumn:'1 / -1',lineHeight:1.7}}>Verba de mídia paga separadamente. A renovação é independente do ciclo do plano principal.</span>
        </div>}
        <p className="pay-help">Dúvidas sobre o pedido? Fale com a ORYNEO antes de concluir.</p>
      </aside>
    </div>
    <footer className="pay-shell pay-footer"><span>ORYNEO · Crescimento em sistema.</span><span><a href="https://guilherme-freitas-oryneo.github.io/Oryneo_Landing_Page/privacidade.html">Privacidade</a> · <TermsDialog label="Termos comerciais" /> · <a href="mailto:contato@oryneo.com.br">Suporte</a></span></footer>
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
  const [invoiceUrl, setInvoiceUrl] = useState<string|null>(null);
  const [pix,setPix]=useState<PublicPixDetails|null>(null);
  const [error, setError] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [fundingBusy,setFundingBusy]=useState(false);
  const [fundingError,setFundingError]=useState('');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const stripePromise = useMemo(() => checkout ? loadStripe(checkout.publishableKey) : null, [checkout?.publishableKey]);
  useEffect(() => {
    if (!token) { setError('Este link de pagamento está incompleto.'); return; }
    let active = true;
    void (async () => {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('billing-public', { body: { action: 'read', token } });
        if (!active) return;
        if (invokeError) {
          setError('Não foi possível verificar o status do pagamento agora. Nenhum pagamento foi confirmado. Tente novamente.');
          setRetryable(true);
        } else if (!data?.order) setError('Não foi possível abrir este pedido. Confira o link ou fale com a ORYNEO.');
        else { setOrder(data.order as PublicBillingOrder); if(data.client_secret&&data.publishable_key)setCheckout({clientSecret:data.client_secret,publishableKey:data.publishable_key}); if(typeof data.invoice_url==='string')setInvoiceUrl(data.invoice_url); if(data.pix?.status==='ready'||data.pix?.status==='expired'||data.pix?.status==='processing')setPix(data.pix as PublicPixDetails); }
      } catch {
        if (!active) return;
        setError('Não foi possível verificar o status do pagamento agora. Nenhum pagamento foi confirmado. Tente novamente.');
        setRetryable(true);
      }
    })();
    return () => { active = false; };
  }, [token]);
  const chooseCheckout=async(method:'card'|'boleto'|'pix',funding?:'credit'|'debit')=>{
    if(fundingBusy||!token)return;
    setFundingBusy(true);setFundingError('');
    try{
      const consent=await supabase.functions.invoke('billing-public',{body:{action:'record_consent',token}});
      if(consent.error||!consent.data?.ok)throw new Error('Não foi possível registrar seu aceite. Tente novamente.');
      const {data,error:invokeError}=await supabase.functions.invoke('billing-public',{body:{action:'set_checkout_method',token,payment_method:method,card_funding:funding}});
      if(invokeError||!data?.ok)throw new Error(data?.error||'Não foi possível preparar essa forma de pagamento.');
      if(method==='boleto'){
        const url=typeof data.invoice_url==='string'?data.invoice_url:'';
        if(!url)throw new Error('A fatura foi criada, mas o link ainda não está disponível. Atualize esta página.');
        setInvoiceUrl(url);
      }else{
        if(!data.client_secret||!data.publishable_key)throw new Error('Não foi possível preparar o pagamento seguro.');
        setCheckout({clientSecret:data.client_secret,publishableKey:data.publishable_key});
      }
      if(method==='pix'){
        // A Checkout Session may already have a Pix PaymentIntent with a QR.
        // Read it before mounting Stripe Elements or calling confirm again.
        const {data:existing,error:readError}=await supabase.functions.invoke('billing-public',{body:{action:'read',token}});
        if(!readError&&existing?.pix?.status)setPix(existing.pix as PublicPixDetails);
      }else setPix(null);
      setOrder(current=>current?{...current,payment_method:method,card_funding:method==='card'?funding:null}:current);
    }catch(cause){setFundingError(cause instanceof Error?cause.message:'Não foi possível preparar esse tipo de cartão.')}
    finally{setFundingBusy(false)}
  };
  if (error) return <main className="pay-page pay-center"><div className="pay-error"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><h1>{retryable?'Não foi possível verificar agora.':'Não conseguimos abrir o pedido.'}</h1><p>{error}</p>{retryable&&<button className="pay-submit" onClick={()=>window.location.reload()}>Tentar novamente</button>}</div></main>;
  if (!order) return <main className="pay-page pay-center"><div className="pay-loading" aria-label="Carregando pedido"><span/>Preparando seu ambiente seguro…</div></main>;
  if(order.status==='awaiting_payment'&&(order.payment_method===undefined||(order.payment_method==='card'&&!order.card_funding)||(order.payment_method==='boleto'&&!invoiceUrl)))
    return <CheckoutMethodPicker order={order} onContinue={chooseCheckout} busy={fundingBusy} error={fundingError}/>;
  if(order.status==='awaiting_payment'&&order.payment_method==='boleto'&&invoiceUrl)
    return <BoletoPayment order={order} invoiceUrl={invoiceUrl}/>;
  if(order.status==='awaiting_payment'&&order.payment_method==='pix'&&pix)
    return <PixPayment order={order} pix={pix}/>;
  if(order.status==='awaiting_payment'&&!checkout)return <main className="pay-page pay-center"><div className="pay-error"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><h1>Não foi possível carregar o pagamento agora.</h1><p>A sessão segura ainda não está disponível. Isso não significa que seu pagamento foi recusado ou confirmado. Consulte novamente antes de tentar outra cobrança.</p><button className="pay-submit" type="button" onClick={()=>window.location.reload()}>Consultar novamente</button></div></main>;
  if(!checkout)return <PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={order.status==='paid'?deliveryLink():''} accountUrl={order.status==='paid'?offboardingLink():''}/>;
  return <CheckoutElementsProvider stripe={stripePromise} options={{clientSecret:checkout.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#4357E8',colorText:'#242931',colorBackground:'#ffffff',borderRadius:'9px',fontFamily:'Inter, Arial, sans-serif'}}}}}>
    <StripePayment order={order}/>
  </CheckoutElementsProvider>;
}

function CheckoutMethodPicker({order,onContinue,busy,error}:{order:PublicBillingOrder;onContinue:(method:'card'|'boleto'|'pix',funding?:'credit'|'debit')=>void;busy:boolean;error:string}){
 const [choice,setChoice]=useState<'credit'|'debit'|'boleto'|'pix'>(order.payment_method==='boleto'?'boleto':order.payment_method==='pix'?'pix':'credit');
 const [methodAccepted,setMethodAccepted]=useState(false);
 return <main className="pay-page pay-center"><section className="pay-card funding-picker"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><small>FORMA DE PAGAMENTO</small><h1>Como você vai pagar?</h1><p>Pedido {order.reference} · {money(order.amount_total)}. Escolha a forma de pagamento para preparar sua cobrança.</p><fieldset><legend>Escolha uma opção</legend><label><input type="radio" name="checkout-method" checked={choice==='credit'} onChange={()=>setChoice('credit')}/><span><strong>Cartão de crédito</strong><small>Renovação conforme a periodicidade do plano.</small></span></label><label><input type="radio" name="checkout-method" checked={choice==='debit'} onChange={()=>setChoice('debit')}/><span><strong>Cartão de débito</strong><small>O emissor precisa permitir a transação e a recorrência escolhida.</small></span></label><label><input type="radio" name="checkout-method" checked={choice==='boleto'} onChange={()=>setChoice('boleto')}/><span><strong>Boleto recorrente</strong><small>Uma nova fatura chega por e-mail a cada período e exige pagamento manual.</small></span></label><label><input type="radio" name="checkout-method" checked={choice==='pix'} onChange={()=>setChoice('pix')}/><span><strong>Pix</strong><small>Pagamento único por QR Code ou Pix copia e cola. Não há renovação automática.</small></span></label></fieldset><label className="pay-consent"><input type="checkbox" checked={methodAccepted} onChange={e=>setMethodAccepted(e.target.checked)}/><span><Check size={15}/> Li e aceito as condições comerciais e a forma de pagamento selecionada.</span></label><div className="pay-terms-access"><TermsDialog /></div>{error&&<p role="alert" className="pay-inline-error">{error}</p>}<button className="pay-submit" disabled={busy||!methodAccepted} onClick={()=>choice==='boleto'?onContinue('boleto'):choice==='pix'?onContinue('pix'):onContinue('card',choice)}><LockKeyhole size={17}/>{busy?'Preparando checkout…':'Continuar'}</button><p className="pay-test-note">O Pix é avulso e depende da confirmação bancária. No cartão, o Checkout Stripe bloqueia o tipo que você não selecionou. A aprovação depende do emissor.</p></section></main>;
}

/** Displays Stripe's existing Pix PaymentIntent, without another confirmation or charge. */
export function PixPayment({order,pix}:{order:PublicBillingOrder;pix:PublicPixDetails}){
  const [status,setStatus]=useState<PublicBillingOrder['status']>(order.status);
  const [now,setNow]=useState(Date.now());
  const [copied,setCopied]=useState(false);
  const [copyError,setCopyError]=useState('');
  const [qrImageFailed,setQrImageFailed]=useState(false);
  const copyInput=useRef<HTMLInputElement>(null);
  const expires=pix.status==='ready'?new Date(pix.expires_at).getTime():0;
  const expired=pix.status==='expired'||(pix.status==='ready'&&(!Number.isFinite(expires)||expires<=now));
  useEffect(()=>{
    if(pix.status!=='ready')return;
    const timer=setInterval(()=>setNow(Date.now()),15000);
    return()=>clearInterval(timer);
  },[pix.status]);
  useEffect(()=>{
    if(pix.status!=='ready'||status!=='awaiting_payment')return;
    const token=new URLSearchParams(window.location.search).get('token');
    if(!token)return;
    let active=true,timer:ReturnType<typeof setTimeout>|undefined;
    const check=async()=>{
      try{
        const {data,error}=await supabase.functions.invoke('billing-public',{body:{action:'read',token}});
        if(!active)return;
        if(!error&&['paid','processing','payment_failed','canceled','expired'].includes(data?.order?.status)){
          setStatus(data.order.status as PublicBillingOrder['status']);return;
        }
        if(!error&&data?.pix?.status==='processing'){setStatus('processing');return;}
      }catch{/* The server/webhook alone authorizes payment completion. */}
      if(active)timer=setTimeout(()=>void check(),5000);
    };
    timer=setTimeout(()=>void check(),5000);
    return()=>{active=false;if(timer)clearTimeout(timer)};
  },[pix.status,status]);
  if(status!=='awaiting_payment'||pix.status==='processing')
    return <PaymentPageView order={{...order,status:pix.status==='processing'&&status==='awaiting_payment'?'processing':status}} paymentSlot={null}
      onPay={()=>undefined} onRefresh={()=>window.location.reload()}
      portalUrl={status==='paid'?deliveryLink():''} accountUrl={status==='paid'?offboardingLink():''}/>;
  const copy=async()=>{
    if(pix.status!=='ready'||expired)return;
    setCopyError('');
    try{
      if(!navigator.clipboard?.writeText)throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(pix.copy_paste);setCopied(true);
    }catch{
      copyInput.current?.focus();copyInput.current?.select();
      setCopyError('Selecione e copie o código manualmente.');
    }
  };
  const slot=expired?<div className="pay-pix-expired" role="alert"><QrCode size={30}/><strong>Este Pix expirou.</strong><p>O código anterior não pode mais ser utilizado. Solicite um novo link à equipe ORYNEO.</p></div>:
    pix.status==='ready'?<section className="pay-pix-generated" aria-label="QR Code e Pix Copia e Cola">
      <div className="pay-pix-generated-top"><PixBrand/><span>Pix gerado pela Stripe</span></div>
      {!qrImageFailed?<img className="pay-pix-qr-image" src={pix.qr_code_url} width="248" height="248" alt="QR Code Pix deste pedido, gerado pela Stripe" loading="eager" onError={()=>setQrImageFailed(true)}/>:<p className="pay-pix-image-fallback" role="status">Não foi possível carregar a imagem do QR. Você ainda pode usar o Pix Copia e Cola abaixo.</p>}
      <p className="pay-pix-expiration">Válido até {new Date(pix.expires_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}.</p>
      <label className="pay-pix-copy-label" htmlFor="pix-copy-code">Pix Copia e Cola</label>
      <div className="pay-pix-copy-row"><input ref={copyInput} id="pix-copy-code" readOnly value={pix.copy_paste} aria-label="Código Pix Copia e Cola"/><button type="button" onClick={()=>void copy()}>{copied?'Código copiado':'Copiar código'}</button></div>
      {copyError&&<p role="status" className="pay-pix-copy-error">{copyError}</p>}
      <p className="pay-pix-waiting" role="status">Aguardando pagamento pelo seu banco. A confirmação é automática após a conciliação.</p>
    </section>:null;
  return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>undefined} onRefresh={()=>window.location.reload()}/>;
}

/** The bank settles the invoice asynchronously. Opening the Stripe link is not payment confirmation. */
export function BoletoPayment({order,invoiceUrl}:{order:PublicBillingOrder;invoiceUrl:string}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const pay=async()=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   const url=new URL(invoiceUrl);
   if(url.protocol!=='https:'||!['invoice.stripe.com','pay.stripe.com'].includes(url.hostname))
    throw Error('Link de boleto inválido.');
   const token=new URLSearchParams(window.location.search).get('token');
   if(!token)throw Error('Link de pagamento inválido.');
   const {data, error:invokeError}=await supabase.functions.invoke('billing-public',{body:{action:'record_consent',token}});
   if(invokeError||!data?.ok)throw Error('Não foi possível registrar o aceite. Tente novamente.');
   window.location.assign(url.toString());
  }catch(cause){
   setError(cause instanceof Error?cause.message:'Não foi possível abrir o boleto.');
   setBusy(false);
  }
 };
  const slot=<div className="pay-element">
  <div className="pay-element-head"><img className="pay-boleto-brand-inline" src={paymentAsset.boleto} alt=""/><span>Boleto bancário</span><small>Fatura Stripe disponível</small></div>
  <div className="pay-boleto-guidance" aria-label="Orientações para pagamento do boleto">
    <strong>Seu boleto está disponível na fatura segura</strong>
    <p>Abra a fatura emitida pela Stripe para consultar o documento, o código de barras e o vencimento. Confira os dados antes de pagar.</p>
    <p>O pagamento é manual a cada período. A compensação bancária pode levar até um dia útil e a liberação do serviço depende da confirmação financeira.</p>
  </div>
  {error&&<p className="pay-inline-error" role="alert">{error}</p>}
 </div>;
 return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>void pay()} busy={busy} payLabel="Abrir boleto seguro"/>;
}

export function StripePayment({order}:{order:PublicBillingOrder}){
  const result=useCheckoutElements();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [completion,setCompletion]=useState<'idle'|'awaiting_pix'|'processing'|'paid'>('idle');
  const [pixStatus,setPixStatus]=useState<'awaiting_payment'|'processing'|'expired'|'payment_failed'>('awaiting_payment');
  const [pollingError,setPollingError]=useState(false);
  const [pixLookupError,setPixLookupError]=useState(false);
  const [pixElementReady,setPixElementReady]=useState(false);
  const autoPixAttempted=useRef(false);
  const confirming=useRef(false);

  useEffect(()=>{
    if(completion!=='processing'&&completion!=='awaiting_pix')return;
    const token=new URLSearchParams(window.location.search).get('token');
    if(!token){setPollingError(true);return;}
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
        if(!lookupError&&data?.order?.status==='processing'){setPollingError(false);setPixStatus('processing');}
        if(lookupError)setPollingError(true);
        else if(!data?.order?.status){setPollingError(true);setPixLookupError(true);}
        else{setPollingError(false);setPixLookupError(false);}
        if(!lookupError&&(data?.order?.status==='expired'||data?.order?.status==='payment_failed')){
          setPixStatus(data.order.status);
          setCompletion('processing');
          return;
        }
      }catch{if(active)setPollingError(true);/* A confirmação financeira cabe ao servidor. */}
      if(active)timer=setTimeout(()=>void verify(),attempts++<8?2000:10000);
    };
    void verify();
    return()=>{active=false;if(timer)clearTimeout(timer)};
  },[completion]);

  const pay=async()=>{
    if(result.type!=='success'||busy||confirming.current||completion!=='idle'||(order.payment_method==='pix'&&!pixElementReady))return;
    confirming.current=true;
    setBusy(true);
    setError('');
    try{
      const token=new URLSearchParams(window.location.search).get('token');
      if(!token)throw new Error('Link de pagamento inválido. Atualize a página e tente novamente.');
      const {data:consent,error:consentError}=await supabase.functions.invoke('billing-public',{body:{action:'record_consent',token}});
      if(consentError||!consent?.ok)throw new Error('Não foi possível registrar o aceite anterior. Nenhum pagamento foi confirmado. Tente novamente.');
      // The Checkout Session already carries return_url. Passing it again here
      // makes Stripe reject Pix confirmation with a duplicate return_url error.
      const confirmation=await result.checkout.confirm();
      if(confirmation.type==='error'){
        // Do not expose an unconfirmed Stripe PaymentElement QR placeholder.
        // Logging only the error classification avoids exposing client secrets.
        console.warn('oryneo.checkout.confirm.error',{code:confirmation.error.code});
        setError(confirmation.error.message||(order.payment_method==='pix'?'O Pix ainda não pôde ser gerado. Tente novamente.':'Confira os dados de pagamento e tente novamente.'));
        return;
      }
      // Pix instructions are rendered inside Stripe's PaymentElement after confirm().
      // Do not unmount it before the customer has scanned or copied the code.
      setCompletion(order.payment_method==='pix'?'awaiting_pix':'processing');
    }catch(cause){
      setError(cause instanceof Error&&cause.message?cause.message:'Não foi possível confirmar o pagamento. Tente novamente.');
    }finally{
      confirming.current=false;
      setBusy(false);
    }
  };

  // A resolved Checkout context is not proof that the embedded PaymentElement
  // is ready. Confirm Pix only after Stripe fires PaymentElement.onReady.
  // This also guards React effect replays against duplicate payment attempts.
  useEffect(()=>{
    if(order.payment_method!=='pix'||result.type!=='success'||!pixElementReady||autoPixAttempted.current||completion!=='idle')return;
    autoPixAttempted.current=true;
    void pay();
  },[order.payment_method,result.type,pixElementReady,completion]);

  if(completion!=='idle'&&completion!=='awaiting_pix')return <PaymentPageView order={{...order,status:completion==='paid'?'paid':pixStatus==='expired'||pixStatus==='payment_failed'?pixStatus:'processing'}} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={completion==='paid'?deliveryLink():''} accountUrl={completion==='paid'?offboardingLink():''}/>;
  const slot=<div className={`pay-element${order.payment_method === 'pix' ? ' pay-element-pix' : ''}`}>
    <div className="pay-element-head">
      {order.payment_method==='boleto'?<Barcode size={17}/>:order.payment_method==='pix'?<PixBrand className="pay-pix-brand-inline"/>:<CreditCard size={17}/>}
      <span>{order.payment_method==='pix'?'Pagamento via Pix':order.payment_method==='boleto'?'Boleto bancário':`Cartão de ${order.card_funding==='debit'?'débito':'crédito'}`}</span>
      <small>Campos seguros da Stripe</small>
    </div>
    {order.payment_method==='card' && <div className="pay-card-brands pay-card-brands-compact" role="note" aria-label="Bandeiras de cartão">
      <span className="pay-brands-art" aria-hidden="true"><img src={paymentAsset.visa} alt=""/><img src={paymentAsset.mastercard} alt=""/></span>
      <span>Visa, Mastercard e outras bandeiras compatíveis. Identificação realizada pela Stripe.</span>
    </div>}
    {completion==='awaiting_pix' && <div className="pay-pix-guidance" role="status" aria-live="polite"><strong>{pixStatus==='processing'?'Aguardando confirmação financeira':'Escaneie o QR Code ou copie o Pix abaixo'}</strong>{pollingError&&<p>Não foi possível consultar o status agora. Evite pagar novamente.</p>}</div>}

    {pixLookupError&&completion==='awaiting_pix'&&<p className="pay-inline-error" role="status">O servidor ainda não retornou um status verificável. O código Pix continua abaixo; não realize outro pagamento.</p>}
    {result.type==='loading'?(order.payment_method==='pix'?<div className="pay-qr-preparing" role="status"><span className="pay-spinner" aria-hidden="true"/> Preparando seu QR Code e Pix Copia e Cola…</div>:<PaymentSkeleton/>):result.type==='error'?<p role="alert">{result.error.message||'Não foi possível carregar os campos seguros.'}</p>:order.payment_method==='pix'?<>
      <div className={`pay-pix-stripe-host${completion==='awaiting_pix'?' is-ready':' is-preparing'}`} aria-hidden={completion!=='awaiting_pix'}>
        <PaymentElement onReady={()=>setPixElementReady(true)} onLoadError={()=>setError('A área segura do Pix não carregou. Atualize a página e tente novamente.')} />
      </div>
      {completion==='idle'&&!error&&<div className="pay-qr-preparing" role="status" aria-live="polite"><span className="pay-spinner" aria-hidden="true"/>{pixElementReady?'Gerando o QR Code e o Pix Copia e Cola…':'Conectando à Stripe para gerar seu Pix…'}</div>}
    </>:<PaymentElement/>}
    {error&&<p className="pay-inline-error" role="alert">{error}</p>}
    {order.payment_method==='pix'&&error&&<button type="button" className="pay-retry" disabled={busy} onClick={()=>result.type==='success'&&pixElementReady?void pay():window.location.reload()}>Tentar gerar Pix novamente</button>}
  </div>;
  return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>void pay()} onRefresh={()=>window.location.reload()} busy={busy||result.type!=='success'||completion==='awaiting_pix'} payLabel={completion==='awaiting_pix'?'Aguardando pagamento Pix…':undefined}/>;
}
