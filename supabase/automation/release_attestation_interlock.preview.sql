-- ORYNEO release interlock v1. REVIEW ONLY until disposable QA passes.
-- Does not modify legacy dispatchers, contacts, payment or real messages.
-- A code deploy, admin click or cron cannot self-certify release gates.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_release_attestations(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 scope text NOT NULL CHECK(scope IN ('global','crm','email','whatsapp','onboarding','billing')),
 gate text NOT NULL CHECK(gate IN (
   'legal','playbook','rollback','security','authenticated_e2e',
   'provider_verified','consent_policy','single_owner',
   'mailbox_verified','financial_webhook','terms_accepted')),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 16 AND 400
     AND evidence_ref ~ '^https://'),
 reviewed_by uuid NOT NULL REFERENCES public.crm_members(user_id) ON DELETE RESTRICT,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(workspace_id,scope,gate),
 CHECK(expires_at > reviewed_at),
 CHECK(revoked_at IS NULL OR revoked_at>=reviewed_at),
 CHECK((scope='global' AND gate IN ('legal','playbook','rollback','security','authenticated_e2e'))
   OR (scope<>'global' AND gate IN (
     'provider_verified','consent_policy','single_owner',
     'mailbox_verified','financial_webhook','terms_accepted')))
);
ALTER TABLE public.automation_release_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_release_attestations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.automation_release_attestations TO service_role;

CREATE OR REPLACE FUNCTION public.automation_release_missing_gates(
 p_workspace_id uuid,p_channel text DEFAULT NULL
) RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE missing text[]:=ARRAY[]::text[];
 v_gate text;v_scope text;v_required text[];
BEGIN
 IF p_workspace_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.automation_workspaces WHERE id=p_workspace_id)
 THEN RAISE EXCEPTION 'RELEASE_WORKSPACE_UNKNOWN' USING ERRCODE='22023'; END IF;
 IF p_channel IS NOT NULL AND p_channel NOT IN
  ('crm','email','whatsapp','onboarding','billing')
 THEN RAISE EXCEPTION 'RELEASE_CHANNEL_UNKNOWN' USING ERRCODE='22023'; END IF;
 v_required:=ARRAY['legal','playbook','rollback','security','authenticated_e2e'];
 IF p_channel IS NOT NULL THEN
  v_required:=v_required||ARRAY['provider_verified','consent_policy','single_owner'];
  IF p_channel='email' THEN v_required:=array_append(v_required,'mailbox_verified'); END IF;
  IF p_channel='billing' THEN
   v_required:=v_required||ARRAY['financial_webhook','terms_accepted']; END IF;
 END IF;
 FOREACH v_gate IN ARRAY v_required LOOP
  v_scope:=CASE WHEN v_gate IN
   ('legal','playbook','rollback','security','authenticated_e2e')
   THEN 'global' ELSE p_channel END;
  IF NOT EXISTS(SELECT 1 FROM public.automation_release_attestations a
   JOIN public.automation_workspace_members m
    ON m.workspace_id=a.workspace_id AND m.user_id=a.reviewed_by
    AND m.role='admin'
   WHERE a.workspace_id=p_workspace_id AND a.scope=v_scope AND a.gate=v_gate
    AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()
    AND a.reviewed_at<=clock_timestamp()
    AND a.evidence_sha256 ~ '^[0-9a-f]{64}$')
  THEN missing:=array_append(missing,v_scope||':'||v_gate); END IF;
 END LOOP;
 RETURN missing;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_enforce_release_interlock()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE missing text[];
BEGIN
 IF TG_TABLE_NAME='automation_runtime_settings' THEN
  IF NEW.mode='live' AND (OLD.mode IS DISTINCT FROM 'live'
     OR OLD.emergency_stop IS DISTINCT FROM false)
  THEN
   missing:=public.automation_release_missing_gates(NEW.workspace_id,NULL);
   IF cardinality(missing)>0 THEN
    RAISE EXCEPTION 'AUTOMATION_RELEASE_NOT_ATTESTED'
     USING ERRCODE='42501', DETAIL=array_to_string(missing,',');
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='automation_channel_ownership' THEN
  IF NEW.owner='new_engine' AND
    (OLD.owner IS DISTINCT FROM 'new_engine'
     OR OLD.release_approved_at IS DISTINCT FROM NEW.release_approved_at)
  THEN
   missing:=public.automation_release_missing_gates(NEW.workspace_id,NEW.channel);
   IF cardinality(missing)>0 THEN
    RAISE EXCEPTION 'AUTOMATION_CHANNEL_NOT_ATTESTED'
     USING ERRCODE='42501',DETAIL=array_to_string(missing,',');
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $fn$;

-- A valid approval at activation time is not perpetual authorization:
-- every newly leased action must still have current evidence.
CREATE OR REPLACE FUNCTION public.automation_release_action_lease_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE channel text;missing text[];
BEGIN
 IF NEW.state='leased' AND OLD.state IS DISTINCT FROM 'leased' THEN
  channel:=CASE
   WHEN NEW.action_type IN('crm_stage_change','crm_task','crm_update','notify') THEN 'crm'
   WHEN NEW.action_type IN('whatsapp_template','whatsapp_reply','human_handoff') THEN 'whatsapp'
   WHEN NEW.action_type='email' THEN 'email'
   WHEN NEW.action_type IN('onboarding') THEN 'onboarding'
   WHEN NEW.action_type IN('billing') THEN 'billing'
   ELSE NULL END;
  IF channel IS NULL THEN
   RAISE EXCEPTION 'RELEASE_UNSUPPORTED_ACTION' USING ERRCODE='42501'; END IF;
  missing:=public.automation_release_missing_gates(NEW.workspace_id,channel);
  IF cardinality(missing)>0 THEN
   RAISE EXCEPTION 'RELEASE_ACTION_EVIDENCE_MISSING'
    USING ERRCODE='42501',DETAIL=array_to_string(missing,','); END IF;
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS automation_release_action_claim_interlock
 ON public.automation_action_outbox;
CREATE TRIGGER automation_release_action_claim_interlock
 BEFORE UPDATE ON public.automation_action_outbox
 FOR EACH ROW EXECUTE FUNCTION public.automation_release_action_lease_guard();

-- Revocation is a real emergency stop, including already-claimed work.
-- Final provider receipt reconciliation remains permitted after the stop.
CREATE OR REPLACE FUNCTION public.automation_release_revocation_stop()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE changed boolean;
BEGIN
 changed:=TG_OP='DELETE';
 IF TG_OP='UPDATE' THEN
  changed:=OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    OR NEW.expires_at<=clock_timestamp() AND OLD.expires_at>clock_timestamp();
 END IF;
 IF changed THEN
  UPDATE public.automation_runtime_settings
   SET mode='disabled',emergency_stop=true,updated_at=clock_timestamp()
   WHERE workspace_id=OLD.workspace_id;
  UPDATE public.automation_workspaces SET active=false WHERE id=OLD.workspace_id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS automation_release_revocation_interlock
 ON public.automation_release_attestations;
CREATE TRIGGER automation_release_revocation_interlock
 AFTER UPDATE OR DELETE ON public.automation_release_attestations
 FOR EACH ROW EXECUTE FUNCTION public.automation_release_revocation_stop();

DROP TRIGGER IF EXISTS automation_runtime_release_interlock ON public.automation_runtime_settings;
CREATE TRIGGER automation_runtime_release_interlock
 BEFORE UPDATE ON public.automation_runtime_settings
 FOR EACH ROW EXECUTE FUNCTION public.automation_enforce_release_interlock();
DROP TRIGGER IF EXISTS automation_channel_release_interlock ON public.automation_channel_ownership;
CREATE TRIGGER automation_channel_release_interlock
 BEFORE UPDATE ON public.automation_channel_ownership
 FOR EACH ROW EXECUTE FUNCTION public.automation_enforce_release_interlock();

REVOKE ALL ON FUNCTION public.automation_release_missing_gates(uuid,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_enforce_release_interlock()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_release_action_lease_guard()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_release_revocation_stop()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_release_missing_gates(uuid,text)
 TO service_role;
COMMIT;
