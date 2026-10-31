-- ORYNEO Macro 6, disposable QA proposal: continue a successful CRM action.
-- A sent action may plan its graph's next segment ONCE. No HTTP/Meta/SMTP.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_live_crm_continuations(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
 execution_id uuid NOT NULL REFERENCES public.automation_executions(id),
 previous_action_id uuid NOT NULL REFERENCES public.automation_action_outbox(id),
 status text NOT NULL CHECK(status IN('continued','completed')),
 continued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(execution_id,previous_action_id)
);
ALTER TABLE public.automation_live_crm_continuations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_live_crm_continuations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.automation_live_crm_continuations TO service_role;
CREATE INDEX IF NOT EXISTS automation_live_crm_continuations_workspace_idx
 ON public.automation_live_crm_continuations(workspace_id,continued_at DESC);

CREATE OR REPLACE FUNCTION public.automation_live_crm_continue(
 p_workspace_id uuid,p_execution_id uuid,p_previous_action_id uuid,p_decision jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 e public.automation_executions%ROWTYPE;
 a public.automation_action_outbox%ROWTYPE;
 i public.automation_event_inbox%ROWTYPE;
 v public.automation_flow_versions%ROWTYPE;
 rowstep jsonb;prevstep jsonb;n jsonb;planned jsonb;
 activation text;expected_key text;
 kind text;node text;laststep jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_execution_id IS NULL OR p_previous_action_id IS NULL
 OR p_decision IS NULL OR jsonb_typeof(p_decision)<>'object'
 OR octet_length(p_decision::text)>131072
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.automation_executions
 WHERE id=p_execution_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CONTINUATION_EXECUTION_MISSING' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.automation_action_outbox
 WHERE id=p_previous_action_id AND execution_id=e.id
 AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CONTINUATION_ACTION_MISSING' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_live_crm_continuations
  WHERE execution_id=e.id AND previous_action_id=a.id) THEN
  RETURN jsonb_build_object('ok',true,'alreadyContinued',true,'dispatchAuthorized',false);
 END IF;
 IF e.state<>'running' OR a.state<>'sent' OR a.action_type NOT IN('crm_task','crm_stage_change')
 OR a.provider_result_id IS DISTINCT FROM 'crm:'||a.action_key
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_RECEIPT_UNVERIFIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership o ON o.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
 AND s.mode='live' AND NOT s.emergency_stop
 AND o.channel='crm' AND o.owner='new_engine'
 AND o.legacy_dispatch_paused_at IS NOT NULL AND o.release_approved_at IS NOT NULL
 FOR SHARE OF w,s,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CONTINUATION_FENCE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.automation_flow_versions
 WHERE id=e.flow_version_id AND workspace_id=p_workspace_id
 AND status='published';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.automation_flows f
 WHERE f.id=v.flow_id AND f.workspace_id=p_workspace_id
 AND f.enabled AND f.published_version_id=v.id)
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_VERSION_DRIFT' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
 WHERE n->>'id'=a.node_id AND n->>'type'=a.action_type)
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_SOURCE_UNTRUSTED' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM public.automation_event_inbox
 WHERE id=e.inbox_id AND workspace_id=p_workspace_id;
 IF NOT FOUND OR i.state<>'processed' OR i.source<>'crm'
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_EVENT_INVALID' USING ERRCODE='42501'; END IF;
 IF p_decision->>'dispatchAuthorized'<>'false'
 OR p_decision->>'state' NOT IN('completed','awaiting_server_outcome')
 OR jsonb_typeof(p_decision->'trace')<>'array'
 OR jsonb_array_length(p_decision->'trace') NOT BETWEEN 1 AND 200
 OR jsonb_typeof(p_decision->'plannedActions')<>'array'
 OR jsonb_array_length(p_decision->'plannedActions')>1
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_DECISION_INVALID' USING ERRCODE='22023'; END IF;
 activation:=encode(sha256(convert_to(
 array_to_json(ARRAY[p_workspace_id::text,v.id::text,i.source,i.event_id])::text,'UTF8')),'hex');
 IF p_decision->>'activationKey' IS DISTINCT FROM activation
 THEN RAISE EXCEPTION 'LIVE_CONTINUATION_ACTIVATION_INVALID' USING ERRCODE='42501'; END IF;
 prevstep:=jsonb_build_object('nodeId',a.node_id,'nextPort','out');
 FOR rowstep IN SELECT value FROM jsonb_array_elements(p_decision->'trace') LOOP
  node:=rowstep->>'nodeId';
  SELECT value INTO n FROM jsonb_array_elements(v.graph_json->'nodes') AS x(value)
   WHERE value->>'id'=node;
  IF n IS NULL OR n->>'type' IS DISTINCT FROM rowstep->>'type'
   OR rowstep->>'status' NOT IN ('evaluated','completed','requires_server_result')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'edges') edge
    WHERE edge->>'source'=prevstep->>'nodeId'
      AND edge->>'source_port'=coalesce(prevstep->>'nextPort','out')
      AND edge->>'target'=node)
  THEN RAISE EXCEPTION 'LIVE_CONTINUATION_GRAPH_EDGE_INVALID' USING ERRCODE='42501'; END IF;
  prevstep:=rowstep;
 END LOOP;
 laststep:=prevstep;
 IF p_decision->>'state'='completed' THEN
  IF jsonb_array_length(p_decision->'plannedActions')<>0
   OR laststep->>'status'<>'completed' OR laststep->>'type' NOT IN('end','stop')
  THEN RAISE EXCEPTION 'LIVE_CONTINUATION_TERMINAL_INVALID' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_live_crm_continuations
  (workspace_id,execution_id,previous_action_id,status)
  VALUES(p_workspace_id,e.id,a.id,'completed');
  UPDATE public.automation_executions SET state='completed',finished_at=clock_timestamp()
   WHERE id=e.id AND state='running';
 ELSE
  IF jsonb_array_length(p_decision->'plannedActions')<>1
   OR laststep->>'type' NOT IN('crm_stage_change','crm_task')
   OR laststep->>'status'<>'requires_server_result'
  THEN RAISE EXCEPTION 'LIVE_CONTINUATION_ACTION_REQUIRED' USING ERRCODE='42501'; END IF;
  planned:=p_decision->'plannedActions'->0;
  node:=planned->>'nodeId';kind:=planned->>'type';
  IF node IS DISTINCT FROM laststep->>'nodeId' OR kind IS DISTINCT FROM laststep->>'type'
   OR (planned->>'actionKey') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'LIVE_CONTINUATION_ACTION_INVALID' USING ERRCODE='42501'; END IF;
  expected_key:=encode(sha256(convert_to(
   array_to_json(ARRAY[activation,node,kind])::text,'UTF8')),'hex');
  IF planned->>'actionKey' IS DISTINCT FROM expected_key
  THEN RAISE EXCEPTION 'LIVE_CONTINUATION_ACTION_KEY_FORGED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_live_crm_continuations
  (workspace_id,execution_id,previous_action_id,status)
  VALUES(p_workspace_id,e.id,a.id,'continued');
  INSERT INTO public.automation_action_outbox
   (workspace_id,execution_id,node_id,action_key,action_type,state)
  VALUES(p_workspace_id,e.id,node,expected_key,kind,'queued')
  ON CONFLICT(workspace_id,action_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('ok',true,'continued',true,
  'complete',p_decision->>'state'='completed','dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_live_crm_continue(uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_continue(uuid,uuid,uuid,jsonb)
 TO service_role;
COMMIT;
