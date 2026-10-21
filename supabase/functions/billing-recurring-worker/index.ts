import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { getBillingEnvironmentConfig, parseBillingEnvironment } from '../_shared/billing/environment.ts';
import type { AssistedPaymentMethod } from '../_shared/billing/obligations.ts';

type ScheduledJob = {
  job_type: 'pix_due_email' | 'assisted_payment_reminder_email' | 'financial_review_required';
  occurrence_key: string;
  due_at: string;
};

type ClaimedObligation = {
  obligation_id: string;
  order_id: string;
  method: AssistedPaymentMethod;
  obligation_kind: string;
  competence_key: string;
  due_at: string;
  amount_total: number;
  currency: 'brl';
};

const addDays = (dueAt: string, days: number): string => {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) throw new Error('INVALID_DUE_AT');
  return new Date(due + days * 86_400_000).toISOString();
};

export function nextAssistedPaymentSchedule(method: AssistedPaymentMethod, dueAt: string): ScheduledJob[] {
  const firstType = method === 'pix_assisted' ? 'pix_due_email' : 'assisted_payment_reminder_email';
  return [
    { job_type: firstType, occurrence_key: 'due-7d', due_at: addDays(dueAt, -7) },
    { job_type: 'assisted_payment_reminder_email', occurrence_key: 'due-3d', due_at: addDays(dueAt, -3) },
    { job_type: 'assisted_payment_reminder_email', occurrence_key: 'due-0d', due_at: dueAt },
    { job_type: 'assisted_payment_reminder_email', occurrence_key: 'overdue-1d', due_at: addDays(dueAt, 1) },
    { job_type: 'assisted_payment_reminder_email', occurrence_key: 'overdue-3d', due_at: addDays(dueAt, 3) },
    { job_type: 'financial_review_required', occurrence_key: 'overdue-5d', due_at: addDays(dueAt, 5) },
  ];
}

export function workerEnvironmentStatus(value: string | undefined): 'test' | 'LIVE_NOT_ENABLED' | 'WORKER_ENVIRONMENT_NOT_CONFIGURED' {
  try {
    return parseBillingEnvironment(value) === 'test' ? 'test' : 'LIVE_NOT_ENABLED';
  } catch {
    return 'WORKER_ENVIRONMENT_NOT_CONFIGURED';
  }
}

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function createTestCheckout(config: ReturnType<typeof getBillingEnvironmentConfig>, obligation: ClaimedObligation) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('locale', 'pt-BR');
  form.set('integration_identifier', `oryneo_assisted_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`);
  form.set('metadata[oryneo_obligation_id]', obligation.obligation_id);
  form.set('metadata[oryneo_order_id]', obligation.order_id);
  form.set('metadata[oryneo_billing_environment]', 'test');
  form.set('line_items[0][price_data][currency]', obligation.currency);
  form.set('line_items[0][price_data][product_data][name]', 'Cobrança ORYNEO');
  form.set('line_items[0][price_data][unit_amount]', String(obligation.amount_total));
  form.set('line_items[0][quantity]', '1');
  const stripe = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Stripe-Version': '2026-08-26.dahlia',
      'Idempotency-Key': `oryneo-assisted-test-${obligation.obligation_id}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const session = await stripe.json();
  if (!stripe.ok || !session?.id || session.livemode !== false) throw new Error('TEST_CHECKOUT_CREATE_FAILED');
  return { id: String(session.id), paymentIntentId: session.payment_intent ? String(session.payment_intent) : null };
}

if (import.meta.main) {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  Deno.serve(async (request) => {
    if (request.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);
    const environment = workerEnvironmentStatus(Deno.env.get('BILLING_ENVIRONMENT'));
    if (environment === 'WORKER_ENVIRONMENT_NOT_CONFIGURED') return respond({ error: environment }, 503);
    if (environment === 'LIVE_NOT_ENABLED') return respond({ error: environment }, 409);

    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return respond({ error: 'Autenticação necessária.' }, 401);
    const { data: member, error: memberError } = await db.from('crm_members').select('user_id').eq('user_id', user.id).maybeSingle();
    if (memberError) return respond({ error: 'WORKER_MEMBERSHIP_UNAVAILABLE' }, 503);
    if (!member) return respond({ error: 'Acesso não autorizado.' }, 403);

    let config: ReturnType<typeof getBillingEnvironmentConfig>;
    try {
      config = getBillingEnvironmentConfig('test', (name) => Deno.env.get(name));
    } catch (error) {
      console.error('billing recurring worker configuration unavailable', { code: error instanceof Error ? error.message : 'unknown' });
      return respond({ error: 'WORKER_CONFIGURATION_UNAVAILABLE' }, 503);
    }

    const now = new Date();
    const { data: claimed, error: claimError } = await db.rpc('crm_claim_assisted_payment_obligations', {
      p_environment: 'test',
      p_before: now.toISOString(),
      p_limit: 10,
    });
    if (claimError) return respond({ error: 'WORKER_CLAIM_UNAVAILABLE' }, 503);

    let created = 0;
    let requiresReview = 0;
    for (const obligation of (claimed || []) as ClaimedObligation[]) {
      try {
        const { data: order, error: orderError } = await db.from('crm_billing_orders').select('deal_id').eq('id', obligation.order_id).eq('billing_environment', 'test').maybeSingle();
        if (orderError || !order) throw new Error('TEST_ORDER_NOT_FOUND');
        const checkout = await createTestCheckout(config, obligation);
        const { data: settled, error: settleError } = await db.rpc('crm_settle_assisted_payment_obligation', {
          p_obligation_id: obligation.obligation_id,
          p_environment: 'test',
          p_state: 'open',
          p_stripe_checkout_session_id: checkout.id,
          p_stripe_payment_intent_id: checkout.paymentIntentId,
        });
        if (settleError || settled !== true) throw new Error('TEST_OBLIGATION_PERSIST_FAILED');
        const jobs = nextAssistedPaymentSchedule(obligation.method, obligation.due_at)
          .filter((job) => Date.parse(job.due_at) >= now.getTime())
          .map((job) => ({ ...job, deal_id: order.deal_id, subject_type: 'billing_obligation', subject_id: obligation.obligation_id }));
        if (jobs.length) {
          const { error: jobsError } = await db.from('crm_automation_jobs').upsert(jobs, {
            onConflict: 'deal_id,job_type,subject_type,subject_id,occurrence_key',
            ignoreDuplicates: true,
          });
          if (jobsError) throw new Error('TEST_AUTOMATION_SCHEDULE_FAILED');
        }
        created++;
      } catch (error) {
        requiresReview++;
        console.error('billing recurring worker candidate failed', { code: error instanceof Error ? error.message : 'unknown' });
      }
    }
    return respond({ environment: 'test', created, requires_review: requiresReview });
  });
}
