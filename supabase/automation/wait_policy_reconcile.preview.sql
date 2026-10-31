-- Shadow-only follow-up suppression based on canonical conversation state.
-- All existing CRM, WhatsApp and email workers remain untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_reconcile_policy(
 p_workspace_id uuid,p_limit integer DEFAULT 50
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100
 THEN RAISE EXCEPTION 'WAIT_RECONCILE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN 0; END IF;
 WITH checked AS (
   SELECT t.id,CASE
     WHEN c.id IS NULL THEN 'CONVERSATION_NOT_FOUND'
     WHEN c.opted_out IS TRUE THEN 'OPTED_OUT'
     WHEN c.consent_granted IS DISTINCT FROM TRUE THEN 'CONSENT_NOT_VERIFIED'
     WHEN c.mode IS DISTINCT FROM 'sdr_active' THEN 'HUMAN_OR_REVIEW_MODE'
     ELSE NULL
   END AS policy_reason
   FROM public.automation_wait_timers t
   LEFT JOIN public.crm_wa_conversations c ON c.id=t.conversation_id
   WHERE t.workspace_id=p_workspace_id AND t.state='waiting'
      AND t.conversation_id IS NOT NULL
   ORDER BY t.created_at,t.id LIMIT p_limit
   FOR UPDATE OF t SKIP LOCKED
 ), cancelled AS (
   UPDATE public.automation_wait_timers t SET state='cancelled',
     reason_code=c.policy_reason,updated_at=clock_timestamp()
   FROM checked c WHERE c.id=t.id AND c.policy_reason IS NOT NULL
   RETURNING t.id
 )
 SELECT count(*) INTO v_count FROM cancelled;
 RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_reconcile_policy(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_reconcile_policy(uuid,integer)
 TO service_role;
COMMIT;
