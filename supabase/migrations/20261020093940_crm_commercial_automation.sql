-- Reconstructed from the deployed Supabase catalog on 2026-10-20.
-- Original production migration: 20261020093940 / crm_commercial_automation.
-- This is a reproducible schema snapshot for clean environments, not a production re-apply.
-- The production migration already exists in supabase_migrations.schema_migrations.
create table if not exists public.crm_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_records(id) on delete cascade,
  job_type text not null constraint crm_automation_jobs_job_type_check
    check (job_type in ('lead_received_email','implementation_started_email')),
  state text not null default 'scheduled' constraint crm_automation_jobs_state_check
    check (state in ('scheduled','running','sent','failed','reconciliation','suppressed','cancelled','dead')),
  due_at timestamptz not null,
  attempts integer not null default 0 constraint crm_automation_jobs_attempts_check check (attempts between 0 and 20),
  internet_message_id text,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_automation_jobs_deal_id_job_type_key unique(deal_id,job_type)
);
create index if not exists crm_automation_jobs_due
  on public.crm_automation_jobs(due_at,id) where state in ('scheduled','failed');
alter table public.crm_automation_jobs enable row level security;
revoke all on table public.crm_automation_jobs from PUBLIC, anon;
grant select on table public.crm_automation_jobs to authenticated;
do $policy$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
      and tablename='crm_automation_jobs' and policyname='crm_automation_jobs_member_read') then
    create policy crm_automation_jobs_member_read on public.crm_automation_jobs
    for select to authenticated using (
      exists (select 1 from public.crm_members member where member.user_id=(select auth.uid()))
    );
  end if;
end $policy$;

CREATE OR REPLACE FUNCTION public.crm_claim_intake_confirmation_jobs(p_limit integer DEFAULT 10)
 RETURNS TABLE(request_id uuid, deal_id uuid, data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_limit not between 1 and 25 then raise exception 'Limite inválido.' using errcode='22023'; end if;
  return query
  with candidates as (
    select job.id from public.crm_automation_jobs job
    where job.attempts<5 and job.due_at<=now() and job.state in ('scheduled','failed')
    order by job.due_at,job.id for update skip locked limit p_limit
  ), claimed as (
    update public.crm_automation_jobs job set state='running',attempts=job.attempts+1,error_code=null,updated_at=clock_timestamp()
    from candidates where job.id=candidates.id returning job.id,job.deal_id,job.job_type
  )
  select claimed.id,claimed.deal_id,jsonb_set(record.data,'{_automation_job_type}',to_jsonb(claimed.job_type),true)
  from claimed join public.crm_records record on record.id=claimed.deal_id and record.kind='deal' and not record.deleted;
end
$function$
;

CREATE OR REPLACE FUNCTION public.crm_finish_intake_confirmation_job(p_request_id uuid, p_state text, p_internet_message_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed integer;
begin
  if p_state not in ('sent','failed','reconciliation','suppressed') then raise exception 'Estado inválido.' using errcode='22023'; end if;
  if p_state='sent' and (p_internet_message_id is null or length(p_internet_message_id) not between 1 and 998 or p_internet_message_id ~ E'[\r\n]') then
    raise exception 'Message-ID inválido.' using errcode='22023';
  end if;
  if p_state<>'sent' and (p_error_code is null or p_error_code !~ '^[A-Z0-9_]{2,80}$') then raise exception 'Erro inválido.' using errcode='22023'; end if;
  update public.crm_automation_jobs job set
    state=case when p_state='failed' and job.attempts>=5 then 'dead' else p_state end,
    internet_message_id=case when p_state='sent' then p_internet_message_id else job.internet_message_id end,
    error_code=case when p_state='sent' then null else p_error_code end,
    completed_at=case when p_state='sent' then clock_timestamp() else job.completed_at end,
    due_at=case when p_state='failed' and job.attempts<5 then clock_timestamp()+make_interval(mins=>least(60,1 << least(job.attempts,5))) else job.due_at end,
    updated_at=clock_timestamp()
  where job.id=p_request_id and job.state='running';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Job não está disponível para finalizar.' using errcode='P0002'; end if;
end
$function$
;

CREATE OR REPLACE FUNCTION public.crm_schedule_implementation_automation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.kind='deal' and not new.deleted
     and new.data->>'stage_id'='a623469a-34c8-4c21-9a44-7e20cc7df502'
     and old.data->>'stage_id' is distinct from new.data->>'stage_id'
     and exists(select 1 from public.crm_billing_orders bill where bill.deal_id=new.id and bill.status='paid') then
    insert into public.crm_automation_jobs(deal_id,job_type,due_at)
    values(new.id,'implementation_started_email',clock_timestamp()+interval '5 minutes')
    on conflict(deal_id,job_type) do nothing;
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.crm_schedule_intake_automation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.crm_automation_jobs(id,deal_id,job_type,due_at)
  values(new.request_id,new.deal_id,'lead_received_email',new.created_at+interval '5 minutes')
  on conflict(deal_id,job_type) do nothing;
  return new;
end
$function$
;

do $trigger$ begin
  if not exists (select 1 from pg_trigger where tgrelid='public.crm_intake_requests'::regclass
      and tgname='crm_schedule_intake_automation') then
    create trigger crm_schedule_intake_automation after insert on public.crm_intake_requests
      for each row execute function public.crm_schedule_intake_automation();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.crm_records'::regclass
      and tgname='crm_schedule_implementation_automation') then
    create trigger crm_schedule_implementation_automation after update on public.crm_records
      for each row execute function public.crm_schedule_implementation_automation();
  end if;
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='crm_automation_jobs') then
    alter publication supabase_realtime add table public.crm_automation_jobs;
  end if;
end $trigger$;
revoke all on function public.crm_claim_intake_confirmation_jobs(integer) from PUBLIC,anon,authenticated;
revoke all on function public.crm_finish_intake_confirmation_job(uuid,text,text,text) from PUBLIC,anon,authenticated;
grant execute on function public.crm_claim_intake_confirmation_jobs(integer) to service_role;
grant execute on function public.crm_finish_intake_confirmation_job(uuid,text,text,text) to service_role;
