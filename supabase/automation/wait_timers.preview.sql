-- ORYNEO additive shadow-only durable wait primitive.
-- NO scheduler, provider send, CRM mutation, payment action or live dispatcher.
-- A separate audited live adapter must own final channel preflight and delivery.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_wait_timers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 node_id text NOT NULL CHECK(node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 conversation_id uuid,
 due_at timestamptz NOT NULL,
 cancel_on_reply boolean NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','cancelled','due')),
 reason_code text,
 observed_reply_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT automation_wait_execution_fk FOREIGN KEY(workspace_id,execution_id)
   REFERENCES public.automation_executions(workspace_id,id) ON DELETE RESTRICT,
 CONSTRAINT automation_wait_cancel_requires_conversation CHECK(NOT cancel_on_reply OR conversation_id IS NOT NULL),
 UNIQUE(execution_id,node_id)
);
CREATE INDEX IF NOT EXISTS automation_wait_due_idx
 ON public.automation_wait_timers(workspace_id,due_at,id) WHERE state='waiting';
CREATE INDEX IF NOT EXISTS automation_wait_conversation_idx
 ON public.automation_wait_timers(workspace_id,conversation_id) WHERE state='waiting' AND cancel_on_reply;
ALTER TABLE public.automation_wait_timers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_wait_timers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_wait_timers TO service_role;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_register(
 p_workspace_id uuid,p_execution_id uuid,p_node_id text,
 p_due_at timestamptz,p_cancel_on_reply boolean,p_conversation_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_id uuid;v_current public.automation_wait_timers%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_execution_id IS NULL
   OR p_node_id IS NULL OR p_node_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_due_at IS NULL OR p_due_at<=now() OR p_due_at>now()+interval '30 days'
   OR p_cancel_on_reply IS NULL OR (p_cancel_on_reply AND p_conversation_id IS NULL)
 THEN RAISE EXCEPTION 'WAIT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   JOIN public.automation_executions e ON e.workspace_id=w.id AND e.id=p_execution_id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow'
     AND s.emergency_stop=false AND e.state='shadow')
 THEN RAISE EXCEPTION 'WAIT_SHADOW_GUARD_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_wait_timers
  (workspace_id,execution_id,node_id,due_at,cancel_on_reply,conversation_id)
 VALUES(p_workspace_id,p_execution_id,p_node_id,p_due_at,p_cancel_on_reply,p_conversation_id)
 ON CONFLICT(execution_id,node_id) DO NOTHING
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT * INTO v_current FROM public.automation_wait_timers
    WHERE execution_id=p_execution_id AND node_id=p_node_id;
   -- Retries must not reset a timer or alter its cancellation policy.
   IF NOT FOUND OR v_current.workspace_id IS DISTINCT FROM p_workspace_id
     OR v_current.due_at IS DISTINCT FROM p_due_at
     OR v_current.cancel_on_reply IS DISTINCT FROM p_cancel_on_reply
     OR v_current.conversation_id IS DISTINCT FROM p_conversation_id
   THEN RAISE EXCEPTION 'WAIT_IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
   v_id:=v_current.id;
 END IF;
 RETURN v_id;
END; $$;

-- Idempotent receipt-driven cancellation. Query the real inbound journal;
-- caller-supplied chat text or a fabricated event ID is never trusted.
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_cancel_reply(
 p_workspace_id uuid,p_conversation_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace_id IS NULL OR p_conversation_id IS NULL
 THEN RAISE EXCEPTION 'WAIT_CANCEL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN 0; END IF;
 WITH confirmed AS (
   SELECT t.id,(
     SELECT m.id FROM public.crm_wa_messages m
     WHERE m.conversation_id=p_conversation_id AND m.direction='inbound'
       AND m.reaction_to_provider_message_id IS NULL
       AND m.occurred_at>=t.created_at
     ORDER BY m.occurred_at,m.id LIMIT 1
   ) message_id
   FROM public.automation_wait_timers t
   WHERE t.workspace_id=p_workspace_id AND t.conversation_id=p_conversation_id
     AND t.cancel_on_reply AND t.state='waiting'
   FOR UPDATE OF t SKIP LOCKED
 ), changed AS (
   UPDATE public.automation_wait_timers t SET
     state='cancelled',reason_code='CANONICAL_INBOUND_RECEIVED',
     observed_reply_id=c.message_id,updated_at=clock_timestamp()
     FROM confirmed c WHERE t.id=c.id AND c.message_id IS NOT NULL
     RETURNING t.id
 )
 SELECT count(*) INTO v_count FROM changed;
 RETURN v_count;
END; $$;

-- Solely proposes that a timer is due; cannot enqueue any outbound action.
-- Cancellation is checked again inside the same claim transaction.
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_poll(
 p_workspace_id uuid,p_limit integer DEFAULT 10
) RETURNS TABLE(wait_id uuid,result_state text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>20
 THEN RAISE EXCEPTION 'WAIT_POLL_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH claimable AS (
   SELECT t.id,t.conversation_id,t.cancel_on_reply,t.created_at
   FROM public.automation_wait_timers t
   WHERE t.workspace_id=p_workspace_id AND t.state='waiting' AND t.due_at<=now()
   ORDER BY t.due_at,t.id LIMIT p_limit FOR UPDATE OF t SKIP LOCKED
 ), checked AS (
   SELECT c.id, CASE WHEN c.cancel_on_reply THEN (
     SELECT m.id FROM public.crm_wa_messages m
     WHERE m.conversation_id=c.conversation_id AND m.direction='inbound'
       AND m.reaction_to_provider_message_id IS NULL
       AND m.occurred_at>=c.created_at
     ORDER BY m.occurred_at,m.id LIMIT 1
   ) ELSE NULL::uuid END AS inbound_id
   FROM claimable c
 ), updated AS (
   UPDATE public.automation_wait_timers t SET
      state=CASE WHEN c.inbound_id IS NOT NULL THEN 'cancelled' ELSE 'due' END,
      reason_code=CASE WHEN c.inbound_id IS NOT NULL THEN 'CANONICAL_INBOUND_RECEIVED'
                       ELSE 'SHADOW_TIMER_DUE' END,
      observed_reply_id=c.inbound_id,updated_at=clock_timestamp()
   FROM checked c WHERE t.id=c.id RETURNING t.id,t.state
 )
 SELECT u.id,u.state FROM updated u;
END; $$;

REVOKE ALL ON FUNCTION public.automation_wait_shadow_register(uuid,uuid,text,timestamptz,boolean,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_cancel_reply(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_poll(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_register(uuid,uuid,text,timestamptz,boolean,uuid)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_cancel_reply(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_poll(uuid,integer) TO service_role;
COMMIT;
