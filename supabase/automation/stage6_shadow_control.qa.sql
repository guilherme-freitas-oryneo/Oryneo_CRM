-- Exact control function is loaded from the production migration before this QA.
-- All changes are rolled back; no provider, network or billing call is present.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE qa_shadow_owner_before AS
  SELECT workspace_id,channel,owner FROM public.automation_channel_ownership;
CREATE TEMP TABLE qa_shadow_outbox_before AS
  SELECT id,state FROM public.automation_action_outbox;

-- Freeze the disposable starter drafts so the control can prove that it rejects
-- mutable input. Production freezing is done by the API's server preflight.
UPDATE public.automation_flow_versions v SET
  graph_json=jsonb_set(v.graph_json,'{status}','"published"'::jsonb,false),
  status='published',published_at=clock_timestamp()
FROM public.automation_flows f,public.automation_workspaces w
WHERE v.flow_id=f.id AND v.workspace_id=f.workspace_id
  AND f.workspace_id=w.id AND w.slug='oryneo-crm' AND v.status='draft';

WITH latest AS (
  SELECT DISTINCT ON (v.workspace_id,v.flow_id) v.workspace_id,v.flow_id,v.id
  FROM public.automation_flow_versions v
  WHERE v.status='published' ORDER BY v.workspace_id,v.flow_id,v.version DESC
)
UPDATE public.automation_flows f SET enabled=false,published_version_id=latest.id
FROM public.automation_workspaces w,latest
WHERE f.workspace_id=w.id AND f.workspace_id=latest.workspace_id
  AND f.id=latest.flow_id AND w.slug='oryneo-crm';

DO $qa$
DECLARE
  w uuid;
  actor uuid;
  started jsonb;
  stopped jsonb;
BEGIN
  SELECT id INTO w FROM public.automation_workspaces WHERE slug='oryneo-crm';
  SELECT m.user_id INTO actor FROM public.automation_workspace_members m
  JOIN public.crm_members c ON c.user_id=m.user_id
  WHERE m.workspace_id=w AND m.role='admin' LIMIT 1;
  IF w IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'SHADOW_QA_ADMIN_FIXTURE_MISSING'; END IF;

  UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
    WHERE workspace_id=w;
  UPDATE public.automation_workspaces SET active=false WHERE id=w;

  SELECT public.automation_shadow_control(w,actor,true) INTO started;
  IF started->>'mode'<>'shadow' OR started->>'dispatchAuthorized'<>'false'
    OR NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings
      WHERE workspace_id=w AND mode='shadow' AND NOT emergency_stop)
    OR NOT EXISTS(SELECT 1 FROM public.automation_workspaces WHERE id=w AND active)
    OR (SELECT count(*) FROM public.automation_ingest_cursors WHERE workspace_id=w)<>2
    OR (SELECT count(*) FROM public.automation_commercial_ingest_cursors WHERE workspace_id=w)<>8
    OR EXISTS(SELECT 1 FROM public.automation_flows WHERE workspace_id=w AND enabled)
    OR EXISTS(SELECT 1 FROM public.automation_action_outbox
      WHERE workspace_id=w AND state IN ('queued','leased','uncertain'))
  THEN RAISE EXCEPTION 'SHADOW_SAFE_START_FAILED'; END IF;

  -- Network retries must be idempotent and must not rewind any cursor.
  SELECT public.automation_shadow_control(w,actor,true) INTO started;
  IF started->>'alreadyRunning'<>'true' THEN RAISE EXCEPTION 'SHADOW_START_NOT_IDEMPOTENT'; END IF;

  SELECT public.automation_shadow_control(w,actor,false) INTO stopped;
  IF stopped->>'mode'<>'disabled' OR stopped->>'dispatchAuthorized'<>'false'
    OR NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings
      WHERE workspace_id=w AND mode='disabled' AND emergency_stop)
    OR EXISTS(SELECT 1 FROM public.automation_workspaces WHERE id=w AND active)
  THEN RAISE EXCEPTION 'SHADOW_SAFE_STOP_FAILED'; END IF;

  IF EXISTS(
    (SELECT workspace_id,channel,owner FROM public.automation_channel_ownership
     EXCEPT SELECT * FROM qa_shadow_owner_before)
    UNION ALL
    (SELECT * FROM qa_shadow_owner_before
     EXCEPT SELECT workspace_id,channel,owner FROM public.automation_channel_ownership)
  ) THEN RAISE EXCEPTION 'SHADOW_CHANGED_CHANNEL_OWNER'; END IF;
  IF EXISTS(
    (SELECT id,state FROM public.automation_action_outbox
     EXCEPT SELECT * FROM qa_shadow_outbox_before)
    UNION ALL
    (SELECT * FROM qa_shadow_outbox_before
     EXCEPT SELECT id,state FROM public.automation_action_outbox)
  ) THEN RAISE EXCEPTION 'SHADOW_CHANGED_OUTBOX'; END IF;
END $qa$;

ROLLBACK;
SELECT 'shadow-control-safe-idempotent-non-emitting-passed' AS qa_result;
