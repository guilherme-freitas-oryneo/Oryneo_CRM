-- Expand-only live billing cutover. Old sandbox RPC remains available while
-- existing Edge Function instances drain; new calls use the generic RPC.
alter table public.crm_billing_orders
  add column if not exists commercial_consent_at timestamptz,
  add column if not exists commercial_consent_version text,
  add column if not exists commercial_consent_snapshot jsonb;

create or replace function public.crm_create_direct_checkout(
  p_request_id uuid, p_fingerprint text, p_token_hash text, p_deal_data jsonb, p_order jsonb, p_environment text
) returns table(order_id uuid, reference text, stripe_checkout_session_id text)
language plpgsql security definer set search_path='' as $$
declare v_deal uuid; v_stage uuid; v_member uuid; v_order uuid;
begin
  if p_request_id is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_deal_data) <> 'object' or jsonb_typeof(p_order) <> 'object'
    or p_environment not in ('test','live') then raise exception 'Pedido direto inválido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 20261019));
  select request.deal_id into v_deal from public.crm_intake_requests request where request.request_id=p_request_id;
  if found then
    select id into v_order from public.crm_billing_orders where deal_id=v_deal order by created_at desc limit 1;
    if v_order is null then raise exception 'Pedido em preparação. Tente novamente.' using errcode='40001'; end if;
    if not exists(select 1 from public.crm_billing_orders where id=v_order and public_token_hash=p_token_hash and billing_environment=p_environment) then raise exception 'Solicitação já usada.' using errcode='42501'; end if;
    return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_order; return;
  end if;
  select id into v_stage from public.crm_records where kind='stage' and not deleted and data->>'outcome'='open' order by (data->>'position')::numeric,id limit 1;
  if v_stage is null then raise exception 'Captação temporariamente indisponível.'; end if;
  select user_id into v_member from public.crm_members order by user_id limit 1;
  if v_member is null then raise exception 'Operação indisponível.'; end if;
  insert into public.crm_records(kind,data) values('deal',p_deal_data || jsonb_build_object('stage_id',v_stage,'source',case when p_environment='live' then 'Checkout direto' else 'Checkout direto (sandbox)' end,'checkout_origin',case when p_environment='live' then 'direct_live' else 'direct_sandbox' end,'next_action',jsonb_build_object('title',case when p_environment='live' then 'Acompanhar pagamento' else 'Acompanhar pagamento sandbox' end,'done',false,'updated_at',now()))) returning id into v_deal;
  insert into public.crm_intake_requests(request_id,deal_id,fingerprint) values(p_request_id,v_deal,p_fingerprint);
  insert into public.crm_billing_orders(deal_id,reference,public_token_hash,status,catalog_version,billing_environment,stripe_traffic_renewal_price_id,selection,items,amount_total,customer_name,customer_email,company,created_by)
  values(v_deal,p_order->>'reference',p_token_hash,'awaiting_payment',p_order->>'catalog_version',p_environment,nullif(p_order->>'traffic_renewal_price_id',''),p_order->'selection',p_order->'items',(p_order->>'amount_total')::integer,p_order->>'customer_name',p_order->>'customer_email',p_order->>'company',v_member) returning id into v_order;
  insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal,'received','Sistema ORYNEO',jsonb_build_object('source',case when p_environment='live' then 'Checkout direto' else 'Checkout direto (sandbox)' end,'order_id',v_order,'billing_environment',p_environment));
  return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_order;
end $$;
revoke all on function public.crm_create_direct_checkout(uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_create_direct_checkout(uuid,text,text,jsonb,jsonb,text) to service_role;

create or replace function public.crm_record_billing_consent(p_token_hash text,p_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.crm_billing_orders%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_version <> 'checkout-2026-10-19' then raise exception 'Aceite inválido.' using errcode='22023'; end if;
  select * into v_order from public.crm_billing_orders where public_token_hash=p_token_hash for update;
  if v_order.id is null or v_order.status <> 'awaiting_payment' then return jsonb_build_object('ok',false); end if;
  if v_order.commercial_consent_at is null then
    update public.crm_billing_orders set commercial_consent_at=now(),commercial_consent_version=p_version,commercial_consent_snapshot=jsonb_build_object('reference',v_order.reference,'billing_environment',v_order.billing_environment,'currency',v_order.currency,'amount_total',v_order.amount_total,'selection',v_order.selection,'items',v_order.items),updated_at=now() where id=v_order.id;
    insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_order.deal_id,'note','Cliente',jsonb_build_object('kind','commercial_consent','version',p_version,'order_id',v_order.id));
    return jsonb_build_object('ok',true,'recorded',true);
  end if;
  return jsonb_build_object('ok',true,'recorded',false);
end $$;
revoke all on function public.crm_record_billing_consent(text,text) from public,anon,authenticated;
grant execute on function public.crm_record_billing_consent(text,text) to service_role;

create or replace function public.crm_stripe_webhook_secret(p_environment text)
returns text language sql stable security definer set search_path='' as $$
 select s.decrypted_secret from vault.decrypted_secrets s where s.name=case p_environment when 'test' then 'oryneo_stripe_test_webhook' when 'live' then 'oryneo_stripe_live_webhook' else null end limit 1
$$;
revoke all on function public.crm_stripe_webhook_secret(text) from public,anon,authenticated;
grant execute on function public.crm_stripe_webhook_secret(text) to service_role;

-- New overloads preserve the legacy seven-argument RPC during the rolling
-- deployment, while recording the actual Stripe environment for new events.
create or replace function public.crm_record_stripe_checkout_event(
 p_event_id text,p_event_type text,p_session_id text,p_payment_status text,
 p_customer_id text,p_subscription_id text,p_invoice_id text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=public.crm_record_stripe_checkout_event(p_event_id,p_event_type,p_session_id,p_payment_status,p_customer_id,p_subscription_id,p_invoice_id);
  if coalesce((v_result->>'ok')::boolean,false) then update public.crm_stripe_events set livemode=p_livemode where event_id=p_event_id; end if;
  return v_result;
end $$;
revoke all on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text,boolean) to service_role;

create or replace function public.crm_record_stripe_invoice_event(
 p_event_id text,p_event_type text,p_invoice_id text,p_subscription_id text,p_amount_cents integer,p_currency text,p_billing_reason text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=public.crm_record_stripe_invoice_event(p_event_id,p_event_type,p_invoice_id,p_subscription_id,p_amount_cents,p_currency,p_billing_reason);
  if coalesce((v_result->>'ok')::boolean,false) then update public.crm_stripe_events set livemode=p_livemode where event_id=p_event_id; end if;
  return v_result;
end $$;
revoke all on function public.crm_record_stripe_invoice_event(text,text,text,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_invoice_event(text,text,text,text,integer,text,text,boolean) to service_role;

create or replace function public.crm_record_stripe_subscription_event(
 p_event_id text,p_event_type text,p_subscription_id text,p_status text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=public.crm_record_stripe_subscription_event(p_event_id,p_event_type,p_subscription_id,p_status);
  if coalesce((v_result->>'ok')::boolean,false) then update public.crm_stripe_events set livemode=p_livemode where event_id=p_event_id; end if;
  return v_result;
end $$;
revoke all on function public.crm_record_stripe_subscription_event(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_subscription_event(text,text,text,text,boolean) to service_role;
