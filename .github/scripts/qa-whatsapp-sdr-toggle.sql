\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;

CREATE TABLE public.crm_wa_channels (
  id uuid PRIMARY KEY
);
CREATE TABLE public.crm_wa_conversations (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES public.crm_wa_channels(id),
  mode text NOT NULL CHECK (mode IN ('sdr_active','review','human_locked','resolved')),
  opted_out boolean NOT NULL DEFAULT false,
  consent_granted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_wa_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.crm_wa_conversations(id),
  direction text NOT NULL,
  kind text NOT NULL,
  reaction_to_provider_message_id text,
  occurred_at timestamptz NOT NULL
);
CREATE TABLE public.crm_wa_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.crm_wa_conversations(id),
  inbound_message_id uuid NOT NULL UNIQUE REFERENCES public.crm_wa_messages(id),
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_wa_ai_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.crm_wa_ai_jobs(id),
  conversation_id uuid NOT NULL REFERENCES public.crm_wa_conversations(id),
  state text NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.crm_wa_enqueue_ai_job(p_conversation_id uuid,p_inbound_message_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.crm_wa_ai_jobs(conversation_id,inbound_message_id,state)
  VALUES(p_conversation_id,p_inbound_message_id,'queued')
  ON CONFLICT(inbound_message_id) DO UPDATE SET updated_at=public.crm_wa_ai_jobs.updated_at
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT SELECT,UPDATE ON public.crm_wa_conversations TO service_role;
GRANT SELECT ON public.crm_wa_messages TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_wa_ai_jobs,public.crm_wa_ai_outbox TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_wa_enqueue_ai_job(uuid,uuid) TO service_role;

\i supabase/migrations/20261029030000_crm_whatsapp_sdr_conversation_toggle.sql

INSERT INTO public.crm_wa_channels(id) VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.crm_wa_conversations(id,channel_id,mode,opted_out,consent_granted) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','review',false,false),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','review',true,false),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','review',false,false),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','review',false,false);
INSERT INTO public.crm_wa_messages(id,conversation_id,direction,kind,occurred_at) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','inbound','text',now()),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','inbound','text',now()-interval '25 hours'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','inbound','text',now());

SET ROLE service_role;
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',true,true
);
RESET ROLE;

DO $$
DECLARE c public.crm_wa_conversations%rowtype; jobs integer; events integer;
BEGIN
 SELECT * INTO c FROM public.crm_wa_conversations WHERE id='20000000-0000-4000-8000-000000000001';
 IF c.mode<>'sdr_active' OR NOT c.consent_granted THEN RAISE EXCEPTION 'activation did not persist consent and mode'; END IF;
 SELECT count(*) INTO jobs FROM public.crm_wa_ai_jobs WHERE conversation_id=c.id AND state='queued';
 IF jobs<>1 THEN RAISE EXCEPTION 'activation did not enqueue latest inbound exactly once'; END IF;
 SELECT count(*) INTO events FROM public.crm_wa_automation_events WHERE conversation_id=c.id AND enabled;
 IF events<>1 THEN RAISE EXCEPTION 'activation was not audited'; END IF;
END $$;

SET ROLE service_role;
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001',true,true
);
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001',false,false
);
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001',true,true
);
RESET ROLE;

DO $$
DECLARE jobs integer;
BEGIN
 SELECT count(*) INTO jobs FROM public.crm_wa_ai_jobs
 WHERE conversation_id='20000000-0000-4000-8000-000000000004' AND state='queued' AND error_code IS NULL;
 IF jobs<>1 THEN RAISE EXCEPTION 'reactivation did not safely resume the paused latest inbound'; END IF;
END $$;

SET ROLE service_role;
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',true,true
);
RESET ROLE;

DO $$
DECLARE jobs integer;
BEGIN
 SELECT count(*) INTO jobs FROM public.crm_wa_ai_jobs WHERE conversation_id='20000000-0000-4000-8000-000000000003';
 IF jobs<>0 THEN RAISE EXCEPTION 'activation enqueued an inbound outside the 24-hour service window'; END IF;
END $$;

INSERT INTO public.crm_wa_ai_jobs(conversation_id,inbound_message_id,state,lease_token,lease_until) VALUES
 ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','retry_wait',null,null)
 ON CONFLICT(inbound_message_id) DO UPDATE SET state='retry_wait';
INSERT INTO public.crm_wa_ai_outbox(conversation_id,state) VALUES
 ('20000000-0000-4000-8000-000000000001','pending'),
 ('20000000-0000-4000-8000-000000000001','leased');

SET ROLE service_role;
SELECT * FROM public.crm_wa_set_automation_state(
 '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',false,false
);
RESET ROLE;

DO $$
DECLARE c public.crm_wa_conversations%rowtype; cancelled_jobs integer; cancelled_outbox integer; leased_outbox integer;
BEGIN
 SELECT * INTO c FROM public.crm_wa_conversations WHERE id='20000000-0000-4000-8000-000000000001';
 IF c.mode<>'review' OR NOT c.consent_granted THEN RAISE EXCEPTION 'pause did not preserve consent'; END IF;
 SELECT count(*) INTO cancelled_jobs FROM public.crm_wa_ai_jobs WHERE conversation_id=c.id AND state='cancelled' AND error_code='AUTOMATION_PAUSED';
 IF cancelled_jobs<>1 THEN RAISE EXCEPTION 'pause did not cancel waiting jobs'; END IF;
 SELECT count(*) INTO cancelled_outbox FROM public.crm_wa_ai_outbox WHERE conversation_id=c.id AND state='cancelled' AND error_code='AUTOMATION_PAUSED';
 SELECT count(*) INTO leased_outbox FROM public.crm_wa_ai_outbox WHERE conversation_id=c.id AND state='leased';
 IF cancelled_outbox<>1 OR leased_outbox<>1 THEN RAISE EXCEPTION 'pause did not distinguish pending from already leased sends'; END IF;
END $$;

SET ROLE service_role;
DO $$
BEGIN
 BEGIN
  PERFORM public.crm_wa_set_automation_state(
   '20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',true,true
  );
  RAISE EXCEPTION 'opted-out conversation was activated';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  PERFORM public.crm_wa_set_automation_state(
   '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',true,true
  );
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'authenticated role executed internal toggle RPC'; END IF;
END $$;
RESET ROLE;

\echo 'ORYNEO WHATSAPP SDR TOGGLE QA PASSED'
