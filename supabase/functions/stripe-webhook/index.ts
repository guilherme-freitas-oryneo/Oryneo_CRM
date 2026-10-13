import { createClient } from 'npm:@supabase/supabase-js@2.90.1';

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

  let event: {id?:string;type?:string;livemode?:boolean;data?:{object?:Record<string,unknown>}};
  try { event=JSON.parse(raw); } catch { return json({error:'Invalid JSON'},400); }
  if(event.livemode !== false)return json({error:'Live events are not accepted'},400);
  if(!event.id||!event.type)return json({error:'Invalid Stripe event'},400);
  const accepted=new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ]);
  if(!accepted.has(event.type))return json({received:true,ignored:true});

  const session=event.data?.object;
  if(!session || session.object!=='checkout.session'||typeof session.id!=='string')
    return json({error:'Invalid checkout session'},400);

  const {data:outcome,error} = await db.rpc('crm_record_stripe_checkout_event',{
    p_event_id:event.id,p_event_type:event.type,p_session_id:session.id,
    p_payment_status:typeof session.payment_status==='string'?session.payment_status:'',
    p_customer_id:typeof session.customer==='string'?session.customer:null,
    p_subscription_id:typeof session.subscription==='string'?session.subscription:null,
    p_invoice_id:typeof session.invoice==='string'?session.invoice:null,
  });
  if(error||!outcome?.ok){
    console.error('Stripe checkout webhook could not reconcile',{code:error?.code,event_type:event.type});
    return json({error:'Reconciliation unavailable'},503);
  }
  return json({received:true,duplicate:!!outcome.duplicate});
});
