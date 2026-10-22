import {useEffect,useMemo,useState} from 'react';
import {loadStripe} from '@stripe/stripe-js';
import {CheckoutElementsProvider,PaymentElement,useCheckoutElements} from '@stripe/react-stripe-js/checkout';
import {supabase} from '../data';
import {Spinner} from '../components';
import {buildBillingQuote} from '../../supabase/functions/_shared/billing/catalog';
import './financial-qa.css';

type PaymentMethod='pix'|'boleto'|'card';
type QaResult={
 method:PaymentMethod;orderId:string;reference?:string;invoiceUrl?:string;cardFunding?:'credit'|'debit';
 clientSecret?:string;publishableKey?:string;amountCents?:number;restored?:boolean;
};
const functionName='checkout-intake-noncard-test';
const money=(amount:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(amount/100);
function safeInvoiceUrl(value:unknown):string|null{
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return url.protocol==='https:'&&['invoice.stripe.com','pay.stripe.com'].includes(url.hostname)?url.toString():null}catch{return null}
}

export function FinancialQaPanel(){
 const [method,setMethod]=useState<PaymentMethod>('boleto');
 const [cardFunding,setCardFunding]=useState<'credit'|'debit'>('credit');
 const [plan,setPlan]=useState('Start');
 const [cycle,setCycle]=useState<'monthly'|'annual'>('monthly');
 const [landingPage,setLandingPage]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [result,setResult]=useState<QaResult|null>(null);
 useEffect(()=>{
  if(!new URLSearchParams(window.location.search).has('qa_return'))return;
  const orderId=sessionStorage.getItem('oryneo.qa.last_order');
  if(!orderId)return;
  let active=true;
  void supabase.functions.invoke(functionName,{body:{action:'read',order_id:orderId}}).then(({data,error})=>{
   if(!active||error||data?.environment!=='test'||data?.order?.id!==orderId)return;
   const method:PaymentMethod=data.order.method==='pix'?'pix':data.order.method==='card'?'card':'boleto';
   setResult({method,orderId,reference:data.order.reference,amountCents:data.order.amount_cents,restored:true});
   setMethod(method);setMessage('Retorno do Stripe TEST recebido. O estado será consultado no servidor; não confie apenas no retorno do navegador.');
  }).catch(()=>{if(active)setMessage('Retorno recebido; não foi possível reler o pedido TEST. Tente verificar a conciliação.');});
  return()=>{active=false};
 },[]);
 const start=async()=>{
  if(busy||result)return;
  setBusy(true);setMessage('');
  const paymentToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('').slice(0,43);
  try{
   const {data,error}=await supabase.functions.invoke(functionName,{body:{
    action:'create',request_id:crypto.randomUUID(),payment_token:paymentToken,
    customer_name:'ORYNEO Homologação',customer_email:'qa@example.com',company:'ORYNEO QA',
    plan,cycle,addons:landingPage?['landing-page']:[],payment_method:method,
    ...(method==='card'?{card_funding:cardFunding}:{}),
   }});
   if(error||data?.environment!=='test'||data?.payment_method!==method||typeof data?.order_id!=='string')throw Error('QA_CREATE_FAILED');
   sessionStorage.setItem('oryneo.qa.last_order',data.order_id);
   if(method==='boleto'){
    const invoiceUrl=safeInvoiceUrl(data.hosted_invoice_url);
    if(!data.invoice_ready||!invoiceUrl)throw Error('QA_INVOICE_LINK_MISSING');
    setResult({method,orderId:data.order_id,reference:data.reference,invoiceUrl});
    setMessage('Assinatura Boleto recorrente criada em Stripe TEST. A fatura inicial e as renovações são acompanhadas pelos eventos assinados; o teste não envia e-mail a clientes reais.');
   }else{
    if(typeof data.client_secret!=='string'||typeof data.publishable_key!=='string'||!data.publishable_key.startsWith('pk_test_'))throw Error('QA_PIX_SESSION_MISSING');
    setResult({method,orderId:data.order_id,reference:data.reference,clientSecret:data.client_secret,publishableKey:data.publishable_key});
    setMessage(method==='card'?'Checkout de cartão TEST pronto. O pedido só muda após confirmação da fatura pelo webhook assinado.':'Checkout Pix TEST pronto. A confirmação no navegador não libera o pedido; aguarde a conciliação Stripe.');
   }
  }catch{
   setMessage('Não foi possível preparar o pagamento de homologação. Nenhuma cobrança LIVE foi criada.');
  }finally{setBusy(false)}
 };
 const check=async()=>{
  if(!result||busy)return;
  setBusy(true);setMessage('Consultando Stripe TEST e aguardando o webhook assinado…');
  try{
   const {data,error}=await supabase.functions.invoke(functionName,{body:{action:'reconcile',order_id:result.orderId}});
   if(error||data?.environment!=='test')throw Error('QA_READ_FAILED');
   if(data.confirmed_paid===true)setMessage('Pagamento confirmado em Stripe TEST e registrado no pedido QA após o webhook assinado.');
   else if(data.reason==='signed_webhook_pending')setMessage('Stripe TEST informa pagamento concluído, mas o webhook assinado ainda não registrou a confirmação no pedido.');
   else if(data.reason==='bank_compensation_webhook_pending')setMessage('A fatura Stripe TEST está paga, mas a prova de compensação ainda não chegou pelo webhook assinado.');
   else setMessage(`Pagamento ainda não confirmado (${data.state||'em processamento'}). Nenhuma liberação comercial foi feita.`);
  }catch{setMessage('Não foi possível consultar a conciliação. O estado de pagamento permanece não confirmado.');}
  finally{setBusy(false)}
 };
 const clear=()=>{if(busy)return;setResult(null);setMessage('');};
 const amountPreview=buildBillingQuote({plan,cycle,addons:landingPage?['landing-page']:[]}).amountTotal;
 return <section className="page-heading financial-qa-panel">
  <div className="financial-qa-copy">
   <span className="eyebrow">AMBIENTE DE TESTE · SEM COBRANÇAS LIVE</span>
   <h1>QA financeiro<span className="heading-dot"/></h1>
   <p>Teste cartão, Pix avulso ou boleto recorrente no Stripe TEST. Pedidos e webhooks ficam isolados do CRM comercial.</p>
   {!result?.restored&&<fieldset className="qa-options" disabled={busy||!!result}>
    <legend>Configuração do pedido de teste</legend>
    <label>Plano<select aria-label="Plano" value={plan} onChange={event=>setPlan(event.target.value)}><option>Start</option><option>Growth</option><option>Scale</option></select></label>
    <label>Ciclo<select aria-label="Ciclo" value={cycle} onChange={event=>setCycle(event.target.value as 'monthly'|'annual')}><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>
    <label className="qa-addon"><input type="checkbox" checked={landingPage} onChange={event=>setLandingPage(event.target.checked)}/> Landing page (cobrança única)</label>
    <p className="qa-amount">Total inicial estimado: <strong>{money(amountPreview)}</strong></p>
    <p className="qa-disabled-addon">Gestão de tráfego permanece desabilitada neste cenário de homologação.</p>
   </fieldset>}
   {result?.restored&&Number.isSafeInteger(result.amountCents)&&<p className="qa-amount">Valor persistido no pedido QA: <strong>{money(result.amountCents!)}</strong></p>}
   {!result?.restored&&<fieldset className="qa-options" disabled={busy||!!result}>
    <legend>Forma de pagamento em TEST</legend>
    <label className="qa-method"><input type="radio" name="qa-method" value="boleto" checked={method==='boleto'} onChange={()=>setMethod('boleto')}/> Boleto — assinatura recorrente com fatura manual</label>
    <label className="qa-method"><input type="radio" name="qa-method" value="pix" checked={method==='pix'} onChange={()=>setMethod('pix')}/> Pix — cobrança avulsa</label>
    <label className="qa-method"><input type="radio" name="qa-method" value="card" checked={method==='card'} onChange={()=>setMethod('card')}/> Cartão de crédito ou débito</label>
    {method==='card'&&<label>Tipo de cartão<select aria-label="Tipo de cartão" value={cardFunding} onChange={event=>setCardFunding(event.target.value as 'credit'|'debit')}><option value="credit">Crédito</option><option value="debit">Débito</option></select></label>}
   </fieldset>}
   {message&&<p role="status" aria-live="polite">{message}</p>}
   {!result&&<button className="primary" disabled={busy} onClick={()=>void start()}>{busy?<Spinner/>:null}{method==='boleto'?'Criar assinatura QA Boleto':method==='card'?'Criar checkout QA Cartão':'Criar checkout QA Pix'}</button>}
   {result?.invoiceUrl&&<p><a href={result.invoiceUrl} target="_blank" rel="noreferrer" aria-label="Abrir fatura Stripe TEST">Abrir fatura Stripe TEST</a></p>}
   {result&&<div className="qa-result-actions"><button type="button" disabled={busy} onClick={()=>void check()}>{busy?<Spinner/>:null}Verificar pagamento no Stripe TEST</button><button type="button" disabled={busy} onClick={clear}>Criar outro cenário (mantém este no TEST)</button></div>}
  </div>
  {(result?.method==='pix'||result?.method==='card')&&result.clientSecret&&result.publishableKey&&<PixTestCheckout result={{...result,method:result.method as 'pix'|'card',clientSecret:result.clientSecret,publishableKey:result.publishableKey}} busy={busy}/>}
 </section>;
}

function PixTestCheckout({result,busy}:{result:QaResult&{method:'pix'|'card';clientSecret:string;publishableKey:string};busy:boolean}){
 const stripe=useMemo(()=>loadStripe(result.publishableKey),[result.publishableKey]);
 return <CheckoutElementsProvider stripe={stripe} options={{clientSecret:result.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#5269ff',colorText:'#242931',colorBackground:'#ffffff',borderRadius:'9px'}}}}}>
  <PixConfirmation busy={busy} orderId={result.orderId} method={result.method}/>
 </CheckoutElementsProvider>;
}
function PixConfirmation({busy,orderId,method}:{busy:boolean;orderId:string;method:'pix'|'card'}){
 const state=useCheckoutElements();
 const [confirming,setConfirming]=useState(false);
 const [error,setError]=useState('');
 const confirm=async()=>{
  if(state.type!=='success'||confirming)return;
  setConfirming(true);setError('');
  try{
   sessionStorage.setItem('oryneo.qa.last_order',orderId);
   const returnUrl=new URL(window.location.href);returnUrl.searchParams.set('qa_return','1');
   const response=await state.checkout.confirm({returnUrl:returnUrl.toString()});
   if(response.type==='error')setError(response.error.message||'A Stripe não confirmou a etapa Pix.');
   else setError('Pagamento permanece pendente até confirmação do Stripe; o navegador não libera o pedido.');
  }catch{setError('Não foi possível confirmar no Stripe. O pedido permanece não pago.');}
  finally{setConfirming(false)}
 };
 return <div className="qa-pix-checkout"><h2>{method==='card'?'Pagamento com cartão em ambiente TEST':'Pagamento Pix em ambiente TEST'}</h2>{state.type==='error'?<><p role="alert">Não foi possível carregar o formulário seguro da Stripe: {state.error.message}</p><p>O pedido QA foi criado, mas não foi pago. Recarregar a página não reutiliza esta sessão.</p><button type="button" onClick={()=>window.location.reload()}>Reiniciar a tela de teste</button></>:<><PaymentElement/><p>Use dados de teste Stripe. O resultado só é registrado após a conciliação do webhook assinado.</p>{error&&<p role="status">{error}</p>}<button type="button" disabled={confirming||busy||state.type!=='success'} onClick={()=>void confirm()}>{confirming?<Spinner/>:null}{method==='card'?'Confirmar cartão no ambiente TEST':'Confirmar Pix no ambiente TEST'}</button></>}</div>;
}
