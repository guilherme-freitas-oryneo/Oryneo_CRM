-- WhatsApp access is explicit. CRM membership alone must not reveal customer threads.
-- A channel-wide grant is reserved for the administrator. Operators/viewers get
-- a grant for each conversation, so an unassigned conversation stays private.
create unique index crm_wa_conversations_id_channel_unique
  on public.crm_wa_conversations(id, channel_id);

create table public.crm_wa_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_members(user_id) on delete cascade,
  channel_id uuid not null references public.crm_wa_channels(id) on delete cascade,
  conversation_id uuid,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  constraint crm_wa_access_scope check (
    (conversation_id is null and role = 'admin') or
    (conversation_id is not null and role in ('operator', 'viewer'))
  ),
  constraint crm_wa_access_conversation_channel foreign key (conversation_id, channel_id)
    references public.crm_wa_conversations(id, channel_id) on delete cascade
);
create unique index crm_wa_access_channel_admin_unique
  on public.crm_wa_access(user_id, channel_id) where conversation_id is null;
create unique index crm_wa_access_conversation_unique
  on public.crm_wa_access(user_id, conversation_id) where conversation_id is not null;
create index crm_wa_access_lookup on public.crm_wa_access(user_id, channel_id, conversation_id, role);

alter table public.crm_wa_access enable row level security;
revoke all on public.crm_wa_access from anon, authenticated;
grant select on public.crm_wa_access to authenticated;
grant select, insert, update, delete on public.crm_wa_access to service_role;
create policy crm_wa_access_self_read on public.crm_wa_access for select to authenticated
  using (user_id = (select auth.uid()));

-- This CRM currently has one member. Grant only that existing member access to
-- the verified ORYNEO channel; on a different or multi-member installation,
-- administrators must be provisioned explicitly by a service-role operation.
insert into public.crm_wa_access(user_id, channel_id, role)
select m.user_id, c.id, 'admin'
from public.crm_members m
join public.crm_wa_channels c
  on c.business_id = '1098665735949825'
 and c.phone_number_id = '1322421900964911'
where (select count(*) from public.crm_members) = 1;

drop policy crm_wa_channels_member_read on public.crm_wa_channels;
drop policy crm_wa_conversations_member_read on public.crm_wa_conversations;
drop policy crm_wa_messages_member_read on public.crm_wa_messages;

create policy crm_wa_channels_granted_read on public.crm_wa_channels for select to authenticated
  using (exists (
    select 1 from public.crm_wa_access a
    where a.user_id = (select auth.uid()) and a.channel_id = crm_wa_channels.id
  ));
create policy crm_wa_conversations_granted_read on public.crm_wa_conversations for select to authenticated
  using (exists (
    select 1 from public.crm_wa_access a
    where a.user_id = (select auth.uid()) and a.channel_id = crm_wa_conversations.channel_id
      and ((a.conversation_id is null and a.role = 'admin') or a.conversation_id = crm_wa_conversations.id)
  ));
create policy crm_wa_messages_granted_read on public.crm_wa_messages for select to authenticated
  using (exists (
    select 1 from public.crm_wa_conversations c where c.id = conversation_id
  ));
