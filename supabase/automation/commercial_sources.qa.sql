-- Stage 3 acceptance, disposable PostgreSQL 17 only.
\set ON_ERROR_STOP on
ALTER TABLE public.crm_billing_orders
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN stripe_checkout_session_id text;
ALTER TABLE public.crm_delivery_projects
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.crm_intake_requests(
 request_id uuid PRIMARY KEY,deal_id uuid,created_at timestamptz NOT NULL);
CREATE TABLE public.crm_stripe_events(
 event_id text PRIMARY KEY,event_type text NOT NULL,livemode boolean NOT NULL,
 payload jsonb NOT NULL,processed_at timestamptz NOT NULL);
GRANT SELECT ON public.crm_intake_requests,public.crm_stripe_events,
 public.crm_billing_orders,public.crm_delivery_projects,public.crm_automation_jobs TO service_role;
GRANT INSERT,UPDATE ON public.crm_intake_requests,public.crm_stripe_events,
 public.crm_billing_orders,public.crm_delivery_projects,public.crm_events TO service_role;
\i supabase/automation/commercial_sources.preview.sql

-- The historic intake must not be replayed on cursor initialization.
INSERT INTO public.crm_intake_requests(request_id,deal_id,created_at) VALUES(
 'c0000000-0000-4000-8000-000000000001',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',now()-interval '1 day');
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 anchor timestamptz;
 repeated timestamptz;
 result jsonb;
 denied boolean;
 before_jobs int;
 after_jobs int;
 stream text;
 n int;
BEGIN
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
  WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 SELECT count(*) INTO before_jobs FROM public.crm_automation_jobs;
 FOREACH stream IN ARRAY ARRAY['intake','checkout','billing','mail','delivery'] LOOP
   anchor:=public.automation_commercial_init_cursor(w,actor,stream);
   repeated:=public.automation_commercial_init_cursor(w,actor,stream);
   IF anchor IS NULL OR anchor<>repeated
   THEN RAISE EXCEPTION 'Cursor rewound: %',stream; END IF;
 END LOOP;
 denied:=false;
 BEGIN
  PERFORM public.automation_commercial_init_cursor(w,
   'ffffffff-ffff-4fff-8fff-ffffffffffff','billing');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unauthorized cursor init'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_commercial_shadow_ingest(w,'billing',3);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled runtime polled commercial data'; END IF;

 -- Synthetic real-business-reference fixtures: event envelopes remain UUID-only.
 INSERT INTO public.crm_intake_requests(request_id,deal_id,created_at)
 VALUES('c0000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',clock_timestamp()+interval '2 seconds');
 INSERT INTO public.crm_billing_orders
 (id,deal_id,status,paid_at,billing_environment,created_at,updated_at,stripe_checkout_session_id)
 VALUES
 ('c1000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'awaiting_payment',NULL,'live',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '3 seconds','cs_stage3_checkout'),
 ('c1000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'paid',clock_timestamp(),'live',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '4 seconds','cs_stage3_paid'),
 ('c1000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'payment_failed',NULL,'live',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '5 seconds','cs_stage3_fail'),
 ('c1000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'expired',NULL,'live',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '6 seconds','cs_stage3_expired'),
 ('c1000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'paid',clock_timestamp(),'live',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '7 seconds','cs_unverified_no_ledger'),
 ('c1000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'paid',clock_timestamp(),'test',clock_timestamp()+interval '3 seconds',
  clock_timestamp()+interval '8 seconds','cs_stage3_test');
 INSERT INTO public.crm_stripe_events(event_id,event_type,livemode,payload,processed_at) VALUES
 ('evt_stage3_paid','checkout.session.completed',true,
    '{"session_id":"cs_stage3_paid","payment_status":"paid"}',clock_timestamp()),
 ('evt_stage3_failed','checkout.session.async_payment_failed',true,
    '{"session_id":"cs_stage3_fail","payment_status":"unpaid"}',clock_timestamp()),
 ('evt_stage3_expired','checkout.session.expired',true,
    '{"session_id":"cs_stage3_expired","payment_status":"unpaid"}',clock_timestamp()),
 ('evt_stage3_test','checkout.session.completed',false,
    '{"session_id":"cs_stage3_test","payment_status":"paid"}',clock_timestamp());
 INSERT INTO public.crm_events(id,deal_id,event_type,created_at)
  VALUES('c2000000-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','email_sent',
    clock_timestamp()+interval '9 seconds');
 INSERT INTO public.crm_delivery_projects(order_id,created_at)
 VALUES('c1000000-0000-4000-8000-000000000002',
   clock_timestamp()+interval '10 seconds');
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false
 WHERE workspace_id=w;
 FOREACH stream IN ARRAY ARRAY['intake','checkout','billing','mail','delivery'] LOOP
  result:=public.automation_commercial_shadow_ingest(w,stream,1);
  IF result->>'inserted'<>'1' THEN
   RAISE EXCEPTION 'First bounded shadow scan failed: %, %',stream,result; END IF;
  IF stream='billing' THEN
   result:=public.automation_commercial_shadow_ingest(w,stream,1);
   IF result->>'inserted'<>'1' THEN
    RAISE EXCEPTION 'Billing second item missing: %',result; END IF;
   result:=public.automation_commercial_shadow_ingest(w,stream,1);
   IF result->>'inserted'<>'1' THEN
    RAISE EXCEPTION 'Billing third item missing: %',result; END IF;
  END IF;
  result:=public.automation_commercial_shadow_ingest(w,stream,100);
  IF (result->>'inserted')::int<>(CASE WHEN stream='checkout' THEN 4 ELSE 0 END)
  THEN RAISE EXCEPTION 'Unexpected bounded stream remainder: %, %',stream,result; END IF;
 END LOOP;
 -- Checkout must observe 6 live orders, but only a single first batch row
 -- was consumed above. Additional reads must not insert forbidden sandbox orders.
 result:=public.automation_commercial_shadow_ingest(w,'checkout',100);
 IF (result->>'inserted')::int<>0 THEN RAISE EXCEPTION 'Checkout replay'; END IF;

 SELECT count(*) INTO n FROM public.automation_event_inbox
 WHERE event_id IN(
  'intake:c0000000-0000-4000-8000-000000000002',
  'checkout:c1000000-0000-4000-8000-000000000001',
  'paid:c1000000-0000-4000-8000-000000000002',
  'failed:c1000000-0000-4000-8000-000000000003',
  'expired:c1000000-0000-4000-8000-000000000004',
  'email-sent:c2000000-0000-4000-8000-000000000001',
  'onboarding:c1000000-0000-4000-8000-000000000002');
 IF n<>7 THEN RAISE EXCEPTION 'Expected seven canonical source envelopes: %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox e
  WHERE e.event_id IN(
   'paid:c1000000-0000-4000-8000-000000000005',
   'paid:c1000000-0000-4000-8000-000000000006',
   'intake:c0000000-0000-4000-8000-000000000001'))
 THEN RAISE EXCEPTION 'Unverified/sandbox/historic business fact ingested'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
    WHERE context_refs::text ~ '(customer|email|phone|body|message)')
 THEN RAISE EXCEPTION 'PII leaked into canonical event references'; END IF;
 SELECT count(*) INTO after_jobs FROM public.crm_automation_jobs;
 IF before_jobs<>after_jobs
 THEN RAISE EXCEPTION 'Shadow feed duplicated an existing legacy job'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
  WHERE state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Shadow commercial relay emitted side effects'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 denied:=false;
 BEGIN
   PERFORM public.automation_commercial_shadow_ingest(w,'intake',1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Emergency-stop ignored by commercial event relay'; END IF;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
END $qa$;
RESET ROLE;
DO $security$
BEGIN
 IF has_function_privilege('anon','public.automation_commercial_shadow_ingest(uuid,text,integer)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_commercial_shadow_ingest(uuid,text,integer)','EXECUTE')
 OR has_table_privilege('anon','public.automation_commercial_source_feed','SELECT')
 OR has_table_privilege('authenticated','public.automation_commercial_source_feed','SELECT')
 THEN RAISE EXCEPTION 'Commercial event feed is exposed to browser roles'; END IF;
END $security$;
SELECT 'phase3-commercial-sources-shadow-only-qa-passed' AS qa_result;
