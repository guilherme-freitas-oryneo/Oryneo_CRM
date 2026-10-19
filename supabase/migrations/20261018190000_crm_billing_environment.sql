alter table public.crm_billing_orders
  add column if not exists billing_environment text,
  add column if not exists stripe_traffic_renewal_price_id text;

update public.crm_billing_orders
set billing_environment='test'
where billing_environment is null;

alter table public.crm_billing_orders
  alter column billing_environment set default 'test',
  alter column billing_environment set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='crm_billing_orders_environment_check'
      and conrelid='public.crm_billing_orders'::regclass
  ) then
    alter table public.crm_billing_orders
      add constraint crm_billing_orders_environment_check
      check (billing_environment in ('test','live'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='crm_billing_orders_traffic_price_shape'
      and conrelid='public.crm_billing_orders'::regclass
  ) then
    alter table public.crm_billing_orders
      add constraint crm_billing_orders_traffic_price_shape
      check (stripe_traffic_renewal_price_id is null or stripe_traffic_renewal_price_id ~ '^price_[A-Za-z0-9_]+$')
      not valid;
  end if;
end $$;

alter table public.crm_billing_orders
  validate constraint crm_billing_orders_traffic_price_shape;
