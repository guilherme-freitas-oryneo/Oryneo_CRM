-- ORYNEO: idempotent registration of already QA-tested shadow engine schema.

-- Reapplying is intentionally safe: no live traffic, billing, emails or provider sends.

-- Requires original 20261030191900 automation engine base migration.

-- All statements run inside the migration tool's transaction.

-- SOURCE: supabase/automation/publication.preview.sql
-- PREVIEW ONLY. Apply solely to PostgreSQL 17 QA service.
-- This disabled-mode publication primitive DOES NOT enable execution, outbox,
-- automatic sends, cron, billing or a new event dispatcher.

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

-- SOURCE: supabase/automation/shadow_queue.preview.sql
-- ISOLATED QA ONLY. No scheduled worker, no live ingress, no provider dispatch.
-- DDL is additive and intentionally leaves production runtime disabled.

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

-- SOURCE: supabase/automation/shadow_crm_adapter.preview.sql
-- REVIEW ONLY. Disposable PostgreSQL QA; no cron, trigger or live dispatcher.
-- Converts canonical CRM journal entries into non-emitting automation events.
-- Cursor MUST be initialized deliberately while runtime is disabled;
-- never silently replay historic records or skip a gap on first worker call.

CREATE TABLE IF NOT EXISTS public.automation_ingest_cursors(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 source text NOT NULL CHECK(source IN ('crm','whatsapp')),
 last_occurred_at timestamptz NOT NULL,
 last_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 initialized_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,source)
);
ALTER TABLE public.automation_ingest_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_ingest_cursors FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_ingest_cursors TO service_role;

CREATE OR REPLACE FUNCTION public.automation_shadow_init_crm_cursor(
 p_workspace_id uuid,p_actor_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_time timestamptz;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspace_members m
      JOIN public.crm_members crm ON crm.user_id=m.user_id
      JOIN public.automation_runtime_settings s ON s.workspace_id=m.workspace_id
      JOIN public.automation_workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role='admin'
      AND s.mode='disabled' AND s.emergency_stop AND NOT w.active
  ) THEN RAISE EXCEPTION 'SHADOW_BOOTSTRAP_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  -- Initialized once: concurrent or repeated admin calls can NEVER rewind cursor.
  INSERT INTO public.automation_ingest_cursors
    (workspace_id,source,last_occurred_at,initialized_by)
    VALUES(p_workspace_id,'crm',clock_timestamp(),p_actor_id)
    ON CONFLICT(workspace_id,source) DO NOTHING;
  SELECT last_occurred_at INTO v_time
    FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='crm';
  RETURN v_time;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_ingest_crm(
 p_workspace_id uuid,p_batch_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_cursor public.automation_ingest_cursors%ROWTYPE;
  v_event RECORD;
  v_seen integer :=0;
  v_added integer :=0;
  v_inserted uuid;
  v_type text;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'SHADOW_CRM_BATCH_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop
  ) THEN RAISE EXCEPTION 'SHADOW_RUNTIME_DISABLED' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cursor FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='crm' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_CURSOR_UNINITIALIZED' USING ERRCODE='42501'; END IF;
  FOR v_event IN
    SELECT e.id,e.deal_id,e.event_type,e.created_at
    FROM public.crm_events e
    WHERE (e.created_at,e.id)>(v_cursor.last_occurred_at,v_cursor.last_event_id)
      AND e.event_type IN ('received','stage_changed') AND e.deal_id IS NOT NULL
    ORDER BY e.created_at,e.id LIMIT p_batch_limit
  LOOP
    -- This mapping is sourced exclusively from the canonical CRM event journal.
    v_type:=CASE v_event.event_type
      WHEN 'received' THEN 'opportunity.created'
      WHEN 'stage_changed' THEN 'opportunity.stage_changed' END;
    v_inserted:=NULL;
    INSERT INTO public.automation_event_inbox
      (workspace_id,source,event_id,event_type,schema_version,context_refs)
      VALUES(p_workspace_id,'crm','crm:'||v_event.id::text,v_type,'1.0.0',
        jsonb_build_object('opportunity_id',v_event.deal_id::text))
      ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN v_added:=v_added+1; END IF;
    v_cursor.last_occurred_at:=v_event.created_at;
    v_cursor.last_event_id:=v_event.id;
    v_seen:=v_seen+1;
  END LOOP;
  IF v_seen>0 THEN
    UPDATE public.automation_ingest_cursors SET
      last_occurred_at=v_cursor.last_occurred_at,
      last_event_id=v_cursor.last_event_id,
      updated_at=now()
      WHERE workspace_id=p_workspace_id AND source='crm';
  END IF;
  RETURN jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
    'scanned',v_seen,'inserted',v_added,'hasMorePossible',v_seen=p_batch_limit);
END; $$;

REVOKE ALL ON FUNCTION public.automation_shadow_init_crm_cursor(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_ingest_crm(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_init_crm_cursor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest_crm(uuid,integer) TO service_role;

-- SOURCE: supabase/automation/shadow_whatsapp_adapter.preview.sql
-- REVIEW ONLY. Read-only canonical WhatsApp inbound -> shadow event journal.
-- Does NOT replace the existing whatsapp-webhook, AI SDR worker or Meta outbox.

CREATE OR REPLACE FUNCTION public.automation_shadow_init_whatsapp_cursor(
 p_workspace_id uuid,p_actor_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_time timestamptz;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspace_members m
      JOIN public.crm_members crm ON crm.user_id=m.user_id
      JOIN public.automation_runtime_settings s ON s.workspace_id=m.workspace_id
      JOIN public.automation_workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role='admin'
      AND s.mode='disabled' AND s.emergency_stop AND NOT w.active
  ) THEN RAISE EXCEPTION 'SHADOW_WA_BOOTSTRAP_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_ingest_cursors
    (workspace_id,source,last_occurred_at,initialized_by)
    VALUES(p_workspace_id,'whatsapp',clock_timestamp(),p_actor_id)
    ON CONFLICT(workspace_id,source) DO NOTHING;
  SELECT last_occurred_at INTO v_time
    FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='whatsapp';
  RETURN v_time;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_ingest_whatsapp(
 p_workspace_id uuid,p_batch_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_cursor public.automation_ingest_cursors%ROWTYPE;
  v_message RECORD;
  v_seen integer :=0;
  v_added integer :=0;
  v_inserted uuid;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'SHADOW_WA_BATCH_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop
  ) THEN RAISE EXCEPTION 'SHADOW_RUNTIME_DISABLED' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cursor FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='whatsapp' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WA_CURSOR_UNINITIALIZED' USING ERRCODE='42501'; END IF;
  FOR v_message IN
    SELECT m.id,m.conversation_id,m.occurred_at
    FROM public.crm_wa_messages m
    WHERE (m.occurred_at,m.id)>(v_cursor.last_occurred_at,v_cursor.last_event_id)
      AND m.direction='inbound' AND m.conversation_id IS NOT NULL
      AND m.reaction_to_provider_message_id IS NULL
    ORDER BY m.occurred_at,m.id LIMIT p_batch_limit
  LOOP
    -- No message body or customer WhatsApp ID is copied into the event inbox.
    v_inserted:=NULL;
    INSERT INTO public.automation_event_inbox
      (workspace_id,source,event_id,event_type,schema_version,context_refs)
      VALUES(p_workspace_id,'whatsapp','wa:'||v_message.id::text,
        'conversation.inbound','1.0.0',
        jsonb_build_object('conversation_id',v_message.conversation_id::text))
      ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN v_added:=v_added+1; END IF;
    v_cursor.last_occurred_at:=v_message.occurred_at;
    v_cursor.last_event_id:=v_message.id;
    v_seen:=v_seen+1;
  END LOOP;
  IF v_seen>0 THEN
    UPDATE public.automation_ingest_cursors SET
      last_occurred_at=v_cursor.last_occurred_at,
      last_event_id=v_cursor.last_event_id,
      updated_at=now()
      WHERE workspace_id=p_workspace_id AND source='whatsapp';
  END IF;
  RETURN jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
    'scanned',v_seen,'inserted',v_added,'hasMorePossible',v_seen=p_batch_limit);
END; $$;
REVOKE ALL ON FUNCTION public.automation_shadow_init_whatsapp_cursor(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_ingest_whatsapp(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_init_whatsapp_cursor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest_whatsapp(uuid,integer) TO service_role;

-- SOURCE: supabase/automation/wait_timers.preview.sql
-- ORYNEO additive shadow-only durable wait primitive.
-- NO scheduler, provider send, CRM mutation, payment action or live dispatcher.
-- A separate audited live adapter must own final channel preflight and delivery.

CREATE TABLE IF NOT EXISTS public.automation_wait_timers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 node_id text NOT NULL CHECK(node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 conversation_id uuid,
 due_at timestamptz NOT NULL,
 cancel_on_reply boolean NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','cancelled','due')),
 reason_code text,
 observed_reply_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT automation_wait_execution_fk FOREIGN KEY(workspace_id,execution_id)
   REFERENCES public.automation_executions(workspace_id,id) ON DELETE RESTRICT,
 CONSTRAINT automation_wait_cancel_requires_conversation CHECK(NOT cancel_on_reply OR conversation_id IS NOT NULL),
 UNIQUE(execution_id,node_id)
);
CREATE INDEX IF NOT EXISTS automation_wait_due_idx
 ON public.automation_wait_timers(workspace_id,due_at,id) WHERE state='waiting';
CREATE INDEX IF NOT EXISTS automation_wait_conversation_idx
 ON public.automation_wait_timers(workspace_id,conversation_id) WHERE state='waiting' AND cancel_on_reply;
ALTER TABLE public.automation_wait_timers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_wait_timers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_wait_timers TO service_role;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_register(
 p_workspace_id uuid,p_execution_id uuid,p_node_id text,
 p_due_at timestamptz,p_cancel_on_reply boolean,p_conversation_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_id uuid;v_current public.automation_wait_timers%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_execution_id IS NULL
   OR p_node_id IS NULL OR p_node_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_due_at IS NULL OR p_due_at<=clock_timestamp()
   OR p_due_at>clock_timestamp()+interval '30 days 1 minute'
   OR p_cancel_on_reply IS NULL OR (p_cancel_on_reply AND p_conversation_id IS NULL)
 THEN RAISE EXCEPTION 'WAIT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   JOIN public.automation_executions e ON e.workspace_id=w.id AND e.id=p_execution_id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow'
     AND s.emergency_stop=false AND e.state='shadow')
 THEN RAISE EXCEPTION 'WAIT_SHADOW_GUARD_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_wait_timers
  (workspace_id,execution_id,node_id,due_at,cancel_on_reply,conversation_id)
 VALUES(p_workspace_id,p_execution_id,p_node_id,p_due_at,p_cancel_on_reply,p_conversation_id)
 ON CONFLICT(execution_id,node_id) DO NOTHING
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT * INTO v_current FROM public.automation_wait_timers
    WHERE execution_id=p_execution_id AND node_id=p_node_id;
   -- Retries must not reset a timer or alter its cancellation policy.
   IF NOT FOUND OR v_current.workspace_id IS DISTINCT FROM p_workspace_id
     OR v_current.due_at IS DISTINCT FROM p_due_at
     OR v_current.cancel_on_reply IS DISTINCT FROM p_cancel_on_reply
     OR v_current.conversation_id IS DISTINCT FROM p_conversation_id
   THEN RAISE EXCEPTION 'WAIT_IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
   v_id:=v_current.id;
 END IF;
 RETURN v_id;
END; $$;

-- Idempotent receipt-driven cancellation. Query the real inbound journal;
-- caller-supplied chat text or a fabricated event ID is never trusted.
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_cancel_reply(
 p_workspace_id uuid,p_conversation_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace_id IS NULL OR p_conversation_id IS NULL
 THEN RAISE EXCEPTION 'WAIT_CANCEL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN 0; END IF;
 WITH confirmed AS (
   SELECT t.id,(
     SELECT m.id FROM public.crm_wa_messages m
     WHERE m.conversation_id=p_conversation_id AND m.direction='inbound'
       AND m.reaction_to_provider_message_id IS NULL
       AND m.occurred_at>=t.created_at
     ORDER BY m.occurred_at,m.id LIMIT 1
   ) message_id
   FROM public.automation_wait_timers t
   WHERE t.workspace_id=p_workspace_id AND t.conversation_id=p_conversation_id
     AND t.cancel_on_reply AND t.state='waiting'
   FOR UPDATE OF t SKIP LOCKED
 ), changed AS (
   UPDATE public.automation_wait_timers t SET
     state='cancelled',reason_code='CANONICAL_INBOUND_RECEIVED',
     observed_reply_id=c.message_id,updated_at=clock_timestamp()
     FROM confirmed c WHERE t.id=c.id AND c.message_id IS NOT NULL
     RETURNING t.id
 )
 SELECT count(*) INTO v_count FROM changed;
 RETURN v_count;
END; $$;

-- Solely proposes that a timer is due; cannot enqueue any outbound action.
-- Cancellation is checked again inside the same claim transaction.
CREATE OR REPLACE FUNCTION public.automation_wait_shadow_poll(
 p_workspace_id uuid,p_limit integer DEFAULT 10
) RETURNS TABLE(wait_id uuid,result_state text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>20
 THEN RAISE EXCEPTION 'WAIT_POLL_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH claimable AS (
   SELECT t.id,t.conversation_id,t.cancel_on_reply,t.created_at
   FROM public.automation_wait_timers t
   WHERE t.workspace_id=p_workspace_id AND t.state='waiting' AND t.due_at<=now()
   ORDER BY t.due_at,t.id LIMIT p_limit FOR UPDATE OF t SKIP LOCKED
 ), checked AS (
   SELECT c.id, CASE WHEN c.cancel_on_reply THEN (
     SELECT m.id FROM public.crm_wa_messages m
     WHERE m.conversation_id=c.conversation_id AND m.direction='inbound'
       AND m.reaction_to_provider_message_id IS NULL
       AND m.occurred_at>=c.created_at
     ORDER BY m.occurred_at,m.id LIMIT 1
   ) ELSE NULL::uuid END AS inbound_id
   FROM claimable c
 ), updated AS (
   UPDATE public.automation_wait_timers t SET
      state=CASE WHEN c.inbound_id IS NOT NULL THEN 'cancelled' ELSE 'due' END,
      reason_code=CASE WHEN c.inbound_id IS NOT NULL THEN 'CANONICAL_INBOUND_RECEIVED'
                       ELSE 'SHADOW_TIMER_DUE' END,
      observed_reply_id=c.inbound_id,updated_at=clock_timestamp()
   FROM checked c WHERE t.id=c.id RETURNING t.id,t.state
 )
 SELECT u.id,u.state FROM updated u;
END; $$;

REVOKE ALL ON FUNCTION public.automation_wait_shadow_register(uuid,uuid,text,timestamptz,boolean,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_cancel_reply(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_poll(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_register(uuid,uuid,text,timestamptz,boolean,uuid)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_cancel_reply(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_poll(uuid,integer) TO service_role;

-- SOURCE: supabase/automation/wait_trace_atomic.preview.sql
-- ORYNEO: atomic shadow wait registration from immutable node trace.
-- No live send, no timers scheduled in pg_cron, no existing CRM triggers changed.

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

-- SOURCE: supabase/automation/wait_policy_reconcile.preview.sql
-- Shadow-only follow-up suppression based on canonical conversation state.
-- All existing CRM, WhatsApp and email workers remain untouched.

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_reconcile_policy(
 p_workspace_id uuid,p_limit integer DEFAULT 50
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100
 THEN RAISE EXCEPTION 'WAIT_RECONCILE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND s.emergency_stop=false)
 THEN RETURN 0; END IF;
 WITH checked AS (
   SELECT t.id,CASE
     WHEN c.id IS NULL THEN 'CONVERSATION_NOT_FOUND'
     WHEN c.opted_out IS TRUE THEN 'OPTED_OUT'
     WHEN c.consent_granted IS DISTINCT FROM TRUE THEN 'CONSENT_NOT_VERIFIED'
     WHEN c.mode IS DISTINCT FROM 'sdr_active' THEN 'HUMAN_OR_REVIEW_MODE'
     ELSE NULL
   END AS policy_reason
   FROM public.automation_wait_timers t
   LEFT JOIN public.crm_wa_conversations c ON c.id=t.conversation_id
   WHERE t.workspace_id=p_workspace_id AND t.state='waiting'
      AND t.conversation_id IS NOT NULL
   ORDER BY t.created_at,t.id LIMIT p_limit
   FOR UPDATE OF t SKIP LOCKED
 ), cancelled AS (
   UPDATE public.automation_wait_timers t SET state='cancelled',
     reason_code=c.policy_reason,updated_at=clock_timestamp()
   FROM checked c WHERE c.id=t.id AND c.policy_reason IS NOT NULL
   RETURNING t.id
 )
 SELECT count(*) INTO v_count FROM cancelled;
 RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_reconcile_policy(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_reconcile_policy(uuid,integer)
 TO service_role;

-- SOURCE: supabase/automation/outbox_runtime_gate.preview.sql
-- ORYNEO action-outbox runtime safety interlock.
-- No provider connector or dispatcher is installed by this migration.

CREATE OR REPLACE FUNCTION public.automation_outbox_prevent_premature_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF NEW.state IN ('queued','leased') THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.automation_runtime_settings s
      JOIN public.automation_workspaces w ON w.id=s.workspace_id
      WHERE w.id=NEW.workspace_id AND w.active
        AND s.mode='live' AND s.emergency_stop=false
    ) THEN
      RAISE EXCEPTION 'AUTOMATION_OUTBOX_RUNTIME_STOPPED' USING ERRCODE='42501';
    END IF;
    IF NEW.state='leased' AND (NEW.lease_until IS NULL OR NEW.lease_until<=clock_timestamp())
    THEN RAISE EXCEPTION 'AUTOMATION_ACTION_LEASE_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  -- Historical provider acknowledgements must remain reconcilable
  -- if the emergency switch is pulled after an actual send.
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.automation_outbox_prevent_premature_queue()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_outbox_prevent_premature_queue() TO service_role;
DROP TRIGGER IF EXISTS automation_outbox_runtime_gate ON public.automation_action_outbox;
CREATE TRIGGER automation_outbox_runtime_gate
  BEFORE INSERT OR UPDATE ON public.automation_action_outbox
  FOR EACH ROW EXECUTE FUNCTION public.automation_outbox_prevent_premature_queue();

-- SOURCE: supabase/automation/onboarding_paid_bridge.preview.sql
-- ORYNEO post-sale transition PREVIEW (isolated QA only).
-- Reuses the existing CRM delivery projects/milestones and the legacy email job.
-- Does not replace, disable or drop the legacy stage trigger.
-- Does not directly invoke SMTP, WhatsApp or Stripe.

CREATE OR REPLACE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
 v_deal_id uuid;
 v_rows integer := 0;
BEGIN
  -- A distinct, explicit release gate prevents a second e-mail owner during
  -- migration. Disabled/shadow and emergency-stop modes NEVER queue here.
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings st ON st.workspace_id=w.id
    WHERE w.slug='oryneo-crm' AND w.active
      AND st.mode='live' AND st.emergency_stop=false)
  THEN RETURN NEW; END IF;
  -- A sandbox payment, unpaid order or missing paid_at NEVER queues an email.
  SELECT o.deal_id INTO v_deal_id
    FROM public.crm_billing_orders o
    WHERE o.id=NEW.order_id AND o.status='paid'
      AND o.paid_at IS NOT NULL AND o.billing_environment='live';
  IF v_deal_id IS NULL THEN RETURN NEW; END IF;
  -- The existing unique (deal_id,job_type) index for legacy jobs ensures
  -- the old stage transition cannot create a duplicate message.
  INSERT INTO public.crm_automation_jobs(deal_id,job_type,due_at)
    VALUES(v_deal_id,'implementation_started_email',clock_timestamp()+interval '5 minutes')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=1 THEN
    INSERT INTO public.crm_delivery_audit(order_id,action,detail)
      VALUES(NEW.order_id,'implementation_email_queued',
        '{"origin":"verified_live_paid_order","legacy_job_deduplicated":true}'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_queue_implementation_on_paid_delivery ON public.crm_delivery_projects;
CREATE TRIGGER automation_queue_implementation_on_paid_delivery
  AFTER INSERT ON public.crm_delivery_projects
  FOR EACH ROW EXECUTE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery();
