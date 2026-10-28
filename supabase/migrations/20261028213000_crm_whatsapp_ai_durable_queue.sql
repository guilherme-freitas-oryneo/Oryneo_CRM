create table public.crm_wa_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.crm_wa_channels(id) on delete cascade,
  conversation_id uuid not null references public.crm_wa_conversations(id) on delete cascade,
  inbound_message_id uuid not null unique references public.crm_wa_messages(id) on delete cascade,
  state text not null default 'queued'
    check (state in ('queued','leased','generated','retry_wait','superseded','cancelled','human_review')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_response_id text check (provider_response_id is null or length(provider_response_id) <= 200),
  error_code text check (error_code is null or length(error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'leased') = (lease_token is not null and lease_until is not null))
);

create unique index crm_wa_ai_jobs_one_active_conversation
  on public.crm_wa_ai_jobs(conversation_id)
  where state in ('queued','leased','retry_wait');
create index crm_wa_ai_jobs_claim
  on public.crm_wa_ai_jobs(next_attempt_at,created_at)
  where state in ('queued','retry_wait');

create table public.crm_wa_ai_outbox (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.crm_wa_ai_jobs(id) on delete cascade,
  conversation_id uuid not null references public.crm_wa_conversations(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4096),
  state text not null default 'pending'
    check (state in ('pending','leased','sent','retry_wait','uncertain','cancelled','human_review')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text unique check (provider_message_id is null or length(provider_message_id) <= 200),
  error_code text check (error_code is null or length(error_code) <= 100),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'leased') = (lease_token is not null and lease_until is not null)),
  check ((state = 'sent') = (provider_message_id is not null and sent_at is not null))
);

create index crm_wa_ai_outbox_claim
  on public.crm_wa_ai_outbox(next_attempt_at,created_at)
  where state in ('pending','retry_wait');

alter table public.crm_wa_ai_jobs enable row level security;
alter table public.crm_wa_ai_outbox enable row level security;
revoke all on public.crm_wa_ai_jobs,public.crm_wa_ai_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.crm_wa_ai_jobs,public.crm_wa_ai_outbox to service_role;

create or replace function public.crm_wa_enqueue_ai_job(
  p_conversation_id uuid,
  p_inbound_message_id uuid
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_channel_id uuid;
  v_existing uuid;
  v_job_id uuid;
begin
  select c.channel_id into v_channel_id
  from public.crm_wa_conversations c
  join public.crm_wa_ai_settings s on s.channel_id=c.channel_id
  join public.crm_wa_messages m on m.id=p_inbound_message_id and m.conversation_id=c.id
  where c.id=p_conversation_id
    and c.mode='sdr_active' and not c.opted_out and s.mode='auto'
    and m.direction='inbound' and m.kind='text'
  for update of c;
  if v_channel_id is null then return null; end if;

  select j.id into v_existing
  from public.crm_wa_ai_jobs j
  where j.inbound_message_id=p_inbound_message_id;
  if v_existing is not null then return v_existing; end if;

  update public.crm_wa_ai_jobs
  set state='superseded',lease_token=null,lease_until=null,error_code='NEWER_INBOUND',updated_at=now()
  where conversation_id=p_conversation_id and state in ('queued','leased','retry_wait');

  update public.crm_wa_ai_outbox o
  set state='cancelled',lease_token=null,lease_until=null,error_code='NEWER_INBOUND',updated_at=now()
  where o.conversation_id=p_conversation_id and o.state in ('pending','leased','retry_wait');

  insert into public.crm_wa_ai_jobs(channel_id,conversation_id,inbound_message_id)
  values(v_channel_id,p_conversation_id,p_inbound_message_id)
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.crm_wa_claim_ai_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 60
) returns setof public.crm_wa_ai_jobs
language plpgsql
set search_path = ''
as $$
begin
  if p_limit not between 1 and 20 or p_lease_seconds not between 15 and 300 then
    raise exception 'Invalid claim limits' using errcode='22023';
  end if;

  update public.crm_wa_ai_jobs j
  set state=case when attempts>=3 then 'human_review' else 'retry_wait' end,
      next_attempt_at=now(),lease_token=null,lease_until=null,
      error_code=case when attempts>=3 then 'LEASE_EXHAUSTED' else 'LEASE_EXPIRED' end,
      updated_at=now()
  where j.state='leased' and j.lease_until<=now();

  update public.crm_wa_ai_jobs j
  set state='cancelled',lease_token=null,lease_until=null,error_code='HUMAN_CONTROL',updated_at=now()
  where j.state in ('queued','retry_wait') and not exists (
    select 1 from public.crm_wa_conversations c
    join public.crm_wa_ai_settings s on s.channel_id=c.channel_id
    where c.id=j.conversation_id and c.mode='sdr_active' and not c.opted_out and s.mode='auto'
  );

  return query
  with candidates as (
    select j.id from public.crm_wa_ai_jobs j
    where j.state in ('queued','retry_wait') and j.next_attempt_at<=now()
    order by j.next_attempt_at,j.created_at
    for update skip locked
    limit p_limit
  )
  update public.crm_wa_ai_jobs j
  set state='leased',attempts=j.attempts+1,lease_token=gen_random_uuid(),
      lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  from candidates c where j.id=c.id
  returning j.*;
end;
$$;

create or replace function public.crm_wa_complete_ai_generation(
  p_job_id uuid,
  p_lease_token uuid,
  p_reply text,
  p_provider_response_id text,
  p_error_code text,
  p_retryable boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_job public.crm_wa_ai_jobs%rowtype;
  v_state text;
begin
  select * into v_job from public.crm_wa_ai_jobs
  where id=p_job_id and state='leased' and lease_token=p_lease_token
  for update;
  if not found then return 'stale'; end if;

  if p_error_code is not null then
    v_state=case when p_retryable and v_job.attempts<3 then 'retry_wait' else 'human_review' end;
    update public.crm_wa_ai_jobs
    set state=v_state,lease_token=null,lease_until=null,error_code=left(p_error_code,100),
        provider_response_id=left(p_provider_response_id,200),
        next_attempt_at=case when v_state='retry_wait' then now()+(interval '1 minute'*power(5,greatest(v_job.attempts-1,0))) else next_attempt_at end,
        updated_at=now()
    where id=p_job_id;
    return v_state;
  end if;

  if length(trim(coalesce(p_reply,''))) not between 1 and 4096 then
    raise exception 'Reply is required' using errcode='22023';
  end if;
  update public.crm_wa_ai_jobs
  set state='generated',lease_token=null,lease_until=null,error_code=null,
      provider_response_id=left(p_provider_response_id,200),updated_at=now()
  where id=p_job_id;
  insert into public.crm_wa_ai_outbox(job_id,conversation_id,body)
  values(p_job_id,v_job.conversation_id,trim(p_reply))
  on conflict(job_id) do nothing;
  return 'generated';
end;
$$;

create or replace function public.crm_wa_claim_ai_outbox(
  p_limit integer default 5,
  p_lease_seconds integer default 60
) returns setof public.crm_wa_ai_outbox
language plpgsql
set search_path = ''
as $$
begin
  if p_limit not between 1 and 20 or p_lease_seconds not between 15 and 300 then
    raise exception 'Invalid claim limits' using errcode='22023';
  end if;

  update public.crm_wa_ai_outbox
  set state='uncertain',lease_token=null,lease_until=null,error_code='LEASE_EXPIRED_AFTER_CLAIM',updated_at=now()
  where state='leased' and lease_until<=now();

  update public.crm_wa_ai_outbox o
  set state='cancelled',lease_token=null,lease_until=null,error_code='HUMAN_CONTROL',updated_at=now()
  where o.state in ('pending','retry_wait') and not exists (
    select 1 from public.crm_wa_conversations c
    join public.crm_wa_ai_settings s on s.channel_id=c.channel_id
    where c.id=o.conversation_id and c.mode='sdr_active' and not c.opted_out and s.mode='auto'
  );

  return query
  with candidates as (
    select o.id from public.crm_wa_ai_outbox o
    where o.state in ('pending','retry_wait') and o.next_attempt_at<=now()
    order by o.next_attempt_at,o.created_at
    for update skip locked
    limit p_limit
  )
  update public.crm_wa_ai_outbox o
  set state='leased',attempts=o.attempts+1,lease_token=gen_random_uuid(),
      lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  from candidates c where o.id=c.id
  returning o.*;
end;
$$;

create or replace function public.crm_wa_finish_ai_send(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_provider_message_id text,
  p_error_code text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_outbox public.crm_wa_ai_outbox%rowtype;
  v_state text;
begin
  select * into v_outbox from public.crm_wa_ai_outbox
  where id=p_outbox_id and state='leased' and lease_token=p_lease_token
  for update;
  if not found then return 'stale'; end if;
  if p_outcome not in ('sent','retry','uncertain','cancelled','human_review') then
    raise exception 'Invalid send outcome' using errcode='22023';
  end if;
  if p_outcome='sent' and length(trim(coalesce(p_provider_message_id,'')))<1 then
    raise exception 'Provider message id is required' using errcode='22023';
  end if;
  v_state=case
    when p_outcome='retry' and v_outbox.attempts<3 then 'retry_wait'
    when p_outcome='retry' then 'human_review'
    else p_outcome
  end;
  update public.crm_wa_ai_outbox
  set state=v_state,lease_token=null,lease_until=null,error_code=left(p_error_code,100),
      provider_message_id=case when v_state='sent' then left(p_provider_message_id,200) else provider_message_id end,
      sent_at=case when v_state='sent' then now() else sent_at end,
      next_attempt_at=case when v_state='retry_wait' then now()+(interval '1 minute'*power(5,greatest(v_outbox.attempts-1,0))) else next_attempt_at end,
      updated_at=now()
  where id=p_outbox_id;
  return v_state;
end;
$$;

revoke all on function public.crm_wa_enqueue_ai_job(uuid,uuid) from public,anon,authenticated;
revoke all on function public.crm_wa_claim_ai_jobs(integer,integer) from public,anon,authenticated;
revoke all on function public.crm_wa_complete_ai_generation(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.crm_wa_claim_ai_outbox(integer,integer) from public,anon,authenticated;
revoke all on function public.crm_wa_finish_ai_send(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_wa_enqueue_ai_job(uuid,uuid) to service_role;
grant execute on function public.crm_wa_claim_ai_jobs(integer,integer) to service_role;
grant execute on function public.crm_wa_complete_ai_generation(uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.crm_wa_claim_ai_outbox(integer,integer) to service_role;
grant execute on function public.crm_wa_finish_ai_send(uuid,uuid,text,text,text) to service_role;
