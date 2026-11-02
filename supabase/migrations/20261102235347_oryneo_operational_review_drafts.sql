-- ORYNEO: prepare action-bearing review drafts without changing any executor.
-- This intentionally creates a NEW draft beside each immutable published
-- structural starter. It never enables a flow, changes its published pointer,
-- transfers channel ownership, schedules work, sends a message or mutates CRM.
BEGIN;

DO $oryneo_operational_review$
DECLARE
  v_workspace uuid;
  v_item record;
  v_flow public.automation_flows%ROWTYPE;
  v_published public.automation_flow_versions%ROWTYPE;
  v_next_version integer;
  v_task_id uuid;
  v_edge_id uuid;
  v_end_id text;
  v_end_count integer;
  v_graph jsonb;
BEGIN
  SELECT w.id INTO v_workspace
  FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings r ON r.workspace_id=w.id
  WHERE w.slug='oryneo-crm' AND w.active=true
    AND r.mode='shadow' AND r.emergency_stop=false
  FOR SHARE OF w,r;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'OPERATIONS_REVIEW_REQUIRES_ACTIVE_SHADOW_RUNTIME'
      USING ERRCODE='42501';
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('starter-new-opportunity','Revisar nova oportunidade',60),
      ('starter-talk-to-us','Revisar solicitação de conversa',60),
      ('starter-direct-checkout','Revisar checkout iniciado sem presumir pagamento',120),
      ('starter-payment-confirmed','Conferir início do onboarding após pagamento verificado',60),
      ('starter-diagnosis','Revisar diagnóstico e próximo passo',1440),
      ('starter-proposal','Conferir proposta enviada e próxima ação',1440),
      ('starter-follow-up','Revalidar elegibilidade antes de eventual follow-up',15),
      ('starter-conversational-sdr','Revisar contexto da conversa e necessidade de handoff',60)
    ) AS items(slug,task_title,due_offset_minutes)
  LOOP
    SELECT * INTO v_flow FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug=v_item.slug
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OPERATIONAL_REVIEW_STARTER_MISSING: %',v_item.slug
        USING ERRCODE='P0002';
    END IF;
    IF v_flow.enabled THEN
      RAISE EXCEPTION 'OPERATIONAL_REVIEW_FLOW_ALREADY_ENABLED: %',v_item.slug
        USING ERRCODE='42501';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.automation_flow_versions existing
      WHERE existing.workspace_id=v_workspace AND existing.flow_id=v_flow.id
        AND existing.status='draft'
        AND existing.graph_json->'metadata'->>'operational_review_seed'='20261102'
    ) THEN
      CONTINUE;
    END IF;
    SELECT * INTO v_published FROM public.automation_flow_versions
    WHERE workspace_id=v_workspace AND flow_id=v_flow.id
      AND id=v_flow.published_version_id AND status='published';
    IF NOT FOUND OR v_published.graph_json->>'status'<>'published' THEN
      RAISE EXCEPTION 'OPERATIONAL_REVIEW_PUBLISHED_SNAPSHOT_MISSING: %',v_item.slug
        USING ERRCODE='42501';
    END IF;
    SELECT count(*),min(node->>'id') INTO v_end_count,v_end_id
    FROM jsonb_array_elements(v_published.graph_json->'nodes') node
    WHERE node->>'type'='end';
    IF v_end_count<>1 OR v_end_id IS NULL THEN
      RAISE EXCEPTION 'OPERATIONAL_REVIEW_END_INVALID: %',v_item.slug
        USING ERRCODE='42501';
    END IF;
    SELECT COALESCE(max(version),0)+1 INTO v_next_version
    FROM public.automation_flow_versions WHERE flow_id=v_flow.id;
    v_task_id:=gen_random_uuid();
    v_edge_id:=gen_random_uuid();
    v_graph:=jsonb_set(v_published.graph_json,'{status}','"draft"'::jsonb,false);
    v_graph:=jsonb_set(v_graph,'{version}',to_jsonb(v_next_version),false);
    v_graph:=jsonb_set(v_graph,'{description}',to_jsonb(
      'Rascunho operacional: cria somente uma tarefa interna, sem WhatsApp, e-mail, cobrança ou mudança de etapa.'::text
    ),true);
    v_graph:=jsonb_set(v_graph,'{metadata}',coalesce(v_graph->'metadata','{}'::jsonb)
      ||jsonb_build_object(
        'draft_variant','crm_review_only',
        'external_transport_allowed',false,
        'live_dispatch',false,
        'requires_business_approval',true,
        'operational_review_seed','20261102'
      ),true);
    v_graph:=jsonb_set(v_graph,'{nodes}',
      (SELECT jsonb_agg(node ORDER BY ordinality)
              ||jsonb_build_array(jsonb_build_object(
                'id',v_task_id::text,
                'type','crm_task',
                'label','Tarefa interna de revisão',
                'position',jsonb_build_object('x',990,'y',100),
                'config',jsonb_build_object('title',v_item.task_title,
                  'due_offset_minutes',v_item.due_offset_minutes),
                'ports',jsonb_build_array('in','out')
              ))
       FROM jsonb_array_elements(v_graph->'nodes') WITH ORDINALITY node(node,ordinality)),true);
    v_graph:=jsonb_set(v_graph,'{edges}',
      (SELECT jsonb_agg(
                CASE WHEN edge->>'target'=v_end_id
                  THEN jsonb_set(edge,'{target}',to_jsonb(v_task_id::text),false)
                  ELSE edge END
                ORDER BY ordinality)
              ||jsonb_build_array(jsonb_build_object(
                'id',v_edge_id::text,
                'source',v_task_id::text,
                'source_port','out',
                'target',v_end_id,
                'target_port','in'
              ))
       FROM jsonb_array_elements(v_graph->'edges') WITH ORDINALITY edge(edge,ordinality)),true);
    INSERT INTO public.automation_flow_versions(
      workspace_id,flow_id,version,schema_version,graph_json,status,validation_report,created_by
    ) VALUES (
      v_workspace,v_flow.id,v_next_version,'1.0.0',v_graph,'draft',
      jsonb_build_object(
        'status','operational_review_draft',
        'runtime_enabled',false,
        'dispatchAuthorized',false,
        'source_version_id',v_published.id::text
      ),NULL
    );
    INSERT INTO public.automation_audit_log(
      workspace_id,actor_id,action,target_type,target_id,summary
    ) VALUES (
      v_workspace,NULL,'operational_review_draft_seeded','flow',v_flow.id,
      jsonb_build_object(
        'slug',v_item.slug,'sourceVersionId',v_published.id::text,
        'runtimeEnabled',false,'dispatchAuthorized',false,
        'externalTransportAllowed',false
      )
    );
  END LOOP;
END $oryneo_operational_review$;

COMMIT;
