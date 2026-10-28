import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import {ensureTrafficSubscription,getPaidOrder,getPaidOrderById,sendWelcomeTestSafe} from '../_shared/billing/fulfillment.ts';
import {classifyCheckoutLookup} from '../_shared/billing/checkout-webhook-policy.ts';
import {checkoutEventIsSettled} from '../_shared/billing/checkout-settlement-policy.ts';
import {classifyInvoiceEvent} from '../_shared/billing/invoice-event-policy.ts';
import {runPaidOrderPostpayment} from '../_shared/billing/postpayment.ts';
import {billingEnvironmentMatchesLivemode,getBillingEnvironmentConfig,parseBillingEnvironment} from '../_shared/billing/environment.ts';
import { verifiedWebhookEnvironment } from '../_shared/billing/webhook-environment.ts';
import { classifyAssistedPaymentEvent } from '../_shared/billing/assisted-payment-webhook.ts';
import { classifyRefundEvent } from '../_shared/billing/refund-event-policy.ts';
import {sendSystemTransactionalEmail,deterministicMailUuid} from '../_shared/mail/system-transactional.ts';
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const encoder = new TextEncoder();

function secureEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verify(raw: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(',').map((piece) => piece.trim().split('='));
  const timestamp = parts.find(([name]) => name === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const epoch = Number(timestamp);
  if (!Number.isSafeInteger(epoch) || Math.abs(Math.floor(Date.now()/1000)-epoch)>300) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${raw}`)));
  return parts.some(([kind, hex]) => {
    if (kind !== 'v1' || !hex || !/^[a-f0-9]{64}$/i.test(hex)) return false;
    const actual = new Uint8Array(hex.match(/.{2}/g)!.map((part)=>parseInt(part,16)));
    return secureEqual(expected,actual);
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  const signature = req.headers.get('Stripe-Signature') || '';
  if (!signature) return json({error:'Missing signature'},400);

  const [{data:testSecret,error:testSecretError},{data:liveSecret,error:liveSecretError}] = await Promise.all([
    db.rpc('crm_stripe_webhook_secret',{p_environment:'test'}),
    db.rpc('crm_stripe_webhook_secret',{p_environment:'live'}),
  ]);
  if (testSecretError || liveSecretError || (!testSecret && !liveSecret)) {
    console.error('Stripe webhook secret unavailable', {test_code:testSecretError?.code,live_code:liveSecretError?.code});
    return json({error:'Webhook not configured'},503);
  }

  let raw: string;
  try {
    raw=await req.text();
    if(raw.length>1_000_000)return json({error:'Payload too large'},413);
  } catch {
    return json({error:'Invalid payload'},400);
  }
  const verification={
    test:typeof testSecret==='string'&&await verify(raw,signature,testSecret),
    live:typeof liveSecret==='string'&&await verify(raw,signature,liveSecret),
  };

  let event: {
    id?:string;type?:string;livemode?:boolean;
    data?:{object?:Record<string,any>}
  };
  try {event=JSON.parse(raw)} catch {return json({error:'Invalid JSON'},400)}
  const environment=verifiedWebhookEnvironment(verification,event.livemode);
  if(!environment)return json({error:'Invalid signature or environment'},400);
  const livemode=environment==='live';
  if(!event.id||!event.type)return json({error:'Invalid Stripe event'},400);

  const checkoutEvents=new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ]);
  const invoiceEvents=new Set(['invoice.finalized','invoice.paid','invoice.payment_failed']);
  const subscriptionEvents=new Set(['customer.subscription.updated','customer.subscription.deleted']);
  const refundEvents=new Set(['refund.created','refund.updated','refund.failed']);
  if(!checkoutEvents.has(event.type)&&!invoiceEvents.has(event.type)&&!subscriptionEvents.has(event.type)&&!refundEvents.has(event.type))
    return json({received:true,ignored:true});
  const source=event.data?.object;
  if(!source || typeof source.id!=='string')return json({error:'Invalid Stripe event object'},400);

  if(refundEvents.has(event.type)){
    const disposition=classifyRefundEvent(event.type,source);
    if(disposition==='reject')return json({error:'Invalid refund snapshot'},422);
    if(disposition==='ignore')return json({received:true,ignored:true});
    const config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
    const stripeGet=async(path:string)=>{
      const response=await fetch('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':'2026-08-26.dahlia'}});
      if(!response.ok)throw new Error('STRIPE_LOOKUP_FAILED');
      return await response.json() as Record<string,any>;
    };
    try{
      let orderId=typeof source.metadata?.oryneo_order_id==='string'?source.metadata.oryneo_order_id:null;
      let paymentIntentId=typeof source.payment_intent==='string'?source.payment_intent:null;
      const chargeId=typeof source.charge==='string'?source.charge:null;
      let invoiceId:string|null=null,subscriptionId:string|null=null;
      if(paymentIntentId){
        const intent=await stripeGet('payment_intents/'+encodeURIComponent(paymentIntentId));
        if(intent.livemode!==livemode)return json({error:'Refund environment mismatch'},422);
        orderId=orderId||intent.metadata?.oryneo_order_id||null;
      }
      if(chargeId){
        const charge=await stripeGet('charges/'+encodeURIComponent(chargeId));
        if(charge.livemode!==livemode)return json({error:'Refund environment mismatch'},422);
        paymentIntentId=paymentIntentId||(typeof charge.payment_intent==='string'?charge.payment_intent:null);
        orderId=orderId||charge.metadata?.oryneo_order_id||null;
        invoiceId=typeof charge.invoice==='string'?charge.invoice:null;
      }
      if(invoiceId){
        const invoice=await stripeGet('invoices/'+encodeURIComponent(invoiceId));
        const parent=invoice.parent?.subscription_details?.subscription;
        subscriptionId=typeof invoice.subscription==='string'?invoice.subscription:typeof parent==='string'?parent:typeof parent?.id==='string'?parent.id:null;
      }
      let query=db.from('crm_billing_orders').select('id,billing_environment,amount_total,customer_name,customer_email,company,selection');
      if(orderId&&/^[0-9a-f-]{36}$/i.test(orderId))query=query.eq('id',orderId);
      else if(invoiceId)query=query.eq('stripe_invoice_id',invoiceId);
      else if(subscriptionId)query=query.eq('stripe_subscription_id',subscriptionId);
      else return json({received:true,unlinked:true});
      let {data:order,error:orderError}=await query.maybeSingle();
      if(!order&&subscriptionId){
        const fallback=await db.from('crm_billing_orders').select('id,billing_environment,amount_total,customer_name,customer_email,company,selection').eq('stripe_subscription_id',subscriptionId).maybeSingle();
        order=fallback.data;orderError=orderError||fallback.error;
      }
      if(orderError)return json({error:'Refund order lookup unavailable'},503);
      if(!order)return json({received:true,unlinked:true});
      if((order.billing_environment==='live')!==livemode)return json({error:'Refund order environment mismatch'},422);
      const {data:result,error}=await db.rpc('crm_record_stripe_refund_event',{
        p_event_id:event.id,p_event_type:event.type,p_refund_id:source.id,p_order_id:order.id,
        p_status:String(source.status),p_amount:Number(source.amount),p_currency:String(source.currency),p_livemode:livemode,
        p_payment_intent_id:paymentIntentId,p_charge_id:chargeId,p_failure_reason:typeof source.failure_reason==='string'?source.failure_reason:null,
      });
      if(error||!result?.ok)return json({error:'Refund reconciliation unavailable'},503);
      if(source.status==='succeeded'&&!result.duplicate){
        const recipient=livemode?order.customer_email:null;
        if(livemode&&!recipient)return json({error:'Refund customer email unavailable'},503);
        const data={firstName:String(order.customer_name||'cliente').split(' ')[0],company:order.company||order.customer_name||'sua empresa',email:recipient||'',plan:order.selection?.plan,cycle:order.selection?.cycle,orderReference:order.id,amountCents:Number(source.amount)};
        await sendSystemTransactionalEmail(db,{idempotencyKey:await deterministicMailUuid('stripe:'+source.id+':refund_confirmed'),template:'refund_confirmed',data,recipient,recipientName:livemode?order.customer_name:'Homologação ORYNEO'});
      }
      return json({received:true,duplicate:!!result.duplicate,full_refund:!!result.full_refund});
    }catch(err){
      console.error('Stripe refund reconciliation pending',{code:err instanceof Error?err.message:'unknown'});
      return json({error:'Refund reconciliation pending'},503);
    }
  }

  if(checkoutEvents.has(event.type)){
    if(source.object!=='checkout.session')return json({error:'Expected Checkout Session'},400);
    const {data:assisted,error:assistedError}=await db.from('crm_billing_obligations')
      .select('id,billing_environment,stripe_checkout_session_id,amount_total,currency,state')
      .eq('stripe_checkout_session_id',source.id).maybeSingle();
    if(assistedError)return json({error:'Assisted payment lookup unavailable'},503);
    if(assisted){
      const classification=classifyAssistedPaymentEvent({
        eventType:event.type,
        livemode,
        duplicate:false,
        obligation:assisted,
        session:{
          id:source.id,
          amount_total:Math.round(Number(source.amount_total)),
          currency:String(source.currency||''),
          payment_status:String(source.payment_status||''),
        },
      });
      if(classification.outcome==='requires_review'){
        console.error('Stripe assisted payment mismatch',{session_id:source.id});
        return json({error:'Assisted payment mismatch'},422);
      }
      const {data:outcome,error}=await db.rpc('crm_record_assisted_payment_event',{
        p_event_id:event.id,p_event_type:event.type,p_obligation_id:assisted.id,p_session_id:source.id,
        p_payment_status:String(source.payment_status||''),p_amount_cents:Math.round(Number(source.amount_total)),
        p_currency:String(source.currency||''),p_livemode:livemode,
      });
      if(error||!outcome?.ok){
        console.error('Stripe assisted payment reconciliation failed',{code:error?.code});
        return json({error:'Assisted payment reconciliation unavailable'},503);
      }
      return json({received:true,duplicate:!!outcome.duplicate,outcome:outcome.outcome});
    }
    // Conferir o pedido vinculado: valores não podem ser decididos pelo payload do navegador.
    const {data:expected,error:lookupError}=await db.from('crm_billing_orders')
      .select('id,amount_total,currency,billing_environment').eq('stripe_checkout_session_id',source.id).maybeSingle();
    const disposition=classifyCheckoutLookup(event.type,Boolean(expected),Boolean(lookupError));
    if(disposition==='acknowledge_unlinked_expiration'){
      // Checkout teste sem pedido correspondente: não houve pagamento a reconciliar.
      console.warn('Stripe checkout expiration with no internal order',{event_id:event.id,session_id:source.id});
      return json({received:true,unlinked:true});
    }
    if(disposition==='retry' || !expected)return json({error:'Checkout order unavailable'},503);
    let expectedEnvironment;
    try{expectedEnvironment=parseBillingEnvironment(expected.billing_environment)}
    catch{return json({error:'Checkout environment unavailable'},503)}
    if(!billingEnvironmentMatchesLivemode(expectedEnvironment,livemode)||
       (source.metadata?.oryneo_billing_environment&&source.metadata.oryneo_billing_environment!==expectedEnvironment)){
      console.error('Stripe checkout environment mismatch',{session_id:source.id});
      return json({error:'Checkout environment mismatch'},422);
    }
    if(source.currency!=='brl'||Number(source.amount_total)!==Number(expected.amount_total)||
       (source.metadata?.oryneo_order_id&&source.metadata.oryneo_order_id!==expected.id)){
      console.error('Stripe checkout amount/reference mismatch',{session_id:source.id});
      return json({error:'Checkout order mismatch'},422);
    }
    const {data:outcome,error}=await db.rpc('crm_record_stripe_checkout_event',{
      p_event_id:event.id,p_event_type:event.type,p_session_id:source.id,
      p_payment_status:typeof source.payment_status==='string'?source.payment_status:'',
      p_customer_id:typeof source.customer==='string'?source.customer:null,
      p_subscription_id:typeof source.subscription==='string'?source.subscription:null,
      p_invoice_id:typeof source.invoice==='string'?source.invoice:null,
      p_livemode:livemode,
    });
    if(error||!outcome?.ok){
      console.error('Stripe checkout reconciliation failed',{code:error?.code});
      return json({error:'Reconciliation unavailable'},503);
    }

    if(checkoutEventIsSettled(event.type,source.payment_status)){
      try{
        const paidOrder=await getPaidOrder(db,source.id);
        if(!paidOrder)return json({error:'Paid order not synchronized'},503);
        const paidEnvironment=parseBillingEnvironment(paidOrder.billing_environment);
        if(!billingEnvironmentMatchesLivemode(paidEnvironment,livemode))return json({error:'Stripe environment mismatch'},503);
        const config=getBillingEnvironmentConfig(paidEnvironment,name=>Deno.env.get(name));
        // A renovação de tráfego não pode impedir o e-mail de boas-vindas de entrar na fila.
        // O claim persistente da mensagem torna seguro o retry do webhook.
        await runPaidOrderPostpayment({
          sendWelcome:()=>sendWelcomeTestSafe(db,paidOrder),
          ensureTrafficSubscription:()=>paidOrder.selection.payment_method==='card'?ensureTrafficSubscription(db,paidOrder,config.secretKey):Promise.resolve(),
          waitUntil:typeof EdgeRuntime!=='undefined'?(job)=>EdgeRuntime.waitUntil(job):undefined,
          onWelcomeError:err=>console.error('Stripe welcome delivery pending review',{code:err instanceof Error?err.message:'unknown'}),
        });
      }catch(err){
        console.error('Stripe postpayment incomplete',{code:err instanceof Error?err.message:'unknown'});
        // Retentar o mesmo evento é seguro: o checkout e a assinatura são idempotentes.
        return json({error:'Postpayment fulfillment pending'},503);
      }
    }
    return json({received:true,duplicate:!!outcome.duplicate});
  }

  if(invoiceEvents.has(event.type)){
    if(source.object!=='invoice')return json({error:'Expected invoice'},400);
    const parent=source.parent?.subscription_details?.subscription;
    const invoiceSubscription=typeof source.subscription==='string'?source.subscription
      :typeof parent==='string'?parent
      :typeof parent?.id==='string'?parent.id:null;
    // A paid event must carry a paid invoice snapshot, not merely a trusted event name.
    if(event.type==='invoice.paid'&&classifyInvoiceEvent(event.type,source.status,source.paid)!=='settle'){
      console.error('Stripe paid invoice snapshot inconsistent',{event_id:event.id,invoice_id:source.id});
      return json({error:'Invoice payment status mismatch'},422);
    }
    if(event.type==='invoice.finalized'){
      if(!invoiceSubscription||source.collection_method!=='send_invoice'||source.status!=='open'||typeof source.hosted_invoice_url!=='string'||!/^https:\/\//i.test(source.hosted_invoice_url))return json({received:true,ignored:true});
      const {data:order,error:orderError}=await db.from('crm_billing_orders').select('id,billing_environment,selection,customer_name,customer_email,company,stripe_checkout_session_id').eq('stripe_subscription_id',invoiceSubscription).maybeSingle();
      if(orderError)return json({error:'Invoice order lookup unavailable'},503);
      if(!order||order.selection?.payment_method!=='boleto'||order.stripe_checkout_session_id)return json({received:true,ignored:true});
      if((order.billing_environment==='live')!==livemode||source.currency!=='brl')return json({error:'Invoice environment/currency mismatch'},422);
      const config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));const verified=await fetch('https://api.stripe.com/v1/invoices/'+encodeURIComponent(source.id),{headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':'2026-08-26.dahlia'}});if(!verified.ok)return json({error:'Invoice verification unavailable'},503);const invoice=await verified.json();if(invoice.livemode!==livemode||invoice.status!=='open'||invoice.collection_method!=='send_invoice'||invoice.hosted_invoice_url!==source.hosted_invoice_url||Number(invoice.amount_due)!==Number(source.amount_due))return json({error:'Invoice snapshot mismatch'},422);
      const recipient=livemode?order.customer_email:null;if(livemode&&!recipient)return json({error:'Invoice customer email unavailable'},503);const email=String(order.customer_name||'cliente').split(' ')[0];const renderedData={firstName:email,company:order.company||order.customer_name||'sua empresa',email:recipient||'',plan:order.selection?.plan,cycle:order.selection?.cycle,orderReference:order.id,amountCents:Number(invoice.amount_due),deadline:invoice.due_date?new Date(invoice.due_date*1000).toLocaleDateString('pt-BR'):'',actionUrl:invoice.hosted_invoice_url};
      await sendSystemTransactionalEmail(db,{idempotencyKey:await deterministicMailUuid('stripe:'+invoice.id+':payment_link'),template:'payment_link',data:renderedData,recipient,recipientName:livemode?order.customer_name:'Homologação ORYNEO'});
      return json({received:true,email_sent:true,test_recipient:!livemode});
    }
    if(invoiceSubscription&&source.billing_reason==='subscription_create'&&event.type!=='invoice.finalized'){
      const {data:linked,error:linkError}=await db.from('crm_billing_orders')
        .select('id,billing_environment,selection,stripe_checkout_session_id,customer_name,customer_email,company')
        .eq('stripe_subscription_id',invoiceSubscription).maybeSingle();
      if(linkError)return json({error:'Invoice order lookup unavailable'},503);
      let boletoOrder=linked?.selection?.payment_method==='boleto'&&!linked.stripe_checkout_session_id;
      if(!linked){
        // A subscription may invoice before our database link is committed.
        // Inspect Stripe metadata instead of acknowledging and permanently losing the event.
        try{
          const config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
          const check=await fetch('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(invoiceSubscription),{
            headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':'2026-08-26.dahlia'},
          });
          if(!check.ok)return json({error:'Invoice subscription reconciliation pending'},503);
          const subscription=await check.json();
          if(subscription.livemode!==livemode)return json({error:'Invoice subscription environment mismatch'},422);
          if(subscription.metadata?.oryneo_payment_method==='boleto'&&subscription.metadata?.oryneo_order_id)
            return json({error:'Boleto order link pending reconciliation'},503);
        }catch{return json({error:'Invoice subscription lookup unavailable'},503)}
      }
      if(boletoOrder&&linked){
        if((linked.billing_environment==='live')!==livemode||source.currency!=='brl')
          return json({error:'Boleto invoice environment/currency mismatch'},422);
        const customerId=typeof source.customer==='string'?source.customer:null;
        const rpcName=event.type==='invoice.paid'
          ? 'crm_record_stripe_boleto_initial_invoice'
          : 'crm_record_stripe_boleto_initial_failure';
        const {data:receipt,error:receiptError}=await db.rpc(rpcName,{
          p_event_id:event.id,p_invoice_id:source.id,p_subscription_id:invoiceSubscription,
          p_customer_id:customerId||'',
          p_amount_cents:Number(event.type==='invoice.paid'?source.amount_paid:source.amount_due),
          p_currency:source.currency,p_livemode:livemode,
        });
        if(receiptError||!receipt?.ok){
          console.error('Boleto initial settlement pending review',{code:receiptError?.code,reason:receipt?.reason});
          return json({error:'Boleto invoice reconciliation pending'},503);
        }
        if(event.type==='invoice.payment_failed'){
          const recipient=livemode?linked.customer_email:null;if(livemode&&!recipient)return json({error:'Invoice customer email unavailable'},503);const data={firstName:String(linked.customer_name||'cliente').split(' ')[0],company:linked.company||linked.customer_name||'sua empresa',email:recipient||'',plan:linked.selection?.plan,cycle:linked.selection?.cycle,orderReference:linked.id,amountCents:Number(source.amount_due||0),actionUrl:typeof source.hosted_invoice_url==='string'?source.hosted_invoice_url:undefined};
          await sendSystemTransactionalEmail(db,{idempotencyKey:await deterministicMailUuid('stripe:'+source.id+':payment_failed'),template:'payment_failed',data,recipient,recipientName:livemode?linked.customer_name:'Homologação ORYNEO'});
          return json({received:true,duplicate:!!receipt.duplicate,initial_boleto:true,failed:true,email_sent:true});
        }
        // Retry postpayment even for a duplicate event; email and addon claims are idempotent.
        {
          try{
            const paidOrder=await getPaidOrderById(db,linked.id);
            if(!paidOrder)return json({error:'Boleto paid order not synchronized'},503);
            const config=getBillingEnvironmentConfig(environment,name=>Deno.env.get(name));
            await runPaidOrderPostpayment({
              sendWelcome:()=>sendWelcomeTestSafe(db,paidOrder),
              ensureTrafficSubscription:()=>paidOrder.selection.payment_method==='card'?ensureTrafficSubscription(db,paidOrder,config.secretKey):Promise.resolve(),
              waitUntil:typeof EdgeRuntime!=='undefined'?(job)=>EdgeRuntime.waitUntil(job):undefined,
              onWelcomeError:err=>console.error('Boleto welcome pending review',{code:err instanceof Error?err.message:'unknown'}),
            });
          }catch(err){
            console.error('Boleto postpayment incomplete',{code:err instanceof Error?err.message:'unknown'});
            return json({error:'Boleto fulfillment pending'},503);
          }
        }
        return json({received:true,duplicate:!!receipt.duplicate,initial_boleto:true});
      }
    }
    const {data:result,error}=await db.rpc('crm_record_stripe_invoice_event',{
      p_event_id:event.id,p_event_type:event.type,p_invoice_id:source.id,
      p_subscription_id:invoiceSubscription||'',
      p_amount_cents:Math.round(Number(source.amount_paid??source.amount_due??0)),
      p_currency:source.currency||'brl',
      p_billing_reason:typeof source.billing_reason==='string'?source.billing_reason:null,
      p_livemode:livemode,
    });
    if(error||!result?.ok)return json({error:'Invoice reconciliation unavailable'},503);
    if(!result.unlinked&&invoiceSubscription&&event.type!=='invoice.finalized'&&(source.billing_reason!=='subscription_create'||event.type==='invoice.payment_failed')){
      const {data:order, error:mailOrderError}=await db.from('crm_billing_orders').select('id,selection,customer_name,customer_email,company').eq('stripe_subscription_id',invoiceSubscription).maybeSingle();
      if(mailOrderError)return json({error:'Invoice email context unavailable'},503);
      if(order){const paid=event.type==='invoice.paid';const recipient=livemode?order.customer_email:null;if(livemode&&!recipient)return json({error:'Invoice customer email unavailable'},503);const tpl=paid?'renewal_paid':(source.billing_reason==='subscription_create'?'payment_failed':'renewal_failed');const data={firstName:String(order.customer_name||'cliente').split(' ')[0],company:order.company||order.customer_name||'sua empresa',email:recipient||'',plan:order.selection?.plan,cycle:order.selection?.cycle,orderReference:order.id,amountCents:Number(source.amount_paid??source.amount_due??0),actionUrl:typeof source.hosted_invoice_url==='string'?source.hosted_invoice_url:undefined};await sendSystemTransactionalEmail(db,{idempotencyKey:await deterministicMailUuid('stripe:'+source.id+':'+tpl),template:tpl,data,recipient,recipientName:livemode?order.customer_name:'Homologação ORYNEO'});}
    }
    return json({received:true,unlinked:!!result.unlinked,duplicate:!!result.duplicate});
  }

  if(source.object!=='subscription')return json({error:'Expected subscription'},400);
  const status=event.type==='customer.subscription.deleted'?'canceled':String(source.status||'unknown');
  const {data:result,error}=await db.rpc('crm_record_stripe_subscription_event',{
    p_event_id:event.id,p_event_type:event.type,p_subscription_id:source.id,p_status:status,
    p_livemode:livemode,
  });
  if(error||!result?.ok)return json({error:'Subscription reconciliation unavailable'},503);
  return json({received:true,unlinked:!!result.unlinked,duplicate:!!result.duplicate});
});
