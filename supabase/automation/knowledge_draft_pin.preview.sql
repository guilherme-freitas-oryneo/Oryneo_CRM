-- ORYNEO canonical knowledge source pinning: DRAFT ONLY, NO SDR SYNC.
BEGIN;
DO $pin_knowledge$
DECLARE
 v_workspace_id uuid;
 v_id uuid;
 v_sources jsonb;
 v_current_hash text;
 v_expected text:='74c48113909964a8fab5e221a2d05b3ee2d999ecb5d907ddbb1baafec3c9c61c';
 v_next jsonb;
BEGIN
 SELECT id INTO v_workspace_id FROM public.automation_workspaces
 WHERE slug='oryneo-crm';
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_WORKSPACE_MISSING'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings
    WHERE workspace_id=v_workspace_id AND mode='disabled' AND emergency_stop)
 THEN RAISE EXCEPTION 'KNOWLEDGE_RUNTIME_MUST_BE_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT id,source_refs,content_sha256 INTO v_id,v_sources,v_current_hash
 FROM public.automation_knowledge_release
 WHERE workspace_id=v_workspace_id AND release_version=1 AND status='draft'
  AND approved_by IS NULL
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_DRAFT_MISSING_OR_PUBLISHED' USING ERRCODE='40001'; END IF;
 IF v_sources #>> '{playbook,blob_sha}'<>'85dc97cc5ca0c208982940bd6573b7cd50afd133'
   OR v_sources #>> '{pricing_catalog,blob_sha}'<>'c157c4425c420d82fa9a3865d65972f4d22b60e0'
   OR v_sources #>> '{sdr_sync,status}'<>'not_enabled'
   OR v_sources #>> '{legal_terms,usage}'<>'blocked'
 THEN RAISE EXCEPTION 'KNOWLEDGE_AUTHORITY_DRIFT' USING ERRCODE='40001'; END IF;
 IF v_current_hash IS NOT NULL THEN
   IF v_current_hash<>v_expected
   THEN RAISE EXCEPTION 'KNOWLEDGE_ALREADY_PINNED_DIFFERENTLY' USING ERRCODE='40001'; END IF;
   RETURN;
 END IF;
 v_next:=v_sources||jsonb_build_object(
   'source_manifest',jsonb_build_object(
     'path','supabase/automation/knowledge_source_manifest_20261030.json',
     'version','1.0.0','content_sha256',v_expected,
     'status','draft_unapproved',
     'dispatch_authorized',false),
   'sdr_sync',(v_sources->'sdr_sync')||jsonb_build_object(
     'observed_training_sha256','43e75192f871277f13284cd97b2d1efac3c21b8742c0b42cb25f88addc2e17aa',
     'observed_system_sha256','c23b7cc73219bdb4771155967757ffa8edc575f5caa17df6021f93eb9580fc6b',
     'status','not_enabled',
     'source_approved_for_sync',false)
 );
 UPDATE public.automation_knowledge_release
 SET source_refs=v_next,content_sha256=v_expected
 WHERE id=v_id AND content_sha256 IS NULL AND status='draft' AND approved_by IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_CONCURRENT_CHANGE' USING ERRCODE='40001'; END IF;
 INSERT INTO public.automation_audit_log(
    workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(v_workspace_id,NULL,'knowledge_draft_sources_pinned',
  'knowledge_release',v_id,
  jsonb_build_object('content_sha256',v_expected,
    'playbook_version','1.0.0','status','draft',
    'sdr_training_unchanged',true,'legal_terms_approved',false,
    'dispatch_authorized',false));
END; $pin_knowledge$;
COMMIT;
