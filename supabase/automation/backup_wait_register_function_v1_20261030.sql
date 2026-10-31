CREATE OR REPLACE FUNCTION public.automation_wait_shadow_register(p_workspace_id uuid, p_execution_id uuid, p_node_id text, p_due_at timestamp with time zone, p_cancel_on_reply boolean, p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END; $function$

