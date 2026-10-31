-- ORYNEO Automations: ISOLATED SCHEMA PROPOSAL, NOT AN AUTO-APPLIED MIGRATION.
-- Execute only in a disposable PostgreSQL 17 database during this PR.
-- This script intentionally has NO runtime dispatcher, cron, trigger on existing
-- CRM tables, Meta send, Stripe write or automated bootstrap of administrators.
-- Reconcile migration timestamps and production authorization before release.

BEGIN;

CREATE TABLE IF NOT EXISTS public.automation_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 100),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.automation_workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','editor','publisher','admin')),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id)
);
CREATE INDEX IF NOT EXISTS automation_members_user_idx ON public.automation_workspace_members(user_id);

CREATE TABLE IF NOT EXISTS public.automation_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  slug text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('pipeline','sdr')),
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_version_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug), UNIQUE (workspace_id,id)
);

CREATE TABLE IF NOT EXISTS public.automation_flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  schema_version text NOT NULL,
  graph_json jsonb NOT NULL CHECK (jsonb_typeof(graph_json) = 'object'),
  content_sha256 text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT automation_flow_version_parent FOREIGN KEY (workspace_id,flow_id)
    REFERENCES public.automation_flows(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT automation_version_hash CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT automation_publish_complete CHECK (
    status = 'draft' OR
    (content_sha256 IS NOT NULL AND schema_version = '1.0.0'
      AND published_by IS NOT NULL AND published_at IS NOT NULL)),
  UNIQUE (flow_id,version), UNIQUE (workspace_id,id)
);
ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_published_version_fk
  FOREIGN KEY (workspace_id,published_version_id)
  REFERENCES public.automation_flow_versions(workspace_id,id)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE IF NOT EXISTS public.automation_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  source text NOT NULL,
  event_id text NOT NULL,
  schema_version text NOT NULL,
  context_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processed','ignored','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,source,event_id), UNIQUE (workspace_id,id)
);
CREATE INDEX IF NOT EXISTS automation_inbox_work_idx ON public.automation_event_inbox(workspace_id,state,received_at);

CREATE TABLE IF NOT EXISTS public.automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  flow_version_id uuid NOT NULL,
  inbox_id uuid NOT NULL,
  correlation_id text,
  subject_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'shadow'
    CHECK (state IN ('shadow','pending','running','waiting','completed','cancelled','failed','dead_letter')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT automation_execution_version_fk FOREIGN KEY (workspace_id,flow_version_id)
    REFERENCES public.automation_flow_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT automation_execution_inbox_fk FOREIGN KEY (workspace_id,inbox_id)
    REFERENCES public.automation_event_inbox(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE (flow_version_id,inbox_id), UNIQUE (workspace_id,id)
);
CREATE INDEX IF NOT EXISTS automation_executions_work_idx ON public.automation_executions(workspace_id,state,started_at);

CREATE TABLE IF NOT EXISTS public.automation_node_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  node_id text NOT NULL,
  attempt int NOT NULL DEFAULT 1 CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('planned','running','waiting','completed','skipped','failed','uncertain')),
  result_code text,
  sanitized_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_node_parent FOREIGN KEY (workspace_id,execution_id)
    REFERENCES public.automation_executions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE (execution_id,node_id,attempt)
);
CREATE INDEX IF NOT EXISTS automation_node_exec_idx ON public.automation_node_executions(execution_id,created_at);

CREATE TABLE IF NOT EXISTS public.automation_action_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  node_id text NOT NULL,
  action_key text NOT NULL,
  action_type text NOT NULL,
  -- Default blocked: no side effect becomes schedulable by merely inserting a row.
  state text NOT NULL DEFAULT 'blocked'
    CHECK (state IN ('blocked','queued','leased','sent','cancelled','failed','uncertain','dead_letter')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  due_at timestamptz,
  lease_until timestamptz,
  provider_result_id text,
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_outbox_parent FOREIGN KEY (workspace_id,execution_id)
    REFERENCES public.automation_executions(workspace_id,id) ON DELETE RESTRICT,
  UNIQUE (workspace_id,action_key)
);
CREATE INDEX IF NOT EXISTS automation_outbox_due_idx
  ON public.automation_action_outbox(state,due_at) WHERE state IN ('queued','leased');

CREATE TABLE IF NOT EXISTS public.automation_template_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  provider_account_id text NOT NULL,
  provider_template_id text,
  template_name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL CHECK (category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  provider_status text NOT NULL CHECK (provider_status IN
    ('APPROVED','PENDING','REJECTED','PAUSED','UNKNOWN','DELETED','ARCHIVED')),
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL,
  UNIQUE (workspace_id,provider_account_id,template_name,language)
);
CREATE TABLE IF NOT EXISTS public.automation_intent_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  release_version int NOT NULL CHECK (release_version >= 1),
  language text NOT NULL DEFAULT 'pt_BR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  approved_by uuid,
  examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  synonyms jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,release_version)
);
CREATE TABLE IF NOT EXISTS public.automation_knowledge_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  release_version int NOT NULL CHECK (release_version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  source_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_sha256 text,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,release_version)
);
CREATE TABLE IF NOT EXISTS public.automation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_audit_work_idx ON public.automation_audit_log(workspace_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS public.automation_runtime_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.automation_workspaces(id),
  mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled','shadow','live')),
  emergency_stop boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable published snapshots, including service-role writes.
CREATE OR REPLACE FUNCTION public.automation_reject_published_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'PUBLISHED_FLOW_VERSION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_reject_published_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS automation_protect_published ON public.automation_flow_versions;
CREATE TRIGGER automation_protect_published
  BEFORE UPDATE OR DELETE ON public.automation_flow_versions
  FOR EACH ROW EXECUTE FUNCTION public.automation_reject_published_mutation();

-- All tables default to server-only writes. Never grant generic authenticated INSERT/UPDATE.
ALTER TABLE public.automation_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_action_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_template_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_intent_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_knowledge_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runtime_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.automation_workspaces, public.automation_workspace_members,
  public.automation_flows, public.automation_flow_versions,
  public.automation_event_inbox, public.automation_executions,
  public.automation_node_executions, public.automation_action_outbox,
  public.automation_template_registry, public.automation_intent_dictionary,
  public.automation_knowledge_release, public.automation_audit_log,
  public.automation_runtime_settings
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.automation_workspaces, public.automation_workspace_members,
  public.automation_flows, public.automation_flow_versions,
  public.automation_executions, public.automation_node_executions,
  public.automation_template_registry, public.automation_intent_dictionary,
  public.automation_knowledge_release, public.automation_audit_log,
  public.automation_runtime_settings
TO authenticated;

-- Server role is the only writer. Its API must verify the user's membership and role.
GRANT ALL ON TABLE
  public.automation_workspaces, public.automation_workspace_members,
  public.automation_flows, public.automation_flow_versions,
  public.automation_event_inbox, public.automation_executions,
  public.automation_node_executions, public.automation_action_outbox,
  public.automation_template_registry, public.automation_intent_dictionary,
  public.automation_knowledge_release, public.automation_audit_log,
  public.automation_runtime_settings
TO service_role;

CREATE POLICY automation_member_self ON public.automation_workspace_members
FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY automation_workspace_member_read ON public.automation_workspaces
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_flow_member_read ON public.automation_flows
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_flows.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_version_member_read ON public.automation_flow_versions
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_flow_versions.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_execution_member_read ON public.automation_executions
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_executions.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_node_execution_member_read ON public.automation_node_executions
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_node_executions.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_template_member_read ON public.automation_template_registry
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_template_registry.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_intent_member_read ON public.automation_intent_dictionary
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_intent_dictionary.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_knowledge_member_read ON public.automation_knowledge_release
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_knowledge_release.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_audit_member_read ON public.automation_audit_log
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_audit_log.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY automation_settings_member_read ON public.automation_runtime_settings
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.automation_workspace_members m
    WHERE m.workspace_id = automation_runtime_settings.workspace_id AND m.user_id = (SELECT auth.uid())));

COMMIT;
