-- Repair/upgrade only the TEST sandbox identity checks. No LIVE objects changed.
CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_link(
 p_order_id uuid,p_owner_id uuid,p_checkout_session_id text,
 p_customer_id text,p_subscription_id text,p_invoice_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND owner_id=p_owner_id FOR UPDATE;
 IF v.state NOT IN ('awaiting_payment','failed') THEN
  RAISE EXCEPTION 'QA_ORDER_NOT_LINKABLE'; END IF;
 IF (v.method='pix' AND (
      (p_checkout_session_id IS NULL OR p_checkout_session_id !~ '^cs_test_[A-Za-z0-9_]+$')
      OR p_customer_id IS NOT NULL OR p_subscription_id IS NOT NULL OR p_invoice_id IS NOT NULL))
  OR (v.method='boleto' AND (
      p_checkout_session_id IS NOT NULL OR
      (p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9_]+$') OR
      (p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]+$') OR
      (p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9_]+$')))
 THEN RAISE EXCEPTION 'QA_PROVIDER_IDENTITY_INVALID' USING ERRCODE='22023'; END IF;
 IF (v.stripe_checkout_session_id IS NOT NULL AND v.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id)
  OR (v.stripe_customer_id IS NOT NULL AND v.stripe_customer_id IS DISTINCT FROM p_customer_id)
  OR (v.stripe_subscription_id IS NOT NULL AND v.stripe_subscription_id IS DISTINCT FROM p_subscription_id)
  OR (v.stripe_invoice_id IS NOT NULL AND v.stripe_invoice_id IS DISTINCT FROM p_invoice_id)
 THEN RAISE EXCEPTION 'QA_PROVIDER_LINK_CONFLICT' USING ERRCODE='23505'; END IF;
 UPDATE oryneo_financial_qa.orders SET
  stripe_checkout_session_id=COALESCE(stripe_checkout_session_id,p_checkout_session_id),
  stripe_customer_id=COALESCE(stripe_customer_id,p_customer_id),
  stripe_subscription_id=COALESCE(stripe_subscription_id,p_subscription_id),
  stripe_invoice_id=COALESCE(stripe_invoice_id,p_invoice_id),
  updated_at=now()
 WHERE id=v.id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'order_id',v.id);
END;
$$;

REVOKE ALL ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) TO service_role;
