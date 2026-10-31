-- Disposable QA: no historic replay, no skipped new events and no outbox dispatch.
\set ON_ERROR_STOP on
CREATE TABLE public.crm_events(
 id uuid PRIMARY KEY,
 deal_id uuid,
 event_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON public.crm_events TO service_role; -- Fixture insertion only; production adapter reads CRM.
INSERT INTO public.crm_events(id,deal_id,event_type,created_at) VALUES
('1b000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
 'received',now()-interval '1 day');

SET ROLE service_role;
DO $$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 anchor timestamptz;
 repeated timestamptz;
 outcome jsonb;
 refused boolean:=false;
 seen integer;
BEGIN
 IF (SELECT mode FROM public.automation_runtime_settings WHERE workspace_id=w)<>'disabled'
 THEN RAISE EXCEPTION 'Expected disabled runtime before cursor initialization'; END IF;
 SELECT public.automation_shadow_init_crm_cursor(w,actor) INTO anchor;
 SELECT public.automation_shadow_init_crm_cursor(w,actor) INTO repeated;
 IF anchor IS NULL OR anchor<>repeated THEN
   RAISE EXCEPTION 'Cursor initialization rewound an existing watermark'; END IF;
 BEGIN
  PERFORM public.automation_shadow_init_crm_cursor(
    '22222222-2222-4222-8222-222222222222',actor);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Unauthorized cross-workspace cursor init'; END IF;

 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 outcome:=public.automation_shadow_ingest_crm(w,5);
 IF outcome->>'inserted'<>'0' OR EXISTS(
   SELECT 1 FROM public.automation_event_inbox WHERE event_id='crm:1b000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Historic CRM event was silently replayed'; END IF;

 -- Insert later journal events in deterministic order, plus unsupported note.
 INSERT INTO public.crm_events(id,deal_id,event_type,created_at) VALUES
 ('1b000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','received',anchor+interval '1 second'),
 ('1b000000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','stage_changed',anchor+interval '2 seconds'),
 ('1b000000-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','note',anchor+interval '3 seconds');
 outcome:=public.automation_shadow_ingest_crm(w,1);
 IF outcome->>'inserted'<>'1' OR outcome->>'scanned'<>'1'
 THEN RAISE EXCEPTION 'First bounded batch not consumed'; END IF;
 outcome:=public.automation_shadow_ingest_crm(w,1);
 IF outcome->>'inserted'<>'1' OR outcome->>'scanned'<>'1'
 THEN RAISE EXCEPTION 'Second bounded batch not consumed'; END IF;
 outcome:=public.automation_shadow_ingest_crm(w,10);
 IF outcome->>'inserted'<>'0' OR outcome->>'scanned'<>'0'
 THEN RAISE EXCEPTION 'Duplicate or unsupported event was ingested'; END IF;
 SELECT count(*) INTO seen FROM public.automation_event_inbox WHERE source='crm'
   AND event_id LIKE 'crm:%';
 IF seen<>2 THEN RAISE EXCEPTION 'Exactly two CRM shadow events expected, got %',seen; END IF;
 IF (SELECT event_type FROM public.automation_event_inbox
    WHERE event_id='crm:1b000000-0000-4000-8000-000000000003')
   <>'opportunity.stage_changed'
 THEN RAISE EXCEPTION 'Canonical stage-change event mapped incorrectly'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
 THEN RAISE EXCEPTION 'CRM shadow ingest scheduled an external effect'; END IF;
 refused:=false;
 BEGIN
  PERFORM public.automation_shadow_init_crm_cursor(w,actor);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Live-mode cursor rewind accepted'; END IF;

 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 refused:=false;
 BEGIN
  PERFORM public.automation_shadow_ingest_crm(w,5);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Stopped runtime ingested CRM events'; END IF;
END; $$;
RESET ROLE;
SELECT 'automation-shadow-crm-adapter-qa-passed' AS qa_result;
