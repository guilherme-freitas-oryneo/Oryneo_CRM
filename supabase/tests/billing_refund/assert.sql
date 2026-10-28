do $$
declare
  v_order uuid;
  v_result jsonb;
begin
  insert into public.crm_billing_orders(deal_id,reference,public_token_hash,status,catalog_version,selection,items,amount_total,currency,customer_name,customer_email,company,created_by,billing_environment)
  values('20000000-0000-4000-8000-000000000001','ORY-REFUND-1',repeat('a',64),'paid','test','{}','[]',10000,'brl','Cliente','cliente@example.com','Empresa','00000000-0000-4000-8000-000000000001','test') returning id into v_order;
  select public.crm_record_stripe_refund_event('evt_partial','refund.created','re_partial',v_order,'succeeded',4000,'brl',false,'pi_1','ch_1',null) into v_result;
  if (select status from public.crm_billing_orders where id=v_order)<>'paid' or (v_result->>'full_refund')::boolean then raise exception 'partial refund changed paid order'; end if;
  select public.crm_record_stripe_refund_event('evt_full','refund.created','re_full',v_order,'succeeded',6000,'brl',false,'pi_1','ch_1',null) into v_result;
  if (select status from public.crm_billing_orders where id=v_order)<>'refunded' or not (v_result->>'full_refund')::boolean then raise exception 'full refund not reconciled'; end if;
  select public.crm_record_stripe_refund_event('evt_full','refund.created','re_full',v_order,'succeeded',6000,'brl',false,'pi_1','ch_1',null) into v_result;
  if not (v_result->>'duplicate')::boolean then raise exception 'duplicate refund event not idempotent'; end if;
end $$;
