/**
 * Isolated TEST-only non-card checkout. Never uses STRIPE_LIVE_SECRET_KEY.
 * Requires authenticated CRM membership and Stripe TEST method enablement.
 * This function must remain undeployed until the invoice migration is verified.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {parseDirectCheckoutInput} from '../_shared/billing/direct-checkout.ts';
import {buildBillingSelection,resolveStripeBillingPrices} from '../_shared/billing/catalog.ts';
import {getBillingEnvironmentConfig} from '../_shared/billing/environment.ts';
import {checkStripeMethodAvailability} from '../_shared/billing/stripe-method-availability.ts';
import {createStripeBoletoSubscription,createStripePixCheckout,finalizeStripeBoletoInvoice} from '../_shared/billing/stripe-noncard-service.ts';
import type {PaymentOrderContext,ServerBillingSelection} from '../_shared/billing/stripe-payment-forms.ts';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','http://localhost:4175']);
const origin='https://guilherme-freitas-oryneo.github.io';
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const reference=()=>`ORY-TEST-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
type Created={order_id:string;reference:string;stripe_checkout_session_id:string|null};

Deno.serve(async(req)=>{
 const requestOrigin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(requestOrigin))headers['Access-Control-Allow-Origin']=requestOrigin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(requestOrigin&&!origins.has(requestOrigin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 if(Number(req.headers.get('content-length')||0)>8000)return respond({error:'Solicitação muito longa.'},413);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return respond({error:'Autenticação CRM necessária para homologação.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError)return respond({error:'Não foi possível validar o acesso.'},503);
 if(!member)return respond({error:'Acesso não autorizado.'},403);
 try{
  const input=parseDirectCheckoutInput(await req.json());
  if(input.payment_method==='card')return respond({error:'Use o fluxo de cartão existente.'},422);
  if(input.addons.includes('traffic'))return respond({error:'A renovação trimestral de tráfego ainda não foi homologada para este método.'},422);
  const config=getBillingEnvironmentConfig('test',name=>Deno.env.get(name));
  const availability=await checkStripeMethodAvailability(input.payment_method,config);
  if(!availability.available)return respond({error:'Método indisponível na Stripe TEST.',reason:availability.reason},503);
  const prices=await resolveStripeBillingPrices(config);
  const selection=buildBillingSelection({plan:input.plan,cycle:input.cycle,addons:input.addons},prices);
  const orderPayload={
   reference:reference(),catalog_version:selection.catalogVersion,traffic_renewal_price_id:null,
   selection:{plan:selection.plan,cycle:selection.cycle,addons:input.addons,payment_method:input.payment_method},
   items:selection.items.map(({stripePriceId,...item})=>({key:item.key,label:item.label,detail:item.detail,amount_cents:item.amountCents})),
   amount_total:selection.amountTotal,customer_name:input.customer_name,customer_email:input.customer_email,company:input.company,
  };
  const dealPayload={title:`Homologação financeira · ${input.company}`.slice(0,160),company:input.company,contact:input.customer_name,email:input.customer_email,phone:'',value_cents:selection.amountTotal,quote:{plan:selection.plan,cycle:selection.cycle,addons:input.addons},notes:'Pedido financeiro TEST. Não cobrar nem provisionar em produção.'};
  const {data:createdRaw,error:createError}=await db.rpc('crm_create_direct_checkout',{
   p_request_id:input.request_id,p_fingerprint:await sha256(input.customer_email+':'+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
   p_token_hash:await sha256(input.payment_token),p_deal_data:dealPayload,p_order:orderPayload,p_environment:'test',
  }).single();
  const created=createdRaw as Created|null;
  if(createError||!created?.order_id)return respond({error:'Não foi possível criar o pedido TEST.'},503);
  const {data:existing,error:existingError}=await db.from('crm_billing_orders')
   .select('id,selection,billing_environment,amount_total,customer_email,stripe_checkout_session_id,stripe_subscription_id,stripe_invoice_id,stripe_customer_id')
   .eq('id',created.order_id).single();
  if(existingError||!existing)return respond({error:'Pedido TEST indisponível.'},503);
  if(existing.billing_environment!=='test'||existing.selection?.payment_method!==input.payment_method||
     existing.amount_total!==selection.amountTotal||existing.customer_email!==input.customer_email)
    return respond({error:'Solicitação já utilizada com condições diferentes.'},409);
  const url=`${origin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(input.payment_token)}`;
  const context:PaymentOrderContext={orderId:created.order_id,environment:'test',customerEmail:input.customer_email,customerName:input.customer_name,returnUrl:url+'&retorno=1'};
  const serverSelection:ServerBillingSelection={plan:selection.plan,cycle:selection.cycle,amountTotal:selection.amountTotal,trafficRenewalPriceId:null,items:selection.items};
  if(input.payment_method==='pix'){
   if(!existing.stripe_checkout_session_id){
    const checkout=await createStripePixCheckout(serverSelection,context,config);
    const {data:linked,error:linkError}=await db.from('crm_billing_orders')
     .update({stripe_checkout_session_id:checkout.sessionId,updated_at:new Date().toISOString()})
     .eq('id',created.order_id).eq('billing_environment','test').is('stripe_checkout_session_id',null).select('id').maybeSingle();
    if(linkError||!linked)return respond({error:'Checkout TEST criado, mas o vínculo exige conciliação.'},503);
   }
   return respond({ok:true,environment:'test',payment_method:'pix',reference:created.reference,url});
  }
  let boletoIds={customerId:existing.stripe_customer_id as string|null,subscriptionId:existing.stripe_subscription_id as string|null,invoiceId:existing.stripe_invoice_id as string|null};
  if(!existing.stripe_subscription_id){
   const boleto=await createStripeBoletoSubscription(serverSelection,context,config);
   boletoIds={customerId:boleto.customerId,subscriptionId:boleto.subscriptionId,invoiceId:boleto.invoiceId};
   if(!boleto.invoiceId)return respond({error:'Assinatura TEST criada, mas a primeira fatura exige conciliação.'},503);
   const {data:linked,error:linkError}=await db.from('crm_billing_orders').update({
    stripe_customer_id:boleto.customerId,stripe_subscription_id:boleto.subscriptionId,stripe_invoice_id:boleto.invoiceId,
    updated_at:new Date().toISOString(),
   }).eq('id',created.order_id).eq('billing_environment','test').is('stripe_subscription_id',null).select('id').maybeSingle();
   if(linkError||!linked)return respond({error:'Boleto TEST criado, mas o vínculo exige conciliação.'},503);
  }
  if(!boletoIds.customerId||!boletoIds.subscriptionId||!boletoIds.invoiceId)
   return respond({error:'A fatura TEST ainda não está vinculada.'},503);
  const hostedInvoiceUrl=await finalizeStripeBoletoInvoice(
   boletoIds.invoiceId,boletoIds.customerId,boletoIds.subscriptionId,
   serverSelection,context,config,
  );
  return respond({ok:true,environment:'test',payment_method:'boleto',reference:created.reference,url,invoice_ready:!!hostedInvoiceUrl});
 }catch(err){
  console.error('noncard sandbox checkout error',{code:err instanceof Error?err.message:'unknown'});
  return respond({error:'A homologação financeira não pôde concluir este pedido. Nenhuma cobrança LIVE foi realizada.'},503);
 }
});
