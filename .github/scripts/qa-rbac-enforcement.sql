-- Run after foundation, read API and qa-rbac-read.sql in a disposable database.
do $$
declare other_deal uuid; own_deal uuid; operation uuid; result_count int;
begin
 select id into other_deal from public.crm_records where data->>'title'='Oportunidade suporte QA';
 select id into own_deal from public.crm_records where data->>'title'='Oportunidade comercial QA';
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 begin
  perform public.crm_add_note(other_deal,'Tentativa indevida');
  raise exception 'Comercial escreveu no negócio de suporte';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.crm_mutate(other_deal,'deal',(select data from public.crm_records where id=other_deal),1,false);
  raise exception 'Comercial alterou o negócio de suporte';
 exception when insufficient_privilege then null;
 end;
 perform public.crm_add_note(own_deal,'Nota permitida');

 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 begin
  perform public.crm_mutate(other_deal,'deal',(select data from public.crm_records where id=other_deal),1,false);
  raise exception 'Suporte editou valores da oportunidade';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
 begin
  perform public.crm_add_note(own_deal,'Tentativa indevida');
  raise exception 'Leitura escreveu';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 select count(*) into result_count from public.crm_get_events(own_deal);
 if result_count=0 then raise exception 'Eventos próprios indisponíveis'; end if;
 begin
  perform public.crm_get_events(other_deal);
  raise exception 'Comercial leu eventos de outro';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 if exists(select 1 from public.crm_get_events(other_deal) where detail ? 'value_cents' or event_type='value_changed') then
  raise exception 'Suporte recebeu evento financeiro';
 end if;

 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 begin
  perform public.crm_set_member('11111111-1111-4111-8111-111111111111','viewer','active','Teste');
  raise exception 'Último administrador foi rebaixado';
 exception when raise_exception then
  if sqlerrm='Último administrador foi rebaixado' then raise; end if;
 end;
 perform public.crm_assign_deal(other_deal,'22222222-2222-4222-8222-222222222222');
 if (select owner_user_id from public.crm_records where id=other_deal) is distinct from '22222222-2222-4222-8222-222222222222'::uuid then
  raise exception 'Atribuição administrativa falhou';
 end if;
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 if exists(select 1 from public.crm_get_board() where id=other_deal) then
  raise exception 'Ex-responsável continua vendo negócio';
 end if;
end $$;

-- Direct table access must be denied even with a valid JWT.
set role authenticated;
do $$ begin
 begin
  perform 1 from public.crm_records limit 1;
  raise exception 'SELECT direto em crm_records permitido';
 exception when insufficient_privilege then null;
 end;
 begin
  perform 1 from public.crm_events limit 1;
  raise exception 'SELECT direto em crm_events permitido';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
