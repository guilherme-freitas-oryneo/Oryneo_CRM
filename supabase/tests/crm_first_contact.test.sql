begin;

do $test$
declare
  v_expected jsonb := jsonb_build_object(
    '87f1e31e-3912-40b0-9284-c6805c84dafe', 'Diagnóstico pendente',
    '621dfba1-d185-4732-96a0-afefe603ad65', 'Diagnóstico agendado',
    '8e200e46-92db-4419-b752-11ab089fd5a3', 'Qualificada',
    'e980564c-5249-47b4-9c22-671b98f24550', 'Proposta enviada',
    'f883a26d-d813-4d09-b807-fa1eb44396f4', 'Em decisão',
    '6ab321bd-5ec4-4dfc-b8c0-4824da854273', 'Ganha',
    '2f0e27bf-cc1f-4656-9905-170fbc45b25c', 'Perdida'
  );
  v_stage record;
begin
  if to_regprocedure('public.crm_business_due(timestamptz,text)') is null then
    raise exception 'missing crm_business_due';
  end if;
  if to_regprocedure('public.crm_record_first_contact(uuid,uuid,text,uuid)') is null then
    raise exception 'missing crm_record_first_contact';
  end if;

  if (select count(*) from public.crm_records where kind='stage' and not deleted) <> 7 then
    raise exception 'unexpected active stage count';
  end if;
  for v_stage in
    select id,data->>'name' as name from public.crm_records where kind='stage' and not deleted
  loop
    if v_expected->>v_stage.id::text is distinct from v_stage.name then
      raise exception 'stage id/name changed unexpectedly: % %',v_stage.id,v_stage.name;
    end if;
  end loop;

  if public.crm_business_due('2026-10-12 08:00:00-03','initial_two_hours') <> '2026-10-12 10:00:00-03'::timestamptz
     or public.crm_business_due('2026-10-12 16:00:00-03','initial_two_hours') <> '2026-10-12 18:00:00-03'::timestamptz
     or public.crm_business_due('2026-10-12 16:00:01-03','initial_two_hours') <> '2026-10-13 10:00:00-03'::timestamptz
     or public.crm_business_due('2026-10-12 07:30:00-03','initial_two_hours') <> '2026-10-12 10:00:00-03'::timestamptz
     or public.crm_business_due('2026-10-16 18:00:00-03','initial_two_hours') <> '2026-10-19 10:00:00-03'::timestamptz
     or public.crm_business_due('2026-10-17 12:00:00-03','initial_two_hours') <> '2026-10-19 10:00:00-03'::timestamptz then
    raise exception 'initial SLA boundaries invalid';
  end if;
  if public.crm_business_due('2026-10-16 15:30:00-03','next_weekday') <> '2026-10-19 15:30:00-03'::timestamptz
     or public.crm_business_due('2026-10-15 09:17:00-03','next_weekday') <> '2026-10-16 09:17:00-03'::timestamptz then
    raise exception 'next weekday SLA invalid';
  end if;

  if has_function_privilege('anon','public.crm_business_due(timestamptz,text)','execute')
     or has_function_privilege('authenticated','public.crm_business_due(timestamptz,text)','execute')
     or has_function_privilege('anon','public.crm_record_first_contact(uuid,uuid,text,uuid)','execute')
     or has_function_privilege('authenticated','public.crm_record_first_contact(uuid,uuid,text,uuid)','execute') then
    raise exception 'first contact RPC exposed to browser roles';
  end if;
  if not has_function_privilege('service_role','public.crm_business_due(timestamptz,text)','execute')
     or not has_function_privilege('service_role','public.crm_record_first_contact(uuid,uuid,text,uuid)','execute') then
    raise exception 'first contact RPC unavailable to service role';
  end if;
end
$test$;

do $test$
declare
  v_actor constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_request constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_key_one constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_key_two constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_deal uuid;
  v_before_revision bigint;
  v_after_revision bigint;
  v_stage uuid;
  v_result jsonb;
begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated','tester@oryneo.local','',now(),'{}','{}',now(),now());
  insert into public.crm_members(user_id) values(v_actor);

  v_deal := public.crm_intake(v_request,'test-fingerprint',jsonb_build_object(
    'title','Lead de teste','company','Acme','contact','Marina','email','marina@example.com','phone','11999990000',
    'notes','','form_submission',jsonb_build_object('intent','conversation','acquisition_channel','Google')
  ));
  select revision,(data->>'stage_id')::uuid into v_before_revision,v_stage from public.crm_records where id=v_deal;
  if (select data->'next_action'->>'title' from public.crm_records where id=v_deal) <> 'Realizar primeiro contato'
     or (select data->'next_action'->>'due_at' from public.crm_records where id=v_deal) is null then
    raise exception 'intake did not create initial SLA action';
  end if;

  v_result := public.crm_record_first_contact(v_deal,v_key_one,'<message-one@oryneo.local>',v_actor);
  if coalesce((v_result->>'already_recorded')::boolean,true) then raise exception 'first record marked duplicate'; end if;
  select revision into v_after_revision from public.crm_records where id=v_deal;
  if v_after_revision <> v_before_revision+1 then raise exception 'first contact revision increment invalid'; end if;
  if (select (data->>'stage_id')::uuid from public.crm_records where id=v_deal) <> v_stage then raise exception 'first contact moved stage'; end if;
  if (select data->'first_contact'->>'idempotency_key' from public.crm_records where id=v_deal) <> v_key_one::text then raise exception 'first contact status missing'; end if;
  if (select data->'next_action'->>'title' from public.crm_records where id=v_deal) <> 'Acompanhar resposta do diagnóstico' then raise exception 'follow-up action missing'; end if;
  if (select count(*) from public.crm_events where deal_id=v_deal and event_type='email_sent') <> 1 then raise exception 'email event missing'; end if;

  v_result := public.crm_record_first_contact(v_deal,v_key_one,'<message-one@oryneo.local>',v_actor);
  if not coalesce((v_result->>'already_recorded')::boolean,false) then raise exception 'retry not marked idempotent'; end if;
  if (select revision from public.crm_records where id=v_deal) <> v_after_revision
     or (select count(*) from public.crm_events where deal_id=v_deal and event_type='email_sent') <> 1 then
    raise exception 'retry changed CRM state';
  end if;

  perform public.crm_record_first_contact(v_deal,v_key_two,'<message-two@oryneo.local>',v_actor);
  if (select count(*) from public.crm_events where deal_id=v_deal and event_type='email_sent') <> 2 then raise exception 'explicit resend not recorded'; end if;
  if (select data->'first_contact'->>'idempotency_key' from public.crm_records where id=v_deal) <> v_key_one::text then raise exception 'resend replaced original first contact'; end if;
end
$test$;

rollback;
