-- Standalone PostgreSQL 17 disposable test. Never run against hosted data.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.crm_records(id uuid PRIMARY KEY,kind text NOT NULL,deleted boolean NOT NULL DEFAULT false,data jsonb NOT NULL);
CREATE TABLE public.crm_billing_orders(id uuid PRIMARY KEY,deal_id uuid NOT NULL,status text NOT NULL,paid_at timestamptz,billing_environment text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.crm_automation_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),deal_id uuid NOT NULL,job_type text NOT NULL,
 state text NOT NULL DEFAULT 'scheduled',attempts integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL,
 error_code text,updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 subject_type text,subject_id uuid,occurrence_key text
);
CREATE UNIQUE INDEX crm_automation_jobs_legacy_once ON public.crm_automation_jobs(deal_id,job_type) WHERE subject_type IS NULL;
CREATE UNIQUE INDEX crm_automation_jobs_subject_occurrence_once ON public.crm_automation_jobs(deal_id,job_type,subject_type,subject_id,occurrence_key) WHERE subject_type IS NOT NULL;
CREATE TABLE public.crm_delivery_projects(order_id uuid PRIMARY KEY);
CREATE TABLE public.crm_delivery_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL,action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.automation_workspaces(id uuid PRIMARY KEY,slug text NOT NULL,active boolean NOT NULL);
CREATE TABLE public.automation_runtime_settings(workspace_id uuid PRIMARY KEY,mode text NOT NULL,emergency_stop boolean NOT NULL);
CREATE FUNCTION public.crm_schedule_implementation_automation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER crm_schedule_implementation_automation AFTER UPDATE ON public.crm_records FOR EACH ROW EXECUTE FUNCTION public.crm_schedule_implementation_automation();
CREATE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER automation_queue_implementation_on_paid_delivery AFTER INSERT ON public.crm_delivery_projects FOR EACH ROW EXECUTE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery();

\i supabase/migrations/20261101194432_guard_implementation_email_after_refund.sql
\i supabase/migrations/20261102001901_bind_implementation_email_to_order.sql

INSERT INTO public.crm_records(id,kind,data) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','deal','{}'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','deal','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','deal','{}'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','deal','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','deal','{}');
INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment,created_at) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','refunded',now(),'live',now()-interval '2 days'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','paid',now(),'live',now()-interval '1 day'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','paid',now(),'live',now()),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','paid',now(),'test',now()),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','paid',null,'live',now());
INSERT INTO public.crm_automation_jobs(id,deal_id,job_type,due_at,subject_type,subject_id,occurrence_key) VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','implementation_started_email',now()-interval '1 minute','billing_order','10000000-0000-4000-8000-000000000001','implementation_started'),
 ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','implementation_started_email',now()-interval '1 minute','billing_order','10000000-0000-4000-8000-000000000003','implementation_started'),
 ('20000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','implementation_started_email',now()-interval '1 minute','billing_order','10000000-0000-4000-8000-000000000004','implementation_started'),
 ('20000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','implementation_started_email',now()-interval '1 minute','billing_order','10000000-0000-4000-8000-000000000005','implementation_started'),
 ('20000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','lead_received_email',now()-interval '1 minute',null,null,null);
CREATE TEMP TABLE claim_result AS SELECT * FROM public.crm_claim_intake_confirmation_jobs(10);
DO $$ BEGIN
 IF (SELECT count(*) FROM claim_result)<>2 THEN RAISE EXCEPTION 'Wrong claim count'; END IF;
 IF EXISTS(SELECT 1 FROM claim_result WHERE request_id='20000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'A different paid order authorized a refunded order job'; END IF;
 IF NOT EXISTS(SELECT 1 FROM claim_result WHERE request_id='20000000-0000-4000-8000-000000000002' AND data->>'_automation_job_type'='implementation_started_email' AND data->>'_automation_order_id'='10000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Exact paid order was not carried to the worker'; END IF;
 IF NOT EXISTS(SELECT 1 FROM claim_result WHERE request_id='20000000-0000-4000-8000-000000000005' AND data->>'_automation_job_type'='lead_received_email') THEN RAISE EXCEPTION 'Lead email regressed'; END IF;
END $$;
UPDATE public.crm_automation_jobs SET state='scheduled' WHERE id='20000000-0000-4000-8000-000000000002';
UPDATE public.crm_billing_orders SET status='refunded' WHERE id='10000000-0000-4000-8000-000000000003';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_claim_intake_confirmation_jobs(10)) THEN RAISE EXCEPTION 'Refunded exact order was claimed on retry'; END IF;
END $$;

-- The legacy stage producer must bind the deterministic, latest live paid order.
INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment,created_at) VALUES
 ('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','paid',now()-interval '2 minutes','live',now()-interval '2 minutes'),
 ('10000000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','paid',now()-interval '1 minute','live',now()-interval '1 minute');
UPDATE public.crm_records SET data=jsonb_build_object('stage_id','a623469a-34c8-4c21-9a44-7e20cc7df502') WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.crm_automation_jobs WHERE deal_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05' AND job_type='implementation_started_email' AND subject_type='billing_order' AND subject_id='10000000-0000-4000-8000-000000000007' AND occurrence_key='implementation_started') THEN RAISE EXCEPTION 'Stage producer did not bind the latest exact order'; END IF;
END $$;
ROLLBACK;
SELECT 'implementation-email-order-guard-passed' AS qa_result;
