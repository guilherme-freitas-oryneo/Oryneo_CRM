-- Exact control function is loaded from the production migration before this QA.
-- All changes are rolled back; no provider, network or billing call is present.
\set ON_ERROR_STOP on
BEGIN;

-- Earlier delivery-protocol QA deliberately leaves an uncertain synthetic row.
-- Remove it only inside this rolled-back transaction to model production's
-- already-proven empty live queue.
DELETE FROM public.automation_action_outbox
  WHERE workspace_id=(SELECT id FROM public.automation_workspaces WHERE slug='oryneo-crm')
    AND state='uncertain';

CREATE TEMP TABLE qa_shadow_owner_before AS
  SELECT workspace_id,channel,owner FROM public.automation_channel_ownership;
CREATE TEMP TABLE qa_shadow_outbox_before AS
  SELECT id,state FROM public.automation_action_outbox;

-- Freeze the disposable starter drafts through the same immutable database
-- primitive used by the API. Production supplies the real server preflight.
DO $freeze$
DECLARE w uuid; actor uuid; item record;
BEGIN
  SELECT id INTO w FROM public.automation_workspaces WHERE slug='oryneo-crm';
  SELECT m.user_id INTO actor FROM public.automation_workspace_members m
  JOIN public.crm_members c ON c.user_id=m.user_id
  WHERE m.workspace_id=w AND m.role='admin' LIMIT 1;
  UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
    WHERE workspace_id=w;
  UPDATE public.automation_workspaces SET active=false WHERE id=w;
  FOR item IN
    SELECT f.id,f.revision,v.graph_json FROM public.automation_flows f
    JOIN LATERAL (SELECT graph_json FROM public.automation_flow_versions
      WHERE workspace_id=f.workspace_id AND flow_id=f.id AND status='draft'
      ORDER BY version DESC LIMIT 1) v ON true
    WHERE f.workspace_id=w
  LOOP
    PERFORM public.automation_publish_disabled(w,actor,item.id,item.revision,item.graph_json,
      jsonb_build_object('ok',true,'dispatchAuthorized',false,'qa','isolated'));
  END LOOP;
END $freeze$;

-- Independent earlier QA cases can leave a frozen version unselected or a
-- synthetic flow armed. Normalize only the disposable transaction.
WITH latest AS (
  SELECT DISTINCT ON (workspace_id,flow_id) workspace_id,flow_id,id
  FROM public.automation_flow_versions WHERE status='published'
  ORDER BY workspace_id,flow_id,version DESC
)
UPDATE public.automation_flows f SET enabled=false,published_version_id=latest.id
FROM latest,public.automation_workspaces w
WHERE f.workspace_id=latest.workspace_id AND f.id=latest.flow_id
  AND w.id=f.workspace_id AND w.slug='oryneo-crm';

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
