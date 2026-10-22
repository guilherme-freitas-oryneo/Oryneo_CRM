import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Barcode, Check, CreditCard, LockKeyhole, QrCode, ShieldCheck } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { supabase } from '../data';
import './payment.css';
import { TermsDialog } from '../legal/TermsDialog';

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

// Official Banco Central Pix asset; preserve the brand artwork without recreating its geometry.
const PIX_OFFICIAL_LOGO = 'https://www.bcb.gov.br/content/estabilidadefinanceira/piximg/logo_pix.png';
function PixBrand({ className = '' }: { className?: string }) {
  return <img className={`pay-pix-brand ${className}`} src={PIX_OFFICIAL_LOGO} alt="Pix" loading="eager" decoding="async" />;
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
          <span className="pay-method-mark" aria-hidden="true">{order.payment_method === 'pix' ? <PixBrand/> : <method.Icon size={19}/>}</span>
          <span className="pay-method-copy"><small>FORMA DE PAGAMENTO</small><strong>{methodLabel}</strong></span>
        </div>
        <div className="pay-intro">
          <small>{order.payment_method === 'pix' ? 'PAGAMENTO INSTANTÂNEO' : 'PAGAMENTO'}</small>
          <h1>{order.payment_method === 'pix' ? 'Conclua seu pagamento com Pix.' : 'Finalize sua contratação.'}</h1>
          <p>Olá, {order.customer_name}. Revise os dados acordados e conclua com segurança. O escopo não pode ser alterado nesta etapa.</p>
        </div>
        <div className="pay-form-body">
          {ready && order.payment_method === 'pix' && <div className="pay-pix-guidance"><strong>Pagamento Pix seguro</strong><p>Após confirmar, o Stripe apresenta as instruções para pagar pelo aplicativo do seu banco. Confira o valor e o destinatário antes de autorizar. A ORYNEO só confirmará a compra quando receber a confirmação financeira.</p></div>}
          {ready ? paymentSlot : <StatusMessage status={order.status} onRefresh={onRefresh}/>}
          {order.status==='paid'&&portalUrl&&<p className="pay-help"><a href={portalUrl} rel="noreferrer">
            Acompanhar implantação e próximos passos</a></p>}
          {order.status==='paid'&&accountUrl&&<p className="pay-help"><a href={accountUrl} rel="noreferrer">Gerenciar assinatura e privacidade</a></p>} 
          {ready && <>
            <label className="pay-consent">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>
              <span><Check size={15}/> {order.payment_method==='pix'?'Li e aceito as condições comerciais. Entendo que o Pix é avulso e não renova automaticamente.':order.payment_method==='boleto'?'Li e aceito as condições comerciais. Entendo que novas faturas Boleto recorrentes serão enviadas por e-mail e cada uma exige pagamento manual.':'Li e aceito as condições comerciais e a recorrência descritas neste pedido.'}</span>
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
        else { setOrder(data.order as PublicBillingOrder); if(data.client_secret&&data.publishable_key)setCheckout({clientSecret:data.client_secret,publishableKey:data.publishable_key}); if(typeof data.invoice_url==='string')setInvoiceUrl(data.invoice_url); }
      } catch {
        if (!active) return;
        setError('Não foi possível verificar o status do pagamento agora. Nenhum pagamento foi confirmado. Tente novamente.');
        setRetryable(true);
      }
    })();
    return () => { active = false; };
  }, [token]);
  const chooseCheckout=async(method:'card'|'boleto',funding?:'credit'|'debit')=>{
    if(fundingBusy||!token)return;
    setFundingBusy(true);setFundingError('');
    try{
      if(method==='boleto'){
        const consent=await supabase.functions.invoke('billing-public',{body:{action:'record_consent',token}});
        if(consent.error||!consent.data?.ok)throw new Error('Não foi possível registrar seu aceite. Tente novamente.');
      }
      const {data,error:invokeError}=await supabase.functions.invoke('billing-public',{body:{action:'set_checkout_method',token,payment_method:method,card_funding:funding}});
      if(invokeError||!data?.ok)throw new Error(data?.error||'Não foi possível preparar essa forma de pagamento.');
      if(method==='boleto'){
        const url=typeof data.invoice_url==='string'?data.invoice_url:'';
        if(!url)throw new Error('A fatura foi criada, mas o link ainda não está disponível. Atualize esta página.');
        setInvoiceUrl(url);
      }else{
        if(!data.client_secret||!data.publishable_key)throw new Error('Não foi possível preparar esse tipo de cartão.');
        setCheckout({clientSecret:data.client_secret,publishableKey:data.publishable_key});
      }
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
  if(order.status==='awaiting_payment'&&!checkout)return <PaymentPageView order={{...order,status:'payment_failed'}} paymentSlot={null} onPay={()=>undefined}/>;
  if(!checkout)return <PaymentPageView order={order} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={order.status==='paid'?deliveryLink():''} accountUrl={order.status==='paid'?offboardingLink():''}/>;
  return <CheckoutElementsProvider stripe={stripePromise} options={{clientSecret:checkout.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#5269ff',colorText:'#242931',colorBackground:'#ffffff',borderRadius:'9px',fontFamily:'DM Sans, sans-serif'}}}}}>
    <StripePayment order={order}/>
  </CheckoutElementsProvider>;
}

function CheckoutMethodPicker({order,onContinue,busy,error}:{order:PublicBillingOrder;onContinue:(method:'card'|'boleto',funding?:'credit'|'debit')=>void;busy:boolean;error:string}){
 const [choice,setChoice]=useState<'credit'|'debit'|'boleto'>(order.payment_method==='boleto'?'boleto':'credit');
 const [boletoAccepted,setBoletoAccepted]=useState(false);
 return <main className="pay-page pay-center"><section className="pay-card funding-picker"><img src="../oryneo-wordmark-mono.png" alt="ORYNEO"/><small>FORMA DE PAGAMENTO</small><h1>Como você vai pagar?</h1><p>Pedido {order.reference} · {money(order.amount_total)}. Escolha a forma de pagamento para preparar sua cobrança.</p><fieldset><legend>Escolha uma opção</legend><label><input type="radio" name="checkout-method" checked={choice==='credit'} onChange={()=>setChoice('credit')}/><span><strong>Cartão de crédito</strong><small>Renovação conforme a periodicidade do plano.</small></span></label><label><input type="radio" name="checkout-method" checked={choice==='debit'} onChange={()=>setChoice('debit')}/><span><strong>Cartão de débito</strong><small>O emissor precisa permitir a transação e a recorrência escolhida.</small></span></label><label><input type="radio" name="checkout-method" checked={choice==='boleto'} onChange={()=>setChoice('boleto')}/><span><strong>Boleto recorrente</strong><small>Uma nova fatura chega por e-mail a cada período e exige pagamento manual.</small></span></label></fieldset>{choice==='boleto'&&<label className="pay-consent"><input type="checkbox" checked={boletoAccepted} onChange={e=>setBoletoAccepted(e.target.checked)}/><span><Check size={15}/> Aceito as condições comerciais e as faturas recorrentes por Boleto enviadas por e-mail.</span></label>}{error&&<p role="alert" className="pay-inline-error">{error}</p>}<button className="pay-submit" disabled={busy||(choice==='boleto'&&!boletoAccepted)} onClick={()=>choice==='boleto'?onContinue('boleto'):onContinue('card',choice)}><LockKeyhole size={17}/>{busy?'Preparando checkout…':'Continuar'}</button><p className="pay-test-note">No cartão, o Checkout Stripe bloqueia o tipo que você não selecionou. A aprovação depende do emissor.</p></section></main>;
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
  <div className="pay-element-head"><Barcode size={17}/><span>Boleto bancário</span><small>Fatura Stripe disponível</small></div>
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

  useEffect(()=>{
    if(completion!=='processing'&&completion!=='awaiting_pix')return;
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
      const token=new URLSearchParams(window.location.search).get('token');
      if(!token)throw new Error('Link de pagamento inválido. Atualize a página e tente novamente.');
      const {data:consent,error:consentError}=await supabase.functions.invoke('billing-public',{body:{action:'record_consent',token}});
      if(consentError||!consent?.ok)throw new Error('Não foi possível registrar seu aceite agora. Nenhum pagamento foi confirmado. Tente novamente.');
      // The Checkout Session already carries return_url. Passing it again here
      // makes Stripe reject Pix confirmation with a duplicate return_url error.
      const confirmation=await result.checkout.confirm();
      if(confirmation.type==='error'){
        setError(confirmation.error.message||'Confira os dados de pagamento e tente novamente.');
        return;
      }
      // Pix instructions are rendered inside Stripe's PaymentElement after confirm().
      // Do not unmount it before the customer has scanned or copied the code.
      setCompletion(order.payment_method==='pix'?'awaiting_pix':'processing');
    }catch(cause){
      setError(cause instanceof Error&&cause.message?cause.message:'Não foi possível confirmar o pagamento. Tente novamente.');
    }finally{
      setBusy(false);
    }
  };

  if(completion!=='idle'&&completion!=='awaiting_pix')return <PaymentPageView order={{...order,status:completion}} paymentSlot={null} onPay={()=>undefined} onRefresh={()=>window.location.reload()} portalUrl={completion==='paid'?deliveryLink():''} accountUrl={completion==='paid'?offboardingLink():''}/>;
  const slot=<div className={`pay-element${order.payment_method === 'pix' ? ' pay-element-pix' : ''}`}>
    <div className="pay-element-head">
      {order.payment_method==='boleto'?<Barcode size={17}/>:order.payment_method==='pix'?<PixBrand className="pay-pix-brand-inline"/>:<CreditCard size={17}/>}
      <span>{order.payment_method==='pix'?'Pagamento via Pix':order.payment_method==='boleto'?'Boleto bancário':`Cartão de ${order.card_funding==='debit'?'débito':'crédito'}`}</span>
      <small>Campos seguros da Stripe</small>
    </div>
    {order.payment_method==='card' && <div className="pay-card-brands" role="note" aria-label="Identificação de bandeira do cartão">
      <div className="pay-card-brands-heading"><ShieldCheck size={16}/><strong>Identificação segura do cartão</strong></div>
      <p>A bandeira é identificada automaticamente nos campos protegidos da Stripe enquanto você digita. Visa e Mastercard são as bandeiras previstas para este checkout.</p>
      <p>Os dados do cartão são inseridos diretamente na Stripe; a ORYNEO não recebe nem armazena o número completo.</p>
    </div>}
    {completion==='awaiting_pix' && <div className="pay-pix-guidance" role="status"><strong>Pix gerado — aguardando pagamento</strong><p>Use o QR Code ou o código Pix exibido pela Stripe abaixo. Mantenha esta página aberta ou volte pelo mesmo link para consultar a confirmação. Não gere uma segunda cobrança.</p></div>}
    {order.payment_method==='pix' && <div className="pay-pix-instructions"><p className="pay-pix-note">O QR Code e o Pix Copia e Cola são disponibilizados pelo Stripe após a confirmação desta etapa. Utilize exclusivamente o código exibido na área segura de pagamento.</p><ol><li>Confirme o pagamento para gerar as instruções.</li><li>Abra o aplicativo do seu banco e escolha pagar com Pix.</li><li>Escaneie o QR Code ou use o Pix Copia e Cola fornecido pelo Stripe.</li><li>Confira o valor e aguarde a confirmação do pagamento.</li></ol></div>}
    {result.type==='loading'?<PaymentSkeleton/>:result.type==='error'?<p role="alert">{result.error.message||'Não foi possível carregar os campos seguros.'}</p>:<PaymentElement/>}
    {error&&<p className="pay-inline-error" role="alert">{error}</p>}
  </div>;
  return <PaymentPageView order={order} paymentSlot={slot} onPay={()=>void pay()} onRefresh={()=>window.location.reload()} busy={busy||result.type!=='success'||completion==='awaiting_pix'} payLabel={completion==='awaiting_pix'?'Aguardando pagamento Pix…':undefined}/>;
}
