-- ORYNEO shadow failure recovery. DISPOSABLE QA ONLY: no live migration.
-- No message, e-mail, payment or pipeline update is performed here.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_shadow_fail(
 p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_error_code text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v public.automation_event_inbox%ROWTYPE; v_delay interval;
BEGIN
 IF p_workspace_id IS NULL OR p_inbox_id IS NULL OR p_lease_token IS NULL
   OR p_error_code IS NULL OR p_error_code NOT IN (
   'SHADOW_FLOWS_UNAVAILABLE','SHADOW_FLOW_LIMIT',
   'SHADOW_VERSIONS_UNAVAILABLE','WAIT_CONVERSATION_REQUIRED',
   'WAIT_CANCEL_UNAVAILABLE','SHADOW_ACK_FAILED',
   'SHADOW_CONTEXT_UNAVAILABLE','SHADOW_PLANNER_FAILED',
   'SHADOW_RUNTIME_STOPPED','SHADOW_UNEXPECTED_FAILURE')
 THEN RAISE EXCEPTION 'SHADOW_FAILURE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.automation_event_inbox
 WHERE workspace_id=p_workspace_id AND id=p_inbox_id FOR UPDATE;
 IF NOT FOUND OR v.state<>'pending'
   OR v.lease_token IS DISTINCT FROM p_lease_token
   OR v.lease_until IS NULL OR v.lease_until<=clock_timestamp()
   OR v.attempts NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'SHADOW_FAILURE_LEASE_STALE' USING ERRCODE='42501'; END IF;
 IF v.attempts>=5 THEN
   UPDATE public.automation_event_inbox SET
     state='failed',lease_token=NULL,lease_until=NULL,
     processed_at=clock_timestamp(),last_error_code=p_error_code
   WHERE workspace_id=p_workspace_id AND id=p_inbox_id;
   RETURN 'quarantined';
 END IF;
 v_delay:=CASE v.attempts
   WHEN 1 THEN interval '30 seconds'
   WHEN 2 THEN interval '2 minutes'
   WHEN 3 THEN interval '5 minutes'
   ELSE interval '15 minutes'
 END;
 UPDATE public.automation_event_inbox SET
   lease_token=NULL,lease_until=clock_timestamp()+v_delay,
   last_error_code=p_error_code
 WHERE workspace_id=p_workspace_id AND id=p_inbox_id;
 RETURN 'retry_scheduled';
END $fn$;
REVOKE ALL ON FUNCTION public.automation_shadow_fail(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_fail(uuid,uuid,uuid,text)
 TO service_role;
COMMIT;
