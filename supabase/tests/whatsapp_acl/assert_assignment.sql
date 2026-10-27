set role service_role;
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.crm_wa_conversations where customer_wa_id='5521999999999';
  perform public.crm_wa_assign_conversation(v_id,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004');
  if (select assignee_user_id from public.crm_wa_conversations where id=v_id) <> '00000000-0000-4000-8000-000000000004'::uuid
    then raise exception 'first assignment failed'; end if;
  if not exists (select 1 from public.crm_wa_access where conversation_id=v_id and user_id='00000000-0000-4000-8000-000000000004' and role='operator')
    then raise exception 'operator grant missing'; end if;
  perform public.crm_wa_assign_conversation(v_id,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
  if exists (select 1 from public.crm_wa_access where conversation_id=v_id and user_id='00000000-0000-4000-8000-000000000004')
    then raise exception 'old operator still has access'; end if;
  if not exists (select 1 from public.crm_wa_access where conversation_id=v_id and user_id='00000000-0000-4000-8000-000000000003' and role='operator')
    then raise exception 'new operator grant missing'; end if;
  if (select count(*) from public.crm_wa_assignment_events where conversation_id=v_id) <> 2
    then raise exception 'audit events missing'; end if;
  begin
    perform public.crm_wa_assign_conversation(v_id,'00000000-0000-4000-8000-000000000002',null);
    raise exception 'ungranted member assigned conversation';
  exception when insufficient_privilege then null;
  end;
end$$;
