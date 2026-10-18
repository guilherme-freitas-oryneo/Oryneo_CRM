-- Additive queue for E16. Existing intakes are suppressed to avoid retroactive mail.
alter table public.crm_mail_outbox alter column created_by drop not null;
alter table public.crm_mail_outbox add column if not exists source text not null default 'user';
alter table public.crm_mail_outbox drop constraint if exists crm_mail_outbox_source_check;
alter table public.crm_mail_outbox add constraint crm_mail_outbox_source_check check(source in ('user','system'));

alter table public.crm_intake_requests
  add column if not exists confirmation_state text not null default 'suppressed',
  add column if not exists confirmation_due_at timestamptz not null default (now()+interval '1 minute'),
  add column if not exists confirmation_claimed_at timestamptz,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmation_attempts integer not null default 0,
  add column if not exists confirmation_internet_message_id text,
  add column if not exists confirmation_error_code text;

alter table public.crm_intake_requests alter column confirmation_state set default 'pending';
alter table public.crm_intake_requests drop constraint if exists crm_intake_confirmation_state_check;
alter table public.crm_intake_requests add constraint crm_intake_confirmation_state_check
  check(confirmation_state in ('pending','sending','sent','failed','reconciliation','suppressed'));
alter table public.crm_intake_requests drop constraint if exists crm_intake_confirmation_attempts_check;
alter table public.crm_intake_requests add constraint crm_intake_confirmation_attempts_check
  check(confirmation_attempts between 0 and 20);
alter table public.crm_intake_requests drop constraint if exists crm_intake_confirmation_message_id_check;
alter table public.crm_intake_requests add constraint crm_intake_confirmation_message_id_check
  check(confirmation_internet_message_id is null or length(confirmation_internet_message_id) between 1 and 998);
alter table public.crm_intake_requests drop constraint if exists crm_intake_confirmation_error_check;
alter table public.crm_intake_requests add constraint crm_intake_confirmation_error_check
  check(confirmation_error_code is null or confirmation_error_code ~ '^[A-Z0-9_]{2,80}$');

create index if not exists crm_intake_confirmation_due
on public.crm_intake_requests(confirmation_due_at,request_id)
where confirmation_state in ('pending','failed');

create or replace function public.crm_claim_intake_confirmation_jobs(p_limit integer default 10)
returns table(request_id uuid,deal_id uuid,data jsonb)
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_limit not between 1 and 25 then raise exception 'Limite inválido.' using errcode='22023'; end if;
  return query
  with candidates as (
    select request.request_id
    from public.crm_intake_requests request
    where request.confirmation_attempts<5
      and request.confirmation_due_at<=now()
      and request.confirmation_state in ('pending','failed')
    order by request.confirmation_due_at,request.request_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.crm_intake_requests request
    set confirmation_state='sending',confirmation_claimed_at=clock_timestamp(),
        confirmation_attempts=request.confirmation_attempts+1,confirmation_error_code=null
    from candidates
    where request.request_id=candidates.request_id
    returning request.request_id,request.deal_id
  )
  select claimed.request_id,claimed.deal_id,record.data
  from claimed join public.crm_records record on record.id=claimed.deal_id and record.kind='deal' and not record.deleted;
end
$$;

create or replace function public.crm_finish_intake_confirmation_job(
  p_request_id uuid,p_state text,p_internet_message_id text default null,p_error_code text default null
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare changed integer;
begin
  if p_state not in ('sent','failed','reconciliation','suppressed') then raise exception 'Estado inválido.' using errcode='22023'; end if;
  if p_state='sent' and (p_internet_message_id is null or length(p_internet_message_id) not between 1 and 998 or p_internet_message_id ~ E'[\r\n]') then
    raise exception 'Message-ID inválido.' using errcode='22023';
  end if;
  if p_state<>'sent' and (p_error_code is null or p_error_code !~ '^[A-Z0-9_]{2,80}$') then
    raise exception 'Erro inválido.' using errcode='22023';
  end if;
  update public.crm_intake_requests request
  set confirmation_state=p_state,
      confirmation_sent_at=case when p_state='sent' then clock_timestamp() else request.confirmation_sent_at end,
      confirmation_internet_message_id=case when p_state='sent' then p_internet_message_id else request.confirmation_internet_message_id end,
      confirmation_error_code=case when p_state='sent' then null else p_error_code end,
      confirmation_due_at=case when p_state='failed' then clock_timestamp()+make_interval(mins=>least(60,1 << least(request.confirmation_attempts,5))) else request.confirmation_due_at end
  where request.request_id=p_request_id and request.confirmation_state='sending';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Job não está disponível para finalizar.' using errcode='P0002'; end if;
end
$$;

revoke all on function public.crm_claim_intake_confirmation_jobs(integer),public.crm_finish_intake_confirmation_job(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_claim_intake_confirmation_jobs(integer),public.crm_finish_intake_confirmation_job(uuid,text,text,text) to service_role;

do $cleanup$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='crm-intake-confirmation-every-minute';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$cleanup$;

-- Deploy intake-mail-worker with gateway JWT verification disabled; the handler
-- still requires the Vault-backed x-oryneo-cron token.
select cron.schedule(
  'crm-intake-confirmation-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/intake-mail-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-oryneo-cron',(select decrypted_secret from vault.decrypted_secrets where name='oryneo_mail_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
  $job$
);
