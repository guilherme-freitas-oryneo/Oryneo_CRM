-- Corrige a reconciliação de falhas de renovação quando a Stripe informa amount_paid = 0.
-- Mantém excluídas a primeira fatura e a fatura inicial já vinculada ao pedido.
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
 -- Falhas de renovação podem chegar com amount_paid=0; isso ainda precisa atualizar o pedido.
 select status into v_persisted_status from public.crm_billing_invoices
   where stripe_invoice_id=p_invoice_id;
 if (p_event_type='invoice.payment_failed' or coalesce(p_amount_cents,0)>0)
   and p_billing_reason is distinct from 'subscription_create'
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
