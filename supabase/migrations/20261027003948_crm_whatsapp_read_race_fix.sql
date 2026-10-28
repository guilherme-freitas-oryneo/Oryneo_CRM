-- Preserve unread messages that arrive while an operator acknowledges an older one.
drop function public.crm_wa_mark_conversation_read(uuid);
create function public.crm_wa_mark_conversation_read(p_conversation_id uuid,p_read_through timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.crm_wa_conversations where id = p_conversation_id for update;
  update public.crm_wa_conversations c
  set unread_count = (
        select count(*) from public.crm_wa_messages m
        where m.conversation_id = p_conversation_id and m.direction = 'inbound' and m.occurred_at > p_read_through
      ),
      last_read_at = greatest(coalesce(c.last_read_at,p_read_through),p_read_through),
      updated_at = now()
  where c.id = p_conversation_id;
end;
$$;
revoke all on function public.crm_wa_mark_conversation_read(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_wa_mark_conversation_read(uuid,timestamptz) to service_role;
