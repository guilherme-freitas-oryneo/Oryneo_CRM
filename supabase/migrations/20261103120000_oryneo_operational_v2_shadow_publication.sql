-- ORYNEO operational v2 publication: immutable, disabled and shadow-only.
--
-- The existing publication and shadow-control RPCs remain the only writers of
-- flow pointers/runtime state. This migration merely supplies an idempotent,
-- auditable operator path for the reviewed v2 drafts and restores shadow mode.
BEGIN;

-- `automation_shadow_ingest_crm` is SECURITY INVOKER. The Edge Function has
-- service_role, but this source table had no SELECT grant, causing the cron to
-- receive 403/42501 and return 503 before any event could be observed.
GRANT SELECT ON TABLE public.crm_events TO service_role;

DO $oryneo_operational_v2_publication$
DECLARE
  v_workspace_id uuid;
  v_admin_id uuid;
  v_flow record;
  v_draft public.automation_flow_versions%ROWTYPE;
  v_result jsonb;
  v_expected_event text;
  v_allowed_types text[]:=ARRAY['trigger','condition','stop','end','wait','crm_task'];
  v_node_count integer;
  v_edge_count integer;
  v_task_count integer;
  v_trigger_count integer;
  v_condition_count integer;
  v_unsafe_count integer;
BEGIN
  SELECT w.id, m.user_id INTO v_workspace_id, v_admin_id
  FROM public.automation_workspaces w
  JOIN public.automation_workspace_members m
    ON m.workspace_id=w.id AND m.role='admin'
  WHERE w.slug='oryneo-crm'
  ORDER BY m.user_id
  LIMIT 1
  FOR UPDATE OF w;

  IF v_workspace_id IS NULL OR v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ORYNEO_OPERATIONAL_V2_ADMIN_REQUIRED';
  END IF;

  -- Existing published v2 snapshots make the migration safely re-runnable.
  IF (SELECT count(*) FROM public.automation_flows f
    JOIN public.automation_flow_versions v ON v.id=f.published_version_id
    WHERE f.workspace_id=v_workspace_id AND v.version=2 AND v.status='published'
  )<>8 THEN
    PERFORM public.automation_shadow_control(v_workspace_id,v_admin_id,false);

    FOR v_flow IN
      SELECT f.id,f.slug,f.revision
      FROM public.automation_flows f
      WHERE f.workspace_id=v_workspace_id
        AND f.slug IN (
          'starter-new-opportunity','starter-talk-to-us','starter-diagnosis','starter-proposal',
          'starter-direct-checkout','starter-payment-confirmed','starter-follow-up','starter-conversational-sdr'
        )
      ORDER BY f.slug
      FOR UPDATE
    LOOP
      SELECT * INTO v_draft
      FROM public.automation_flow_versions v
      WHERE v.workspace_id=v_workspace_id AND v.flow_id=v_flow.id
        AND v.status='draft' AND v.version=2
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ORYNEO_OPERATIONAL_V2_DRAFT_REQUIRED: %',v_flow.slug;
      END IF;

      v_expected_event:=CASE v_flow.slug
        WHEN 'starter-new-opportunity' THEN 'opportunity.created'
        WHEN 'starter-talk-to-us' THEN 'conversation.inbound'
        WHEN 'starter-diagnosis' THEN 'opportunity.stage_changed'
        WHEN 'starter-proposal' THEN 'proposal.sent'
        WHEN 'starter-direct-checkout' THEN 'checkout.started'
        WHEN 'starter-payment-confirmed' THEN 'billing.paid_verified'
        WHEN 'starter-follow-up' THEN 'conversation.inbound'
        WHEN 'starter-conversational-sdr' THEN 'conversation.inbound'
      END;
      SELECT count(*),
        count(*) FILTER (WHERE n->>'type'='crm_task'),
        count(*) FILTER (WHERE n->>'type'='trigger'
          AND n->'config'->>'event_type'=v_expected_event),
        count(*) FILTER (WHERE n->>'type'='condition'),
        count(*) FILTER (WHERE NOT (n->>'type'=ANY(v_allowed_types)))
      INTO v_node_count,v_task_count,v_trigger_count,v_condition_count,v_unsafe_count
      FROM jsonb_array_elements(v_draft.graph_json->'nodes') n;
      SELECT count(*) INTO v_edge_count
      FROM jsonb_array_elements(v_draft.graph_json->'edges');

      IF v_draft.graph_json->>'status'<>'draft'
        OR v_draft.graph_json->>'schema_version'<>'1.0.0'
        OR v_draft.graph_json->'metadata'->>'draft_variant'<>'crm_review_only'
        OR v_draft.graph_json->'metadata'->>'external_transport_allowed'<>'false'
        OR v_draft.graph_json->'metadata'->>'live_dispatch'<>'false'
        OR v_node_count<5 OR v_edge_count<4 OR v_task_count<>1
        OR v_trigger_count<>1 OR v_condition_count<1 OR v_unsafe_count<>0
      THEN
        RAISE EXCEPTION 'ORYNEO_OPERATIONAL_V2_STRUCTURE_INVALID: %',v_flow.slug;
      END IF;

      SELECT public.automation_publish_disabled(
        v_workspace_id,v_admin_id,v_flow.id,v_flow.revision,v_draft.graph_json,
        jsonb_build_object(
          'ok',true,'issues','[]'::jsonb,'dispatchAuthorized',false,
          'preflight','migration_structural_guard','nodeCount',v_node_count,
          'edgeCount',v_edge_count,'externalTransportAllowed',false
        )
      ) INTO v_result;
      IF coalesce((v_result->>'enabled')::boolean,true) THEN
        RAISE EXCEPTION 'ORYNEO_OPERATIONAL_V2_ENABLE_FORBIDDEN: %',v_flow.slug;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.automation_shadow_control(v_workspace_id,v_admin_id,true);
END
$oryneo_operational_v2_publication$;

COMMIT;
