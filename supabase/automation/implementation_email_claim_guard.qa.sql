-- Standalone PostgreSQL 17 disposable test. Never run against hosted data.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.crm_records(id uuid PRIMARY KEY,kind text NOT NULL,deleted boolean NOT NULL DEFAULT false,data jsonb NOT NULL);
CREATE TABLE public.crm_billing_orders(id uuid PRIMARY KEY,deal_id uuid NOT NULL,status text NOT NULL,paid_at timestamptz,billing_environment text);
CREATE TABLE public.crm_automation_jobs(id uuid PRIMARY KEY,deal_id uuid NOT NULL,job_type text NOT NULL,state text NOT NULL DEFAULT 'scheduled',attempts integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL,error_code text,updated_at timestamptz);
\i supabase/migrations/20261101194432_guard_implementation_email_after_refund.sql
INSERT INTO public.crm_records(id,kind,data) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','deal','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','deal','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','deal','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','deal','{}');
INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','paid',now(),'live'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','refunded',now(),'live'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','paid',now(),'test'),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','paid',null,'live');
INSERT INTO public.crm_automation_jobs(id,deal_id,job_type,due_at) VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','implementation_started_email',now()-interval '1 minute'),
 ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','implementation_started_email',now()-interval '1 minute'),
 ('20000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','implementation_started_email',now()-interval '1 minute'),
 ('20000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','implementation_started_email',now()-interval '1 minute'),
 ('20000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','lead_received_email',now()-interval '1 minute');
CREATE TEMP TABLE claim_result AS SELECT * FROM public.crm_claim_intake_confirmation_jobs(10);
DO $$ BEGIN
 IF (SELECT count(*) FROM claim_result)<>2 THEN RAISE EXCEPTION 'Wrong claim count'; END IF;
 IF NOT EXISTS(SELECT 1 FROM claim_result WHERE request_id='20000000-0000-4000-8000-000000000001' AND data->>'_automation_job_type'='implementation_started_email') THEN RAISE EXCEPTION 'Paid live implementation blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM claim_result WHERE request_id='20000000-0000-4000-8000-000000000005' AND data->>'_automation_job_type'='lead_received_email') THEN RAISE EXCEPTION 'Lead email regressed'; END IF;
 IF (SELECT count(*) FROM public.crm_automation_jobs WHERE state='running')<>2 THEN RAISE EXCEPTION 'Unsafe job entered running state'; END IF;
END $$;
UPDATE public.crm_automation_jobs SET state='scheduled' WHERE id='20000000-0000-4000-8000-000000000001';
UPDATE public.crm_billing_orders SET status='refunded' WHERE id='10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_claim_intake_confirmation_jobs(10)) THEN RAISE EXCEPTION 'Refunded job claimed on retry'; END IF;
END $$;
ROLLBACK;
SELECT 'implementation-email-claim-guard-passed' AS qa_result;
