create table public.crm_billing_refunds (
  refund_id text primary key check (refund_id ~ '^re_[A-Za-z0-9_]+$'),
  order_id uuid not null references public.crm_billing_orders(id) on delete restrict,
  latest_event_id text not null,
  status text not null check (status in ('pending','requires_action','succeeded','failed','canceled')),
  amount integer not null check (amount>0),
  currency text not null check (currency='brl'),
  livemode boolean not null,
  payment_intent_id text,
  charge_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_billing_refunds_order on public.crm_billing_refunds(order_id,created_at desc);
alter table public.crm_billing_refunds enable row level security;
revoke all on public.crm_billing_refunds from anon,authenticated;
grant select on public.crm_billing_refunds to authenticated;
grant select,insert,update on public.crm_billing_refunds to service_role;
create policy crm_billing_refunds_members_read on public.crm_billing_refunds for select to authenticated
  using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create function public.crm_record_stripe_refund_event(
  p_event_id text,p_event_type text,p_refund_id text,p_order_id uuid,
  p_status text,p_amount integer,p_currency text,p_livemode boolean,
  p_payment_intent_id text default null,p_charge_id text default null,p_failure_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.crm_billing_orders%rowtype;
  v_inserted integer;
  v_refunded bigint;
begin
  if coalesce(p_event_id,'')='' or p_event_type not in ('refund.created','refund.updated','refund.failed')
    or p_refund_id !~ '^re_[A-Za-z0-9_]+$' or p_status not in ('pending','requires_action','succeeded','failed','canceled')
    or p_amount<=0 or p_currency<>'brl' then
    raise exception 'Invalid refund event' using errcode='22023';
  end if;
  select * into v_order from public.crm_billing_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','unknown_order'); end if;
  if (v_order.billing_environment='live') is distinct from p_livemode then
    return jsonb_build_object('ok',false,'reason','environment_mismatch');
  end if;
  insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
  values(p_event_id,p_event_type,p_livemode,jsonb_build_object('refund_id',p_refund_id,'order_id',p_order_id,'status',p_status,'amount',p_amount,'currency',p_currency))
  on conflict(event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return jsonb_build_object('ok',true,'duplicate',true); end if;

  insert into public.crm_billing_refunds(refund_id,order_id,latest_event_id,status,amount,currency,livemode,payment_intent_id,charge_id,failure_reason)
  values(p_refund_id,p_order_id,p_event_id,p_status,p_amount,p_currency,p_livemode,p_payment_intent_id,p_charge_id,left(p_failure_reason,240))
  on conflict(refund_id) do update set
    latest_event_id=excluded.latest_event_id,status=excluded.status,amount=excluded.amount,
    payment_intent_id=coalesce(excluded.payment_intent_id,public.crm_billing_refunds.payment_intent_id),
    charge_id=coalesce(excluded.charge_id,public.crm_billing_refunds.charge_id),
    failure_reason=excluded.failure_reason,updated_at=now()
  where public.crm_billing_refunds.order_id=excluded.order_id
    and public.crm_billing_refunds.currency=excluded.currency
    and public.crm_billing_refunds.livemode=excluded.livemode;
  if not found then return jsonb_build_object('ok',false,'reason','refund_identity_mismatch'); end if;

  select coalesce(sum(amount),0) into v_refunded from public.crm_billing_refunds
  where order_id=p_order_id and status='succeeded';
  if v_refunded>=v_order.amount_total and v_order.status in ('paid','refunded') then
    update public.crm_billing_orders set status='refunded',updated_at=now() where id=p_order_id;
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'refunded_amount',v_refunded,
    'full_refund',v_refunded>=v_order.amount_total,'order_status',(select status from public.crm_billing_orders where id=p_order_id));
end $$;
revoke all on function public.crm_record_stripe_refund_event(text,text,text,uuid,text,integer,text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_refund_event(text,text,text,uuid,text,integer,text,boolean,text,text,text) to service_role;
