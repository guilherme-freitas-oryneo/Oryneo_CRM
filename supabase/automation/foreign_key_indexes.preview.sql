-- ORYNEO automation FKs: additive indexes for ledger/reconciliation joins.
-- No table drops, updates, policy changes, senders or cron effects.
BEGIN;
CREATE INDEX IF NOT EXISTS automation_flows_published_fk_idx
 ON public.automation_flows(workspace_id,published_version_id)
 WHERE published_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_flow_versions_parent_fk_idx
 ON public.automation_flow_versions(workspace_id,flow_id);
CREATE INDEX IF NOT EXISTS automation_execution_version_fk_idx
 ON public.automation_executions(workspace_id,flow_version_id);
CREATE INDEX IF NOT EXISTS automation_execution_inbox_fk_idx
 ON public.automation_executions(workspace_id,inbox_id);
CREATE INDEX IF NOT EXISTS automation_node_parent_fk_idx
 ON public.automation_node_executions(workspace_id,execution_id);
CREATE INDEX IF NOT EXISTS automation_outbox_parent_fk_idx
 ON public.automation_action_outbox(workspace_id,execution_id);
CREATE INDEX IF NOT EXISTS automation_wait_execution_fk_idx
 ON public.automation_wait_timers(workspace_id,execution_id);
COMMIT;
