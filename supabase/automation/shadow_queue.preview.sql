-- ISOLATED QA ONLY. No scheduled worker, no live ingress, no provider dispatch.
-- DDL is additive and intentionally leaves production runtime disabled.
BEGIN;
ALTER TABLE public.automation_event_inbox
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;
CREATE INDEX IF NOT EXISTS automation_shadow_claim_due_idx
  ON public.automation_event_inbox(workspace_id,state,lease_until,received_at)
  WHERE state='pending';
-- Only service_role can write. RLS policies and table grants are unchanged.
CREATE OR REPLACE FUNCTION public.automation_shadow_ingest(
  p_workspace_id uuid,p_source text,p_event_id text,p_event_type text,p_context_refs jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_source NOT IN ('crm','whatsapp','stripe','mail','landing')
    OR p_event_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
    OR p_event_type NOT IN (
      'opportunity.created','opportunity.updated','opportunity.stage_changed',
      'lead.intake_received','checkout.started','checkout.expired',
      'billing.paid_verified','billing.failed','conversation.inbound',
      'conversation.human_takeover','meeting.scheduled','proposal.sent')
    OR p_context_refs IS NULL OR jsonb_typeof(p_context_refs)<>'object'
    OR octet_length(p_context_refs::text)>4096
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_context_refs) AS k(key)
      WHERE k.key NOT IN ('opportunity_id','conversation_id','order_id','lead_id'))
    OR EXISTS(SELECT 1 FROM jsonb_each_text(p_context_refs) AS kv(key,value)
      WHERE kv.value IS NULL OR kv.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'SHADOW_ENVELOPE_REJECTED' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RAISE EXCEPTION 'SHADOW_RUNTIME_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,event_type,schema_version,context_refs)
    VALUES(p_workspace_id,p_source,p_event_id,p_event_type,'1.0.0',p_context_refs)
    ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND source=p_source AND event_id=p_event_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_claim(
  p_workspace_id uuid,p_batch_limit integer DEFAULT 5
) RETURNS TABLE(inbox_id uuid,source text,event_id text,event_type text,
                context_refs jsonb,lease_token uuid,attempt integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'SHADOW_BATCH_LIMIT' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RETURN; END IF;
  -- Row locks and leases protect concurrent workers, including after crashes.
  RETURN QUERY
  WITH claimable AS (
    SELECT e.id FROM public.automation_event_inbox e
    WHERE e.workspace_id=p_workspace_id AND e.state='pending'
      AND e.event_type IS NOT NULL AND e.schema_version='1.0.0'
      AND (e.lease_until IS NULL OR e.lease_until<now())
      AND e.attempts<5
    ORDER BY e.received_at,e.id
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.automation_event_inbox e SET
      lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',
      attempts=e.attempts+1,last_error_code=NULL
    FROM claimable c WHERE e.id=c.id
    RETURNING e.id,e.source,e.event_id,e.event_type,e.context_refs,e.lease_token,e.attempts
  )
  SELECT l.id,l.source,l.event_id,l.event_type,l.context_refs,l.lease_token,l.attempts
  FROM leased l;
END; $$;

-- Atomic acknowledgement: all matching flows must be included in p_plans.
-- A plan is metadata ONLY. No branch can queue an external side effect.
CREATE OR REPLACE FUNCTION public.automation_shadow_finish(
  p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_plans jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_event public.automation_event_inbox%ROWTYPE;
  v_plans integer;
  v_required integer;
  v_plan jsonb;
  v_decision jsonb;
  v_version_id uuid;
  v_execution_id uuid;
  v_node jsonb;
  v_action jsonb;
  v_count integer:=0;
  v_step_id text;
  v_action_type text;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans)<>'array'
    OR jsonb_array_length(p_plans)>20 OR octet_length(p_plans::text)>262144
  THEN RAISE EXCEPTION 'SHADOW_PLANS_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_event FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND id=p_inbox_id FOR UPDATE;
  IF NOT FOUND OR v_event.state<>'pending'
    OR v_event.lease_token IS DISTINCT FROM p_lease_token
    OR v_event.lease_until IS NULL OR v_event.lease_until<now()
  THEN RAISE EXCEPTION 'SHADOW_LEASE_STALE' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RAISE EXCEPTION 'SHADOW_STOPPED' USING ERRCODE='42501'; END IF;
  -- Only currently frozen, disabled published flows that match the event type.
  SELECT count(*) INTO v_required FROM public.automation_flows f
    JOIN public.automation_flow_versions v ON v.id=f.published_version_id
      AND v.workspace_id=f.workspace_id
    WHERE f.workspace_id=p_workspace_id AND NOT f.enabled AND v.status='published'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
        WHERE n->>'type'='trigger' AND n->'config'->>'event_type'=v_event.event_type);
  v_plans:=jsonb_array_length(p_plans);
  IF v_plans<>v_required THEN RAISE EXCEPTION 'SHADOW_MISSING_FLOW_PLAN'
    USING ERRCODE='22023'; END IF;
  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF jsonb_typeof(v_plan)<>'object'
      OR v_plan->>'flowVersionId' IS NULL
      OR (v_plan->>'flowVersionId') !~* '^[0-9a-f-]{36}$'
      OR jsonb_typeof(v_plan->'decision')<>'object'
    THEN RAISE EXCEPTION 'SHADOW_FLOW_PLAN_INVALID' USING ERRCODE='22023'; END IF;
    v_version_id:=(v_plan->>'flowVersionId')::uuid;
    v_decision:=v_plan->'decision';
    IF v_decision->>'shadowOnly'<>'true' OR v_decision->>'dispatchAuthorized'<>'false'
      OR v_decision->>'state' NOT IN ('completed','awaiting_server_outcome','waiting','blocked')
      OR jsonb_typeof(v_decision->'trace')<>'array'
      OR jsonb_array_length(v_decision->'trace')>500
      OR jsonb_typeof(v_decision->'plannedActions')<>'array'
      OR jsonb_array_length(v_decision->'plannedActions')>50
      OR NOT EXISTS(SELECT 1 FROM public.automation_flows f
        JOIN public.automation_flow_versions v ON v.id=f.published_version_id
          AND v.workspace_id=f.workspace_id
        WHERE f.workspace_id=p_workspace_id AND NOT f.enabled
          AND v.id=v_version_id AND v.status='published'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
            WHERE n->>'type'='trigger' AND n->'config'->>'event_type'=v_event.event_type))
    THEN RAISE EXCEPTION 'SHADOW_PLAN_UNAUTHORIZED' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plans) AS p(value)
      WHERE p.value->>'flowVersionId'=v_plan->>'flowVersionId'
      GROUP BY p.value->>'flowVersionId' HAVING count(*)>1)
    THEN RAISE EXCEPTION 'SHADOW_PLAN_DUPLICATED' USING ERRCODE='22023'; END IF;
    INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state,finished_at)
      VALUES(p_workspace_id,v_version_id,p_inbox_id,'shadow',now())
      ON CONFLICT(flow_version_id,inbox_id) DO NOTHING;
    SELECT id INTO v_execution_id FROM public.automation_executions
      WHERE flow_version_id=v_version_id AND inbox_id=p_inbox_id;
    FOR v_node IN SELECT value FROM jsonb_array_elements(v_decision->'trace') LOOP
      v_step_id:=v_node->>'nodeId';
      IF length(coalesce(v_step_id,'')) NOT BETWEEN 1 AND 128
        OR NOT EXISTS(SELECT 1 FROM public.automation_flow_versions v,
          jsonb_array_elements(v.graph_json->'nodes') n
          WHERE v.id=v_version_id AND n->>'id'=v_step_id)
      THEN RAISE EXCEPTION 'SHADOW_TRACE_UNTRUSTED' USING ERRCODE='22023'; END IF;
      INSERT INTO public.automation_node_executions
        (workspace_id,execution_id,node_id,state,result_code,sanitized_trace)
        VALUES(p_workspace_id,v_execution_id,v_step_id,
          CASE WHEN v_node->>'status'='waiting' THEN 'waiting' ELSE 'planned' END,
          LEFT(COALESCE(v_node->>'status','unknown'),48),
          jsonb_build_object('type',LEFT(COALESCE(v_node->>'type','unknown'),48)))
        ON CONFLICT(execution_id,node_id,attempt) DO NOTHING;
    END LOOP;
    FOR v_action IN SELECT value FROM jsonb_array_elements(v_decision->'plannedActions') LOOP
      v_step_id:=v_action->>'nodeId';
      v_action_type:=v_action->>'type';
      IF (v_action->>'actionKey') !~ '^[0-9a-f]{64}$'
        OR v_action_type NOT IN ('whatsapp_template','whatsapp_reply','email',
          'crm_stage_change','crm_task','crm_update','human_handoff','notify')
        OR NOT EXISTS(SELECT 1 FROM public.automation_flow_versions v,
            jsonb_array_elements(v.graph_json->'nodes') n
            WHERE v.id=v_version_id AND n->>'id'=v_step_id
              AND n->>'type'=v_action_type)
      THEN RAISE EXCEPTION 'SHADOW_ACTION_UNTRUSTED' USING ERRCODE='22023'; END IF;
      INSERT INTO public.automation_action_outbox
        (workspace_id,execution_id,node_id,action_key,action_type,state)
        VALUES(p_workspace_id,v_execution_id,v_step_id,
          v_action->>'actionKey',v_action_type,'blocked')
        ON CONFLICT(workspace_id,action_key) DO NOTHING;
    END LOOP;
    v_count:=v_count+1;
  END LOOP;
  UPDATE public.automation_event_inbox SET
    state=CASE WHEN v_count=0 THEN 'ignored' ELSE 'processed' END,
    lease_token=NULL,lease_until=NULL,processed_at=now()
    WHERE id=p_inbox_id;
  RETURN jsonb_build_object('inboxId',p_inbox_id,'flowCount',v_count,'shadowOnly',true,
    'dispatchAuthorized',false);
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_recover(
  p_workspace_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_total integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings s
    WHERE s.workspace_id=p_workspace_id AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RETURN 0; END IF;
  UPDATE public.automation_event_inbox SET state='failed',lease_token=NULL,lease_until=NULL,
    last_error_code='MAX_SHADOW_RETRIES'
    WHERE workspace_id=p_workspace_id AND state='pending' AND attempts>=5
      AND (lease_until IS NULL OR lease_until<now());
  GET DIAGNOSTICS v_total=ROW_COUNT;
  RETURN v_total;
END; $$;

REVOKE ALL ON FUNCTION public.automation_shadow_ingest(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_recover(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_finish(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_recover(uuid) TO service_role;
COMMIT;
)
  THEN RAISE EXCEPTION 'SHADOW_ENVELOPE_REJECTED' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RAISE EXCEPTION 'SHADOW_RUNTIME_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,event_type,schema_version,context_refs)
    VALUES(p_workspace_id,p_source,p_event_id,p_event_type,'1.0.0',p_context_refs)
    ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND source=p_source AND event_id=p_event_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_claim(
  p_workspace_id uuid,p_batch_limit integer DEFAULT 5
) RETURNS TABLE(inbox_id uuid,source text,event_id text,event_type text,
                context_refs jsonb,lease_token uuid,attempt integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF p_batch_limit NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'SHADOW_BATCH_LIMIT' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RETURN; END IF;
  -- Row locks and leases protect concurrent workers, including after crashes.
  RETURN QUERY
  WITH claimable AS (
    SELECT e.id FROM public.automation_event_inbox e
    WHERE e.workspace_id=p_workspace_id AND e.state='pending'
      AND e.event_type IS NOT NULL AND e.schema_version='1.0.0'
      AND (e.lease_until IS NULL OR e.lease_until<now())
      AND e.attempts<5
    ORDER BY e.received_at,e.id
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.automation_event_inbox e SET
      lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',
      attempts=e.attempts+1,last_error_code=NULL
    FROM claimable c WHERE e.id=c.id
    RETURNING e.id,e.source,e.event_id,e.event_type,e.context_refs,e.lease_token,e.attempts
  )
  SELECT l.id,l.source,l.event_id,l.event_type,l.context_refs,l.lease_token,l.attempts
  FROM leased l;
END; $$;

-- Atomic acknowledgement: all matching flows must be included in p_plans.
-- A plan is metadata ONLY. No branch can queue an external side effect.
CREATE OR REPLACE FUNCTION public.automation_shadow_finish(
  p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_plans jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_event public.automation_event_inbox%ROWTYPE;
  v_plans integer;
  v_required integer;
  v_plan jsonb;
  v_decision jsonb;
  v_version_id uuid;
  v_execution_id uuid;
  v_node jsonb;
  v_action jsonb;
  v_count integer:=0;
  v_step_id text;
  v_action_type text;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans)<>'array'
    OR jsonb_array_length(p_plans)>20 OR octet_length(p_plans::text)>262144
  THEN RAISE EXCEPTION 'SHADOW_PLANS_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_event FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND id=p_inbox_id FOR UPDATE;
  IF NOT FOUND OR v_event.state<>'pending'
    OR v_event.lease_token IS DISTINCT FROM p_lease_token
    OR v_event.lease_until IS NULL OR v_event.lease_until<now()
  THEN RAISE EXCEPTION 'SHADOW_LEASE_STALE' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RAISE EXCEPTION 'SHADOW_STOPPED' USING ERRCODE='42501'; END IF;
  -- Only currently frozen, disabled published flows that match the event type.
  SELECT count(*) INTO v_required FROM public.automation_flows f
    JOIN public.automation_flow_versions v ON v.id=f.published_version_id
      AND v.workspace_id=f.workspace_id
    WHERE f.workspace_id=p_workspace_id AND NOT f.enabled AND v.status='published'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
        WHERE n->>'type'='trigger' AND n->'config'->>'event_type'=v_event.event_type);
  v_plans:=jsonb_array_length(p_plans);
  IF v_plans<>v_required THEN RAISE EXCEPTION 'SHADOW_MISSING_FLOW_PLAN'
    USING ERRCODE='22023'; END IF;
  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF jsonb_typeof(v_plan)<>'object'
      OR v_plan->>'flowVersionId' IS NULL
      OR (v_plan->>'flowVersionId') !~* '^[0-9a-f-]{36}$'
      OR jsonb_typeof(v_plan->'decision')<>'object'
    THEN RAISE EXCEPTION 'SHADOW_FLOW_PLAN_INVALID' USING ERRCODE='22023'; END IF;
    v_version_id:=(v_plan->>'flowVersionId')::uuid;
    v_decision:=v_plan->'decision';
    IF v_decision->>'shadowOnly'<>'true' OR v_decision->>'dispatchAuthorized'<>'false'
      OR v_decision->>'state' NOT IN ('completed','awaiting_server_outcome','waiting','blocked')
      OR jsonb_typeof(v_decision->'trace')<>'array'
      OR jsonb_array_length(v_decision->'trace')>500
      OR jsonb_typeof(v_decision->'plannedActions')<>'array'
      OR jsonb_array_length(v_decision->'plannedActions')>50
      OR NOT EXISTS(SELECT 1 FROM public.automation_flows f
        JOIN public.automation_flow_versions v ON v.id=f.published_version_id
          AND v.workspace_id=f.workspace_id
        WHERE f.workspace_id=p_workspace_id AND NOT f.enabled
          AND v.id=v_version_id AND v.status='published'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
            WHERE n->>'type'='trigger' AND n->'config'->>'event_type'=v_event.event_type))
    THEN RAISE EXCEPTION 'SHADOW_PLAN_UNAUTHORIZED' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plans) AS p(value)
      WHERE p.value->>'flowVersionId'=v_plan->>'flowVersionId'
      GROUP BY p.value->>'flowVersionId' HAVING count(*)>1)
    THEN RAISE EXCEPTION 'SHADOW_PLAN_DUPLICATED' USING ERRCODE='22023'; END IF;
    INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state,finished_at)
      VALUES(p_workspace_id,v_version_id,p_inbox_id,'shadow',now())
      ON CONFLICT(flow_version_id,inbox_id) DO NOTHING;
    SELECT id INTO v_execution_id FROM public.automation_executions
      WHERE flow_version_id=v_version_id AND inbox_id=p_inbox_id;
    FOR v_node IN SELECT value FROM jsonb_array_elements(v_decision->'trace') LOOP
      v_step_id:=v_node->>'nodeId';
      IF length(coalesce(v_step_id,'')) NOT BETWEEN 1 AND 128
        OR NOT EXISTS(SELECT 1 FROM public.automation_flow_versions v,
          jsonb_array_elements(v.graph_json->'nodes') n
          WHERE v.id=v_version_id AND n->>'id'=v_step_id)
      THEN RAISE EXCEPTION 'SHADOW_TRACE_UNTRUSTED' USING ERRCODE='22023'; END IF;
      INSERT INTO public.automation_node_executions
        (workspace_id,execution_id,node_id,state,result_code,sanitized_trace)
        VALUES(p_workspace_id,v_execution_id,v_step_id,
          CASE WHEN v_node->>'status'='waiting' THEN 'waiting' ELSE 'planned' END,
          LEFT(COALESCE(v_node->>'status','unknown'),48),
          jsonb_build_object('type',LEFT(COALESCE(v_node->>'type','unknown'),48)))
        ON CONFLICT(execution_id,node_id,attempt) DO NOTHING;
    END LOOP;
    FOR v_action IN SELECT value FROM jsonb_array_elements(v_decision->'plannedActions') LOOP
      v_step_id:=v_action->>'nodeId';
      v_action_type:=v_action->>'type';
      IF (v_action->>'actionKey') !~ '^[0-9a-f]{64}$'
        OR v_action_type NOT IN ('whatsapp_template','whatsapp_reply','email',
          'crm_stage_change','crm_task','crm_update','human_handoff','notify')
        OR NOT EXISTS(SELECT 1 FROM public.automation_flow_versions v,
            jsonb_array_elements(v.graph_json->'nodes') n
            WHERE v.id=v_version_id AND n->>'id'=v_step_id
              AND n->>'type'=v_action_type)
      THEN RAISE EXCEPTION 'SHADOW_ACTION_UNTRUSTED' USING ERRCODE='22023'; END IF;
      INSERT INTO public.automation_action_outbox
        (workspace_id,execution_id,node_id,action_key,action_type,state)
        VALUES(p_workspace_id,v_execution_id,v_step_id,
          v_action->>'actionKey',v_action_type,'blocked')
        ON CONFLICT(workspace_id,action_key) DO NOTHING;
    END LOOP;
    v_count:=v_count+1;
  END LOOP;
  UPDATE public.automation_event_inbox SET
    state=CASE WHEN v_count=0 THEN 'ignored' ELSE 'processed' END,
    lease_token=NULL,lease_until=NULL,processed_at=now()
    WHERE id=p_inbox_id;
  RETURN jsonb_build_object('inboxId',p_inbox_id,'flowCount',v_count,'shadowOnly',true,
    'dispatchAuthorized',false);
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_recover(
  p_workspace_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_total integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings s
    WHERE s.workspace_id=p_workspace_id AND s.mode='shadow' AND NOT s.emergency_stop)
  THEN RETURN 0; END IF;
  UPDATE public.automation_event_inbox SET state='failed',lease_token=NULL,lease_until=NULL,
    last_error_code='MAX_SHADOW_RETRIES'
    WHERE workspace_id=p_workspace_id AND state='pending' AND attempts>=5
      AND (lease_until IS NULL OR lease_until<now());
  GET DIAGNOSTICS v_total=ROW_COUNT;
  RETURN v_total;
END; $$;

REVOKE ALL ON FUNCTION public.automation_shadow_ingest(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_recover(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_finish(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_recover(uuid) TO service_role;
COMMIT;
