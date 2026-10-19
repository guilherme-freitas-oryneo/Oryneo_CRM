import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { buildBillingSelection, resolveStripeBillingPrices } from '../_shared/billing/catalog.ts';
import { parseDirectCheckoutInput } from '../_shared/billing/direct-checkout.ts';
import { getBillingEnvironmentConfig, parseBillingEnvironment } from '../_shared/billing/environment.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const origins = new Set(['https://oryneo-lp-preview.guilherme-frei160023.chatgpt.site','https://oryneo.com.br','https://www.oryneo.com.br','https://guilherme-freitas-oryneo.github.io']);
const origin = 'https://guilherme-freitas-oryneo.github.io';
type CreatedCheckout = { order_id: string; reference: string; stripe_checkout_session_id: string | null };
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
const reference = () => `ORY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
const identifier = () => 'oryneo_' + Array.from(crypto.getRandomValues(new Uint8Array(8)), value => String.fromCharCode(97 + value % 26)).join('');

Deno.serve(async req => {
  const requestOrigin = req.headers.get('origin') || '';
  const headers: Record<string, string> = {'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
  if (origins.has(requestOrigin)) headers['Access-Control-Allow-Origin'] = requestOrigin;
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (requestOrigin && !origins.has(requestOrigin)) return respond({error:'Origem não autorizada.'},403);
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return respond({error:'Método não permitido.'},405);
  try {
    if (Number(req.headers.get('content-length') || 0) > 8_000) return respond({error:'Solicitação muito longa.'},413);
    const environment = parseBillingEnvironment(Deno.env.get('BILLING_DEFAULT_ENVIRONMENT') || 'test');
    // Live remains closed until the next task records approved terms and auditable consent.
    if (environment !== 'test') return respond({error:'Contratação direta ainda não está disponível neste ambiente.'},409);
    const input = parseDirectCheckoutInput(await req.json());
    const config = getBillingEnvironmentConfig(environment, name => Deno.env.get(name));
    const prices = await resolveStripeBillingPrices(config);
    const selection = buildBillingSelection({plan:input.plan,cycle:input.cycle,addons:input.addons},prices);
    const tokenHash = await sha256(input.payment_token);
    const fingerprint = await sha256(`${input.customer_email}:${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`);
    const orderPayload = {
      reference: reference(), catalog_version: selection.catalogVersion, traffic_renewal_price_id: selection.trafficRenewalPriceId,
      selection: {plan:selection.plan,cycle:selection.cycle,addons:input.addons},
      items: selection.items.map(({stripePriceId,...item}) => ({key:item.key,label:item.label,detail:item.detail,amount_cents:item.amountCents})),
      amount_total: selection.amountTotal, customer_name:input.customer_name, customer_email:input.customer_email, company:input.company,
    };
    const dealPayload = {title:`Contratação direta · ${input.company}`.slice(0,160),company:input.company,contact:input.customer_name,email:input.customer_email,phone:'',value_cents:selection.amountTotal,quote:{plan:selection.plan,cycle:selection.cycle,addons:selection.items.filter(item=>input.addons.includes(item.key as typeof input.addons[number])).map(item=>({key:item.key,label:item.label}))},notes:'Pedido iniciado pelo checkout direto em sandbox.'};
    const {data:createdRaw,error:creationError} = await db.rpc('crm_create_direct_checkout_sandbox',{p_request_id:input.request_id,p_fingerprint:fingerprint,p_token_hash:tokenHash,p_deal_data:dealPayload,p_order:orderPayload}).single();
    const created = createdRaw as CreatedCheckout | null;
    if (creationError || !created?.order_id) { console.error('direct checkout storage failed',{code:creationError?.code}); return respond({error:'Não foi possível preparar o pedido agora. Nenhuma cobrança foi realizada.'},503); }
    let sessionId = created.stripe_checkout_session_id as string | null;
    if (!sessionId) {
      const form = new URLSearchParams();
      form.set('mode','subscription');form.set('ui_mode','elements');form.set('customer_email',input.customer_email);form.set('integration_identifier',identifier());form.set('locale','pt-BR');
      form.set('return_url',`${origin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(input.payment_token)}&retorno=1`);
      form.set('metadata[oryneo_order_id]',created.order_id);form.set('metadata[oryneo_billing_environment]','test');
      form.set('subscription_data[metadata][oryneo_order_id]',created.order_id);form.set('subscription_data[billing_mode][type]','flexible');
      if (selection.trafficRenewalPriceId) form.set('metadata[oryneo_traffic_renewal_price]',selection.trafficRenewalPriceId);
      selection.stripePriceIds.forEach((price,index) => {form.set(`line_items[${index}][price]`,price);form.set(`line_items[${index}][quantity]`,'1')});
      const stripe = await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-direct-${created.order_id}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
      const session = await stripe.json();
      if (!stripe.ok || !session?.id || session.livemode !== false) return respond({error:'O Stripe não conseguiu preparar o pagamento de teste.'},502);
      sessionId = session.id;
      const {error:updateError} = await db.from('crm_billing_orders').update({stripe_checkout_session_id:sessionId,updated_at:new Date().toISOString()}).eq('id',created.order_id).is('stripe_checkout_session_id',null);
      if (updateError) return respond({error:'O pedido foi criado, mas não pode ser vinculado ao pagamento agora.'},503);
    }
    return respond({ok:true,reference:created.reference,url:`${origin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(input.payment_token)}`});
  } catch (cause) {
    console.error('direct checkout failed',{code:cause instanceof Error?cause.message:'unknown'});
    return respond({error:'Confira os dados e tente novamente. Nenhuma cobrança foi realizada.'},400);
  }
});
