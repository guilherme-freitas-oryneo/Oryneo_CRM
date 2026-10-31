-- PREVIEW ONLY. Apply solely to PostgreSQL 17 QA service.
-- This disabled-mode publication primitive DOES NOT enable execution, outbox,
-- automatic sends, cron, billing or a new event dispatcher.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_publish_disabled(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_flow_id uuid,
  p_expected_revision bigint,
  p_graph jsonb,
  p_validation jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_flow public.automation_flows%ROWTYPE;
  v_version public.automation_flow_versions%ROWTYPE;
  v_snapshot jsonb;
  v_sha text;
  v_revision bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_members crm
    JOIN public.automation_workspace_members m ON m.user_id=crm.user_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
      AND m.role IN ('publisher','admin')
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_PUBLISHER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_runtime_settings s
    WHERE s.workspace_id=p_workspace_id AND s.mode='disabled' AND s.emergency_stop IS TRUE
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_RUNTIME_GUARD_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_flow FROM public.automation_flows
    WHERE workspace_id=p_workspace_id AND id=p_flow_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_flow.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'AUTOMATION_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  IF p_validation IS NULL OR jsonb_typeof(p_validation)<>'object'
    OR p_validation->>'ok'<>'true' OR p_validation->>'dispatchAuthorized'<>'false'
    OR p_graph IS NULL OR jsonb_typeof(p_graph)<>'object'
    OR p_graph->>'id'<>p_flow_id::text
    OR p_graph->>'kind'<>v_flow.kind
    OR p_graph->>'status'<>'draft'
    OR p_graph->>'schema_version'<>'1.0.0'
    OR octet_length(p_graph::text)>262144 THEN
    RAISE EXCEPTION 'AUTOMATION_RELEASE_NOT_VALIDATED' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_version FROM public.automation_flow_versions
    WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id AND status='draft'
    ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_version.graph_json<>p_graph THEN
    RAISE EXCEPTION 'AUTOMATION_DRAFT_CHANGED' USING ERRCODE='40001';
  END IF;

  v_snapshot:=jsonb_set(p_graph,'{status}','"published"'::jsonb,false);
  v_sha:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
  UPDATE public.automation_flow_versions SET
    graph_json=v_snapshot, status='published',schema_version='1.0.0',
    content_sha256=v_sha,published_at=now(),published_by=p_actor_id,
    validation_report=p_validation
    WHERE id=v_version.id AND workspace_id=p_workspace_id;

  -- A published snapshot is immutable; the flow remains disabled.
  UPDATE public.automation_flows SET
    published_version_id=v_version.id,enabled=false,
    revision=revision+1,updated_by=p_actor_id,updated_at=now()
    WHERE id=p_flow_id AND workspace_id=p_workspace_id
    RETURNING revision INTO v_revision;

  INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
  VALUES(p_workspace_id,p_actor_id,'flow_published_disabled','flow',p_flow_id,
    jsonb_build_object('version_id',v_version.id,'sha256',v_sha,
      'revision',v_revision,'runtime_enabled',false));
  RETURN jsonb_build_object('flowId',p_flow_id,'versionId',v_version.id,
    'revision',v_revision,'contentSha256',v_sha,'enabled',false);
END; $$;
REVOKE ALL ON FUNCTION public.automation_publish_disabled(uuid,uuid,uuid,bigint,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_publish_disabled(uuid,uuid,uuid,bigint,jsonb,jsonb)
  TO service_role;
COMMIT;
