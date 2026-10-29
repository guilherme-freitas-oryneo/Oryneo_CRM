create table public.crm_wa_automation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_wa_conversations(id) on delete cascade,
  actor_id uuid not null,
  from_mode text not null check (from_mode in ('sdr_active','review','human_locked','resolved')),
  to_mode text not null check (to_mode in ('sdr_active','review','human_locked','resolved')),
  enabled boolean not null,
  consent_confirmed boolean not null,
  occurred_at timestamptz not null default now()
);

create index crm_wa_automation_events_conversation
  on public.crm_wa_automation_events(conversation_id,occurred_at desc,id);

alter table public.crm_wa_automation_events enable row level security;
revoke all on public.crm_wa_automation_events from public,anon,authenticated;
grant select,insert on public.crm_wa_automation_events to service_role;

create or replace function public.crm_wa_set_automation_state(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_enabled boolean,
  p_consent_confirmed boolean
) returns table(mode text,consent_granted boolean,job_enqueued boolean)
language plpgsql
set search_path=''
as $$
declare
  v_from_mode text;
  v_to_mode text;
  v_opted_out boolean;
  v_consent boolean;
  v_latest_message_id uuid;
  v_latest_kind text;
  v_job_id uuid;
begin
  select c.mode,c.opted_out,c.consent_granted
    into v_from_mode,v_opted_out,v_consent
  from public.crm_wa_conversations c
  where c.id=p_conversation_id
  for update;
  if not found then
    raise exception 'Conversation not found' using errcode='P0002';
  end if;

  if p_enabled then
    if not p_consent_confirmed then
      raise exception 'Consent confirmation is required' using errcode='22023';
    end if;
    if v_opted_out then
      raise exception 'Opted-out conversation cannot enable automation' using errcode='23514';
    end if;
    if v_from_mode not in ('review','sdr_active') then
      raise exception 'Conversation must return to review before automation' using errcode='55000';
    end if;
    v_to_mode:='sdr_active';
    v_consent:=true;
  else
    v_to_mode:=case when v_from_mode='sdr_active' then 'review' else v_from_mode end;
  end if;

  update public.crm_wa_conversations c
  set mode=v_to_mode,consent_granted=v_consent,updated_at=now()
  where c.id=p_conversation_id;

  if p_enabled then
    select m.id,m.kind into v_latest_message_id,v_latest_kind
    from public.crm_wa_messages m
    where m.conversation_id=p_conversation_id
      and m.direction='inbound'
      and m.reaction_to_provider_message_id is null
    order by m.occurred_at desc,m.id desc
    limit 1;
    if v_latest_message_id is not null and v_latest_kind='text' then
      v_job_id:=public.crm_wa_enqueue_ai_job(p_conversation_id,v_latest_message_id);
    end if;
  else
    update public.crm_wa_ai_jobs j
    set state='cancelled',lease_token=null,lease_until=null,
        error_code='AUTOMATION_PAUSED',updated_at=now()
    where j.conversation_id=p_conversation_id
      and j.state in ('queued','generated','retry_wait');
    update public.crm_wa_ai_outbox o
    set state='cancelled',lease_token=null,lease_until=null,
        error_code='AUTOMATION_PAUSED',updated_at=now()
    where o.conversation_id=p_conversation_id
      and o.state in ('pending','retry_wait');
  end if;

  insert into public.crm_wa_automation_events(
    conversation_id,actor_id,from_mode,to_mode,enabled,consent_confirmed
  ) values(
    p_conversation_id,p_actor_id,v_from_mode,v_to_mode,p_enabled,p_enabled and p_consent_confirmed
  );

  return query select v_to_mode,v_consent,v_job_id is not null;
end;
$$;

revoke all on function public.crm_wa_set_automation_state(uuid,uuid,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.crm_wa_set_automation_state(uuid,uuid,boolean,boolean)
  to service_role;
