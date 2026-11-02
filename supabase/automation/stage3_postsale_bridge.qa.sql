-- Standalone PostgreSQL 17 acceptance test. No network or external effect.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

CREATE TABLE public.crm_members(user_id uuid PRIMARY KEY);
CREATE TABLE public.crm_records(
 id uuid PRIMARY KEY,kind text NOT NULL,data jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1,deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_billing_orders(
 id uuid PRIMARY KEY,deal_id uuid NOT NULL,status text NOT NULL,
 paid_at timestamptz,billing_environment text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_delivery_projects(
 order_id uuid PRIMARY KEY REFERENCES public.crm_billing_orders(id),
 status text NOT NULL DEFAULT 'pending_kickoff',started_at timestamptz,completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_delivery_milestones(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.crm_delivery_projects(order_id),
 position integer NOT NULL,title text NOT NULL,state text NOT NULL DEFAULT 'pending',due_at timestamptz,note text,
 completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,position)
);
CREATE TABLE public.crm_delivery_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.crm_delivery_projects(order_id),
 actor uuid,action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_automation_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),deal_id uuid NOT NULL,job_type text NOT NULL,
 state text NOT NULL DEFAULT 'scheduled',attempts integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL,
 internet_message_id text,error_code text,completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 subject_type text,subject_id uuid,occurrence_key text
);
CREATE UNIQUE INDEX crm_automation_jobs_legacy_once
 ON public.crm_automation_jobs(deal_id,job_type) WHERE subject_type IS NULL;
CREATE UNIQUE INDEX crm_automation_jobs_subject_occurrence_once
 ON public.crm_automation_jobs(deal_id,job_type,subject_type,subject_id,occurrence_key)
 WHERE subject_type IS NOT NULL;
CREATE TABLE public.crm_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),deal_id uuid,event_type text NOT NULL,
 actor_label text,detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_checkout_drafts(
 deal_id uuid PRIMARY KEY,state text NOT NULL DEFAULT 'started',last_activity_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.crm_schedule_implementation_automation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN new;END$$;
CREATE TRIGGER crm_schedule_implementation_automation AFTER UPDATE ON public.crm_records
 FOR EACH ROW EXECUTE FUNCTION public.crm_schedule_implementation_automation();
CREATE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN new;END$$;
CREATE TRIGGER automation_queue_implementation_on_paid_delivery AFTER INSERT ON public.crm_delivery_projects
 FOR EACH ROW EXECUTE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery();
CREATE FUNCTION public.crm_create_delivery_on_paid_order() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN new;END$$;
CREATE TRIGGER crm_delivery_after_paid AFTER UPDATE OF status ON public.crm_billing_orders
 FOR EACH ROW EXECUTE FUNCTION public.crm_create_delivery_on_paid_order();
CREATE FUNCTION public.crm_sync_billing_order_to_deal() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN new;END$$;
CREATE TRIGGER crm_billing_order_sync_deal AFTER UPDATE OF status ON public.crm_billing_orders
 FOR EACH ROW EXECUTE FUNCTION public.crm_sync_billing_order_to_deal();

INSERT INTO auth.users(id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.crm_members(user_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.crm_records(id,kind,data) VALUES
 ('6ab321bd-5ec4-4dfc-b8c0-4824da854273','stage','{"name":"Ganha","outcome":"won","position":6000}'),
 ('a623469a-34c8-4c21-9a44-7e20cc7df502','stage','{"name":"Implantação","outcome":"won","position":6500}'),
 ('8e200e46-92db-4419-b752-11ab089fd5a3','stage','{"name":"Qualificada","outcome":"open","position":3000}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','deal','{"stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','deal','{"stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','deal','{"stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','deal','{"stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','deal','{"stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}');
INSERT INTO public.crm_checkout_drafts(deal_id) SELECT id FROM public.crm_records WHERE kind='deal';

\i supabase/migrations/20261102001901_bind_implementation_email_to_order.sql
\i supabase/migrations/20261102170000_oryneo_verified_paid_postsale_bridge.sql

DO $qa$ BEGIN
 IF NOT public.crm_postsale_bridge_ready() THEN RAISE EXCEPTION 'Bridge did not pass safe preflight'; END IF;
 IF (SELECT count(*) FROM public.crm_records WHERE kind='stage' AND data->>'outcome'='won')<>2
 THEN RAISE EXCEPTION 'Won-stage fixture invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='crm_schedule_implementation_automation' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'Legacy implementation trigger was removed'; END IF;
END $qa$;

INSERT INTO public.crm_billing_orders(id,deal_id,status,paid_at,billing_environment) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','awaiting_payment',NULL,'live'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','awaiting_payment',NULL,'test'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','awaiting_payment',NULL,'live'),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04','awaiting_payment',NULL,'live'),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05','awaiting_payment',NULL,'live');
UPDATE public.crm_billing_orders SET status='paid',paid_at=clock_timestamp() WHERE id='10000000-0000-4000-8000-000000000002';
UPDATE public.crm_billing_orders SET status='paid' WHERE id='10000000-0000-4000-8000-000000000003';
UPDATE public.crm_billing_orders SET status='paid',paid_at=clock_timestamp() WHERE id='10000000-0000-4000-8000-000000000004';
-- Replay the same provider result: all business artifacts must remain singular.
UPDATE public.crm_billing_orders SET paid_at=paid_at WHERE id='10000000-0000-4000-8000-000000000004';

DO $qa$ BEGIN
 IF (SELECT count(*) FROM public.crm_delivery_projects)<>1 THEN RAISE EXCEPTION 'Unsafe or duplicate delivery project'; END IF;
 IF (SELECT count(*) FROM public.crm_delivery_milestones WHERE order_id='10000000-0000-4000-8000-000000000004')<>3
 THEN RAISE EXCEPTION 'Milestones missing or duplicated'; END IF;
 IF (SELECT count(*) FROM public.crm_automation_jobs WHERE subject_id='10000000-0000-4000-8000-000000000004')<>1
 THEN RAISE EXCEPTION 'Implementation e-mail missing or duplicated'; END IF;
 IF (SELECT data->>'stage_id' FROM public.crm_records WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04')
    <>'6ab321bd-5ec4-4dfc-b8c0-4824da854273'
 THEN RAISE EXCEPTION 'Explicit Ganha mapping not used with two won stages'; END IF;
 IF (SELECT count(*) FROM public.crm_delivery_audit WHERE action='delivery_created')<>1
 THEN RAISE EXCEPTION 'Delivery creation audit missing or duplicated'; END IF;
END $qa$;

UPDATE public.crm_billing_orders SET status='refunded' WHERE id='10000000-0000-4000-8000-000000000004';
DO $qa$ DECLARE result jsonb; milestone uuid; BEGIN
 IF (SELECT status FROM public.crm_delivery_projects WHERE order_id='10000000-0000-4000-8000-000000000004')<>'paused'
 THEN RAISE EXCEPTION 'Refund did not pause delivery'; END IF;
 IF (SELECT state FROM public.crm_automation_jobs WHERE subject_id='10000000-0000-4000-8000-000000000004')<>'suppressed'
 THEN RAISE EXCEPTION 'Refund did not suppress queued e-mail'; END IF;
 SELECT id INTO milestone FROM public.crm_delivery_milestones WHERE order_id='10000000-0000-4000-8000-000000000004' ORDER BY position LIMIT 1;
 result:=public.crm_update_delivery_milestone('10000000-0000-4000-8000-000000000004',milestone,'in_progress',NULL,NULL,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 IF result->>'reason'<>'payment_not_verified' THEN RAISE EXCEPTION 'Refunded delivery still accepted progress'; END IF;
END $qa$;

SELECT public.crm_postsale_bridge_set_enabled(false,'QA rollback control',NULL);
UPDATE public.crm_billing_orders SET status='paid',paid_at=clock_timestamp() WHERE id='10000000-0000-4000-8000-000000000005';
DO $qa$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_delivery_projects WHERE order_id='10000000-0000-4000-8000-000000000005')
 THEN RAISE EXCEPTION 'Disabled bridge created a delivery'; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_automation_jobs WHERE subject_id='10000000-0000-4000-8000-000000000005')
 THEN RAISE EXCEPTION 'Disabled bridge queued an e-mail'; END IF;
END $qa$;
-- The untouched legacy trigger remains usable during rollback and binds the exact order.
UPDATE public.crm_records SET data=data||'{"stage_id":"a623469a-34c8-4c21-9a44-7e20cc7df502"}'::jsonb
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05';
DO $qa$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.crm_automation_jobs
   WHERE subject_id='10000000-0000-4000-8000-000000000005'
     AND subject_type='billing_order' AND occurrence_key='implementation_started')
 THEN RAISE EXCEPTION 'Legacy rollback path did not remain available'; END IF;
END $qa$;

ROLLBACK;
SELECT 'stage3-postsale-bridge-passed' AS qa_result;
