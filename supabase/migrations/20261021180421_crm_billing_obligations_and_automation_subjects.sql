-- Assisted payment obligations are server-owned financial records. They are
-- deliberately not exposed through the Data API to browsers or members.
create table if not exists public.crm_billing_obligations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.crm_billing_orders(id) on delete restrict,
  method text not null check (method in ('pix_assisted','boleto_assisted')),
  obligation_kind text not null check (obligation_kind ~ '^[a-z][a-z0-9_]{1,80}$'),
  competence_key text not null check (competence_key ~ '^[0-9]{4}(-([0-9]{2}|Q[1-4]))?$'),
  billing_environment text not null check (billing_environment in ('test','live')),
  state text not null default 'scheduled' check (state in ('scheduled','open','processing','paid','expired','failed','overdue','canceled','requires_review')),
  due_at timestamptz not null,
  amount_total integer not null check (amount_total > 0),
  currency text not null default 'brl' check (currency = 'brl'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint crm_billing_obligations_paid_at_check check (
    (state = 'paid' and paid_at is not null) or (state <> 'paid')
  )
);

create unique index if not exists crm_billing_obligations_competence_once
  on public.crm_billing_obligations(order_id,method,obligation_kind,competence_key,billing_environment);
create index if not exists crm_billing_obligations_due_candidates
  on public.crm_billing_obligations(billing_environment,due_at,id)
  where state in ('scheduled','open','failed','overdue');

alter table public.crm_billing_obligations enable row level security;
revoke all on table public.crm_billing_obligations from public, anon, authenticated;
grant select, insert, update on table public.crm_billing_obligations to service_role;

alter table public.crm_automation_jobs
  add column if not exists subject_type text,
  add column if not exists subject_id uuid,
  add column if not exists occurrence_key text;

alter table public.crm_automation_jobs
  drop constraint if exists crm_automation_jobs_job_type_check,
  add constraint crm_automation_jobs_job_type_check check (job_type in (
    'lead_received_email',
    'implementation_started_email',
    'payment_link_email',
    'payment_reminder_email',
    'payment_confirmed_email',
    'renewal_failed_email',
    'pix_due_email',
    'assisted_payment_reminder_email',
    'financial_review_required'
  )),
  add constraint crm_automation_jobs_subject_shape_check check (
    num_nonnulls(subject_type,subject_id,occurrence_key) in (0,3)
  );

alter table public.crm_automation_jobs
  drop constraint if exists crm_automation_jobs_deal_id_job_type_key;

create unique index if not exists crm_automation_jobs_legacy_once
  on public.crm_automation_jobs(deal_id,job_type)
  where subject_type is null;
create unique index if not exists crm_automation_jobs_subject_occurrence_once
  on public.crm_automation_jobs(deal_id,job_type,subject_type,subject_id,occurrence_key)
  where subject_type is not null;

create or replace function public.crm_claim_assisted_payment_obligations(
  p_environment text,
  p_before timestamptz,
  p_limit integer default 10
)
returns table(
  obligation_id uuid,
  order_id uuid,
  method text,
  obligation_kind text,
  competence_key text,
  due_at timestamptz,
  amount_total integer,
  currency text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_environment not in ('test','live') then
    raise exception 'Ambiente inválido.' using errcode='22023';
  end if;
  if p_limit not between 1 and 25 then
    raise exception 'Limite inválido.' using errcode='22023';
  end if;
  return query
  with candidates as (
    select obligation.id
    from public.crm_billing_obligations obligation
    where obligation.billing_environment = p_environment
      and obligation.due_at <= p_before
      and obligation.state in ('scheduled','failed')
    order by obligation.due_at, obligation.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.crm_billing_obligations obligation
    set state='processing', updated_at=clock_timestamp()
    from candidates
    where obligation.id=candidates.id
    returning obligation.*
  )
  select claimed.id,claimed.order_id,claimed.method,claimed.obligation_kind,
         claimed.competence_key,claimed.due_at,claimed.amount_total,claimed.currency
  from claimed;
end
$function$;

create or replace function public.crm_settle_assisted_payment_obligation(
  p_obligation_id uuid,
  p_environment text,
  p_state text,
  p_stripe_checkout_session_id text default null,
  p_stripe_payment_intent_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_obligation public.crm_billing_obligations%rowtype;
begin
  if p_environment not in ('test','live') then
    raise exception 'Ambiente inválido.' using errcode='22023';
  end if;
  if p_state not in ('open','processing','paid','expired','failed','overdue','canceled','requires_review') then
    raise exception 'Estado inválido.' using errcode='22023';
  end if;

  select * into current_obligation
  from public.crm_billing_obligations
  where id=p_obligation_id and billing_environment=p_environment
  for update;
  if not found then return false; end if;
  if current_obligation.state='paid' and p_state<>'paid' then return false; end if;

  update public.crm_billing_obligations
  set state=p_state,
      stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_stripe_checkout_session_id),
      stripe_payment_intent_id=coalesce(stripe_payment_intent_id,p_stripe_payment_intent_id),
      paid_at=case when p_state='paid' then coalesce(paid_at,clock_timestamp()) else paid_at end,
      updated_at=clock_timestamp()
  where id=current_obligation.id;

  if p_state='paid' then
    update public.crm_automation_jobs
    set state='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where subject_type='billing_obligation'
      and subject_id=current_obligation.id
      and state in ('scheduled','failed','reconciliation');
  end if;
  return true;
end
$function$;

revoke all on function public.crm_claim_assisted_payment_obligations(text,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.crm_settle_assisted_payment_obligation(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_claim_assisted_payment_obligations(text,timestamptz,integer) to service_role;
grant execute on function public.crm_settle_assisted_payment_obligation(uuid,text,text,text,text) to service_role;

create or replace function public.crm_schedule_implementation_automation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.kind='deal' and not new.deleted
     and new.data->>'stage_id'='a623469a-34c8-4c21-9a44-7e20cc7df502'
     and old.data->>'stage_id' is distinct from new.data->>'stage_id'
     and exists(select 1 from public.crm_billing_orders bill where bill.deal_id=new.id and bill.status='paid') then
    insert into public.crm_automation_jobs(deal_id,job_type,due_at)
    values(new.id,'implementation_started_email',clock_timestamp()+interval '5 minutes')
    on conflict do nothing;
  end if;
  return new;
end
$function$;

create or replace function public.crm_schedule_intake_automation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.crm_automation_jobs(id,deal_id,job_type,due_at)
  values(new.request_id,new.deal_id,'lead_received_email',new.created_at+interval '5 minutes')
  on conflict do nothing;
  return new;
end
$function$;
