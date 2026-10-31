-- Disposable PostgreSQL QA: pin canonical sources without publication.
\set ON_ERROR_STOP on
INSERT INTO public.automation_knowledge_release(
 workspace_id,release_version,status,source_refs,content_sha256,approved_by)
SELECT w.id,1,'draft',jsonb_build_object(
 'playbook',jsonb_build_object(
  'path','src/playbook/content.ts','version','1.0.0',
  'blob_sha','85dc97cc5ca0c208982940bd6573b7cd50afd133',
  'status','published_in_CRM'),
 'pricing_catalog',jsonb_build_object(
  'path','supabase/functions/_shared/billing/catalog.ts',
  'blob_sha','c157c4425c420d82fa9a3865d65972f4d22b60e0',
  'authority','canonical_billing'),
 'sdr_sync',jsonb_build_object(
  'status','not_enabled','preserve_current_training',true),
 'legal_terms',jsonb_build_object('status','unverified','usage','blocked')
),NULL,NULL FROM public.automation_workspaces w WHERE w.slug='oryneo-crm'
ON CONFLICT(workspace_id,release_version) DO NOTHING;
\i supabase/automation/knowledge_draft_pin.preview.sql
\i supabase/automation/knowledge_draft_pin.preview.sql
DO $qa$
BEGIN
 IF (SELECT count(*) FROM public.automation_knowledge_release k
   JOIN public.automation_workspaces w ON w.id=k.workspace_id
   WHERE w.slug='oryneo-crm' AND k.status='draft'
      AND k.approved_by IS NULL
      AND k.content_sha256='74c48113909964a8fab5e221a2d05b3ee2d999ecb5d907ddbb1baafec3c9c61c'
      AND k.source_refs #>> '{sdr_sync,status}'='not_enabled'
      AND k.source_refs #>> '{legal_terms,usage}'='blocked'
      AND k.source_refs #>> '{source_manifest,status}'='draft_unapproved')<>1
 THEN RAISE EXCEPTION 'Knowledge pin implicitly approved or changed a release'; END IF;
 IF (SELECT count(*) FROM public.automation_audit_log
   WHERE action='knowledge_draft_sources_pinned')<>1
 THEN RAISE EXCEPTION 'Knowledge release pin was not idempotent'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_knowledge_release WHERE status='published')
 THEN RAISE EXCEPTION 'An unapproved legal source was published'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state IN ('queued','leased'))
 THEN RAISE EXCEPTION 'Knowledge metadata caused an action'; END IF;
END; $qa$;
SELECT 'knowledge-draft-source-pin-qa-passed' AS qa_result;
