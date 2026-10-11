-- Run after qa-rbac-fixture.sql and the RBAC foundation migration, in a disposable DB.
insert into auth.users(id,email) values
 ('33333333-3333-4333-8333-333333333333','support@example.test'),
 ('44444444-4444-4444-8444-444444444444','viewer@example.test');

insert into public.crm_members(user_id,role,directory_email) values
 ('22222222-2222-4222-8222-222222222222','commercial','commercial@example.test'),
 ('33333333-3333-4333-8333-333333333333','support','support@example.test'),
 ('44444444-4444-4444-8444-444444444444','viewer','viewer@example.test');

insert into public.crm_records(kind,data,owner_user_id)
select 'deal',jsonb_build_object(
  'title','Oportunidade comercial QA',
  'company','Empresa Comercial QA',
  'email','lead@example.test',
  'value_cents',123456,
  'quote',jsonb_build_object('plan','Growth'),
  'stage_id',id::text
),'22222222-2222-4222-8222-222222222222'
from public.crm_records where kind='stage' and data->>'outcome'='open'
order by (data->>'position')::int limit 1;

insert into public.crm_records(kind,data,owner_user_id)
select 'deal',jsonb_build_object(
  'title','Oportunidade suporte QA',
  'company','Empresa Suporte QA',
  'email','support-lead@example.test',
  'value_cents',98765,
  'quote',jsonb_build_object('plan','Scale'),
  'stage_id',id::text
),'33333333-3333-4333-8333-333333333333'
from public.crm_records where kind='stage' and data->>'outcome'='open'
order by (data->>'position')::int limit 1;

do $$
declare rows jsonb;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  select jsonb_agg(to_jsonb(b)) into rows from public.crm_get_board() b where b.kind='deal';
  if jsonb_array_length(rows)<>3 then raise exception 'Admin não vê as três oportunidades'; end if;

  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  select jsonb_agg(to_jsonb(b)) into rows from public.crm_get_board() b where b.kind='deal';
  if jsonb_array_length(rows)<>1 or rows::text not like '%Oportunidade comercial QA%'
    or rows::text like '%Oportunidade suporte QA%' then
    raise exception 'Comercial viu oportunidade de outra pessoa ou perdeu a sua';
  end if;

  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  select jsonb_agg(to_jsonb(b)) into rows from public.crm_get_board() b where b.kind='deal';
  if jsonb_array_length(rows)<>1 or rows::text not like '%Oportunidade suporte QA%'
    or rows::text like '%value_cents%' or rows::text like '%quote%' then
    raise exception 'Suporte recebeu negócio alheio ou campo financeiro';
  end if;

  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  if (select count(*) from public.crm_get_board() where kind='deal')<>0 then
    raise exception 'Leitura recebeu oportunidade não atribuída';
  end if;
end $$;
