-- PostgreSQL 17 ephemeral QA, never live messaging.
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 flow_version uuid;
 inbox uuid;
 execution uuid;
 first_wait uuid;
 duplicate_wait uuid;
 timeout_wait uuid;
 inbound uuid:='7a000000-0000-4000-8000-000000000001';
 conversation uuid:='7b000000-0000-4000-8000-000000000001';
 no_reply uuid:='7b000000-0000-4000-8000-000000000002';
 node1 text:='7c000000-0000-4000-8000-000000000001';
 node2 text:='7c000000-0000-4000-8000-000000000002';
 due timestamptz:=now()+interval '2 hours';
 result record;
 changed integer;
 denied boolean:=false;
BEGIN
 SELECT id INTO flow_version FROM public.automation_flow_versions
  WHERE workspace_id=w AND status='published' ORDER BY version DESC LIMIT 1;
 IF flow_version IS NULL THEN RAISE EXCEPTION 'Published flow QA fixture absent'; END IF;
 INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,event_type,schema_version)
 VALUES(w,'crm','wait.qa.1','opportunity.created','1.0.0') RETURNING id INTO inbox;
 INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state)
 VALUES(w,flow_version,inbox,'shadow') RETURNING id INTO execution;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 first_wait:=public.automation_wait_shadow_register(w,execution,node1,due,true,conversation);
 duplicate_wait:=public.automation_wait_shadow_register(w,execution,node1,due,true,conversation);
 IF first_wait IS NULL OR first_wait IS DISTINCT FROM duplicate_wait
 THEN RAISE EXCEPTION 'Wait duplicate registration reset timer'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.automation_wait_shadow_register(w,execution,node1,due+interval '1 minute',true,conversation);
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Wait accepted changed policy under same idempotency key'; END IF;
 IF public.automation_wait_shadow_cancel_reply(w,conversation)<>0
 THEN RAISE EXCEPTION 'Unconfirmed inbound cancelled wait'; END IF;

 -- A WhatsApp reaction is not evidence of a new customer message.
 INSERT INTO public.crm_wa_messages(id,conversation_id,direction,body,reaction_to_provider_message_id,occurred_at)
 VALUES('7a000000-0000-4000-8000-000000000002',conversation,'inbound',
  'private reaction','wamid:another',clock_timestamp());
 IF public.automation_wait_shadow_cancel_reply(w,conversation)<>0
 THEN RAISE EXCEPTION 'A reaction cancelled a wait'; END IF;
 INSERT INTO public.crm_wa_messages(id,conversation_id,direction,body,occurred_at)
 VALUES(inbound,conversation,'inbound','private follow-up reply',clock_timestamp());
 changed:=public.automation_wait_shadow_cancel_reply(w,conversation);
 IF changed<>1 THEN RAISE EXCEPTION 'Canonical reply did not cancel exactly one wait'; END IF;
 IF public.automation_wait_shadow_cancel_reply(w,conversation)<>0
 THEN RAISE EXCEPTION 'Repeated inbound triggered a second cancellation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE id=first_wait AND state='cancelled' AND observed_reply_id=inbound
     AND reason_code='CANONICAL_INBOUND_RECEIVED')
 THEN RAISE EXCEPTION 'Cancellation did not persist canonical source ID'; END IF;

 timeout_wait:=public.automation_wait_shadow_register(w,execution,node2,due,true,no_reply);
 UPDATE public.automation_wait_timers SET due_at=now()-interval '1 second'
   WHERE id IN(first_wait,timeout_wait);
 SELECT * INTO result FROM public.automation_wait_shadow_poll(w,10);
 IF NOT FOUND OR result.wait_id IS DISTINCT FROM timeout_wait OR result.result_state<>'due'
 THEN RAISE EXCEPTION 'Due poll ignored a noncancelled wait'; END IF;
 SELECT * INTO result FROM public.automation_wait_shadow_poll(w,10);
 IF FOUND THEN RAISE EXCEPTION 'Another poll double-claimed a due wait'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
 THEN RAISE EXCEPTION 'A timer caused an external action'; END IF;
 IF (SELECT count(*) FROM public.automation_wait_timers WHERE execution_id=execution)<>2
 THEN RAISE EXCEPTION 'Timer registration was not idempotent'; END IF;

 -- Boundary valid in graphGuard: a 43200-minute timer must not fail due to
 -- small difference between transaction start and clock_timestamp().
 PERFORM public.automation_wait_shadow_register(w,execution,
  '7c000000-0000-4000-8000-000000000004',clock_timestamp()+interval '30 days',
  false,NULL);
 denied:=false;
 BEGIN
   PERFORM public.automation_wait_shadow_register(w,execution,
     '7c000000-0000-4000-8000-000000000005',
     clock_timestamp()+interval '31 days',false,NULL);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Out-of-policy 31-day wait was accepted'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
   WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 denied:=false;
 BEGIN
  PERFORM public.automation_wait_shadow_register(w,execution,
    '7c000000-0000-4000-8000-000000000003',now()+interval '10 minutes',false,NULL);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled runtime created a wait'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_wait_shadow_poll(w,10))
 THEN RAISE EXCEPTION 'Disabled runtime claimed a timer'; END IF;
END; $$;
RESET ROLE;
DO $$
BEGIN
 IF has_function_privilege('anon','public.automation_wait_shadow_poll(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_wait_shadow_register(uuid,uuid,text,timestamptz,boolean,uuid)','EXECUTE')
  OR has_table_privilege('authenticated','public.automation_wait_timers','INSERT')
 THEN RAISE EXCEPTION 'Unauthorized user can manipulate timers'; END IF;
END; $$;
SELECT 'automation-shadow-wait-cancellation-qa-passed' AS qa_result;
