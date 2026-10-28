-- Additive metadata for quoted replies and reactions. Provider references may
-- point to messages outside the local retention window, so they are not FKs.
alter table public.crm_wa_messages
  add column reply_to_provider_message_id text
    check (reply_to_provider_message_id is null or length(reply_to_provider_message_id) between 1 and 200),
  add column reaction_to_provider_message_id text
    check (reaction_to_provider_message_id is null or length(reaction_to_provider_message_id) between 1 and 200),
  add column reaction_emoji text
    check (reaction_emoji is null or length(reaction_emoji) between 1 and 16);

alter table public.crm_wa_outbox drop constraint crm_wa_outbox_kind_check;
alter table public.crm_wa_outbox add constraint crm_wa_outbox_kind_check
  check (kind in ('text','audio','image','document','video','reaction'));

create index crm_wa_messages_reply_lookup
  on public.crm_wa_messages(conversation_id,reply_to_provider_message_id)
  where reply_to_provider_message_id is not null;
create index crm_wa_messages_reaction_lookup
  on public.crm_wa_messages(conversation_id,reaction_to_provider_message_id)
  where reaction_to_provider_message_id is not null;

-- "Delete for me" is per operator and never removes the provider record.
create table public.crm_wa_message_hidden (
  user_id uuid not null references public.crm_members(user_id) on delete cascade,
  message_id uuid not null references public.crm_wa_messages(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id,message_id)
);
alter table public.crm_wa_message_hidden enable row level security;
revoke all on public.crm_wa_message_hidden from anon,authenticated;
grant select on public.crm_wa_message_hidden to authenticated;
grant select,insert,delete on public.crm_wa_message_hidden to service_role;
create policy crm_wa_message_hidden_self_read on public.crm_wa_message_hidden
  for select to authenticated using (user_id=(select auth.uid()));

drop policy crm_wa_messages_granted_read on public.crm_wa_messages;
create policy crm_wa_messages_granted_read on public.crm_wa_messages for select to authenticated
  using (
    exists(select 1 from public.crm_wa_conversations c where c.id=conversation_id)
    and not exists(
      select 1 from public.crm_wa_message_hidden h
      where h.message_id=crm_wa_messages.id and h.user_id=(select auth.uid())
    )
  );
