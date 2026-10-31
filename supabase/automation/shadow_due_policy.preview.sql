-- ORYNEO: extra safety boundary for due shadow timers.
-- Disposable PostgreSQL QA preview; NO live sends or CRM mutations.
-- A due timer is never assumed safe just because it passed the earlier poll.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_due_policy(
 p_workspace_id uuid, p_wait_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 t public.automation_wait_timers%ROWTYPE;
 c public.crm_wa_conversations%ROWTYPE;
 v_reason text;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL
 THEN RAISE EXCEPTION 'DUE_POLICY_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers
 WHERE workspace_id=p_workspace_id AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DUE_POLICY_WAIT_MISSING' USING ERRCODE='P0002'; END IF;
 IF t.state<>'due' OR t.resumed_at IS NOT NULL
 THEN RETURN 'not_due'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
 THEN RETURN 'runtime_stopped'; END IF;
 IF t.conversation_id IS NULL THEN RETURN 'ready'; END IF;
 -- Lock conversation state during this SQL transaction. A second, DB-enforced
 -- resume trigger repeats the check just before acknowledging the trace.
 SELECT * INTO c FROM public.crm_wa_conversations
  WHERE id=t.conversation_id FOR SHARE;
 IF NOT FOUND THEN v_reason:='CONVERSATION_NOT_FOUND';
 ELSIF c.opted_out IS TRUE THEN v_reason:='OPTED_OUT';
 ELSIF c.consent_granted IS DISTINCT FROM TRUE THEN v_reason:='CONSENT_NOT_VERIFIED';
 ELSIF c.mode IS DISTINCT FROM 'sdr_active' THEN v_reason:='HUMAN_OR_REVIEW_MODE';
 ELSIF t.cancel_on_reply AND EXISTS(
   SELECT 1 FROM public.crm_wa_messages m
   WHERE m.conversation_id=t.conversation_id
     AND m.direction='inbound'
     AND m.reaction_to_provider_message_id IS NULL
     AND m.occurred_at>=t.created_at
 ) THEN v_reason:='CANONICAL_INBOUND_RECEIVED';
 END IF;
 IF v_reason IS NOT NULL THEN
  UPDATE public.automation_wait_timers SET
    state='cancelled',reason_code=v_reason,updated_at=clock_timestamp()
  WHERE id=t.id AND workspace_id=p_workspace_id;
  RETURN 'cancelled';
 END IF;
 RETURN 'ready';
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume_atomic_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 c public.crm_wa_conversations%ROWTYPE;
BEGIN
 IF OLD.resumed_at IS NOT NULL OR NEW.resumed_at IS NULL
 THEN RETURN NEW; END IF;
 IF NEW.state<>'due' OR OLD.state<>'due'
  OR NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
     JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
     WHERE w.id=NEW.workspace_id AND w.active AND s.mode='shadow'
       AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'SHADOW_RESUME_RUNTIME_GUARD_DENIED' USING ERRCODE='42501'; END IF;
 IF OLD.conversation_id IS NOT NULL THEN
  SELECT * INTO c FROM public.crm_wa_conversations
  WHERE id=OLD.conversation_id FOR SHARE;
  IF NOT FOUND OR c.mode IS DISTINCT FROM 'sdr_active'
    OR c.opted_out IS TRUE OR c.consent_granted IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'SHADOW_RESUME_CONVERSATION_GUARD_DENIED'
    USING ERRCODE='42501'; END IF;
  IF OLD.cancel_on_reply AND EXISTS(
   SELECT 1 FROM public.crm_wa_messages m
    WHERE m.conversation_id=OLD.conversation_id AND m.direction='inbound'
     AND m.reaction_to_provider_message_id IS NULL
     AND m.occurred_at>=OLD.created_at
  ) THEN RAISE EXCEPTION 'SHADOW_RESUME_CANONICAL_REPLY_PRESENT'
    USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS automation_wait_resume_atomic_guard
 ON public.automation_wait_timers;
CREATE TRIGGER automation_wait_resume_atomic_guard
 BEFORE UPDATE OF resumed_at ON public.automation_wait_timers
 FOR EACH ROW WHEN (OLD.resumed_at IS NULL AND NEW.resumed_at IS NOT NULL)
 EXECUTE FUNCTION public.automation_wait_shadow_resume_atomic_guard();

REVOKE ALL ON FUNCTION public.automation_wait_shadow_due_policy(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume_atomic_guard()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_due_policy(uuid,uuid)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume_atomic_guard()
 TO service_role;
COMMIT;
