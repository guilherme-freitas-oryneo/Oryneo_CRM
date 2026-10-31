-- Disposable PostgreSQL17: release guard, revocation, role and legacy safety.
\set ON_ERROR_STOP on
\i supabase/automation/release_attestation_interlock.preview.sql
DO $acl$
BEGIN
 IF has_table_privilege('authenticated','public.automation_release_attestations','SELECT')
 OR has_table_privilege('anon','public.automation_release_attestations','SELECT')
 OR has_function_privilege('authenticated',
   'public.automation_release_missing_gates(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'RELEASE_EVIDENCE_EXPOSED'; END IF;
END $acl$;
BEGIN;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 admin_user uuid;
 stage text;
 missing text[];
 blocked boolean;
BEGIN
 SELECT m.user_id INTO admin_user FROM public.automation_workspace_members m
 JOIN public.crm_members c ON c.user_id=m.user_id
 WHERE m.workspace_id=w AND m.role='admin' LIMIT 1;
 IF admin_user IS NULL THEN RAISE EXCEPTION 'QA_ADMIN_NOT_FOUND'; END IF;
 UPDATE public.automation_runtime_settings
  SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_channel_ownership
  SET owner='legacy',legacy_dispatch_paused_at=NULL,
   release_approved_at=NULL,release_id=NULL WHERE workspace_id=w;
 missing:=public.automation_release_missing_gates(w,NULL);
 IF cardinality(missing)<>5 THEN
  RAISE EXCEPTION 'EXPECTED_5_GATES_GOT_%',missing; END IF;
 blocked:=false;
 BEGIN
  UPDATE public.automation_runtime_settings SET mode='live',
   emergency_stop=false WHERE workspace_id=w;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'UNATTESTED_LIVE_ALLOWED'; END IF;
 blocked:=false;
 BEGIN
  UPDATE public.automation_channel_ownership
  SET owner='new_engine',legacy_dispatch_paused_at=now(),
   release_approved_at=now(),release_id='qa' WHERE workspace_id=w AND channel='crm';
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'UNATTESTED_CUTOVER_ALLOWED'; END IF;
 FOR stage IN SELECT unnest(ARRAY[
   'legal','playbook','rollback','security','authenticated_e2e',
   'provider_verified','consent_policy','single_owner']) LOOP
  INSERT INTO public.automation_release_attestations
   (workspace_id,scope,gate,evidence_sha256,evidence_ref,
    reviewed_by,reviewed_at,expires_at)
  VALUES(w,CASE WHEN stage IN
   ('legal','playbook','rollback','security','authenticated_e2e') THEN 'global' ELSE 'crm' END,
   stage,repeat('a',64),'https://example.test/qa/recorded-confirmation',
   admin_user,clock_timestamp(),clock_timestamp()+interval '1 day');
 END LOOP;
 missing:=public.automation_release_missing_gates(w,'crm');
 IF cardinality(missing)<>0 THEN RAISE EXCEPTION 'ATTESTED_STILL_BLOCKED_%',missing; END IF;
 UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 UPDATE public.automation_channel_ownership
 SET owner='new_engine',legacy_dispatch_paused_at=now(),
  release_approved_at=now(),release_id='qa-runtime' WHERE workspace_id=w AND channel='crm';
 -- Separate channel is not approved even though global gates are satisfied.
 blocked:=false;
 BEGIN
  UPDATE public.automation_channel_ownership
  SET owner='new_engine',legacy_dispatch_paused_at=now(),
   release_approved_at=now(),release_id='qa-email'
   WHERE workspace_id=w AND channel='email';
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'CROSS_CHANNEL_APPROVAL_BYPASS'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_release_attestations
 SET revoked_at=clock_timestamp() WHERE workspace_id=w AND scope='global' AND gate='legal';
 blocked:=false;
 BEGIN
  UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'REVOKED_LEGAL_ATTESTATION_BYPASS'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'release_attestation_gate_revocation_isolation_passed' AS qa;
