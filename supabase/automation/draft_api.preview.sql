-- ORYNEO draft-only DB API. Requires automation schema foundation.
-- SECURITY INVOKER, service_role only; caller verifies bearer token first.
-- No published flows or outbound effects can be created by this API.
BEGIN;

CREATE OR REPLACE FUNCTION public.automation_draft_create(
  p_workspace_id uuid, p_actor_id uuid, p_graph jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_flow_id uuid;
  v_version_id uuid;
  v_kind text;
  v_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_workspace_members m
    JOIN public.crm_members crm ON crm.user_id=m.user_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
      AND m.role IN ('admin','publisher','editor')
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_EDITOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_graph IS NULL OR jsonb_typeof(p_graph) <> 'object'
    OR octet_length(p_graph::text) > 262144
    OR p_graph->>'status' <> 'draft'
    OR p_graph->>'schema_version' NOT IN ('0.1-concept','1.0.0')
    OR jsonb_typeof(p_graph->'nodes') <> 'array'
    OR jsonb_typeof(p_graph->'edges') <> 'array'
    OR jsonb_array_length(p_graph->'nodes') > 500
    OR jsonb_array_length(p_graph->'edges') > 1000 THEN
    RAISE EXCEPTION 'AUTOMATION_INVALID_DRAFT' USING ERRCODE='22023';
  END IF;
  v_kind := p_graph->>'kind';
  v_name := p_graph->>'name';
  IF v_kind NOT IN ('sdr','pipeline') OR v_name IS NULL OR length(trim(v_name)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'AUTOMATION_INVALID_IDENTITY' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_flow_id := (p_graph->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AUTOMATION_INVALID_FLOW_ID' USING ERRCODE='22023';
  END;
  IF v_flow_id IS NULL THEN
    RAISE EXCEPTION 'AUTOMATION_INVALID_FLOW_ID' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,created_by,updated_by)
    VALUES(v_flow_id,p_workspace_id,'flow-'||v_flow_id::text,v_name,v_kind,p_actor_id,p_actor_id);
  INSERT INTO public.automation_flow_versions(
    workspace_id,flow_id,version,schema_version,graph_json,status,created_by,validation_report)
    VALUES(p_workspace_id,v_flow_id,1,p_graph->>'schema_version',p_graph,'draft',p_actor_id,
      '{"status":"unvalidated","runtime_enabled":false}'::jsonb)
    RETURNING id INTO v_version_id;
  INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(p_workspace_id,p_actor_id,'draft_created','flow',v_flow_id,'{"runtime_enabled":false}'::jsonb);
  RETURN jsonb_build_object('id',v_flow_id,'revision',1,'versionId',v_version_id);
END; $$;

CREATE OR REPLACE FUNCTION public.automation_draft_save(
  p_workspace_id uuid, p_actor_id uuid, p_flow_id uuid,
  p_expected_revision bigint, p_graph jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_flow public.automation_flows%ROWTYPE;
  v_draft public.automation_flow_versions%ROWTYPE;
  v_next_revision bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_workspace_members m
    JOIN public.crm_members crm ON crm.user_id=m.user_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
      AND m.role IN ('admin','publisher','editor')
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_EDITOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_flow FROM public.automation_flows
    WHERE id=p_flow_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_flow.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'AUTOMATION_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  IF p_graph IS NULL OR jsonb_typeof(p_graph) <> 'object'
    OR octet_length(p_graph::text) > 262144
    OR p_graph->>'id' <> p_flow_id::text
    OR p_graph->>'kind' <> v_flow.kind
    OR p_graph->>'status' <> 'draft'
    OR p_graph->>'schema_version' NOT IN ('0.1-concept','1.0.0')
    OR jsonb_typeof(p_graph->'nodes') <> 'array'
    OR jsonb_typeof(p_graph->'edges') <> 'array'
    OR jsonb_array_length(p_graph->'nodes') > 500
    OR jsonb_array_length(p_graph->'edges') > 1000
    OR length(trim(COALESCE(p_graph->>'name',''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'AUTOMATION_INVALID_DRAFT' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_draft FROM public.automation_flow_versions
    WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id AND status='draft'
    ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.automation_flow_versions SET
      graph_json=p_graph,
      schema_version=p_graph->>'schema_version',
      validation_report='{"status":"unvalidated","runtime_enabled":false}'::jsonb
    WHERE id=v_draft.id;
  ELSE
    INSERT INTO public.automation_flow_versions(
      workspace_id,flow_id,version,schema_version,graph_json,status,created_by,validation_report)
      SELECT p_workspace_id,p_flow_id,COALESCE(MAX(version),0)+1,p_graph->>'schema_version',p_graph,'draft',p_actor_id,
        '{"status":"unvalidated","runtime_enabled":false}'::jsonb
      FROM public.automation_flow_versions WHERE flow_id=p_flow_id
      RETURNING * INTO v_draft;
  END IF;
  UPDATE public.automation_flows SET
    revision=revision+1,name=p_graph->>'name',updated_by=p_actor_id,updated_at=now()
    WHERE id=p_flow_id AND workspace_id=p_workspace_id
    RETURNING revision INTO v_next_revision;
  INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(p_workspace_id,p_actor_id,'draft_saved','flow',p_flow_id,
      jsonb_build_object('revision',v_next_revision,'runtime_enabled',false));
  RETURN jsonb_build_object('id',p_flow_id,'revision',v_next_revision,'versionId',v_draft.id);
END; $$;

REVOKE ALL ON FUNCTION public.automation_draft_create(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_draft_save(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_draft_create(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_draft_save(uuid,uuid,uuid,bigint,jsonb) TO service_role;

COMMIT;
