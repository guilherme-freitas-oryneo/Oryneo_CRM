-- Run with the four-member RBAC fixture in a disposable DB.
do $$
declare a uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; b uuid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
begin
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 perform public.crm_presence_ping(a);
 perform public.crm_presence_ping(b);
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if not (select online from public.crm_list_presence() where user_id='22222222-2222-4222-8222-222222222222') then
  raise exception 'Comercial deveria estar online';
 end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 perform public.crm_presence_leave(a);
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if not (select online from public.crm_list_presence() where user_id='22222222-2222-4222-8222-222222222222') then
  raise exception 'Outra sessão ativa foi ignorada';
 end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 perform public.crm_presence_leave(b);
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if (select online from public.crm_list_presence() where user_id='22222222-2222-4222-8222-222222222222')
  or (select last_seen_at from public.crm_list_presence() where user_id='22222222-2222-4222-8222-222222222222') is null then
  raise exception 'Logout não marcou offline e último acesso';
 end if;
 perform public.crm_set_member('22222222-2222-4222-8222-222222222222','commercial','suspended','Teste');
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 begin
  perform public.crm_presence_ping(a);
  raise exception 'Conta suspensa publicou presença';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 perform public.crm_set_member('22222222-2222-4222-8222-222222222222','commercial','active','Teste');
end $$;

do $$
declare client uuid; i integer; duration bigint;
begin
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 for i in 1..8 loop
  client:=('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid;
  perform public.crm_presence_ping(client);
 end loop;
 begin
  perform public.crm_presence_ping('aaaaaaaa-aaaa-4aaa-8aaa-000000000009');
  raise exception 'Nona sessão ativa foi aceita';
 exception when program_limit_exceeded then null;
 end;
 delete from public.crm_presence_sessions where user_id='22222222-2222-4222-8222-222222222222';
 insert into public.crm_presence_sessions(user_id,client_id,online_since_at,last_seen_at,expires_at)
 values('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000001',now()-interval '50 seconds',now()-interval '20 seconds',now()-interval '1 second');
 update public.crm_members set last_seen_at=now()-interval '20 seconds',last_session_seconds=null
 where user_id='22222222-2222-4222-8222-222222222222';
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 select last_session_seconds into duration from public.crm_list_presence()
 where user_id='22222222-2222-4222-8222-222222222222';
 if duration<29 then raise exception 'Duração de sessão expirada não exibida'; end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 perform public.crm_presence_ping('aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
 if (select last_session_seconds from public.crm_members
  where user_id='22222222-2222-4222-8222-222222222222')<29 then
  raise exception 'Duração expirada não foi preservada após limpeza';
 end if;
 if (select count(*) from public.crm_presence_sessions
  where user_id='22222222-2222-4222-8222-222222222222')<>1 then
  raise exception 'Sessões expiradas não foram removidas';
 end if;
end $$;
