-- Macroetapa 6: durable, fenced CRM-only live event planning (REVIEW / CI ONLY).
-- No migration to production, cron, Meta/SMTP, Stripe or old-worker cutover.
-- Only service_role may call these invoker functions; live operation requires
-- explicit release gates that do not exist in the current hosted runtime.
BEGIN;

CREATE OR REPLACE FUNCTION public.automation_live_crm_ingest(
 p_workspace_id uuid,p_crm_event_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE e record; v_type text; v_id uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_crm_event_id IS NULL
 THEN RAISE EXCEPTION 'LIVE_CRM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership o ON o.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
   AND s.mode='live' AND NOT s.emergency_stop
   AND o.channel='crm' AND o.owner='new_engine'
   AND o.legacy_dispatch_paused_at IS NOT NULL AND o.release_approved_at IS NOT NULL
   AND o.release_id IS NOT NULL
 FOR SHARE OF w,s,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CRM_FENCE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT id,deal_id,event_type INTO e FROM public.crm_events WHERE id=p_crm_event_id;
 IF NOT FOUND OR e.deal_id IS NULL THEN RAISE EXCEPTION 'LIVE_CRM_EVENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 v_type:=CASE e.event_type WHEN 'received' THEN 'opportunity.created'
    WHEN 'stage_changed' THEN 'opportunity.stage_changed' ELSE NULL END;
 IF v_type IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.crm_records d WHERE d.id=e.deal_id AND d.kind='deal' AND NOT d.deleted
 ) THEN RAISE EXCEPTION 'LIVE_CRM_EVENT_NOT_CANONICAL' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_event_inbox
  (workspace_id,source,event_id,event_type,schema_version,context_refs,state)
 VALUES(p_workspace_id,'crm','crm:'||e.id::text,v_type,'1.0.0',
   jsonb_build_object('opportunity_id',e.deal_id::text),'pending')
 ON CONFLICT(workspace_id,source,event_id) DO NOTHING;
 SELECT id INTO v_id FROM public.automation_event_inbox
 WHERE workspace_id=p_workspace_id AND source='crm' AND event_id='crm:'||e.id::text;
 RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_crm_claim(
 p_workspace_id uuid,p_limit integer DEFAULT 5
) RETURNS TABLE(inbox_id uuid,source text,event_id text,event_type text,
 context_refs jsonb,lease_token uuid,attempt integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10
 THEN RAISE EXCEPTION 'LIVE_CRM_CLAIM_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership o ON o.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
   AND s.mode='live' AND NOT s.emergency_stop
   AND o.channel='crm' AND o.owner='new_engine' AND o.release_approved_at IS NOT NULL
   AND o.legacy_dispatch_paused_at IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH next AS(
  SELECT i.id FROM public.automation_event_inbox i
  WHERE i.workspace_id=p_workspace_id AND i.source='crm'
    AND i.state='pending' AND i.event_type IN('opportunity.created','opportunity.stage_changed')
    AND i.attempts<5 AND (i.lease_until IS NULL OR i.lease_until<clock_timestamp())
  ORDER BY i.received_at,i.id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ),leased AS(
  UPDATE public.automation_event_inbox i SET
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',
    attempts=i.attempts+1,last_error_code=NULL
  FROM next n WHERE i.id=n.id
  RETURNING i.id,i.source,i.event_id,i.event_type,i.context_refs,i.lease_token,i.attempts
 )
 SELECT l.id,l.source,l.event_id,l.event_type,l.context_refs,l.lease_token,l.attempts
 FROM leased l;
END $fn$;

-- An authorized server-side compiled decision is persisted transactionally.
-- The SQL routine rechecks the immutable graph's node and adjacency path,
-- event ownership, receipt token and a deterministic action key. It never
-- trusts an action payload, phone number, recipient or target-stage from caller.
CREATE OR REPLACE FUNCTION public.automation_live_crm_finish(
 p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_plans jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 i public.automation_event_inbox%ROWTYPE;
 plan jsonb; decision jsonb; v public.automation_flow_versions%ROWTYPE;
 n jsonb; step jsonb; act jsonb; prev_step jsonb;
 v_version_id uuid; v_execution_id uuid; v_required int; v_count int:=0;
 v_act_count int; v_node text; v_type text; v_expected text; v_activation text;
BEGIN
 IF p_workspace_id IS NULL OR p_inbox_id IS NULL OR p_lease_token IS NULL
 OR p_plans IS NULL OR jsonb_typeof(p_plans)<>'array'
 OR jsonb_array_length(p_plans)>20 OR octet_length(p_plans::text)>131072
 THEN RAISE EXCEPTION 'LIVE_CRM_FINISH_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO i FROM public.automation_event_inbox
 WHERE id=p_inbox_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR i.state<>'pending' OR i.lease_token IS DISTINCT FROM p_lease_token
  OR i.lease_until IS NULL OR i.lease_until<clock_timestamp() OR i.source<>'crm'
 THEN RAISE EXCEPTION 'LIVE_CRM_LEASE_STALE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership o ON o.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
   AND s.mode='live' AND NOT s.emergency_stop
   AND o.channel='crm' AND o.owner='new_engine'
   AND o.legacy_dispatch_paused_at IS NOT NULL AND o.release_approved_at IS NOT NULL
 FOR SHARE OF w,s,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CRM_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO v_required FROM public.automation_flows f
 JOIN public.automation_flow_versions fv ON fv.id=f.published_version_id
  AND fv.workspace_id=f.workspace_id AND fv.status='published'
 WHERE f.workspace_id=p_workspace_id AND f.enabled
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(fv.graph_json->'nodes') x
  WHERE x->>'type'='trigger' AND x->'config'->>'event_type'=i.event_type);
 IF v_required<>jsonb_array_length(p_plans)
 THEN RAISE EXCEPTION 'LIVE_CRM_PLANS_INCOMPLETE' USING ERRCODE='22023'; END IF;
 FOR plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
  IF jsonb_typeof(plan)<>'object' OR
    (plan->>'flowVersionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'LIVE_CRM_VERSION_INVALID' USING ERRCODE='22023'; END IF;
  v_version_id:=(plan->>'flowVersionId')::uuid;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plans) p
   WHERE p->>'flowVersionId'=plan->>'flowVersionId'
   GROUP BY p->>'flowVersionId' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'LIVE_CRM_DUPLICATED_PLAN' USING ERRCODE='22023'; END IF;
  SELECT fv.* INTO v FROM public.automation_flow_versions fv
  JOIN public.automation_flows f ON f.published_version_id=fv.id
   AND f.workspace_id=fv.workspace_id
  WHERE fv.id=v_version_id AND fv.workspace_id=p_workspace_id
   AND fv.status='published' AND f.enabled
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(fv.graph_json->'nodes') x
    WHERE x->>'type'='trigger' AND x->'config'->>'event_type'=i.event_type);
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CRM_VERSION_FENCE' USING ERRCODE='42501'; END IF;
  decision:=plan->'decision';
  IF decision IS NULL OR jsonb_typeof(decision)<>'object'
   OR decision->>'dispatchAuthorized'<>'false'
   OR decision->>'state' NOT IN ('completed','awaiting_server_outcome')
   OR jsonb_typeof(decision->'trace')<>'array'
   OR jsonb_array_length(decision->'trace') NOT BETWEEN 1 AND 200
   OR jsonb_typeof(decision->'plannedActions')<>'array'
   OR jsonb_array_length(decision->'plannedActions')>1
  THEN RAISE EXCEPTION 'LIVE_CRM_DECISION_INVALID' USING ERRCODE='22023'; END IF;
  -- A suspended wait has no durable live scheduler yet: reject it, do not
  -- acknowledge and silently lose the continuation. Unsupported AI, Meta
  -- and e-mail nodes cannot impersonate the finished CRM-only segment.
  IF (decision->>'state'='awaiting_server_outcome' AND
       (jsonb_array_length(decision->'plannedActions')<>1
        OR decision->'trace'->-1->>'status'<>'requires_server_result'
        OR decision->'trace'->-1->>'type' NOT IN ('crm_stage_change','crm_task')))
    OR (decision->>'state'='completed' AND
       (jsonb_array_length(decision->'plannedActions')<>0
        OR decision->'trace'->-1->>'type' NOT IN ('end','stop')
        OR decision->'trace'->-1->>'status'<>'completed'))
  THEN RAISE EXCEPTION 'LIVE_CRM_TERMINAL_STATE_INVALID' USING ERRCODE='42501'; END IF;
  v_activation:=encode(sha256(convert_to(
    array_to_json(ARRAY[p_workspace_id::text,v.id::text,i.source,i.event_id])::text,'UTF8')),'hex');
  IF decision->>'activationKey' IS DISTINCT FROM v_activation
  THEN RAISE EXCEPTION 'LIVE_CRM_ACTIVATION_MISMATCH' USING ERRCODE='42501'; END IF;
  prev_step:=NULL;v_act_count:=0;
  FOR step IN SELECT value FROM jsonb_array_elements(decision->'trace') LOOP
   v_node:=step->>'nodeId';
   SELECT x INTO n FROM jsonb_array_elements(v.graph_json->'nodes') x WHERE x->>'id'=v_node;
   IF n IS NULL OR n->>'type' IS DISTINCT FROM step->>'type'
   THEN RAISE EXCEPTION 'LIVE_CRM_TRACE_NODE_INVALID' USING ERRCODE='42501'; END IF;
   IF prev_step IS NULL THEN
     IF n->>'type'<>'trigger' THEN RAISE EXCEPTION 'LIVE_CRM_TRACE_TRIGGER_REQUIRED' USING ERRCODE='42501'; END IF;
   ELSE
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'edges') edge
      WHERE edge->>'source'=prev_step->>'nodeId' AND edge->>'target'=v_node
      AND edge->>'source_port'=COALESCE(prev_step->>'nextPort','out'))
     THEN RAISE EXCEPTION 'LIVE_CRM_TRACE_EDGE_INVALID' USING ERRCODE='42501'; END IF;
   END IF;
   prev_step:=step;
  END LOOP;
  INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state)
   VALUES(p_workspace_id,v_version_id,i.id,'running')
   ON CONFLICT(flow_version_id,inbox_id) DO NOTHING;
  SELECT id INTO v_execution_id FROM public.automation_executions
   WHERE flow_version_id=v_version_id AND inbox_id=i.id AND workspace_id=p_workspace_id;
  FOR act IN SELECT value FROM jsonb_array_elements(decision->'plannedActions') LOOP
   v_type:=act->>'type';v_node:=act->>'nodeId';
   IF v_type NOT IN ('crm_stage_change','crm_task')
    OR prev_step->>'nodeId' IS DISTINCT FROM v_node
    OR (act->>'actionKey') !~ '^[0-9a-f]{64}$'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') x
      WHERE x->>'id'=v_node AND x->>'type'=v_type)
   THEN RAISE EXCEPTION 'LIVE_CRM_ACTION_NOT_SUPPORTED' USING ERRCODE='42501'; END IF;
   v_expected:=encode(sha256(convert_to(
     array_to_json(ARRAY[v_activation,v_node,v_type])::text,'UTF8')),'hex');
   IF act->>'actionKey' IS DISTINCT FROM v_expected
   THEN RAISE EXCEPTION 'LIVE_CRM_ACTION_KEY_MISMATCH' USING ERRCODE='42501'; END IF;
   INSERT INTO public.automation_action_outbox
    (workspace_id,execution_id,node_id,action_key,action_type,state)
   VALUES(p_workspace_id,v_execution_id,v_node,v_expected,v_type,'queued')
   ON CONFLICT(workspace_id,action_key) DO NOTHING;
   v_act_count:=v_act_count+1;
  END LOOP;
  IF v_act_count=0 THEN
    UPDATE public.automation_executions SET
     state=CASE WHEN decision->>'state'='waiting' THEN 'waiting'
       WHEN decision->>'state'='blocked' THEN 'failed' ELSE 'completed' END,
     finished_at=CASE WHEN decision->>'state'='waiting' THEN NULL ELSE now() END
    WHERE id=v_execution_id AND state='running';
  END IF;
  v_count:=v_count+1;
 END LOOP;
 UPDATE public.automation_event_inbox SET state=CASE WHEN v_count=0 THEN 'ignored' ELSE 'processed' END,
  lease_token=NULL,lease_until=NULL,processed_at=clock_timestamp() WHERE id=i.id;
 RETURN jsonb_build_object('ok',true,'flowCount',v_count,'queuedCrmOnly',true,
   'externalMessagesSent',0,'paymentsCreated',0,'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_live_crm_ingest(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_crm_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_crm_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_ingest(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_finish(uuid,uuid,uuid,jsonb) TO service_role;