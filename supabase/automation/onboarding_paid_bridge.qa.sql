-- Disposable PostgreSQL 17 test. Executes no e-mail, webhook or external action.
\set ON_ERROR_STOP on
-- Use the existing automation fixture: this QA file executes after schema.qa
-- and shadow adapter QA in the same disposable PostgreSQL database.
UPDATE public.automation_workspaces SET active=true
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings
 SET mode='live',emergency_stop=false
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
CREATE TABLE public.crm_billing_orders (
 id uuid PRIMARY KEY,
 deal_id uuid NOT NULL,
 status text NOT NULL,
 paid_at timestamptz,
 billing_environment text
);
CREATE TABLE public.crm_delivery_projects (
 order_id uuid PRIMARY KEY REFERENCES public.crm_billing_orders(id),
 status text NOT NULL DEFAULT 'pending_kickoff'
);
CREATE TABLE public.crm_delivery_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 actor uuid,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_automation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 deal_id uuid NOT NULL,
 job_type text NOT NULL,
 state text NOT NULL DEFAULT 'scheduled',
 due_at timestamptz NOT NULL,
 subject_type text
);
CREATE UNIQUE INDEX crm_automation_jobs_legacy_once
 ON public.crm_automation_jobs(deal_id,job_type) WHERE subject_type IS NULL;
INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','paid',now(),'live'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','paid',now(),'test'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','awaiting_payment',null,'live'),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','paid',null,'live'),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','paid',now(),'live');

-- Legacy job already exists: post-sale handoff must NOT create a second copy.
INSERT INTO public.crm_automation_jobs(deal_id,job_type,due_at)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','implementation_started_email',now()+interval '1 minute');
\i supabase/automation/onboarding_paid_bridge.preview.sql
INSERT INTO public.crm_delivery_projects(order_id) VALUES
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000004'),
 ('10000000-0000-4000-8000-000000000005');
-- Simulate duplicate webhook creating the SAME delivery row.
INSERT INTO public.crm_delivery_projects(order_id)
 VALUES('10000000-0000-4000-8000-000000000001')
 ON CONFLICT(order_id) DO NOTHING;
-- Disable the bridge before a new paid order. The pre-existing stage trigger
-- remains untouched, but the new trigger must NOT schedule any additional mail.
UPDATE public.automation_runtime_settings
 SET mode='disabled',emergency_stop=true
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment)
 VALUES('10000000-0000-4000-8000-000000000006',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06','paid',now(),'live');
INSERT INTO public.crm_delivery_projects(order_id)
 VALUES('10000000-0000-4000-8000-000000000006');
-- Simulate the old stage trigger reattempt after the new paid-event bridge.
INSERT INTO public.crm_automation_jobs(deal_id,job_type,due_at)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','implementation_started_email',now())
 ON CONFLICT DO NOTHING;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.crm_automation_jobs)<>2 THEN
  RAISE EXCEPTION 'Duplicate, missing or sandbox-triggered implementation email job'; END IF;
 IF (SELECT count(*) FROM public.crm_automation_jobs WHERE deal_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')<>1
 THEN RAISE EXCEPTION 'Duplicate legacy+new implementation'; END IF;
 IF (SELECT count(*) FROM public.crm_delivery_audit WHERE action='implementation_email_queued')<>1
 THEN RAISE EXCEPTION 'Email bridge audit missing or duplicated'; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_automation_jobs j JOIN public.crm_billing_orders o
  ON o.deal_id=j.deal_id WHERE o.status<>'paid' OR o.paid_at IS NULL OR o.billing_environment<>'live')
 THEN RAISE EXCEPTION 'Unsafe sandbox/unpaid job was created'; END IF;
 IF (SELECT count(*) FROM public.crm_delivery_projects)<>6
 THEN RAISE EXCEPTION 'Delivery project missing or duplicated'; END IF;
END; $$;
SELECT 'onboarding-paid-bridge-passed' AS qa_result;
