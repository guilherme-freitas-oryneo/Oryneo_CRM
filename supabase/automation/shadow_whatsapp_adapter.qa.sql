-- Disposable QA: inbound-only WhatsApp journal ingestion without re-sending.
\set ON_ERROR_STOP on
CREATE TABLE public.crm_wa_messages(
 id uuid PRIMARY KEY,
 conversation_id uuid,
 direction text NOT NULL,
 body text,
 reaction_to_provider_message_id text,
 occurred_at timestamptz NOT NULL
);
GRANT SELECT,INSERT ON public.crm_wa_messages TO service_role; -- QA fixture only; adapter reads canonical messages.
INSERT INTO public.crm_wa_messages(id,conversation_id,direction,body,occurred_at) VALUES
('2b000000-0000-4000-8000-000000000001',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound',
 'historical customer data must not replay',now()-interval '1 day');

SET ROLE service_role;
DO $$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 start_at timestamptz;
 again timestamptz;
 result jsonb;
 refused boolean:=false;
 count_events integer;
BEGIN
 SELECT public.automation_shadow_init_whatsapp_cursor(w,actor) INTO start_at;
 SELECT public.automation_shadow_init_whatsapp_cursor(w,actor) INTO again;
 IF start_at IS NULL OR start_at<>again THEN RAISE EXCEPTION 'WA bootstrap rewound watermark'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 result:=public.automation_shadow_ingest_whatsapp(w,10);
 IF result->>'inserted'<>'0' THEN RAISE EXCEPTION 'Historic inbound replayed'; END IF;

 INSERT INTO public.crm_wa_messages
 (id,conversation_id,direction,body,reaction_to_provider_message_id,occurred_at) VALUES
 ('2b000000-0000-4000-8000-000000000002',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound',
 'latest inbound, private',NULL,start_at+interval '1 second'),
 ('2b000000-0000-4000-8000-000000000003',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound',
 'another inbound, private',NULL,start_at+interval '2 seconds'),
 ('2b000000-0000-4000-8000-000000000004',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','outbound',
 'assistant response',NULL,start_at+interval '3 seconds'),
 ('2b000000-0000-4000-8000-000000000005',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound',
 'reaction payload','wamid:example',start_at+interval '4 seconds');
 result:=public.automation_shadow_ingest_whatsapp(w,1);
 IF result->>'scanned'<>'1' OR result->>'inserted'<>'1'
 THEN RAISE EXCEPTION 'First inbound batch missing'; END IF;
 result:=public.automation_shadow_ingest_whatsapp(w,1);
 IF result->>'scanned'<>'1' OR result->>'inserted'<>'1'
 THEN RAISE EXCEPTION 'Second inbound batch missing'; END IF;
 result:=public.automation_shadow_ingest_whatsapp(w,5);
 IF result->>'scanned'<>'0' OR result->>'inserted'<>'0'
 THEN RAISE EXCEPTION 'Outbound or reaction processed as lead message'; END IF;
 SELECT count(*) INTO count_events FROM public.automation_event_inbox
   WHERE source='whatsapp' AND event_id LIKE 'wa:%';
 IF count_events<>2 THEN RAISE EXCEPTION 'WhatsApp inbox dedup failed: %',count_events; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
    WHERE source='whatsapp' AND (event_type<>'conversation.inbound'
      OR context_refs ? 'body' OR context_refs ? 'customer_wa_id'
      OR NOT (context_refs ? 'conversation_id')))
 THEN RAISE EXCEPTION 'Private payload leaked or wrong event type'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
 THEN RAISE EXCEPTION 'WhatsApp shadow adapter dispatched'; END IF;

 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 refused:=false;
 BEGIN
  PERFORM public.automation_shadow_ingest_whatsapp(w,1);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Disabled WA ingest was authorized'; END IF;
END; $$;
RESET ROLE;
SELECT 'automation-shadow-whatsapp-qa-passed' AS qa_result;
