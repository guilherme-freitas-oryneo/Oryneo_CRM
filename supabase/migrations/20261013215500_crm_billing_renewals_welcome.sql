-- Complemento aditivo: rastrear faturas, renovação do tráfego e comunicação transacional.
-- Preserva pedido pago, histórico Stripe e demais tabelas existentes.
alter table public.crm_billing_orders
  add column if not exists stripe_traffic_subscription_id text unique,
  add column if not exists traffic_next_charge_at timestamptz,
  add column if not exists main_subscription_status text,
  add column if not exists traffic_subscription_status text,
  add column if not exists renewal_payment_status text;

create table if not exists public.crm_billing_invoices (
  stripe_invoice_id text primary key,
  order_id uuid not null references public.crm_billing_orders(id) on delete restrict,
  stripe_subscription_id text not null,
  status text not null check(status in ('paid','payment_failed')),
  amount_cents integer not null check(amount_cents >= 0),
  currency text not null default 'brl',
  last_event_id text not null,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists crm_billing_invoices_order on public.crm_billing_invoices(order_id,updated_at desc);
alter table public.crm_billing_invoices enable row level security;
revoke all on public.crm_billing_invoices from anon, authenticated;
grant select on public.crm_billing_invoices to authenticated;
drop policy if exists crm_billing_invoices_members_read on public.crm_billing_invoices;
create policy crm_billing_invoices_members_read on public.crm_billing_invoices
 for select to authenticated using (
   exists(select 1 from public.crm_members where user_id = (select auth.uid()))
 );

create table if not exists public.crm_billing_welcome (
  order_id uuid primary key references public.crm_billing_orders(id) on delete restrict,
  state text not null default 'pending'
    check(state in ('pending','sending','sent','suppressed_test','failed')),
  attempts integer not null default 0,
  internet_message_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_billing_welcome enable row level security;
revoke all on public.crm_billing_welcome from anon, authenticated;
-- Registro interno restrito a service_role, sem política de leitura pública.

-- Mesma assinatura RPC, substitui somente a reconciliação de checkout para enfileirar boas-vindas.
create or replace function public.crm_record_stripe_checkout_event(
 p_event_id text, p_event_type text, p_session_id text, p_payment_status text,
 p_customer_id text default null, p_subscription_id text default null, p_invoice_id text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_inserted integer;
begin
 if coalesce(p_event_id,'') = '' or coalesce(p_session_id,'') = '' then
   raise exception 'Missing event/session id';
 end if;
 if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded',
   'checkout.session.async_payment_failed','checkout.session.expired') then
   return jsonb_build_object('ok',true,'ignored',true);
 end if;
 select id into v_order_id from public.crm_billing_orders
   where stripe_checkout_session_id=p_session_id for update;
 if v_order_id is null then return jsonb_build_object('ok',false,'reason','unknown_session'); end if;
 insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
   values (p_event_id,p_event_type,false,jsonb_build_object('session_id',p_session_id,'payment_status',p_payment_status))
   on conflict(event_id) do nothing;
 get diagnostics v_inserted = row_count;
 if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
    and p_payment_status='paid' then
   update public.crm_billing_orders set status='paid',
     paid_at=coalesce(paid_at,now()), stripe_customer_id=coalesce(p_customer_id,stripe_customer_id),
     stripe_subscription_id=coalesce(p_subscription_id,stripe_subscription_id),
     stripe_invoice_id=coalesce(p_invoice_id,stripe_invoice_id),updated_at=now()
     where id=v_order_id and status<>'refunded';
   if exists(select 1 from public.crm_billing_orders where id=v_order_id and status='paid') then
     insert into public.crm_billing_welcome(order_id) values(v_order_id)
       on conflict(order_id) do nothing;
   end if;
 elsif v_inserted=1 and p_event_type='checkout.session.async_payment_failed' then
   update public.crm_billing_orders set status='payment_failed',updated_at=now()
     where id=v_order_id and status not in ('paid','refunded','canceled');
 elsif v_inserted=1 and p_event_type='checkout.session.expired' then
   update public.crm_billing_orders set status='expired',updated_at=now()
     where id=v_order_id and status='awaiting_payment';
 end if;
 return jsonb_build_object('ok',true,'duplicate',v_inserted=0,'order_id',v_order_id);
end
$$;
revoke all on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text)
 to service_role;

create or replace function public.crm_record_stripe_invoice_event(
 p_event_id text, p_event_type text, p_invoice_id text, p_subscription_id text,
 p_amount_cents integer, p_currency text, p_billing_reason text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_inserted integer; v_new_status text; v_persisted_status text;
begin
 if p_event_type not in ('invoice.paid','invoice.payment_failed') then
   return jsonb_build_object('ok',true,'ignored',true);
 end if;
 if coalesce(p_invoice_id,'')='' or coalesce(p_subscription_id,'')='' then
   return jsonb_build_object('ok',true,'unlinked',true);
 end if;
 select id into v_order_id from public.crm_billing_orders
 where stripe_subscription_id=p_subscription_id or stripe_traffic_subscription_id=p_subscription_id
 order by created_at desc limit 1 for update;
 if v_order_id is null then return jsonb_build_object('ok',true,'unlinked',true); end if;
 insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
   values(p_event_id,p_event_type,false,jsonb_build_object('invoice_id',p_invoice_id,'subscription_id',p_subscription_id))
   on conflict(event_id) do nothing;
 get diagnostics v_inserted = row_count;
 if v_inserted=0 then return jsonb_build_object('ok',true,'duplicate',true); end if;
 v_new_status=case when p_event_type='invoice.paid' then 'paid' else 'payment_failed' end;
 insert into public.crm_billing_invoices(stripe_invoice_id,order_id,stripe_subscription_id,status,amount_cents,currency,last_event_id,paid_at)
 values(p_invoice_id,v_order_id,p_subscription_id,v_new_status,greatest(coalesce(p_amount_cents,0),0),
   coalesce(p_currency,'brl'),p_event_id,case when v_new_status='paid' then now() else null end)
 on conflict(stripe_invoice_id) do update set
  status=case when public.crm_billing_invoices.status='paid' then 'paid' else excluded.status end,
  last_event_id=excluded.last_event_id,
  paid_at=coalesce(public.crm_billing_invoices.paid_at,excluded.paid_at),updated_at=now();
 -- Nunca confundir primeira fatura, trial de valor zero ou evento atrasado com renovação.
 select status into v_persisted_status from public.crm_billing_invoices
   where stripe_invoice_id=p_invoice_id;
 if coalesce(p_amount_cents,0)>0 and p_billing_reason is distinct from 'subscription_create'
   and p_invoice_id <> coalesce((select stripe_invoice_id from public.crm_billing_orders where id=v_order_id),'') then
   update public.crm_billing_orders set renewal_payment_status=v_persisted_status,updated_at=now()
     where id=v_order_id and status='paid';
 end if;
 return jsonb_build_object('ok',true,'order_id',v_order_id);
end
$$;
revoke all on function public.crm_record_stripe_invoice_event(text,text,text,text,integer,text,text)
 from public,anon,authenticated;
grant execute on function public.crm_record_stripe_invoice_event(text,text,text,text,integer,text,text) to service_role;

create or replace function public.crm_record_stripe_subscription_event(
 p_event_id text,p_event_type text,p_subscription_id text,p_status text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_is_traffic boolean; v_inserted integer;
begin
 if p_event_type not in ('customer.subscription.updated','customer.subscription.deleted') then
   return jsonb_build_object('ok',true,'ignored',true);
 end if;
 select id,(stripe_traffic_subscription_id=p_subscription_id) into v_order_id,v_is_traffic
 from public.crm_billing_orders
 where stripe_subscription_id=p_subscription_id or stripe_traffic_subscription_id=p_subscription_id
 order by created_at desc limit 1 for update;
 if v_order_id is null then return jsonb_build_object('ok',true,'unlinked',true); end if;
 insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
 values(p_event_id,p_event_type,false,jsonb_build_object('subscription_id',p_subscription_id,'status',p_status))
 on conflict(event_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then return jsonb_build_object('ok',true,'duplicate',true); end if;
 if v_is_traffic then
   update public.crm_billing_orders set traffic_subscription_status=p_status,updated_at=now() where id=v_order_id;
 else
   update public.crm_billing_orders set main_subscription_status=p_status,updated_at=now() where id=v_order_id;
 end if;
 return jsonb_build_object('ok',true,'order_id',v_order_id);
end
$$;
revoke all on function public.crm_record_stripe_subscription_event(text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.crm_record_stripe_subscription_event(text,text,text,text) to service_role;
