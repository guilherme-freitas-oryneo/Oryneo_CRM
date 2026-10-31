-- ORYNEO isolated shadow continuation. QA PREVIEW ONLY, no production migration.
-- A due timer can advance ONLY in shadow mode, from an immutable version,
-- with a graph-bound trace. Every planned action is persisted as BLOCKED.
BEGIN;
ALTER TABLE public.automation_wait_timers
 ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
 ADD COLUMN IF NOT EXISTS resume_attempts integer NOT NULL DEFAULT 0
   CHECK (resume_attempts BETWEEN 0 AND 5),
 ADD COLUMN IF NOT EXISTS resume_next_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS resume_error_code text;
CREATE INDEX IF NOT EXISTS automation_wait_resume_due_idx
 ON public.automation_wait_timers(workspace_id,resume_next_at,id)
 WHERE state='due' AND resumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume(
 p_workspace_id uuid,p_wait_id uuid,p_decision jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 t public.automation_wait_timers%ROWTYPE;
 v_execution public.automation_executions%ROWTYPE;
 v_graph jsonb; v_node jsonb; v_previous text; v_first text;
 v_expected text; v_step jsonb; v_action jsonb;
 v_action_node text; v_action_type text; v_count integer:=0;
 v_state text; v_index integer:=0;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL OR p_decision IS NULL
  OR jsonb_typeof(p_decision)<>'object'
  OR octet_length(p_decision::text)>131072
  OR p_decision->>'shadowOnly'<>'true'
  OR p_decision->>'dispatchAuthorized'<>'false'
  OR p_decision->>'state' NOT IN ('completed','blocked','waiting','awaiting_server_outcome')
  OR jsonb_typeof(p_decision->'trace')<>'array'
  OR jsonb_array_length(p_decision->'trace') NOT BETWEEN 1 AND 500
  OR jsonb_typeof(p_decision->'plannedActions')<>'array'
  OR jsonb_array_length(p_decision->'plannedActions')>50
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers
  WHERE workspace_id=p_workspace_id AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WAIT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF t.resumed_at IS NOT NULL THEN
  RETURN jsonb_build_object('alreadyResumed',true,'dispatchAuthorized',false);
 END IF;
 IF t.state<>'due' OR t.resume_attempts>=5 OR t.resume_next_at>clock_timestamp()
 THEN RAISE EXCEPTION 'SHADOW_WAIT_NOT_CLAIMABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_execution FROM public.automation_executions
  WHERE workspace_id=p_workspace_id AND id=t.execution_id FOR UPDATE;
 IF NOT FOUND OR v_execution.state<>'shadow'
 THEN RAISE EXCEPTION 'SHADOW_EXECUTION_NOT_ACTIVE' USING ERRCODE='42501'; END IF;
 SELECT graph_json INTO v_graph FROM public.automation_flow_versions
  WHERE workspace_id=p_workspace_id AND id=v_execution.flow_version_id
    AND status='published';
 IF v_graph IS NULL OR jsonb_typeof(v_graph->'nodes')<>'array'
 THEN RAISE EXCEPTION 'SHADOW_FROZEN_GRAPH_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT n.value INTO v_node FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
  WHERE n.value->>'id'=t.node_id AND n.value->>'type'='wait' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WAIT_NODE_NOT_IN_GRAPH' USING ERRCODE='22023'; END IF;
 SELECT e.value->>'target' INTO v_expected FROM jsonb_array_elements(v_graph->'edges') AS e(value)
  WHERE e.value->>'source'=t.node_id AND e.value->>'source_port'='out' LIMIT 1;
 IF v_expected IS NULL THEN RAISE EXCEPTION 'SHADOW_WAIT_OUT_EDGE_MISSING' USING ERRCODE='22023'; END IF;
 FOR v_step IN SELECT value FROM jsonb_array_elements(p_decision->'trace') AS a(value) LOOP
   v_first:=v_step->>'nodeId';
   IF v_first IS NULL OR v_first<>v_expected
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
       WHERE n.value->>'id'=v_first AND n.value->>'type'=v_step->>'type')
     OR v_step->>'status' NOT IN ('evaluated','completed','waiting','requires_server_result')
   THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_TRACE_INVALID' USING ERRCODE='22023'; END IF;
   IF v_index>0 AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(v_graph->'edges') AS e(value)
     WHERE e.value->>'source'=v_previous AND e.value->>'target'=v_first
   ) THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_EDGE_INVALID' USING ERRCODE='22023'; END IF;
   INSERT INTO public.automation_node_executions
     (workspace_id,execution_id,node_id,state,result_code,sanitized_trace)
   VALUES(p_workspace_id,t.execution_id,v_first,
     CASE WHEN v_step->>'status'='waiting' THEN 'waiting' ELSE 'planned' END,
     LEFT(v_step->>'status',48),
     jsonb_build_object('type',LEFT(v_step->>'type',48),'from_wait',t.node_id))
   ON CONFLICT (execution_id,node_id,attempt) DO NOTHING;
   v_previous:=v_first;
   v_expected:=NULL; -- updated below from actual graph edge, if any
   IF v_step ? 'nextPort' THEN
     SELECT e.value->>'target' INTO v_expected
     FROM jsonb_array_elements(v_graph->'edges') AS e(value)
     WHERE e.value->>'source'=v_first
       AND e.value->>'source_port'=v_step->>'nextPort' LIMIT 1;
   END IF;
   v_index:=v_index+1;
 END LOOP;
 -- Verify the last traced status actually reflects the decision state.
 v_step:=p_decision->'trace'->(v_index-1);
 v_state:=p_decision->>'state';
 IF (v_state='completed' AND v_step->>'status'<>'completed')
  OR (v_state='waiting' AND v_step->>'status'<>'waiting')
  OR (v_state='awaiting_server_outcome' AND v_step->>'status'<>'requires_server_result')
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_TERMINAL_INVALID' USING ERRCODE='22023'; END IF;
 FOR v_action IN SELECT value FROM jsonb_array_elements(p_decision->'plannedActions') AS a(value) LOOP
  v_action_node:=v_action->>'nodeId';v_action_type:=v_action->>'type';
  IF (v_action->>'actionKey') !~ '^[0-9a-f]{64}$'
   OR v_action_type NOT IN ('whatsapp_template','whatsapp_reply','email',
     'crm_stage_change','crm_task','crm_update','human_handoff','notify')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
      WHERE n.value->>'id'=v_action_node AND n.value->>'type'=v_action_type)
  THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_ACTION_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.automation_action_outbox
   (workspace_id,execution_id,node_id,action_key,action_type,state)
  VALUES(p_workspace_id,t.execution_id,v_action_node,
   v_action->>'actionKey',v_action_type,'blocked')
  ON CONFLICT(workspace_id,action_key) DO NOTHING;
  v_count:=v_count+1;
 END LOOP;
 UPDATE public.automation_wait_timers
 SET resumed_at=clock_timestamp(),
  reason_code=CASE WHEN v_state='blocked' THEN 'SHADOW_RESUME_BLOCKED'
       ELSE 'SHADOW_RESUMED' END,
  updated_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND id=p_wait_id;
 RETURN jsonb_build_object('resumed',true,'traceCount',v_index,
  'blockedActionCount',v_count,'dispatchAuthorized',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume_fail(
 p_workspace_id uuid,p_wait_id uuid,p_code text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE t public.automation_wait_timers%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL
 OR p_code NOT IN ('SHADOW_RESUME_UNAVAILABLE','SHADOW_RESUME_CONTEXT',
   'SHADOW_RESUME_PLAN','SHADOW_RESUME_ACK')
 THEN RAISE EXCEPTION 'SHADOW_RESUME_FAILURE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers WHERE workspace_id=p_workspace_id
  AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND OR t.state<>'due' OR t.resumed_at IS NOT NULL
 THEN RAISE EXCEPTION 'SHADOW_RESUME_FAILURE_STALE' USING ERRCODE='42501'; END IF;
 IF t.resume_attempts>=4 THEN
   UPDATE public.automation_wait_timers SET resume_attempts=5,
     state='cancelled',reason_code='SHADOW_CONTINUATION_DEAD_LETTER',
     resume_error_code=p_code,updated_at=clock_timestamp()
   WHERE id=t.id;
   RETURN 'quarantined';
 END IF;
 UPDATE public.automation_wait_timers SET
  resume_attempts=resume_attempts+1,
  resume_error_code=p_code,
  resume_next_at=clock_timestamp()+(CASE t.resume_attempts
   WHEN 0 THEN interval '30 seconds'
   WHEN 1 THEN interval '2 minutes'
   WHEN 2 THEN interval '5 minutes'
   ELSE interval '15 minutes' END),
  updated_at=clock_timestamp()
 WHERE id=t.id;
 RETURN 'retry_scheduled';
END $fn$;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume(uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume_fail(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume_fail(uuid,uuid,text) TO service_role;
COMMIT;
