-- ORYNEO staged migration: do not apply to LIVE until sandbox boleto end-to-end passes.
-- Initial Boleto subscription invoices do not have a Checkout Session.
-- This RPC is called only by a signature-verified Stripe webhook using service_role.
CREATE OR REPLACE FUNCTION public.crm_record_stripe_boleto_initial_invoice(
 p_event_id text,
 p_invoice_id text,
 p_subscription_id text,
 p_customer_id text,
 p_amount_cents integer,
 p_currency text,
 p_livemode boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
 v_order public.crm_billing_orders%ROWTYPE;
 v_inserted integer;
 v_invoice_written integer;
BEGIN
 IF p_event_id !~ '^evt_[A-Za-z0-9_]+$'
   OR p_invoice_id !~ '^in_[A-Za-z0-9_]+$'
   OR p_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
   OR p_customer_id !~ '^cus_[A-Za-z0-9_]+$'
   OR p_currency IS DISTINCT FROM 'brl'
   OR p_amount_cents IS NULL OR p_amount_cents <= 0
 THEN RETURN jsonb_build_object('ok',false,'reason','invalid_invoice'); END IF;

 SELECT * INTO v_order
 FROM public.crm_billing_orders
 WHERE stripe_subscription_id=p_subscription_id
   AND selection->>'payment_method'='boleto'
   AND stripe_checkout_session_id IS NULL
 ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','unlinked_invoice'); END IF;
 IF (v_order.billing_environment='live') IS DISTINCT FROM p_livemode
   OR v_order.currency IS DISTINCT FROM 'brl'
   OR v_order.amount_total IS DISTINCT FROM p_amount_cents
   OR v_order.stripe_customer_id IS DISTINCT FROM p_customer_id
   OR (v_order.stripe_invoice_id IS NOT NULL AND v_order.stripe_invoice_id<>p_invoice_id)
 THEN RETURN jsonb_build_object('ok',false,'reason','invoice_mismatch'); END IF;

 IF v_order.status='paid' THEN
   RETURN jsonb_build_object('ok',true,'duplicate',true,'order_id',v_order.id);
 END IF;
 IF v_order.status<>'awaiting_payment' THEN
   RETURN jsonb_build_object('ok',false,'reason','order_requires_review');
 END IF;

 INSERT INTO public.crm_stripe_events(event_id,event_type,livemode,payload)
 VALUES(p_event_id,'invoice.paid',p_livemode,
   jsonb_build_object('invoice_id',p_invoice_id,'subscription_id',p_subscription_id,'order_id',v_order.id,'payment_method','boleto'))
 ON CONFLICT(event_id) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=0 THEN
   RETURN jsonb_build_object('ok',false,'reason','event_already_claimed');
 END IF;

 INSERT INTO public.crm_billing_invoices(
   stripe_invoice_id,order_id,stripe_subscription_id,status,amount_cents,currency,last_event_id,paid_at
 ) VALUES(p_invoice_id,v_order.id,p_subscription_id,'paid',p_amount_cents,'brl',p_event_id,now())
 ON CONFLICT(stripe_invoice_id) DO UPDATE SET
   status='paid',paid_at=coalesce(public.crm_billing_invoices.paid_at,excluded.paid_at),
   last_event_id=excluded.last_event_id,updated_at=now()
 WHERE public.crm_billing_invoices.order_id=excluded.order_id;
 GET DIAGNOSTICS v_invoice_written=ROW_COUNT;
 IF v_invoice_written<>1 THEN RAISE EXCEPTION 'INVOICE_ORDER_CONFLICT'; END IF;

 UPDATE public.crm_billing_orders SET
   status='paid',paid_at=coalesce(paid_at,now()),
   stripe_invoice_id=coalesce(stripe_invoice_id,p_invoice_id),
   updated_at=now()
 WHERE id=v_order.id AND status='awaiting_payment';

 INSERT INTO public.crm_billing_welcome(order_id) VALUES(v_order.id)
 ON CONFLICT(order_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'duplicate',false,'order_id',v_order.id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_record_stripe_boleto_initial_invoice(text,text,text,text,integer,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_record_stripe_boleto_initial_invoice(text,text,text,text,integer,text,boolean) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_stripe_boleto_initial_invoice(text,text,text,text,integer,text,boolean) TO service_role;
