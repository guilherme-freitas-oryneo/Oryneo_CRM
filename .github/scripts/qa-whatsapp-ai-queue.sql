\set ON_ERROR_STOP on

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.crm_wa_channels (
  id uuid PRIMARY KEY
);
CREATE TABLE public.crm_wa_conversations (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES public.crm_wa_channels(id),
  mode text NOT NULL CHECK (mode IN ('sdr_active','review','human_locked','resolved')),
  opted_out boolean NOT NULL DEFAULT false
);
CREATE TABLE public.crm_wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.crm_wa_conversations(id),
  provider_message_id text NOT NULL UNIQUE,
  direction text NOT NULL,
  kind text NOT NULL,
  body text NOT NULL DEFAULT '',
  delivery_status text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_wa_ai_settings (
  channel_id uuid PRIMARY KEY REFERENCES public.crm_wa_channels(id),
  mode text NOT NULL CHECK (mode IN ('off','suggest','auto'))
);
GRANT SELECT,UPDATE ON public.crm_wa_conversations TO service_role;
GRANT SELECT ON public.crm_wa_channels,public.crm_wa_ai_settings TO service_role;
GRANT SELECT,INSERT ON public.crm_wa_messages TO service_role;

\i supabase/migrations/20261028213000_crm_whatsapp_ai_durable_queue.sql

INSERT INTO public.crm_wa_channels(id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.crm_wa_conversations(id,channel_id,mode,opted_out)
VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','sdr_active',false);
INSERT INTO public.crm_wa_ai_settings(channel_id,mode)
VALUES ('10000000-0000-4000-8000-000000000001','auto');
INSERT INTO public.crm_wa_messages(id,conversation_id,provider_message_id,direction,kind,occurred_at)
VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','wamid.1','inbound','text','2026-10-28T18:00:00Z'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','wamid.2','inbound','text','2026-10-28T18:00:01Z'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','wamid.3','inbound','text','2026-10-28T18:00:02Z'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','wamid.4','inbound','text','2026-10-28T18:00:03Z'),
 ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','wamid.5','inbound','text','2026-10-28T18:00:04Z');

SET ROLE service_role;
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001'
);
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001'
);
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.crm_wa_ai_jobs;
 IF n <> 1 THEN RAISE EXCEPTION 'duplicate inbound produced % jobs', n; END IF;
END $$;

SET ROLE service_role;
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000002'
);
RESET ROLE;

DO $$
DECLARE active_count integer; superseded_count integer;
BEGIN
 SELECT count(*) FILTER (WHERE state='queued'), count(*) FILTER (WHERE state='superseded')
 INTO active_count,superseded_count FROM public.crm_wa_ai_jobs;
 IF active_count <> 1 OR superseded_count <> 1 THEN
   RAISE EXCEPTION 'new inbound did not supersede stale job: active %, superseded %',active_count,superseded_count;
 END IF;
END $$;

SET ROLE service_role;
SELECT id FROM public.crm_wa_claim_ai_jobs(1,60);
RESET ROLE;

DO $$
DECLARE leased_count integer; token_present boolean;
BEGIN
 SELECT count(*),bool_and(lease_token is not null) INTO leased_count,token_present FROM public.crm_wa_ai_jobs WHERE state='leased';
 IF leased_count <> 1 OR not token_present THEN RAISE EXCEPTION 'claim did not lease exactly one job'; END IF;
END $$;

SET ROLE service_role;
DO $$
DECLARE claimed integer;
BEGIN
 SELECT count(*) INTO claimed FROM public.crm_wa_claim_ai_jobs(1,60);
 IF claimed <> 0 THEN RAISE EXCEPTION 'second worker claimed leased job'; END IF;
END $$;
RESET ROLE;

SET ROLE service_role;
SELECT public.crm_wa_complete_ai_generation(
 id,lease_token,'Posso entender melhor seu cenário?','resp_1',null,false
) FROM public.crm_wa_ai_jobs WHERE state='leased';
RESET ROLE;

DO $$
DECLARE jobs integer; outbox integer;
BEGIN
 SELECT count(*) INTO jobs FROM public.crm_wa_ai_jobs WHERE state='generated';
 SELECT count(*) INTO outbox FROM public.crm_wa_ai_outbox WHERE state='pending';
 IF jobs <> 1 OR outbox <> 1 THEN RAISE EXCEPTION 'generation did not create one durable outbox'; END IF;
END $$;

UPDATE public.crm_wa_conversations SET mode='human_locked'
WHERE id='20000000-0000-4000-8000-000000000001';

SET ROLE service_role;
DO $$
DECLARE claimed integer;
BEGIN
 SELECT count(*) INTO claimed FROM public.crm_wa_claim_ai_outbox(1,60);
 IF claimed <> 0 THEN RAISE EXCEPTION 'human takeover still allowed outbox claim'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE cancelled integer;
BEGIN
 SELECT count(*) INTO cancelled FROM public.crm_wa_ai_outbox WHERE state='cancelled' AND error_code='HUMAN_CONTROL';
 IF cancelled <> 1 THEN RAISE EXCEPTION 'human takeover did not cancel pending outbox'; END IF;
END $$;

UPDATE public.crm_wa_conversations SET mode='sdr_active'
WHERE id='20000000-0000-4000-8000-000000000001';
SET ROLE service_role;
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000003'
);
SELECT id FROM public.crm_wa_claim_ai_jobs(1,60);
SELECT public.crm_wa_complete_ai_generation(
 id,lease_token,'Vamos avançar para o diagnóstico.','resp_2',null,false
) FROM public.crm_wa_ai_jobs WHERE state='leased';
SELECT id FROM public.crm_wa_claim_ai_outbox(1,60);
SELECT public.crm_wa_finish_ai_send(
 id,lease_token,'sent','wamid.out.1',null
) FROM public.crm_wa_ai_outbox WHERE state='leased';
RESET ROLE;

DO $$
DECLARE sent integer; read_model integer;
BEGIN
 SELECT count(*) INTO sent FROM public.crm_wa_ai_outbox
 WHERE state='sent' AND provider_message_id='wamid.out.1' AND sent_at IS NOT NULL;
 IF sent <> 1 THEN RAISE EXCEPTION 'successful send was not finalized'; END IF;
 SELECT count(*) INTO read_model FROM public.crm_wa_messages
 WHERE provider_message_id='wamid.out.1' AND direction='outbound'
   AND body='Vamos avançar para o diagnóstico.' AND delivery_status='pending';
 IF read_model <> 1 THEN RAISE EXCEPTION 'successful send was not reconciled into the read model'; END IF;
END $$;

SET ROLE service_role;
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000004'
);
SELECT id FROM public.crm_wa_claim_ai_jobs(1,60);
SELECT public.crm_wa_complete_ai_generation(
 id,lease_token,null,'resp_3','AI_PROVIDER_RATE_LIMITED',true
) FROM public.crm_wa_ai_jobs WHERE state='leased';
RESET ROLE;

DO $$
DECLARE retrying integer;
BEGIN
 SELECT count(*) INTO retrying FROM public.crm_wa_ai_jobs
 WHERE state='retry_wait' AND attempts=1 AND next_attempt_at>now()
   AND error_code='AI_PROVIDER_RATE_LIMITED';
 IF retrying <> 1 THEN RAISE EXCEPTION 'retryable generation failure was not scheduled'; END IF;
END $$;

SET ROLE service_role;
SELECT public.crm_wa_enqueue_ai_job(
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000005'
);
SELECT id FROM public.crm_wa_claim_ai_jobs(1,60);
SELECT public.crm_wa_cancel_ai_job(
 id,lease_token,'cancelled','CONSENT_REQUIRED'
) FROM public.crm_wa_ai_jobs WHERE state='leased';
RESET ROLE;

DO $$
DECLARE cancelled integer;
BEGIN
 SELECT count(*) INTO cancelled FROM public.crm_wa_ai_jobs
 WHERE state='cancelled' AND error_code='CONSENT_REQUIRED' AND lease_token IS NULL;
 IF cancelled <> 1 THEN RAISE EXCEPTION 'leased job was not safely cancelled'; END IF;
END $$;

SET ROLE authenticated;
DO $$
DECLARE blocked boolean := false;
BEGIN
 BEGIN
   PERFORM 1 FROM public.crm_wa_ai_jobs LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN blocked := true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'authenticated role can read internal AI queue'; END IF;
END $$;
RESET ROLE;

\echo 'ORYNEO WHATSAPP AI DURABLE QUEUE QA PASSED'
