-- ORYNEO: atomic shadow wait registration from immutable node trace.
-- No live send, no timers scheduled in pg_cron, no existing CRM triggers changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_shadow_trace_wait_register()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
 v_graph jsonb;
 v_refs jsonb;
 v_node jsonb;
 v_config jsonb;
 v_duration integer;
 v_cancel boolean;
 v_conversation uuid;
 v_timer uuid;
BEGIN
 IF NEW.state<>'waiting' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=NEW.workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RAISE EXCEPTION 'WAIT_RUNTIME_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT v.graph_json,i.context_refs INTO v_graph,v_refs
 FROM public.automation_executions e
 JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
   AND v.workspace_id=e.workspace_id
 JOIN public.automation_event_inbox i ON i.id=e.inbox_id
   AND i.workspace_id=e.workspace_id
 WHERE e.workspace_id=NEW.workspace_id AND e.id=NEW.execution_id
   AND e.state='shadow' AND v.status='published';
 IF NOT FOUND OR jsonb_typeof(v_graph->'nodes')<>'array'
 THEN RAISE EXCEPTION 'WAIT_PUBLISHED_VERSION_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT n.value INTO v_node FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
 WHERE n.value->>'id'=NEW.node_id AND n.value->>'type'='wait'
 LIMIT 1;
 IF v_node IS NULL THEN RAISE EXCEPTION 'WAIT_NODE_NOT_FROZEN' USING ERRCODE='22023'; END IF;
 v_config:=v_node->'config';
 IF jsonb_typeof(v_config)<>'object'
   OR (v_config->>'duration_minutes') !~ '^[0-9]{1,5}$'
   OR jsonb_typeof(v_config->'cancel_on_reply')<>'boolean'
 THEN RAISE EXCEPTION 'WAIT_CONFIG_UNVERIFIED' USING ERRCODE='22023'; END IF;
 v_duration:=(v_config->>'duration_minutes')::integer;
 v_cancel:=(v_config->>'cancel_on_reply')::boolean;
 IF v_duration NOT BETWEEN 1 AND 43200
 THEN RAISE EXCEPTION 'WAIT_DURATION_OUT_OF_POLICY' USING ERRCODE='22023'; END IF;
 IF (v_refs->>'conversation_id') IS NOT NULL THEN
   IF (v_refs->>'conversation_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION 'WAIT_REFERENCE_INVALID' USING ERRCODE='22023'; END IF;
   v_conversation:=(v_refs->>'conversation_id')::uuid;
 END IF;
 IF v_cancel AND v_conversation IS NULL
 THEN RAISE EXCEPTION 'WAIT_CANCEL_REQUIRES_CANONICAL_CHAT' USING ERRCODE='22023'; END IF;
 -- This insert participates in the SAME transaction as shadow_finish().
 -- If registration fails, the event remains eligible for lease recovery.
 v_timer:=public.automation_wait_shadow_register(
   NEW.workspace_id,NEW.execution_id,NEW.node_id,
   clock_timestamp()+make_interval(mins=>v_duration),
   v_cancel,v_conversation);
 IF v_timer IS NULL THEN RAISE EXCEPTION 'WAIT_REGISTER_FAILED'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.automation_shadow_trace_wait_register()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_trace_wait_register() TO service_role;
DROP TRIGGER IF EXISTS automation_shadow_trace_wait_insert ON public.automation_node_executions;
CREATE TRIGGER automation_shadow_trace_wait_insert
 AFTER INSERT ON public.automation_node_executions
 FOR EACH ROW WHEN (NEW.state='waiting')
 EXECUTE FUNCTION public.automation_shadow_trace_wait_register();
COMMIT;
