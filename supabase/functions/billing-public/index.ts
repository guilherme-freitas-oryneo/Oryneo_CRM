import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { buildBillingSelection, resolveStripeBillingPrices } from '../_shared/billing/catalog.ts';
import { buildCardSubscriptionCheckoutForm } from '../_shared/billing/assisted-checkout.ts';
import { createStripeBoletoSubscription, finalizeStripeBoletoInvoice } from '../_shared/billing/stripe-noncard-service.ts';
import { publicCheckoutSnapshot } from '../_shared/billing/public-status.ts';
import { boletoInvoiceView } from '../_shared/billing/invoice-public-status.ts';
import { billingEnvironmentMatchesLivemode, getBillingEnvironmentConfig, parseBillingEnvironment } from '../_shared/billing/environment.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';const headers:Record<string,string>={'Content-Type':'application/json','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 let body:{token?:string;action?:string;card_funding?:string;payment_method?:string};try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 const publicToken=typeof body.token==='string'?body.token:'';if(publicToken.length<40)return respond({error:'Link inválido.'},400);
 const {data:order,error:orderError}=await db.from('crm_billing_orders').select('*').eq('public_token_hash',await hash(publicToken)).maybeSingle();
 if(orderError){console.error('billing-public order lookup failed',{code:orderError.code,message:orderError.message});return respond({error:'Não foi possível consultar este pedido.'},503)}
 if(!order)return respond({error:'Pedido não encontrado.'},404);
 if(body.action==='record_consent'){
  const {data,error}=await db.rpc('crm_record_billing_consent',{p_token_hash:await hash(publicToken),p_version:'checkout-2026-10-19'}).single();
  const receipt=data as {ok?:boolean;recorded?:boolean}|null;
  if(error||receipt?.ok!==true){console.error('billing consent receipt failed',{code:error?.code});return respond({error:'Não foi possível registrar o aceite agora.'},503)}
  return respond({ok:true,recorded:receipt.recorded===true});
 }
 let environment:ReturnType<typeof parseBillingEnvironment>;
 let config:ReturnType<typeof getBillingEnvironmentConfig>;
 try{
  environment=parseBillingEnvironment(order.billing_environment);
  config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
 }catch(error){
  console.error('billing-public environment unavailable',{code:error instanceof Error?error.message:'unknown'});
  return respond({error:'Este ambiente de pagamento não está disponível agora.'},503);
 }
 if(body.action==='set_checkout_method'){
  const method=body.payment_method;
  if(method!=='card'&&method!=='boleto')return respond({error:'Escolha cartão ou boleto.'},400);
  if(method==='card'&&body.card_funding!=='credit'&&body.card_funding!=='debit')return respond({error:'Escolha crédito ou débito.'},400);
  if(order.status!=='awaiting_payment'||(order.commercial_consent_at&&order.selection?.payment_method!==method))return respond({error:'A forma de pagamento deste pedido não pode mais ser alterada.'},409);
  if(method==='boleto'){
   if(!order.commercial_consent_at)return respond({error:'Registre o aceite das condições recorrentes antes de emitir a primeira fatura.'},409);
   let prices:Awaited<ReturnType<typeof resolveStripeBillingPrices>>,selection:ReturnType<typeof buildBillingSelection>;
   try{prices=await resolveStripeBillingPrices(config);selection=buildBillingSelection({plan:order.selection.plan,cycle:order.selection.cycle,addons:order.selection.addons||[]},prices)}catch{return respond({error:'O catálogo do pedido não pôde ser conferido.'},503)}
   if(selection.amountTotal!==order.amount_total)return respond({error:'O valor do pedido diverge do catálogo aceito.'},409);
   const sessionId=order.stripe_checkout_session_id;
   if(sessionId){
    const r=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia'}});
    if(!r.ok)return respond({error:'Não foi possível conferir a tentativa de pagamento atual.'},503);
    const current=await r.json();
    if(current.livemode!==config.livemode||current.status==='complete')return respond({error:'Este pagamento já foi concluído ou está em outro ambiente.'},409);
    if(current.status==='open'){
     const expired=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-expire-before-boleto-${sessionId}`}});
     if(!expired.ok)return respond({error:'Não foi possível substituir a tentativa atual com segurança.'},409);
    }
   }
   const context={orderId:order.id,environment,customerEmail:order.customer_email,customerName:order.customer_name,returnUrl:`https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=${encodeURIComponent(publicToken)}&retorno=1`};
   let identities:{customerId:string;subscriptionId:string;invoiceId:string|null};
   try{identities=order.stripe_subscription_id&&order.stripe_customer_id&&order.stripe_invoice_id?{customerId:order.stripe_customer_id,subscriptionId:order.stripe_subscription_id,invoiceId:order.stripe_invoice_id}:await createStripeBoletoSubscription(selection,context,config)}catch(error){console.error('boleto subscription setup failed',{code:error instanceof Error?error.message:'unknown'});return respond({error:'Não foi possível preparar a assinatura Boleto.'},502)}
   if(!identities.invoiceId)return respond({error:'A primeira fatura ainda está sendo criada. Tente novamente.'},503);
   if(!order.stripe_invoice_id){
    let saveQuery=db.from('crm_billing_orders').update({selection:{...order.selection,payment_method:'boleto',card_funding:null},stripe_checkout_session_id:null,stripe_customer_id:identities.customerId,stripe_subscription_id:identities.subscriptionId,stripe_invoice_id:identities.invoiceId,updated_at:new Date().toISOString()}).eq('id',order.id).eq('status','awaiting_payment');
    saveQuery=sessionId?saveQuery.eq('stripe_checkout_session_id',sessionId):saveQuery.is('stripe_checkout_session_id',null);
    const saved=await saveQuery.select('id').maybeSingle();
    if(saved.error||!saved.data)return respond({error:'A assinatura foi preparada e precisa de conciliação antes de emitir a fatura.'},503);
   }
   try{
    const invoiceUrl=await finalizeStripeBoletoInvoice(identities.invoiceId,identities.customerId,identities.subscriptionId,selection,context,config);
    if(!invoiceUrl)return respond({error:'A fatura não ficou disponível. Tente novamente para concluir a emissão.'},503);
    return respond({ok:true,payment_method:'boleto',invoice_url:invoiceUrl});
   }catch(error){console.error('boleto invoice finalization failed',{code:error instanceof Error?error.message:'unknown'});return respond({error:'A assinatura existe, mas a fatura precisa de conciliação antes do envio.'},503)}
  }
  const currentSessionId=order.stripe_checkout_session_id;
  if(!currentSessionId)return respond({error:'A sessão de pagamento ainda não está pronta.'},409);
  const currentResponse=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(currentSessionId)}`,{headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia'}});
  if(!currentResponse.ok)return respond({error:'Não foi possível validar a sessão atual.'},503);
  const current=await currentResponse.json();
  if(current.livemode!==config.livemode)return respond({error:'O ambiente da sessão diverge do pedido.'},409);
  if(order.selection?.payment_method===method&&order.selection?.card_funding===body.card_funding&&current.status==='open'&&typeof current.client_secret==='string')return respond({ok:true,payment_method:'card',card_funding:body.card_funding,client_secret:current.client_secret,publishable_key:config.publishableKey});
  if(current.status==='complete')return respond({error:'Este pagamento já foi confirmado. Aguarde a atualização do pedido.'},409);
  if(current.status==='open'){
   const expired=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(currentSessionId)}/expire`,{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-expire-before-funding-${currentSessionId}`}});
   if(!expired.ok)return respond({error:'Não foi possível substituir a sessão de pagamento com segurança.'},409);
  }else if(current.status!=='expired')return respond({error:'A sessão atual está em processamento. Atualize o pedido antes de tentar novamente.'},409);
  const publicOrigin='https://guilherme-freitas-oryneo.github.io';
  const choiceKey=`card-${body.card_funding}`;
  const integrationIdentifier='oryneo_'+Array.from(`${currentSessionId}-${choiceKey}`,char=>String.fromCharCode(97+char.charCodeAt(0)%26)).join('').slice(0,40);
  let prices:Awaited<ReturnType<typeof resolveStripeBillingPrices>>,selection:ReturnType<typeof buildBillingSelection>;
  try{prices=await resolveStripeBillingPrices(config);selection=buildBillingSelection({plan:order.selection.plan,cycle:order.selection.cycle,addons:order.selection.addons||[]},prices)}catch{return respond({error:'O catálogo do pedido não pôde ser conferido.'},503)}
  if(selection.amountTotal!==order.amount_total)return respond({error:'O valor do pedido diverge do catálogo aceito.'},409);
  const form=buildCardSubscriptionCheckoutForm({orderId:order.id,environment,customerEmail:order.customer_email,funding:body.card_funding as 'credit'|'debit',priceIds:selection.stripePriceIds,returnUrl:`${publicOrigin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(publicToken)}&retorno=1`,integrationIdentifier,trafficRenewalPriceId:selection.trafficRenewalPriceId});
  const nextResponse=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-order-${environment}-${order.id}-${currentSessionId}-${choiceKey}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
  const next=await nextResponse.json();if(!nextResponse.ok||!next.id||typeof next.client_secret!=='string'||next.livemode!==config.livemode){console.error('billing-public checkout choice session unavailable',{status:nextResponse.status,code:next?.error?.code});return respond({error:'Não foi possível preparar o checkout com esse tipo de cartão.'},502)}
  const saved=await db.from('crm_billing_orders').update({selection:{...order.selection,payment_method:method,card_funding:method==='card'?body.card_funding:null},stripe_checkout_session_id:next.id,updated_at:new Date().toISOString()}).eq('id',order.id).eq('stripe_checkout_session_id',currentSessionId).eq('status','awaiting_payment').select('id').maybeSingle();
  if(saved.error||!saved.data){await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(next.id)}/expire`,{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia'}});return respond({error:'Outra atualização do pedido ocorreu. Atualize a página antes de continuar.'},409)}
  return respond({ok:true,payment_method:method,card_funding:method==='card'?body.card_funding:null,client_secret:next.client_secret,publishable_key:config.publishableKey});
 }
 const paymentMethod=order.selection?.payment_method==='boleto'?'boleto':order.selection?.payment_method==='pix'?'pix':'card';
 let invoiceUrl:string|null=null;
 let snapshot:{status:string;clientSecret:string|null};
 if(paymentMethod==='boleto'&&order.stripe_invoice_id){
  if(order.status==='awaiting_payment'){
   try{
    const stripe=await fetch('https://api.stripe.com/v1/invoices/'+encodeURIComponent(order.stripe_invoice_id),{
     headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':'2026-08-26.dahlia'},
    });
    if(!stripe.ok)return respond({error:'Não foi possível consultar o boleto agora.'},503);
    const invoice=await stripe.json();
    if(invoice.id!==order.stripe_invoice_id)return respond({error:'Referência de fatura divergente.'},503);
    const view=boletoInvoiceView(order,invoice);
    invoiceUrl=view.invoiceUrl;
    snapshot={status:view.status,clientSecret:null};
   }catch(error){
    console.error('billing-public boleto invoice validation failed',{code:error instanceof Error?error.message:'unknown'});
    return respond({error:'Não foi possível validar a fatura agora.'},503);
   }
  }else snapshot={status:order.status,clientSecret:null};
 }else if(paymentMethod==='boleto')snapshot={status:order.status,clientSecret:null};
 else{
  try {
   snapshot=await publicCheckoutSnapshot(order,async sessionId=>{
    const stripe=await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`,{headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia'}});
    if(!stripe.ok)return null;
    const session=await stripe.json();
    if(typeof session.livemode!=='boolean'||!billingEnvironmentMatchesLivemode(environment,session.livemode))return null;
    return {payment_status:typeof session.payment_status==='string'?session.payment_status:undefined,client_secret:typeof session.client_secret==='string'?session.client_secret:null};
   });
  } catch (error) {
   if(error instanceof Error&&error.message==='BILLING_SESSION_UNAVAILABLE'){
    return respond({error:'Não foi possível verificar o status do pagamento agora. Tente novamente.'},503);
   }
   console.error('billing-public checkout snapshot failed');
   return respond({error:'Não foi possível consultar este pedido agora. Tente novamente.'},503);
  }

 }
 const {status,clientSecret}=snapshot;
 const selection=order.selection as {plan:string;cycle:string};
 return respond({order:{reference:order.reference,company:order.company,customer_name:order.customer_name,status,payment_method:paymentMethod,card_funding:order.selection?.card_funding||null,currency:'brl',amount_total:order.amount_total,items:order.items,recurring:{label:`Plano ${selection.plan}`,amount_cents:(order.items as any[])[0]?.amount_cents||0,interval_label:selection.cycle==='annual'?'por ano':'por mês',next_charge_at:null},expires_at:order.expires_at,test_mode:environment==='test'},client_secret:clientSecret,publishable_key:config.publishableKey,invoice_url:invoiceUrl});
});
