-- Disposable PostgreSQL QA for idempotent eight safe starter drafts.
\set ON_ERROR_STOP on
-- Earlier independent tests may leave their synthetic workspace in shadow.
-- Reset ONLY the disposable 'oryneo-crm' fixture, never weaken the migration.
UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
 WHERE workspace_id=(SELECT id FROM public.automation_workspaces WHERE slug='oryneo-crm');
UPDATE public.automation_workspaces SET active=false WHERE slug='oryneo-crm';
\i supabase/automation/starter_drafts_seed.preview.sql
\i supabase/automation/starter_drafts_seed.preview.sql
DO $qa$
DECLARE w uuid;
BEGIN
 SELECT id INTO w FROM public.automation_workspaces WHERE slug='oryneo-crm';
 IF (SELECT count(*) FROM public.automation_flows
    WHERE workspace_id=w AND slug LIKE 'starter-%')<>8
 THEN RAISE EXCEPTION 'STARTER_FLOW_COUNT_NOT_EIGHT'; END IF;
 IF (SELECT count(*) FROM public.automation_flow_versions v
     JOIN public.automation_flows f ON f.id=v.flow_id
     WHERE f.workspace_id=w AND f.slug LIKE 'starter-%')<>8
 THEN RAISE EXCEPTION 'STARTER_DRAFT_VERSION_DUPLICATED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_flows f
   JOIN public.automation_flow_versions v ON v.flow_id=f.id
   WHERE f.workspace_id=w AND f.slug LIKE 'starter-%' AND
    (f.enabled OR f.published_version_id IS NOT NULL
     OR v.status<>'draft' OR v.graph_json->>'status'<>'draft'
     OR v.graph_json #>> '{metadata,live_dispatch}' IS DISTINCT FROM 'false'
     OR v.graph_json #>> '{metadata,requires_business_approval}' IS DISTINCT FROM 'true'
     OR jsonb_array_length(v.graph_json->'edges')<3
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') node
       WHERE node->>'type' IN ('whatsapp_template','whatsapp_reply','email',
         'crm_stage_change','crm_task','crm_update','notify','human_handoff'))
    ))
 THEN RAISE EXCEPTION 'STARTER_HAS_UNAPPROVED_EFFECT'; END IF;
 IF (SELECT count(*) FROM public.automation_audit_log
   WHERE workspace_id=w AND action='starter_draft_seeded')<>8
 THEN RAISE EXCEPTION 'STARTER_AUDIT_NOT_IDEMPOTENT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings
   WHERE workspace_id=w AND mode='disabled' AND emergency_stop)
 THEN RAISE EXCEPTION 'STARTER_SEED_CHANGED_KILL_SWITCH'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE workspace_id=w
   AND state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'STARTER_SEED_GENERATED_EXTERNAL_ACTION'; END IF;
END $qa$;
SELECT 'eight-starter-drafts-non-emitting-idempotent-passed' AS qa_result;
