-- QA-only Stripe TEST signed webhook ledger. No CRM commercial tables or triggers.
-- Signing secret is installed separately into this private table; NEVER commit it.
CREATE TABLE IF NOT EXISTS oryneo_financial_qa.webhook_secrets(
 endpoint text PRIMARY KEY CHECK(endpoint='financial_qa_test'),
 signing_secret text NOT NULL CHECK(signing_secret ~ '^whsec_[A-Za-z0-9]+$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oryneo_financial_qa.invoice_cycles(
 stripe_invoice_id text PRIMARY KEY CHECK(stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
 order_id uuid NOT NULL REFERENCES oryneo_financial_qa.orders(id) ON DELETE RESTRICT,
 stripe_subscription_id text NOT NULL CHECK(stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
 billing_reason text,
 currency text NOT NULL CHECK(currency='brl'),
 amount_cents integer NOT NULL CHECK(amount_cents>=0),
 state text NOT NULL CHECK(state IN ('pending','paid','failed','void','uncollectible')),
 paid_at timestamptz,
 last_event_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oryneo_qa_cycles_by_order ON oryneo_financial_qa.invoice_cycles(order_id,created_at DESC);
ALTER TABLE oryneo_financial_qa.webhook_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE oryneo_financial_qa.invoice_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oryneo_financial_qa.webhook_secrets,oryneo_financial_qa.invoice_cycles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON oryneo_financial_qa.webhook_secrets TO service_role;
GRANT SELECT,INSERT,UPDATE ON oryneo_financial_qa.invoice_cycles TO service_role;

CREATE OR REPLACE FUNCTION public.oryneo_qa_webhook_signing_secret()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT signing_secret FROM oryneo_financial_qa.webhook_secrets WHERE endpoint='financial_qa_test'
$$;
REVOKE ALL ON FUNCTION public.oryneo_qa_webhook_signing_secret() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_webhook_signing_secret() TO service_role;

CREATE OR REPLACE FUNCTION public.oryneo_qa_webhook_lookup(
 p_method text,p_provider_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE;
BEGIN
 IF p_method='pix' AND p_provider_id ~ '^cs_test_[A-Za-z0-9_]+$' THEN
  SELECT * INTO v FROM oryneo_financial_qa.orders WHERE stripe_checkout_session_id=p_provider_id;
 ELSIF p_method='boleto' AND p_provider_id ~ '^sub_[A-Za-z0-9_]+$' THEN
  SELECT * INTO v FROM oryneo_financial_qa.orders WHERE stripe_subscription_id=p_provider_id;
 ELSE RETURN NULL;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object(
 'id',v.id,'owner_id',v.owner_id,'method',v.method,'state',v.state,
 'amount_cents',v.amount_cents,'environment',v.environment,
 'stripe_checkout_session_id',v.stripe_checkout_session_id,
 'stripe_customer_id',v.stripe_customer_id,
 'stripe_subscription_id',v.stripe_subscription_id,
 'stripe_invoice_id',v.stripe_invoice_id);
END;
$$;
REVOKE ALL ON FUNCTION public.oryneo_qa_webhook_lookup(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_webhook_lookup(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.oryneo_qa_boleto_invoice_event(
 p_order_id uuid,p_invoice_id text,p_event_id text,p_status text,
 p_amount_cents integer,p_billing_reason text,p_paid boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE; v_cycle oryneo_financial_qa.invoice_cycles%ROWTYPE;
 v_inserted int; v_state text;
BEGIN
 SELECT * INTO STRICT v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND method='boleto' AND environment='test' FOR UPDATE;
 IF p_invoice_id !~ '^in_[A-Za-z0-9_]+$' OR p_event_id !~ '^evt_[A-Za-z0-9_]+$'
   OR p_status NOT IN ('draft','open','paid','void','uncollectible','payment_failed')
   OR p_status IS NULL OR p_paid IS NULL OR p_amount_cents IS NULL OR p_amount_cents<0
   OR v.stripe_subscription_id IS NULL OR v.stripe_customer_id IS NULL
   OR (p_paid AND p_status<>'paid')
   OR (p_status='paid' AND NOT p_paid)
   OR (p_invoice_id=v.stripe_invoice_id AND p_amount_cents IS DISTINCT FROM v.amount_cents)
 THEN RAISE EXCEPTION 'QA_BOLETO_INVOICE_CONTRACT_INVALID' USING ERRCODE='22023'; END IF;

 SELECT * INTO v_cycle FROM oryneo_financial_qa.invoice_cycles WHERE stripe_invoice_id=p_invoice_id FOR UPDATE;
 IF FOUND AND (v_cycle.order_id<>v.id OR v_cycle.stripe_subscription_id<>v.stripe_subscription_id OR v_cycle.amount_cents<>p_amount_cents)
 THEN RAISE EXCEPTION 'QA_BOLETO_INVOICE_IDENTITY_CONFLICT' USING ERRCODE='23505'; END IF;

 INSERT INTO oryneo_financial_qa.events(order_id,event_key,event_type,provider_status)
 VALUES(v.id,'qa_'||p_event_id,'invoice.'||p_status,p_status)
 ON CONFLICT(event_key) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=0 THEN RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'order_state',v.state); END IF;
 v_state:=CASE WHEN p_paid THEN 'paid'
   WHEN p_status='void' THEN 'void'
   WHEN p_status='uncollectible' THEN 'uncollectible'
   WHEN p_status='payment_failed' THEN 'failed' ELSE 'pending' END;

 INSERT INTO oryneo_financial_qa.invoice_cycles(
  stripe_invoice_id,order_id,stripe_subscription_id,billing_reason,currency,
  amount_cents,state,paid_at,last_event_id
 ) VALUES(p_invoice_id,v.id,v.stripe_subscription_id,p_billing_reason,'brl',
  p_amount_cents,v_state,CASE WHEN p_paid THEN now() ELSE NULL END,p_event_id)
 ON CONFLICT(stripe_invoice_id) DO UPDATE SET
   state=CASE WHEN oryneo_financial_qa.invoice_cycles.state='paid' THEN 'paid' ELSE excluded.state END,
   paid_at=COALESCE(oryneo_financial_qa.invoice_cycles.paid_at,excluded.paid_at),
   last_event_id=excluded.last_event_id,updated_at=now();

 IF p_invoice_id=v.stripe_invoice_id THEN
   UPDATE oryneo_financial_qa.orders
   SET state=CASE WHEN p_paid THEN 'paid' WHEN state='paid' THEN 'paid'
      WHEN p_status='void' THEN 'expired' WHEN p_status='uncollectible' THEN 'failed'
      WHEN p_status='payment_failed' THEN 'failed' ELSE state END,
      paid_at=CASE WHEN p_paid THEN COALESCE(paid_at,now()) ELSE paid_at END,
      provider_status=p_status,last_checked_at=now(),updated_at=now()
   WHERE id=v.id;
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',false,
   'order_state',(SELECT state FROM oryneo_financial_qa.orders WHERE id=v.id),
   'invoice_state',(SELECT state FROM oryneo_financial_qa.invoice_cycles WHERE stripe_invoice_id=p_invoice_id));
END;
$$;
REVOKE ALL ON FUNCTION public.oryneo_qa_boleto_invoice_event(uuid,text,text,text,integer,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_boleto_invoice_event(uuid,text,text,text,integer,text,boolean) TO service_role;
