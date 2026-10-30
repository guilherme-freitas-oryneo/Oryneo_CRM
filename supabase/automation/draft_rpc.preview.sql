-- ORYNEO automation draft persistence: PREVIEW ONLY; do not deploy until migration history is reconciled.
-- Atomic creation/update of versioned drafts. Uses INVOKER and is executable only by service_role.
-- Edge API must verify JWT + crm_members and derive p_actor_id from the authenticated user.

CREATE OR REPLACE FUNCTION public.automation_save_draft(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_flow_id uuid,
  p_expected_revision bigint,
  p_name text,
  p_kind text,
  p_graph jsonb
)
RETURNS TABLE (flow_id uuid, saved_revision bigint, saved_version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_revision bigint;
  v_kind text;
  v_version integer;
BEGIN
  IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_name IS NULL OR length(trim(p_name)) < 1 OR length(p_name) > 160
    OR p_kind NOT IN ('pipeline','sdr')
    OR p_graph IS NULL OR jsonb_typeof(p_graph) <> 'object'
    OR p_graph->>'id' IS DISTINCT FROM p_flow_id::text
    OR p_graph->>'name' IS DISTINCT FROM p_name
    OR p_graph->>'kind' IS DISTINCT FROM p_kind
    OR p_graph->>'status' IS DISTINCT FROM 'draft'
    OR p_graph->>'schema_version' IS DISTINCT FROM '0.1-concept'
    OR jsonb_typeof(p_graph->'nodes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_graph->'edges') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_graph->'nodes') > 500
    OR jsonb_array_length(p_graph->'edges') > 1000
    OR octet_length(p_graph::text) > 200000
  THEN
    RAISE EXCEPTION 'AUTOMATION_DRAFT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- The draft version must always match the transaction's optimistic revision.
  IF p_expected_revision > 2147483646
     OR jsonb_typeof(p_graph->'version') IS DISTINCT FROM 'number'
     OR length(p_graph->>'version') > 10
     OR translate(p_graph->>'version','0123456789','') <> ''
  THEN
    RAISE EXCEPTION 'AUTOMATION_DRAFT_VERSION_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF (p_graph->>'version')::bigint <> (p_expected_revision + 1) THEN
    RAISE EXCEPTION 'AUTOMATION_DRAFT_VERSION_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Fail closed: membership and explicit edit role are required.
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_workspace_members m
    JOIN public.automation_workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = p_workspace_id AND m.user_id = p_actor_id
      AND m.role IN ('editor','publisher','admin')
      AND w.active IS TRUE
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_EDITOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_expected_revision = 0 THEN
    INSERT INTO public.automation_flows
      (id, workspace_id, slug, name, kind, enabled, revision, created_by, updated_by)
    VALUES (
      p_flow_id, p_workspace_id, p_flow_id::text, p_name, p_kind,
      false, 1, p_actor_id, p_actor_id
    );
    v_revision := 1;
    v_version := 1;
  ELSE
    -- Explicit optimistic concurrency: no last-writer-wins on another editor's work.
    SELECT f.revision, f.kind INTO v_revision, v_kind
    FROM public.automation_flows f
    WHERE f.id = p_flow_id AND f.workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AUTOMATION_FLOW_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_revision <> p_expected_revision THEN
      RAISE EXCEPTION 'AUTOMATION_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    IF v_kind IS DISTINCT FROM p_kind THEN
      RAISE EXCEPTION 'AUTOMATION_KIND_IMMUTABLE' USING ERRCODE = '22023';
    END IF;
    v_revision := v_revision + 1;
    IF v_revision > 2147483647 THEN
      RAISE EXCEPTION 'AUTOMATION_VERSION_LIMIT' USING ERRCODE = '22023';
    END IF;
    v_version := v_revision::integer;
    UPDATE public.automation_flows
       SET name = p_name, revision = v_revision, updated_by = p_actor_id,
           updated_at = now()
     WHERE id = p_flow_id AND workspace_id = p_workspace_id;
  END IF;

  INSERT INTO public.automation_flow_versions
    (workspace_id, flow_id, version, schema_version, graph_json, status, created_by)
  VALUES
    (p_workspace_id, p_flow_id, v_version, '0.1-concept', p_graph, 'draft', p_actor_id);

  INSERT INTO public.automation_audit_log
    (workspace_id, actor_id, action, target_type, target_id, summary)
  VALUES
    (p_workspace_id, p_actor_id, 'draft_saved', 'automation_flow', p_flow_id,
     jsonb_build_object('revision',v_revision,'version',v_version));

  RETURN QUERY SELECT p_flow_id, v_revision, v_version;
END
$function$;

REVOKE ALL ON FUNCTION public.automation_save_draft(
  uuid,uuid,uuid,bigint,text,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_save_draft(
  uuid,uuid,uuid,bigint,text,text,jsonb
) TO service_role;
