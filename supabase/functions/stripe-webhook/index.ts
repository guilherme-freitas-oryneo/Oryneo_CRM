import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import {ensureTrafficSubscription,getPaidOrder,sendWelcomeTestSafe} from '../_shared/billing/fulfillment.ts';

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

  const {data:secret, error:secretError} = await db.rpc('crm_stripe_test_webhook_secret');
  if (secretError || !secret || typeof secret !== 'string') {
    console.error('Stripe webhook secret unavailable', {code:secretError?.code});
    return json({error:'Webhook not configured'},503);
  }

  let raw: string;
  try {
    raw=await req.text();
    if(raw.length>1_000_000)return json({error:'Payload too large'},413);
  } catch {
    return json({error:'Invalid payload'},400);
  }
  if (!(await verify(raw,signature,secret))) return json({error:'Invalid signature'},400);

  let event: {
    id?:string;type?:string;livemode?:boolean;
    data?:{object?:Record<string,any>}
  };
  try {event=JSON.parse(raw)} catch {return json({error:'Invalid JSON'},400)}
  if(event.livemode!==false)return json({error:'Live events are not accepted'},400);
  if(!event.id||!event.type)return json({error:'Invalid Stripe event'},400);

  const checkoutEvents=new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ]);
  const invoiceEvents=new Set(['invoice.paid','invoice.payment_failed']);
  const subscriptionEvents=new Set(['customer.subscription.updated','customer.subscription.deleted']);
  if(!checkoutEvents.has(event.type)&&!invoiceEvents.has(event.type)&&!subscriptionEvents.has(event.type))
    return json({received:true,ignored:true});
  const source=event.data?.object;
  if(!source || typeof source.id!=='string')return json({error:'Invalid Stripe event object'},400);

  if(checkoutEvents.has(event.type)){
    if(source.object!=='checkout.session')return json({error:'Expected Checkout Session'},400);
    // Conferir o pedido vinculado: valores não podem ser decididos pelo payload do navegador.
    const {data:expected,error:lookupError}=await db.from('crm_billing_orders')
      .select('id,amount_total,currency').eq('stripe_checkout_session_id',source.id).maybeSingle();
    if(lookupError || !expected)return json({error:'Checkout order unavailable'},503);
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
    });
    if(error||!outcome?.ok){
      console.error('Stripe checkout reconciliation failed',{code:error?.code});
      return json({error:'Reconciliation unavailable'},503);
    }

    if(source.payment_status==='paid'&&
       (event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')){
      try{
        const paidOrder=await getPaidOrder(db,source.id);
        if(!paidOrder)return json({error:'Paid order not synchronized'},503);
        const key=Deno.env.get('STRIPE_SECRET_KEY');
        if(!key||!key.startsWith('sk_test_'))return json({error:'Stripe sandbox key unavailable'},503);
        await ensureTrafficSubscription(db,paidOrder,key);
        const job=sendWelcomeTestSafe(db,paidOrder).catch(err=>{
          console.error('Stripe welcome delivery pending review',{code:err instanceof Error?err.message:'unknown'});
        });
        // Envio de teste é restrito a domínio interno; não bloquear o ACK com SMTP.
        if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(job);
        else await job;
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
    const {data:result,error}=await db.rpc('crm_record_stripe_invoice_event',{
      p_event_id:event.id,p_event_type:event.type,p_invoice_id:source.id,
      p_subscription_id:invoiceSubscription||'',
      p_amount_cents:Math.round(Number(source.amount_paid??source.amount_due??0)),
      p_currency:source.currency||'brl',
    });
    if(error||!result?.ok)return json({error:'Invoice reconciliation unavailable'},503);
    return json({received:true,unlinked:!!result.unlinked,duplicate:!!result.duplicate});
  }

  if(source.object!=='subscription')return json({error:'Expected subscription'},400);
  const status=event.type==='customer.subscription.deleted'?'canceled':String(source.status||'unknown');
  const {data:result,error}=await db.rpc('crm_record_stripe_subscription_event',{
    p_event_id:event.id,p_event_type:event.type,p_subscription_id:source.id,p_status:status,
  });
  if(error||!result?.ok)return json({error:'Subscription reconciliation unavailable'},503);
  return json({received:true,unlinked:!!result.unlinked,duplicate:!!result.duplicate});
});
