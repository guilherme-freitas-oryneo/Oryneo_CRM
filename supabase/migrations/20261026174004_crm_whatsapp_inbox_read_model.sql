-- Read model for signed WhatsApp events. Browser roles cannot mutate channels or messages.
create table public.crm_wa_channels (
  id uuid primary key default gen_random_uuid(),
  business_id text not null check (business_id ~ '^[0-9]{8,32}$'),
  app_id text not null check (app_id ~ '^[0-9]{8,32}$'),
  messaging_account_id text not null check (messaging_account_id ~ '^[0-9]{8,32}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{8,32}$'),
  display_phone_number text not null check (display_phone_number ~ '^\+[0-9]{10,15}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_wa_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.crm_wa_channels(id),
  customer_wa_id text not null check (customer_wa_id ~ '^[0-9]{8,32}$'),
  customer_name text check (customer_name is null or length(customer_name) <= 160),
  deal_id uuid references public.crm_records(id) on delete set null,
  mode text not null default 'review' check (mode in ('sdr_active','review','human_locked','resolved')),
  opted_out boolean not null default false,
  consent_granted boolean not null default false,
  last_message_at timestamptz,
  last_preview text not null default '' check (length(last_preview) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_id,customer_wa_id)
);
create index crm_wa_conversations_recent on public.crm_wa_conversations(channel_id,last_message_at desc nulls last,id);
create index crm_wa_conversations_deal on public.crm_wa_conversations(deal_id) where deal_id is not null;

create table public.crm_wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_wa_conversations(id),
  provider_message_id text not null unique check (length(provider_message_id) between 1 and 200),
  direction text not null check (direction in ('inbound','outbound')),
  kind text not null check (kind in ('text','audio','image','document','video','other')),
  body text not null default '' check (length(body) <= 4096),
  media_id text check (media_id is null or length(media_id) <= 200),
  mime_type text check (mime_type is null or length(mime_type) <= 120),
  delivery_status text check (delivery_status is null or delivery_status in ('pending','sent','delivered','read','failed')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index crm_wa_messages_conversation_time on public.crm_wa_messages(conversation_id,occurred_at,id);

-- Status events may arrive before the outbound message row. Preserve them for reconciliation.
create table public.crm_wa_delivery_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null check (length(provider_message_id) between 1 and 200),
  status text not null check (status in ('sent','delivered','read','failed')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider_message_id,status,occurred_at)
);
create index crm_wa_delivery_events_message on public.crm_wa_delivery_events(provider_message_id,occurred_at);

alter table public.crm_wa_channels enable row level security;
alter table public.crm_wa_conversations enable row level security;
alter table public.crm_wa_messages enable row level security;
alter table public.crm_wa_delivery_events enable row level security;
revoke all on public.crm_wa_channels,public.crm_wa_conversations,public.crm_wa_messages,public.crm_wa_delivery_events from anon,authenticated;
grant select on public.crm_wa_channels,public.crm_wa_conversations,public.crm_wa_messages to authenticated;
grant select,insert,update on public.crm_wa_channels,public.crm_wa_conversations,public.crm_wa_messages,public.crm_wa_delivery_events to service_role;
create policy crm_wa_channels_member_read on public.crm_wa_channels for select to authenticated
  using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy crm_wa_conversations_member_read on public.crm_wa_conversations for select to authenticated
  using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy crm_wa_messages_member_read on public.crm_wa_messages for select to authenticated
  using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create function public.crm_wa_ensure_conversation(p_channel_id uuid,p_customer_wa_id text,p_customer_name text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  insert into public.crm_wa_conversations(channel_id,customer_wa_id,customer_name)
  values(p_channel_id,p_customer_wa_id,p_customer_name)
  on conflict(channel_id,customer_wa_id) do update
    set customer_name=coalesce(excluded.customer_name,public.crm_wa_conversations.customer_name),updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.crm_wa_ensure_conversation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_wa_ensure_conversation(uuid,text,text) to service_role;

create function public.crm_wa_set_latest(p_conversation_id uuid,p_occurred_at timestamptz,p_preview text)
returns void language sql security invoker set search_path='' as $$
  update public.crm_wa_conversations
  set last_message_at=p_occurred_at,last_preview=left(p_preview,160),updated_at=now()
  where id=p_conversation_id and (last_message_at is null or last_message_at<p_occurred_at);
$$;
revoke all on function public.crm_wa_set_latest(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_wa_set_latest(uuid,timestamptz,text) to service_role;
