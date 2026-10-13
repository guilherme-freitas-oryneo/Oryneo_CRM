create table public.crm_billing_orders (
 id uuid primary key default gen_random_uuid(),
 deal_id uuid not null references public.crm_records(id) on delete restrict,
 reference text not null unique,
 public_token_hash text not null unique,
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','paid','payment_failed','expired','canceled','refunded','requires_review')),
 catalog_version text not null,
 selection jsonb not null,
 items jsonb not null,
 amount_total integer not null check(amount_total>0),
 currency text not null default 'brl' check(currency='brl'),
 customer_name text not null,
 customer_email text not null,
 company text not null,
 stripe_checkout_session_id text unique,
 stripe_customer_id text,
 stripe_subscription_id text,
 stripe_invoice_id text,
 created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default (now()+interval '24 hours'),
 paid_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.crm_stripe_events (
 event_id text primary key,
 event_type text not null,
 livemode boolean not null,
 payload jsonb not null,
 processed_at timestamptz not null default now()
);

create index crm_billing_orders_deal_created on public.crm_billing_orders(deal_id,created_at desc);
alter table public.crm_billing_orders enable row level security;
alter table public.crm_stripe_events enable row level security;
revoke all on public.crm_billing_orders,public.crm_stripe_events from anon,authenticated;
grant select on public.crm_billing_orders to authenticated;
create policy crm_billing_orders_members_read on public.crm_billing_orders for select to authenticated
 using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create or replace function public.crm_billing_order_for_deal(p_deal_id uuid)
returns setof public.crm_billing_orders language sql stable security invoker set search_path=public as $$
 select * from public.crm_billing_orders
 where deal_id=p_deal_id
 and exists(select 1 from public.crm_members where user_id=(select auth.uid()))
 order by created_at desc limit 1
$$;
grant execute on function public.crm_billing_order_for_deal(uuid) to authenticated;
