insert into auth.users values
('00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000004');
insert into public.crm_members values
('00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000004');
insert into public.crm_wa_access(user_id,channel_id,conversation_id,role)
select '00000000-0000-4000-8000-000000000003',channel_id,id,'viewer' from public.crm_wa_conversations;
insert into public.crm_wa_access(user_id,channel_id,conversation_id,role)
select '00000000-0000-4000-8000-000000000004',channel_id,id,'operator' from public.crm_wa_conversations;

do $$begin
  if (select count(*) from public.crm_wa_access where role='admin') <> 1 then raise exception 'admin seed failed'; end if;
end$$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
do $$begin
  if (select count(*) from public.crm_wa_conversations) <> 1 then raise exception 'admin cannot read'; end if;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$begin
  if (select count(*) from public.crm_wa_channels) <> 0 then raise exception 'ungranted member sees channel'; end if;
  if (select count(*) from public.crm_wa_conversations) <> 0 then raise exception 'ungranted member sees conversation'; end if;
  if (select count(*) from public.crm_wa_messages) <> 0 then raise exception 'ungranted member sees message'; end if;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
do $$begin
  if (select count(*) from public.crm_wa_conversations) <> 1 then raise exception 'viewer cannot read assigned conversation'; end if;
  if (select count(*) from public.crm_wa_messages) <> 1 then raise exception 'viewer cannot read assigned message'; end if;
end$$;
reset role;
set role anon;
do $$begin
  begin
    perform count(*) from public.crm_wa_conversations;
    raise exception 'anon was allowed to read conversations';
  exception when insufficient_privilege then null;
  end;
end$$;
