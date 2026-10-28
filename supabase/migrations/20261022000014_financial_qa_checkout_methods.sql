-- Extend the existing private QA store to reconcile TEST card sessions while
-- retaining recurring boleto invoice and one-time Pix reconciliation paths.
create or replace function public.oryneo_qa_webhook_lookup(p_method text,p_provider_id text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v oryneo_financial_qa.orders%rowtype; v_role text;
begin
 if p_method='pix' and p_provider_id ~ '^cs_test_[A-Za-z0-9_]+$' then
  select * into v from oryneo_financial_qa.orders where method='pix' and stripe_checkout_session_id=p_provider_id;
 elsif p_method='card' and p_provider_id ~ '^cs_test_[A-Za-z0-9_]+$' then
  select * into v from oryneo_financial_qa.orders where method=p_method and stripe_checkout_session_id=p_provider_id;
  v_role:='primary';
 elsif p_method in ('boleto','card') and p_provider_id ~ '^sub_[A-Za-z0-9_]+$' then
  select * into v from oryneo_financial_qa.orders where method=p_method and stripe_subscription_id=p_provider_id;
  v_role:='primary';
  if not found then
   select * into v from oryneo_financial_qa.orders where method=p_method and stripe_traffic_subscription_id=p_provider_id;
   v_role:='traffic_quarterly';
  end if;
 else return null; end if;
 if not found then return null; end if;
 return pg_catalog.jsonb_build_object('id',v.id,'owner_id',v.owner_id,'method',v.method,'state',v.state,
  'amount_cents',v.amount_cents,'environment',v.environment,'plan',v.plan,'cycle',v.cycle,'selection',v.selection,
  'stripe_checkout_session_id',v.stripe_checkout_session_id,'stripe_customer_id',v.stripe_customer_id,
  'stripe_subscription_id',v.stripe_subscription_id,'stripe_invoice_id',v.stripe_invoice_id,
  'stripe_traffic_subscription_id',v.stripe_traffic_subscription_id,
  'traffic_subscription_status',v.traffic_subscription_status,'traffic_renewal_price_id',v.traffic_renewal_price_id,
  'paid_at',v.paid_at,'subscription_role',v_role);
end
$function$;

create or replace function public.oryneo_qa_billing_link(
 p_order_id uuid,p_owner_id uuid,p_checkout_session_id text,p_customer_id text,p_subscription_id text,p_invoice_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v oryneo_financial_qa.orders%rowtype;
begin
 select * into strict v from oryneo_financial_qa.orders where id=p_order_id and owner_id=p_owner_id for update;
 if v.state not in ('awaiting_payment','failed','paid') then raise exception 'QA_ORDER_NOT_LINKABLE'; end if;
 if (v.method='pix' and (p_checkout_session_id is null or p_checkout_session_id !~ '^cs_test_[A-Za-z0-9_]+$'
      or p_customer_id is not null or p_subscription_id is not null or p_invoice_id is not null))
  or (v.method='boleto' and (p_checkout_session_id is not null or p_customer_id is null
      or p_customer_id !~ '^cus_[A-Za-z0-9_]+$' or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
      or p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9_]+$'))
  or (v.method='card' and (p_checkout_session_id is null or p_checkout_session_id !~ '^cs_test_[A-Za-z0-9_]+$'
      or ((p_customer_id is null)<>(p_subscription_id is null))
      or (p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9_]+$')
      or (p_subscription_id is not null and p_subscription_id !~ '^sub_[A-Za-z0-9_]+$')
      or (p_invoice_id is not null and p_invoice_id !~ '^in_[A-Za-z0-9_]+$')))
 then raise exception 'QA_PROVIDER_IDENTITY_INVALID' using errcode='22023'; end if;
 if (v.stripe_checkout_session_id is not null and v.stripe_checkout_session_id is distinct from p_checkout_session_id)
  or (v.stripe_customer_id is not null and v.stripe_customer_id is distinct from p_customer_id)
  or (v.stripe_subscription_id is not null and v.stripe_subscription_id is distinct from p_subscription_id)
  or (v.stripe_invoice_id is not null and v.stripe_invoice_id is distinct from p_invoice_id)
 then raise exception 'QA_PROVIDER_LINK_CONFLICT' using errcode='23505'; end if;
 update oryneo_financial_qa.orders set
  stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_checkout_session_id),
  stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),
  stripe_subscription_id=coalesce(stripe_subscription_id,p_subscription_id),
  stripe_invoice_id=coalesce(stripe_invoice_id,p_invoice_id),updated_at=now()
 where id=v.id;
 return pg_catalog.jsonb_build_object('ok',true,'order_id',v.id);
end
$function$;

create or replace function public.oryneo_qa_billing_reconcile(
 p_order_id uuid,p_owner_id uuid,p_provider_object_id text,p_provider_status text,
 p_confirmed_paid boolean,p_paid_amount integer,p_event_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v oryneo_financial_qa.orders%rowtype; v_inserted integer;
begin
 select * into strict v from oryneo_financial_qa.orders where id=p_order_id and owner_id=p_owner_id for update;
 if p_event_key !~ '^qa_[a-zA-Z0-9_-]+$' or
  p_provider_object_id is distinct from
   (case when v.method='pix' and v.stripe_checkout_session_id is not null
    then v.stripe_checkout_session_id else v.stripe_invoice_id end)
  or p_provider_status is null or length(p_provider_status)>64
  or (p_confirmed_paid and (p_provider_status<>'paid' or p_paid_amount is distinct from v.amount_cents))
 then raise exception 'QA_SETTLEMENT_CONTRACT_MISMATCH' using errcode='22023'; end if;
 insert into oryneo_financial_qa.events(order_id,event_key,event_type,provider_status)
 values(v.id,p_event_key,case when p_confirmed_paid then 'paid' else 'checked' end,p_provider_status)
 on conflict(event_key) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then return pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'state',v.state); end if;
 update oryneo_financial_qa.orders
 set state=case when p_confirmed_paid then 'paid' when state='paid' then 'paid'
          when p_provider_status in ('expired','void','uncollectible') then 'expired'
          when p_provider_status in ('failed','payment_failed') then 'failed' else state end,
  provider_status=p_provider_status,
  paid_at=case when p_confirmed_paid then coalesce(paid_at,now()) else paid_at end,
  last_checked_at=now(),updated_at=now()
 where id=v.id;
 return pg_catalog.jsonb_build_object('ok',true,'duplicate',false,
  'state',(select state from oryneo_financial_qa.orders where id=v.id));
end
$function$;
