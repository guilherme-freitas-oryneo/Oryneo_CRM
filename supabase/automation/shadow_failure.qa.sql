-- PostgreSQL 17 ephemeral QA. Run after shadow_queue.qa.sql.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
 IF has_function_privilege('anon','public.automation_shadow_fail(uuid,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_shadow_fail(uuid,uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.automation_shadow_fail(uuid,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Unrestricted shadow failure RPC'; END IF;
END $guard$;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 e uuid;
 claimed record;
 current_state text;
 current_code text;
 next_lease timestamptz;
 result text;
 blocked boolean;
 attempt_no integer;
BEGIN
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings
  SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 e:=public.automation_shadow_ingest(w,'crm','evt.shadow.failure.contract',
  'opportunity.created',
  '{"opportunity_id":"44444444-4444-4444-8444-444444444444"}'::jsonb);
 FOR attempt_no IN 1..5 LOOP
   SELECT * INTO claimed FROM public.automation_shadow_claim(w,1);
   IF NOT FOUND OR claimed.inbox_id IS DISTINCT FROM e
     OR claimed.attempt<>attempt_no
   THEN RAISE EXCEPTION 'Failed to claim attempt %',attempt_no; END IF;
   blocked:=false;
   BEGIN
     PERFORM public.automation_shadow_fail(w,e,gen_random_uuid(),'SHADOW_ACK_FAILED');
   EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
   END;
   IF NOT blocked THEN RAISE EXCEPTION 'Wrong lease token accepted'; END IF;
   blocked:=false;
   BEGIN
     PERFORM public.automation_shadow_fail(w,e,claimed.lease_token,
      'customer email: person@example.com');
   EXCEPTION WHEN invalid_parameter_value THEN blocked:=true;
   END;
   IF NOT blocked THEN RAISE EXCEPTION 'PII error text accepted'; END IF;
   result:=public.automation_shadow_fail(
     w,e,claimed.lease_token,'SHADOW_CONTEXT_UNAVAILABLE');
   SELECT state,last_error_code,lease_until INTO current_state,current_code,next_lease
   FROM public.automation_event_inbox WHERE id=e;
   IF current_code<>'SHADOW_CONTEXT_UNAVAILABLE'
   THEN RAISE EXCEPTION 'Error cause not stored'; END IF;
   IF attempt_no<5 THEN
     IF result<>'retry_scheduled' OR current_state<>'pending'
       OR next_lease<=clock_timestamp()
       OR (SELECT lease_token FROM public.automation_event_inbox WHERE id=e) IS NOT NULL
     THEN RAISE EXCEPTION 'Backoff not applied'; END IF;
     blocked:=false;
     BEGIN
       PERFORM public.automation_shadow_fail(w,e,claimed.lease_token,'SHADOW_ACK_FAILED');
     EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
     END;
     IF NOT blocked THEN RAISE EXCEPTION 'Duplicate failure ACK accepted'; END IF;
     SELECT * INTO claimed FROM public.automation_shadow_claim(w,1);
     IF FOUND THEN RAISE EXCEPTION 'Claim bypassed backoff'; END IF;
     UPDATE public.automation_event_inbox
       SET lease_until=clock_timestamp()-interval '1 second' WHERE id=e;
   ELSE
     IF result<>'quarantined' OR current_state<>'failed' OR next_lease IS NOT NULL
     THEN RAISE EXCEPTION 'Fifth retry was not quarantined'; END IF;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
   WHERE state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Shadow failure caused outbound effects'; END IF;
 UPDATE public.automation_runtime_settings
  SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
END $qa$;
RESET ROLE;
SELECT 'shadow-recovery-qa-passed' AS qa_result;
