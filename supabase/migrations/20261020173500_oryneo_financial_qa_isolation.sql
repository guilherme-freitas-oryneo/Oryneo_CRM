-- ORYNEO | Financial QA isolation without an additional Supabase branch.
-- Additive, standalone tables in a private schema. No CRM foreign keys, triggers,
-- onboarding, jobs, customer deliveries or email sends. Always Stripe TEST.
CREATE SCHEMA IF NOT EXISTS oryneo_financial_qa;
REVOKE ALL ON SCHEMA oryneo_financial_qa FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA oryneo_financial_qa TO service_role;

CREATE TABLE IF NOT EXISTS oryneo_financial_qa.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  reference text NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'test' CHECK(environment='test'),
  method text NOT NULL CHECK(method IN ('pix','boleto')),
  plan text NOT NULL CHECK(plan IN ('Start','Growth','Scale')),
  cycle text NOT NULL CHECK(cycle IN ('monthly','annual')),
  quote_fingerprint text NOT NULL CHECK(quote_fingerprint ~ '^[0-9a-f]{64}$'),
  selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object'),
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  currency text NOT NULL DEFAULT 'brl' CHECK(currency='brl'),
  state text NOT NULL DEFAULT 'awaiting_payment'
    CHECK(state IN ('awaiting_payment','paid','failed','expired','requires_review')),
  stripe_checkout_session_id text UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_invoice_id text UNIQUE,
  provider_status text,
  paid_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_method_shape CHECK(
    (method='pix' AND stripe_subscription_id IS NULL AND stripe_invoice_id IS NULL)
    OR (method='boleto' AND stripe_checkout_session_id IS NULL)
  )
);
CREATE TABLE IF NOT EXISTS oryneo_financial_qa.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES oryneo_financial_qa.orders(id) ON DELETE RESTRICT,
 event_key text NOT NULL UNIQUE,
 event_type text NOT NULL,
 provider_status text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE oryneo_financial_qa.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE oryneo_financial_qa.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA oryneo_financial_qa FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA oryneo_financial_qa FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON oryneo_financial_qa.orders TO service_role;
GRANT SELECT,INSERT ON oryneo_financial_qa.events TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA oryneo_financial_qa TO service_role;

-- All RPCs are service-role-only. Membership is checked again in SQL.
CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_create(
 p_request_id uuid,p_owner_id uuid,p_method text,p_plan text,p_cycle text,
 p_quote_fingerprint text,p_selection jsonb,p_amount_cents integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_row oryneo_financial_qa.orders%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_owner_id IS NULL OR p_method NOT IN ('pix','boleto')
  OR p_plan NOT IN ('Start','Growth','Scale') OR p_cycle NOT IN ('monthly','annual')
  OR p_quote_fingerprint !~ '^[0-9a-f]{64}$'
  OR p_amount_cents IS NULL OR p_amount_cents<=0 OR jsonb_typeof(p_selection)<>'object'
  OR NOT EXISTS(SELECT 1 FROM public.crm_members WHERE user_id=p_owner_id)
 THEN RAISE EXCEPTION 'INVALID_QA_ORDER' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261020));
 INSERT INTO oryneo_financial_qa.orders(
  request_id,owner_id,reference,method,plan,cycle,quote_fingerprint,selection,amount_cents)
 VALUES(p_request_id,p_owner_id,'QA-'||p_request_id::text,p_method,p_plan,p_cycle,
 p_quote_fingerprint,p_selection,p_amount_cents)
 ON CONFLICT(request_id) DO NOTHING;
 SELECT * INTO STRICT v_row FROM oryneo_financial_qa.orders WHERE request_id=p_request_id FOR UPDATE;
 IF v_row.owner_id<>p_owner_id OR v_row.method<>p_method OR v_row.plan<>p_plan OR
  v_row.cycle<>p_cycle OR v_row.quote_fingerprint<>p_quote_fingerprint OR
  v_row.amount_cents<>p_amount_cents OR v_row.selection<>p_selection
 THEN RAISE EXCEPTION 'QA_ORDER_REPLAY_MISMATCH' USING ERRCODE='23505'; END IF;
 RETURN pg_catalog.jsonb_build_object('id',v_row.id,'reference',v_row.reference,
  'state',v_row.state,'environment','test','method',v_row.method,
  'stripe_checkout_session_id',v_row.stripe_checkout_session_id,
  'stripe_subscription_id',v_row.stripe_subscription_id,
  'stripe_customer_id',v_row.stripe_customer_id,
  'stripe_invoice_id',v_row.stripe_invoice_id);
END;
$$;

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
      (p_checkout_session_id IS NULL OR p_checkout_session_id !~ '^cs_test_[A-Za-z0-9_]+
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

CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_read(
 p_order_id uuid,p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE;
BEGIN
 SELECT * INTO v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND owner_id=p_owner_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object(
  'id',v.id,'environment',v.environment,'method',v.method,'state',v.state,
  'amount_cents',v.amount_cents,'currency',v.currency,
  'stripe_checkout_session_id',v.stripe_checkout_session_id,
  'stripe_customer_id',v.stripe_customer_id,
  'stripe_subscription_id',v.stripe_subscription_id,'stripe_invoice_id',v.stripe_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_reconcile(
 p_order_id uuid,p_owner_id uuid,p_provider_object_id text,
 p_provider_status text,p_confirmed_paid boolean,p_paid_amount integer,
 p_event_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE; v_inserted integer;
BEGIN
 SELECT * INTO STRICT v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND owner_id=p_owner_id FOR UPDATE;
 IF p_event_key !~ '^qa_[a-zA-Z0-9_-]+$' OR
  p_provider_object_id IS DISTINCT FROM
   (CASE WHEN v.method='pix' THEN v.stripe_checkout_session_id ELSE v.stripe_invoice_id END)
  OR p_provider_status IS NULL OR length(p_provider_status)>64
  OR p_confirmed_paid IS NULL OR p_paid_amount IS NULL OR p_paid_amount<0
  OR (p_confirmed_paid AND (p_provider_status<>'paid' OR p_paid_amount IS DISTINCT FROM v.amount_cents))
 THEN RAISE EXCEPTION 'QA_SETTLEMENT_CONTRACT_MISMATCH' USING ERRCODE='22023'; END IF;
 INSERT INTO oryneo_financial_qa.events(order_id,event_key,event_type,provider_status)
 VALUES(v.id,p_event_key,CASE WHEN p_confirmed_paid THEN 'paid' ELSE 'checked' END,p_provider_status)
 ON CONFLICT(event_key) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=0 THEN
  RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'state',v.state); END IF;
 UPDATE oryneo_financial_qa.orders
 SET state=CASE WHEN p_confirmed_paid THEN 'paid'
          WHEN state='paid' THEN 'paid'
          WHEN p_provider_status IN ('expired','void','uncollectible') THEN 'expired'
          WHEN p_provider_status IN ('failed','payment_failed') THEN 'failed'
          ELSE state END,
  provider_status=p_provider_status,
  paid_at=CASE WHEN p_confirmed_paid THEN COALESCE(paid_at,now()) ELSE paid_at END,
  last_checked_at=now(),updated_at=now()
 WHERE id=v.id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',false,
  'state',(SELECT state FROM oryneo_financial_qa.orders WHERE id=v.id));
END;
$$;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_create(uuid,uuid,text,text,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_read(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_reconcile(uuid,uuid,text,text,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_create(uuid,uuid,text,text,text,text,jsonb,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_read(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_reconcile(uuid,uuid,text,text,boolean,integer,text) TO service_role;
)
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

CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_read(
 p_order_id uuid,p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE;
BEGIN
 SELECT * INTO v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND owner_id=p_owner_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object(
  'id',v.id,'environment',v.environment,'method',v.method,'state',v.state,
  'amount_cents',v.amount_cents,'currency',v.currency,
  'stripe_checkout_session_id',v.stripe_checkout_session_id,
  'stripe_customer_id',v.stripe_customer_id,
  'stripe_subscription_id',v.stripe_subscription_id,'stripe_invoice_id',v.stripe_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.oryneo_qa_billing_reconcile(
 p_order_id uuid,p_owner_id uuid,p_provider_object_id text,
 p_provider_status text,p_confirmed_paid boolean,p_paid_amount integer,
 p_event_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v oryneo_financial_qa.orders%ROWTYPE; v_inserted integer;
BEGIN
 SELECT * INTO STRICT v FROM oryneo_financial_qa.orders WHERE id=p_order_id AND owner_id=p_owner_id FOR UPDATE;
 IF p_event_key !~ '^qa_[a-zA-Z0-9_-]+$' OR
  p_provider_object_id IS DISTINCT FROM
   (CASE WHEN v.method='pix' THEN v.stripe_checkout_session_id ELSE v.stripe_invoice_id END)
  OR p_provider_status IS NULL OR length(p_provider_status)>64
  OR (p_confirmed_paid AND (p_provider_status<>'paid' OR p_paid_amount IS DISTINCT FROM v.amount_cents))
 THEN RAISE EXCEPTION 'QA_SETTLEMENT_CONTRACT_MISMATCH' USING ERRCODE='22023'; END IF;
 INSERT INTO oryneo_financial_qa.events(order_id,event_key,event_type,provider_status)
 VALUES(v.id,p_event_key,CASE WHEN p_confirmed_paid THEN 'paid' ELSE 'checked' END,p_provider_status)
 ON CONFLICT(event_key) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=0 THEN
  RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'state',v.state); END IF;
 UPDATE oryneo_financial_qa.orders
 SET state=CASE WHEN p_confirmed_paid THEN 'paid'
          WHEN state='paid' THEN 'paid'
          WHEN p_provider_status IN ('expired','void','uncollectible') THEN 'expired'
          WHEN p_provider_status IN ('failed','payment_failed') THEN 'failed'
          ELSE state END,
  provider_status=p_provider_status,
  paid_at=CASE WHEN p_confirmed_paid THEN COALESCE(paid_at,now()) ELSE paid_at END,
  last_checked_at=now(),updated_at=now()
 WHERE id=v.id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'duplicate',false,
  'state',(SELECT state FROM oryneo_financial_qa.orders WHERE id=v.id));
END;
$$;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_create(uuid,uuid,text,text,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_read(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.oryneo_qa_billing_reconcile(uuid,uuid,text,text,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_create(uuid,uuid,text,text,text,text,jsonb,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_link(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_read(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oryneo_qa_billing_reconcile(uuid,uuid,text,text,boolean,integer,text) TO service_role;
