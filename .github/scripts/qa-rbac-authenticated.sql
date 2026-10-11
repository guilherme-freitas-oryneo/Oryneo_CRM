-- Verify the public API with ordinary authenticated privileges, not postgres.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
begin
 if (select count(*) from public.crm_get_board() where kind='deal')<>2 then
  raise exception 'Comercial não vê as oportunidades atribuídas';
 end if;
 begin
  perform 1 from public.crm_records;
  raise exception 'Tabela base acessível';
 exception when insufficient_privilege then null;
 end;
 begin
  perform 1 from public.crm_member_audit;
  raise exception 'Auditoria acessível';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.crm_list_members();
  raise exception 'Comercial listou equipe';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$
begin
 if exists(select 1 from public.crm_get_board() where kind='deal') then
  raise exception 'Suporte viu oportunidade reatribuída';
 end if;
end $$;
reset role;
