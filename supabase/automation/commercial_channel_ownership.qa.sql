-- Stage 3: no dual delivery owner. Disposable DB only.
\set ON_ERROR_STOP on
\i supabase/automation/commercial_channel_ownership.preview.sql
DO $security$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.automation_channel_ownership
  WHERE owner='legacy' AND release_approved_at IS NULL;
 IF n<>5 THEN RAISE EXCEPTION 'Five channels must remain legacy-owned: %',n; END IF;
 IF has_table_privilege('anon','public.automation_channel_ownership','SELECT')
  OR has_table_privilege('authenticated','public.automation_channel_ownership','SELECT')
  OR has_table_privilege('service_role','public.automation_channel_ownership','UPDATE')
  OR has_function_privilege('anon','public.automation_channel_cutover_preflight(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Public/client roles can change channel ownership'; END IF;
END $security$;
BEGIN;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 result jsonb;
 refused boolean:=false;
 old_count integer;
BEGIN
 SELECT count(*) INTO old_count FROM public.crm_automation_jobs;
 result:=public.automation_channel_cutover_preflight(w,'email');
 IF result->>'eligible'<>'false'
   OR result->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'Disabled runtime claimed delivery authorization'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 FOR result IN SELECT public.automation_channel_cutover_preflight(w,ch)
  FROM (VALUES ('email'),('whatsapp'),('crm'),('onboarding'),('billing')) v(ch)
 LOOP
  IF result->>'eligible'<>'false' OR result->>'code'<>'LEGACY_EXECUTOR_OWNER'
  THEN RAISE EXCEPTION 'Legacy and new engine owners were both eligible: %',result; END IF;
 END LOOP;
 BEGIN
  UPDATE public.automation_channel_ownership
  SET owner='new_engine' WHERE workspace_id=w AND channel='email';
 EXCEPTION WHEN check_violation THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Missing release attestation bypassed ownership constraint'; END IF;
 UPDATE public.automation_channel_ownership SET
  owner='new_engine',legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
  release_approved_at=clock_timestamp(),release_id='qa-release-single-owner'
 WHERE workspace_id=w AND channel='email';
 result:=public.automation_channel_cutover_preflight(w,'email');
 IF result->>'eligible'<>'true' OR result->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'Metadata-only preflight violated no-send property'; END IF;
 -- Emergency stop always overrides the ownership metadata.
 UPDATE public.automation_runtime_settings SET emergency_stop=true WHERE workspace_id=w;
 result:=public.automation_channel_cutover_preflight(w,'email');
 IF result->>'eligible'<>'false' OR result->>'code'<>'RUNTIME_DISABLED'
 THEN RAISE EXCEPTION 'Emergency stop did not fence released channel'; END IF;
 IF (SELECT count(*) FROM public.crm_automation_jobs)<>old_count
 THEN RAISE EXCEPTION 'Ownership QA changed legacy job queue'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
    WHERE state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Ownership preflight emitted external actions'; END IF;
END $qa$;
ROLLBACK;
SELECT 'stage3-single-owner-no-send-qa-passed' AS qa_result;
