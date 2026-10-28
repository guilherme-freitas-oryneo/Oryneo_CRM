-- Direct checkout is deliberately sandbox-only until the audited consent/capability migration.
-- The request id and token hash make retries converge on a single deal and order.
create or replace function public.crm_create_direct_checkout_sandbox(
  p_request_id uuid, p_fingerprint text, p_token_hash text, p_deal_data jsonb, p_order jsonb
) returns table(order_id uuid, reference text, stripe_checkout_session_id text)
language plpgsql security definer set search_path='' as $$
declare v_deal uuid; v_stage uuid; v_member uuid; v_order uuid;
begin
  if p_request_id is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_deal_data) <> 'object' or jsonb_typeof(p_order) <> 'object' then
    raise exception 'Pedido direto inválido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 20261019));
  select request.deal_id into v_deal from public.crm_intake_requests request where request.request_id=p_request_id;
  if found then
    select id into v_order from public.crm_billing_orders where deal_id=v_deal order by created_at desc limit 1;
    if v_order is null then raise exception 'Pedido em preparação. Tente novamente.' using errcode='40001'; end if;
    if not exists(select 1 from public.crm_billing_orders where id=v_order and public_token_hash=p_token_hash) then
      raise exception 'Solicitação já usada.' using errcode='42501';
    end if;
    return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_order;
    return;
  end if;
  select id into v_stage from public.crm_records where kind='stage' and not deleted and data->>'outcome'='open'
    order by (data->>'position')::numeric,id limit 1;
  if v_stage is null then raise exception 'Captação temporariamente indisponível.'; end if;
  select user_id into v_member from public.crm_members order by user_id limit 1;
  if v_member is null then raise exception 'Operação indisponível.'; end if;
  insert into public.crm_records(kind,data) values('deal',p_deal_data || jsonb_build_object(
    'stage_id',v_stage,'source','Checkout direto (sandbox)','checkout_origin','direct_sandbox',
    'next_action',jsonb_build_object('title','Acompanhar pagamento sandbox','done',false,'updated_at',now())
  )) returning id into v_deal;
  insert into public.crm_intake_requests(request_id,deal_id,fingerprint) values(p_request_id,v_deal,p_fingerprint);
  insert into public.crm_billing_orders(
    deal_id,reference,public_token_hash,status,catalog_version,billing_environment,stripe_traffic_renewal_price_id,
    selection,items,amount_total,customer_name,customer_email,company,created_by
  ) values (
    v_deal,p_order->>'reference',p_token_hash,'awaiting_payment',p_order->>'catalog_version','test',nullif(p_order->>'traffic_renewal_price_id',''),
    p_order->'selection',p_order->'items',(p_order->>'amount_total')::integer,p_order->>'customer_name',p_order->>'customer_email',p_order->>'company',v_member
  ) returning id into v_order;
  insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal,'received','Sistema ORYNEO',jsonb_build_object('source','Checkout direto (sandbox)','order_id',v_order));
  return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_order;
end $$;
revoke all on function public.crm_create_direct_checkout_sandbox(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_create_direct_checkout_sandbox(uuid,text,text,jsonb,jsonb) to service_role;
