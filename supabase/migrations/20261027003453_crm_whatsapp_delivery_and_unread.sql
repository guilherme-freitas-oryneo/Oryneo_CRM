-- Agent read state and real Meta delivery receipts. Only the service role writes.
alter table public.crm_wa_conversations
  add column unread_count integer not null default 0 check (unread_count >= 0),
  add column last_inbound_at timestamptz,
  add column last_read_at timestamptz;

-- A request id reserves one attempt. An uncertain Graph API result is never sent twice automatically.
create table public.crm_wa_outbox (
  request_id uuid primary key,
  conversation_id uuid not null references public.crm_wa_conversations(id),
  operator_id uuid not null references auth.users(id),
  kind text not null check (kind in ('text','audio','image','document','video')),
  state text not null default 'reserved' check (state in ('reserved','sending','sent','unknown','failed')),
  provider_message_id text unique,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_wa_outbox_conversation on public.crm_wa_outbox(conversation_id,created_at desc);
alter table public.crm_wa_outbox enable row level security;
revoke all on public.crm_wa_outbox from anon,authenticated;
grant select,insert,update on public.crm_wa_outbox to service_role;

create function public.crm_wa_outbound_insert_state() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.direction = 'outbound' then
    select e.status into new.delivery_status
    from public.crm_wa_delivery_events e
    where e.provider_message_id = new.provider_message_id
    order by case e.status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 1 end desc,
             e.occurred_at desc limit 1;
    new.delivery_status := coalesce(new.delivery_status, 'pending');
  end if;
  return new;
end;
$$;
create trigger crm_wa_outbound_insert_state before insert on public.crm_wa_messages
for each row execute function public.crm_wa_outbound_insert_state();

create function public.crm_wa_inbound_insert_state() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.direction = 'inbound' then
    update public.crm_wa_conversations
      set unread_count = unread_count + 1,
          last_inbound_at = greatest(coalesce(last_inbound_at, new.occurred_at), new.occurred_at),
          updated_at = now()
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;
create trigger crm_wa_inbound_insert_state after insert on public.crm_wa_messages
for each row execute function public.crm_wa_inbound_insert_state();

create function public.crm_wa_delivery_status_state() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.crm_wa_messages m
  set delivery_status = new.status
  where m.provider_message_id = new.provider_message_id
    and m.direction = 'outbound'
    and (m.delivery_status is null or
      case new.status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 1 end >
      case m.delivery_status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 when 'failed' then 1 else 0 end);
  return new;
end;
$$;
create trigger crm_wa_delivery_status_state after insert on public.crm_wa_delivery_events
for each row execute function public.crm_wa_delivery_status_state();

create function public.crm_wa_mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.crm_wa_conversations
  set unread_count = 0, last_read_at = now(), updated_at = now()
  where id = p_conversation_id;
end;
$$;
revoke all on function public.crm_wa_mark_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.crm_wa_mark_conversation_read(uuid) to service_role;
