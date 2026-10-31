-- Disposable PostgreSQL QA for seven non-destructive automation FK indexes.
\set ON_ERROR_STOP on
\i supabase/automation/foreign_key_indexes.preview.sql
\i supabase/automation/foreign_key_indexes.preview.sql
DO $qa$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_indexes
 WHERE schemaname='public'
 AND (tablename,indexname) IN (
  ('automation_flows','automation_flows_published_fk_idx'),
  ('automation_flow_versions','automation_flow_versions_parent_fk_idx'),
  ('automation_executions','automation_execution_version_fk_idx'),
  ('automation_executions','automation_execution_inbox_fk_idx'),
  ('automation_node_executions','automation_node_parent_fk_idx'),
  ('automation_action_outbox','automation_outbox_parent_fk_idx'),
  ('automation_wait_timers','automation_wait_execution_fk_idx')
 );
 IF n<>7 THEN RAISE EXCEPTION 'MISSING_AUTOMATION_FK_INDEX: %',n; END IF;
 IF (SELECT count(*) FROM pg_indexes
  WHERE schemaname='public' AND indexname='automation_flows_published_fk_idx'
    AND indexdef LIKE '%published_version_id%')<>1
 THEN RAISE EXCEPTION 'MISSING_COVERING_PUBLISHED_VERSION_INDEX'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state IN ('queued','leased'))
 THEN RAISE EXCEPTION 'INDEX_CREATION_SCHEDULED_A_MESSAGE'; END IF;
END $qa$;
SELECT 'automation-fk-indexes-idempotent-qa-passed' AS qa_result;
