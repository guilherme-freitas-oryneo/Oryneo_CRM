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
 -- The same trigger used on the real outbox is checked on a disposable
 -- local action row, including current approval and expiring consent.
 CREATE TEMP TABLE qa_release_action_probe(
  id text PRIMARY KEY,workspace_id uuid,action_type text,state text
 );
 CREATE TRIGGER qa_release_action_gate BEFORE UPDATE
  ON qa_release_action_probe FOR EACH ROW
  EXECUTE FUNCTION public.automation_release_action_lease_guard();
 INSERT INTO qa_release_action_probe VALUES('crm-action',w,'crm_task','queued');
 UPDATE qa_release_action_probe SET state='leased' WHERE id='crm-action';
 IF (SELECT state FROM qa_release_action_probe WHERE id='crm-action')<>'leased'
 THEN RAISE EXCEPTION 'VALID_CRM_ACTION_NOT_LEASED'; END IF;
 UPDATE qa_release_action_probe SET state='queued' WHERE id='crm-action';
 -- Separate channel is not approved even though global gates are satisfied.
 blocked:=false;
 BEGIN
  UPDATE public.automation_channel_ownership
  SET owner='new_engine',legacy_dispatch_paused_at=now(),
   release_approved_at=now(),release_id='qa-email'
   WHERE workspace_id=w AND channel='email';
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'CROSS_CHANNEL_APPROVAL_BYPASS'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_release_attestations
 SET revoked_at=clock_timestamp() WHERE workspace_id=w AND scope='global' AND gate='legal';
 blocked:=false;
 BEGIN
  UPDATE qa_release_action_probe SET state='leased' WHERE id='crm-action';
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'REVOKED_EVIDENCE_ALLOWED_NEW_ACTION_LEASE'; END IF;
 IF (SELECT mode FROM public.automation_runtime_settings WHERE workspace_id=w)<>'disabled'
 OR (SELECT emergency_stop FROM public.automation_runtime_settings WHERE workspace_id=w) IS DISTINCT FROM true
 OR (SELECT active FROM public.automation_workspaces WHERE id=w) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'REVOCATION_DID_NOT_STOP_RUNTIME_AND_WORKSPACE'; END IF;
 blocked:=false;
 BEGIN
  UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'REVOKED_LEGAL_ATTESTATION_BYPASS'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'release_attestation_gate_revocation_isolation_passed' AS qa;
