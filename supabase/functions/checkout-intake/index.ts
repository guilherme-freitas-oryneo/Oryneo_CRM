import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { buildBillingQuote, buildBillingSelection, resolveStripeBillingPrices } from '../_shared/billing/catalog.ts';
import { parseDirectCheckoutDraftInput, parseDirectCheckoutInput, normalizeBrazilianMobile, validCnpj } from '../_shared/billing/direct-checkout.ts';
import { normalizeBrasilApiCompany } from '../_shared/billing/company-profile.ts';
import { applyCardFundingRestriction } from '../_shared/billing/assisted-checkout.ts';
import { getBillingEnvironmentConfig } from '../_shared/billing/environment.ts';

const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://oryneo-lp-preview.guilherme-frei160023.chatgpt.site','https://oryneo.com.br','https://www.oryneo.com.br','https://guilherme-freitas-oryneo.github.io']);
const publicOrigin='https://guilherme-freitas-oryneo.github.io';
type Company={cnpj:string;legalName:string;displayName:string;profile:Record<string,unknown>};
type CompanyLookup={status:'partial'|'invalid'|'not_found'|'unavailable'|'found';company?:Company};
type CreatedCheckout={order_id:string;reference:string;stripe_checkout_session_id:string|null};
type Quote={catalogVersion:string;plan:string;cycle:string;userLimit:number;amountTotal:number;items:Array<{key:string;label:string;amountCents:number}>};
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const reference=()=>`ORY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
const identifier=()=>`oryneo_${Array.from(crypto.getRandomValues(new Uint8Array(8)),value=>String.fromCharCode(97+value%26)).join('')}`;
const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function companyFor(cnpj:string):Promise<CompanyLookup>{
  if(cnpj.length<14)return {status:'partial'};
  if(!validCnpj(cnpj))return {status:'invalid'};
  const {data:cached}=await db.from('crm_companies').select('cnpj,legal_name,profile,enriched_at').eq('cnpj',cnpj).maybeSingle();
  if(cached?.enriched_at&&Date.now()-new Date(cached.enriched_at).getTime()<24*60*60*1000&&cached.profile&&Object.keys(cached.profile).length){
    const profile=cached.profile as Record<string,unknown>;
    return {status:'found',company:{cnpj,legalName:String(profile.legal_name||cached.legal_name),displayName:String(profile.trade_name||profile.legal_name||cached.legal_name),profile}};
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7500);
  try{
    const response=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,{headers:{Accept:'application/json','User-Agent':'ORYNEO-CRM/1.0'},signal:controller.signal});
    if(response.status===404)return {status:'not_found'};
    if(!response.ok)return {status:'unavailable'};
    return {status:'found',company:normalizeBrasilApiCompany(await response.json(),cnpj)};
  }catch{return {status:'unavailable'};}finally{clearTimeout(timer);}
}

const companyPublic=(company?:Company)=>company?{legal_name:company.legalName,trade_name:String(company.profile.trade_name||''),status:String(company.profile.status||'')}:undefined;
const dealFor=(input:{customer_name:string;customer_email:string;customer_phone:string;cnpj:string;plan:string;cycle:string;addons:string[]},company:Company|undefined,quote:Quote,state:'started'|'payment_pending')=>{
  const contact=input.customer_name.trim(),display=company?.displayName||(input.cnpj?`CNPJ ${input.cnpj}`:contact||'Checkout em preenchimento');
  const period=quote.items[0],setup=quote.items[1],addonItems=quote.items.slice(2);
  return {
    title:`Contratação · ${display}`.slice(0,160),company:display,contact,email:validEmail(input.customer_email)?input.customer_email:'',
    phone:normalizeBrazilianMobile(input.customer_phone),value_cents:quote.amountTotal,company_cnpj:company?.cnpj||(input.cnpj.length===14?input.cnpj:null),
    company_profile:company?.profile||null,quote:{plan:quote.plan,cycle:quote.cycle,monthly_cents:quote.cycle==='monthly'?period.amountCents:Math.round(period.amountCents/12),period_cents:period.amountCents,setup_cents:setup.amountCents,first_charge_cents:quote.amountTotal,users:quote.userLimit,catalog_version:quote.catalogVersion,addons:addonItems.map(item=>({key:item.key,label:item.label,billing:item.key==='traffic'?'quarterly':'once',amount_cents:item.amountCents,upfront_cents:item.amountCents}))},
    notes:'Contratação iniciada pelo checkout do site.',checkout_state:state,
  };
};

Deno.serve(async req=>{
  const requestOrigin=req.headers.get('origin')||'';
  const headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
  if(origins.has(requestOrigin))headers['Access-Control-Allow-Origin']=requestOrigin;
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(requestOrigin&&!origins.has(requestOrigin))return respond({error:'Origem não autorizada.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
  try{
    if(Number(req.headers.get('content-length')||0)>8_000)return respond({error:'Solicitação muito longa.'},413);
    const raw=await req.json();
    const environment='live' as const;
    const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const fingerprint=await sha256(`${ip}:${req.headers.get('user-agent')||'unknown'}:${serviceKey}`);

    if(raw?.action==='draft'){
      const input=parseDirectCheckoutDraftInput(raw),quote=buildBillingQuote(input);
      const lookup=await companyFor(input.cnpj);
      const tokenHash=await sha256(input.payment_token);
      const deal=dealFor(input,lookup.company,quote,'started');
      const {error}=await db.rpc('crm_upsert_direct_checkout_draft',{p_request_id:input.request_id,p_fingerprint:fingerprint,p_token_hash:tokenHash,p_deal_data:deal,p_environment:environment});
      if(error){console.error('checkout draft storage failed',{code:error.code});return respond({error:'Não foi possível salvar o andamento agora.'},503);}
      return respond({ok:true,cnpj_status:lookup.status,company:companyPublic(lookup.company)});
    }

    const input=parseDirectCheckoutInput(raw);
    const lookup=input.legacy_company?{status:'found' as const,company:undefined}:await companyFor(input.cnpj);
    if(lookup.status==='invalid')return respond({error:'Digite um CNPJ válido para continuar.'},422);
    if(lookup.status==='not_found')return respond({error:'CNPJ não encontrado na Receita Federal.'},422);
    if(lookup.status!=='found')return respond({error:'Não foi possível consultar o CNPJ agora. Tente novamente.'},503);
    const config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
    const prices=await resolveStripeBillingPrices(config);
    const selection=buildBillingSelection({plan:input.plan,cycle:input.cycle,addons:input.addons},prices);
    const tokenHash=await sha256(input.payment_token);
    const company=lookup.company;
    const companyName=company?.displayName||input.legacy_company;
    const orderPayload={reference:reference(),catalog_version:selection.catalogVersion,traffic_renewal_price_id:selection.trafficRenewalPriceId,
      selection:{plan:selection.plan,cycle:selection.cycle,addons:input.addons,payment_method:input.payment_method,card_funding:input.payment_method==='card'?input.card_funding:null},
      items:selection.items.map(({stripePriceId,...item})=>({key:item.key,label:item.label,detail:item.detail,amount_cents:item.amountCents})),
      amount_total:selection.amountTotal,customer_name:input.customer_name,customer_email:input.customer_email,company:companyName};
    const dealPayload={...dealFor(input,company,selection,'payment_pending'),company:companyName,title:`Contratação direta · ${companyName}`.slice(0,160),notes:'Pedido preparado pelo checkout direto em produção.'};
    const {data:createdRaw,error:creationError}=await db.rpc('crm_create_direct_checkout',{p_request_id:input.request_id,p_fingerprint:fingerprint,p_token_hash:tokenHash,p_deal_data:dealPayload,p_order:orderPayload,p_environment:environment}).single();
    const created=createdRaw as CreatedCheckout|null;
    if(creationError||!created?.order_id){console.error('direct checkout storage failed',{code:creationError?.code});return respond({error:'Não foi possível preparar o pedido agora. Nenhuma cobrança foi realizada.'},503);}
    const {data:storedOrder,error:storedError}=await db.from('crm_billing_orders').select('selection,amount_total,customer_email,billing_environment,status').eq('id',created.order_id).maybeSingle();
    const storedSelection=storedOrder?.selection as {plan?:string;cycle?:string;addons?:string[];payment_method?:string;card_funding?:string|null}|undefined;
    if(storedError||!storedOrder||storedOrder.billing_environment!==environment||storedOrder.status!=='awaiting_payment'||storedOrder.amount_total!==selection.amountTotal||storedOrder.customer_email!==input.customer_email||storedSelection?.plan!==selection.plan||storedSelection.cycle!==selection.cycle||storedSelection.payment_method!==input.payment_method||(input.payment_method==='card'&&storedSelection.card_funding!==input.card_funding)||JSON.stringify([...(storedSelection.addons||[])].sort())!==JSON.stringify([...input.addons].sort()))return respond({error:'A seleção deste pedido mudou. Reinicie o checkout para preparar um novo pedido.'},409);
    let sessionId=created.stripe_checkout_session_id;
    if(!sessionId){
      const form=new URLSearchParams();
      form.set('ui_mode','elements');form.set('customer_email',input.customer_email);form.set('integration_identifier',identifier());form.set('locale','pt-BR');
      form.set('return_url',`${publicOrigin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(input.payment_token)}&retorno=1`);
      form.set('metadata[oryneo_order_id]',created.order_id);form.set('metadata[oryneo_billing_environment]',environment);
      if(input.payment_method==='card'){
        if(!input.card_funding)throw new Error('INVALID_CARD_FUNDING');
        form.set('mode','subscription');form.set('subscription_data[metadata][oryneo_order_id]',created.order_id);form.set('subscription_data[billing_mode][type]','flexible');
        applyCardFundingRestriction(form,input.card_funding);
        if(selection.trafficRenewalPriceId)form.set('metadata[oryneo_traffic_renewal_price]',selection.trafficRenewalPriceId);
        selection.stripePriceIds.forEach((price,index)=>{form.set(`line_items[${index}][price]`,price);form.set(`line_items[${index}][quantity]`,'1');});
      }else{
        form.set('mode','payment');form.set('allowed_payment_method_types[0]',input.payment_method);if(input.payment_method==='boleto')form.set('customer_creation','always');
        form.set('line_items[0][price_data][currency]','brl');form.set('line_items[0][price_data][unit_amount]',String(selection.amountTotal));
        form.set('line_items[0][price_data][product_data][name]',`Contratação ORYNEO ${selection.plan} · ${companyName}`);form.set('line_items[0][quantity]','1');
        form.set('payment_intent_data[metadata][oryneo_order_id]',created.order_id);form.set('payment_intent_data[metadata][oryneo_billing_environment]',environment);
      }
      const stripe=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${config.secretKey}`,'Stripe-Version':'2026-08-26.dahlia','Idempotency-Key':`oryneo-direct-${created.order_id}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
      const session=await stripe.json();
      if(!stripe.ok||!session?.id||session.livemode!==true)return respond({error:'O Stripe não conseguiu preparar o pagamento neste ambiente.'},502);
      sessionId=session.id;
      const {error:updateError}=await db.from('crm_billing_orders').update({stripe_checkout_session_id:sessionId,updated_at:new Date().toISOString()}).eq('id',created.order_id).is('stripe_checkout_session_id',null);
      if(updateError)return respond({error:'O pedido foi criado, mas não pode ser vinculado ao pagamento agora.'},503);
    }
    return respond({ok:true,reference:created.reference,url:`${publicOrigin}/Oryneo_CRM/pagar/?token=${encodeURIComponent(input.payment_token)}`});
  }catch(cause){
    const code=cause instanceof Error?cause.message:'unknown';console.error('direct checkout failed',{code});
    return respond({error:'Confira os dados e tente novamente. Nenhuma cobrança foi realizada.'},400);
  }
});
