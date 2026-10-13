-- Stripe test-mode webhook: isolated, idempotent server-side reconciliation.
-- The signing secret is stored separately in Supabase Vault, not in source control.
create or replace function public.crm_stripe_test_webhook_secret()
returns text language sql stable security definer set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'oryneo_stripe_test_webhook'
  limit 1
$$;
revoke all on function public.crm_stripe_test_webhook_secret() from public, anon, authenticated;
grant execute on function public.crm_stripe_test_webhook_secret() to service_role;

create or replace function public.crm_record_stripe_checkout_event(
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_payment_status text,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_invoice_id text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id uuid;
  v_inserted integer;
begin
  if coalesce(p_event_id, '') = '' or coalesce(p_session_id, '') = '' then
    raise exception 'Missing event/session id';
  end if;
  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired'
  ) then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;

  select id into v_order_id from public.crm_billing_orders
  where stripe_checkout_session_id = p_session_id for update;
  if v_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_session');
  end if;

  insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
  values (p_event_id,p_event_type,false,
    jsonb_build_object('session_id',p_session_id,'payment_status',p_payment_status))
  on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
     and p_payment_status = 'paid' then
    update public.crm_billing_orders
    set status = 'paid',
        paid_at = coalesce(paid_at, now()),
        stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
        stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
        stripe_invoice_id = coalesce(p_invoice_id, stripe_invoice_id),
        updated_at = now()
    where id = v_order_id and status <> 'refunded';
  elsif p_event_type = 'checkout.session.async_payment_failed' then
    update public.crm_billing_orders set status='payment_failed',updated_at=now()
    where id=v_order_id and status not in ('paid','refunded','canceled');
  elsif p_event_type = 'checkout.session.expired' then
    update public.crm_billing_orders set status='expired',updated_at=now()
    where id=v_order_id and status='awaiting_payment';
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false);
end
$$;
revoke all on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) to service_role;
