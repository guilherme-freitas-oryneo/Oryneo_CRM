do $$
declare
  v_message uuid;
  v_member uuid := '00000000-0000-4000-8000-000000000001';
begin
  select id into v_message from public.crm_wa_messages limit 1;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crm_wa_messages' and column_name='reply_to_provider_message_id'
  ) then raise exception 'reply metadata missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crm_wa_messages' and column_name='reaction_to_provider_message_id'
  ) then raise exception 'reaction metadata missing'; end if;
  insert into public.crm_wa_message_hidden(user_id,message_id) values(v_member,v_message);
  if not exists(select 1 from public.crm_wa_message_hidden where user_id=v_member and message_id=v_message) then
    raise exception 'operator hidden state missing';
  end if;
end $$;
