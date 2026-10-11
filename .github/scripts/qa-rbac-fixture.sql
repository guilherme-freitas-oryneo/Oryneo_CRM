-- Only for the disposable PostgreSQL QA database.
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','guilherme.freitas@oryneo.com.br'),
 ('22222222-2222-4222-8222-222222222222','commercial@example.test');

insert into public.crm_members(user_id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.crm_records(kind,data)
select 'deal',jsonb_build_object(
  'title','Oportunidade histórica QA',
  'company','Empresa QA',
  'value_cents',100,
  'stage_id',id::text
)
from public.crm_records
where kind='stage' and not deleted and data->>'outcome'='open'
order by (data->>'position')::int
limit 1;
