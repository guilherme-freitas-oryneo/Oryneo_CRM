-- ORYNEO Stage 4 — reviewable knowledge + semantic release pairing.
-- PREVIEW ONLY: isolated PostgreSQL 17 QA, NEVER hosted by this PR.
-- The existing SDR continues unchanged. No AI prompt, WA, Stripe or email
-- is modified; the release pointer remains DISABLED after every publication.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_sdr_active_release(
 workspace_id uuid PRIMARY KEY REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 knowledge_release_id uuid REFERENCES public.automation_knowledge_release(id) ON DELETE RESTRICT,
 dictionary_release_id uuid REFERENCES public.automation_intent_dictionary(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT sdr_release_pair_atomic CHECK(
   (knowledge_release_id IS NULL AND dictionary_release_id IS NULL)
   OR (knowledge_release_id IS NOT NULL AND dictionary_release_id IS NOT NULL))
);
ALTER TABLE public.automation_sdr_active_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_sdr_active_release FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_sdr_active_release TO service_role;
-- Runtime opt-in requires a future, separately authorized release procedure.
-- No UPDATE grant is given to service_role in this stage.
INSERT INTO public.automation_sdr_active_release(workspace_id)
 SELECT id FROM public.automation_workspaces WHERE slug='oryneo-crm'
 ON CONFLICT (workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.automation_sdr_protect_published()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF OLD.status='published'
 THEN RAISE EXCEPTION 'SDR_PUBLISHED_RELEASE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.automation_sdr_protect_published() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_sdr_knowledge_immutable ON public.automation_knowledge_release;
CREATE TRIGGER automation_sdr_knowledge_immutable BEFORE UPDATE OR DELETE
 ON public.automation_knowledge_release FOR EACH ROW
 EXECUTE FUNCTION public.automation_sdr_protect_published();
DROP TRIGGER IF EXISTS automation_sdr_intent_immutable ON public.automation_intent_dictionary;
CREATE TRIGGER automation_sdr_intent_immutable BEFORE UPDATE OR DELETE
 ON public.automation_intent_dictionary FOR EACH ROW
 EXECUTE FUNCTION public.automation_sdr_protect_published();

-- Publish must be a deliberate transaction performed only while runtime is
-- disabled and stopped. It never switches the SDR's active release.
CREATE OR REPLACE FUNCTION public.automation_sdr_publish_pair_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_knowledge_id uuid,p_dictionary_id uuid,
 p_expected_revision bigint,p_dictionary_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
 k public.automation_knowledge_release%ROWTYPE;
 d public.automation_intent_dictionary%ROWTYPE;
 s public.automation_sdr_active_release%ROWTYPE;
 v jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_knowledge_id IS NULL
 OR p_dictionary_id IS NULL OR p_expected_revision IS NULL OR p_dictionary_hash
 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'SDR_RELEASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings r ON r.workspace_id=w.id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members cm ON cm.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND r.mode='disabled' AND r.emergency_stop
 AND m.user_id=p_actor_id AND m.role IN ('admin','publisher')
 FOR SHARE OF w,r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_RELEASE_AUTH_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.automation_sdr_active_release
 WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR s.revision<>p_expected_revision OR s.enabled
 THEN RAISE EXCEPTION 'SDR_RELEASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO k FROM public.automation_knowledge_release
 WHERE id=p_knowledge_id AND workspace_id=p_workspace_id FOR UPDATE;
 SELECT * INTO d FROM public.automation_intent_dictionary
 WHERE id=p_dictionary_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF k.id IS NULL OR d.id IS NULL OR k.status<>'draft' OR d.status<>'draft'
 OR k.approved_by IS NOT NULL OR d.approved_by IS NOT NULL
 OR k.content_sha256<>'74c48113909964a8fab5e221a2d05b3ee2d999ecb5d907ddbb1baafec3c9c61c'
 OR k.source_refs #>> '{playbook,blob_sha}'<>'85dc97cc5ca0c208982940bd6573b7cd50afd133'
 OR k.source_refs #>> '{pricing_catalog,blob_sha}'<>'c157c4425c420d82fa9a3865d65972f4d22b60e0'
 OR k.source_refs #>> '{legal_terms,usage}'<>'blocked'
 THEN RAISE EXCEPTION 'SDR_KNOWLEDGE_UNVERIFIED' USING ERRCODE='42501'; END IF;
 -- Explicit schema checks: the runtime separately verifies the SHA-256
 -- of stable-canonical JSON before each use (no serialization ambiguity).
 IF d.language<>'pt_BR' OR d.content_sha256 IS DISTINCT FROM p_dictionary_hash
 OR jsonb_typeof(d.examples)<>'array'
 OR jsonb_array_length(d.examples) NOT BETWEEN 10 AND 40
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d.examples) e
  WHERE jsonb_typeof(e)<>'object'
   OR e->>'id' !~ '^[a-z][a-z0-9_]{1,40}$'
   OR jsonb_typeof(e->'positive')<>'array'
   OR jsonb_typeof(e->'negative')<>'array'
   OR jsonb_typeof(e->'synonyms')<>'array'
   OR e->>'risk' NOT IN ('normal','human_review'))
 THEN RAISE EXCEPTION 'SDR_DICTIONARY_UNVERIFIED' USING ERRCODE='42501'; END IF;
 UPDATE public.automation_knowledge_release SET status='published',approved_by=p_actor_id
 WHERE id=k.id AND status='draft';
 UPDATE public.automation_intent_dictionary SET status='published',approved_by=p_actor_id
 WHERE id=d.id AND status='draft';
 UPDATE public.automation_sdr_active_release SET
  knowledge_release_id=k.id,dictionary_release_id=d.id,
  revision=revision+1,changed_by=p_actor_id,changed_at=clock_timestamp(),
  enabled=false WHERE workspace_id=p_workspace_id AND revision=p_expected_revision;
 INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'sdr_pair_published_disabled','knowledge_release',k.id,
   jsonb_build_object('dictionary_version',d.release_version,
    'knowledge_version',k.release_version,'dispatch_authorized',false,
    'enabled',false));
 RETURN jsonb_build_object('ok',true,'publishedDisabled',true,
  'revision',s.revision+1,'dispatchAuthorized',false);
END $fn$;

-- A rollback changes only the selected pair, never mutates an approved release,
-- never implicitly activates either release, and retains CAS under stop.
CREATE OR REPLACE FUNCTION public.automation_sdr_select_pair_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_knowledge_id uuid,p_dictionary_id uuid,
 p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE s public.automation_sdr_active_release%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings r ON r.workspace_id=w.id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members cm ON cm.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND r.mode='disabled' AND r.emergency_stop
 AND m.user_id=p_actor_id AND m.role IN ('admin','publisher')
 FOR SHARE OF w,r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_ROLLBACK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.automation_sdr_active_release
 WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR s.revision<>p_expected_revision OR s.enabled
 THEN RAISE EXCEPTION 'SDR_ROLLBACK_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_knowledge_release k
   WHERE k.id=p_knowledge_id AND k.workspace_id=p_workspace_id
    AND k.status='published' AND k.approved_by IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.automation_intent_dictionary d
   WHERE d.id=p_dictionary_id AND d.workspace_id=p_workspace_id
    AND d.status='published' AND d.approved_by IS NOT NULL)
 THEN RAISE EXCEPTION 'SDR_ROLLBACK_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 UPDATE public.automation_sdr_active_release SET
  knowledge_release_id=p_knowledge_id,dictionary_release_id=p_dictionary_id,
  enabled=false,revision=revision+1,changed_by=p_actor_id,changed_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND revision=p_expected_revision;
 INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'sdr_pair_selected_disabled',
  'knowledge_release',p_knowledge_id,jsonb_build_object(
    'dictionary_release_id',p_dictionary_id,'dispatch_authorized',false));
 RETURN jsonb_build_object('ok',true,'revision',s.revision+1,'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_sdr_publish_pair_disabled(uuid,uuid,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_sdr_select_pair_disabled(uuid,uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_sdr_publish_pair_disabled(uuid,uuid,uuid,uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_sdr_select_pair_disabled(uuid,uuid,uuid,uuid,bigint) TO service_role;
COMMIT;
