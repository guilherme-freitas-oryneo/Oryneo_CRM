-- Exactly one accountable operator per conversation; transfers are serialized.
alter table public.crm_wa_conversations
  add column assignee_user_id uuid references public.crm_members(user_id) on delete set null;
create index crm_wa_conversations_assignee_recent
  on public.crm_wa_conversations(assignee_user_id,last_message_at desc nulls last,id)
  where assignee_user_id is not null;

create table public.crm_wa_assignment_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_wa_conversations(id),
  actor_id uuid not null,
  from_user_id uuid,
  to_user_id uuid,
  occurred_at timestamptz not null default now()
);
create index crm_wa_assignment_events_conversation
  on public.crm_wa_assignment_events(conversation_id,occurred_at desc,id);
alter table public.crm_wa_assignment_events enable row level security;
revoke all on public.crm_wa_assignment_events from anon,authenticated;
grant select,insert on public.crm_wa_assignment_events to service_role;

create function public.crm_wa_assign_conversation(
  p_conversation_id uuid, p_actor_id uuid, p_assignee_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_channel_id uuid;
  v_previous uuid;
begin
  select c.channel_id,c.assignee_user_id into v_channel_id,v_previous
  from public.crm_wa_conversations c
  where c.id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.' using errcode='P0002'; end if;
  if not exists (
    select 1 from public.crm_wa_access a
    where a.user_id = p_actor_id and a.channel_id = v_channel_id
      and a.conversation_id is null and a.role = 'admin'
  ) then raise exception 'Atribuição não autorizada.' using errcode='42501'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.crm_members m where m.user_id = p_assignee_id
  ) then raise exception 'Operador não encontrado.' using errcode='22023'; end if;
  if v_previous is not distinct from p_assignee_id then return; end if;

  delete from public.crm_wa_access a
  where a.conversation_id = p_conversation_id and a.role = 'operator';
  if p_assignee_id is not null then
    insert into public.crm_wa_access(user_id,channel_id,conversation_id,role)
    values(p_assignee_id,v_channel_id,p_conversation_id,'operator')
    on conflict (user_id,conversation_id) where conversation_id is not null
    do update set role='operator';
  end if;
  update public.crm_wa_conversations
  set assignee_user_id=p_assignee_id,updated_at=now()
  where id=p_conversation_id;
  insert into public.crm_wa_assignment_events(conversation_id,actor_id,from_user_id,to_user_id)
  values(p_conversation_id,p_actor_id,v_previous,p_assignee_id);
end;
$$;
revoke all on function public.crm_wa_assign_conversation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_wa_assign_conversation(uuid,uuid,uuid) to service_role;
