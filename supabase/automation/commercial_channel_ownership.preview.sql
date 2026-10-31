-- ORYNEO Macro 3. PREVIEW ONLY: single-owner cutover guard.
-- This does NOT disable legacy workers, send messages, modify CRM or
-- authorize switching owners. New engine ownership requires a future
-- controlled release that proves the old dispatcher is actually paused.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_channel_ownership(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel IN
  ('whatsapp','email','crm','onboarding','billing')),
 owner text NOT NULL DEFAULT 'legacy' CHECK(owner IN ('legacy','new_engine')),
 legacy_dispatch_paused_at timestamptz,
 release_approved_at timestamptz,
 release_id text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,channel),
 CONSTRAINT automation_channel_new_owner_requires_verified_cutover CHECK (
  owner='legacy' OR
  (legacy_dispatch_paused_at IS NOT NULL AND release_approved_at IS NOT NULL
   AND release_id ~ '^[A-Za-z0-9._:-]{8,128}$'
   AND release_approved_at>=legacy_dispatch_paused_at))
);
ALTER TABLE public.automation_channel_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_channel_ownership FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_channel_ownership TO service_role;
-- A migration cannot inadvertently take over pre-existing channels.
INSERT INTO public.automation_channel_ownership(workspace_id,channel)
 SELECT w.id,c.channel FROM public.automation_workspaces w
 CROSS JOIN (VALUES ('whatsapp'),('email'),('crm'),('onboarding'),('billing')) AS c(channel)
 WHERE w.slug='oryneo-crm'
 ON CONFLICT(workspace_id,channel) DO NOTHING;

CREATE OR REPLACE FUNCTION public.automation_channel_cutover_preflight(
 p_workspace_id uuid,p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v record;
BEGIN
 IF p_channel NOT IN ('whatsapp','email','crm','onboarding','billing')
   OR p_workspace_id IS NULL
 THEN RAISE EXCEPTION 'CHANNEL_PREFLIGHT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT o.owner,o.legacy_dispatch_paused_at,o.release_approved_at,o.release_id,
   w.active,s.mode,s.emergency_stop
 INTO v FROM public.automation_channel_ownership o
   JOIN public.automation_workspaces w ON w.id=o.workspace_id
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 WHERE o.workspace_id=p_workspace_id AND o.channel=p_channel
   AND w.slug='oryneo-crm';
 IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false,'code','OWNER_NOT_INITIALIZED','dispatchAuthorized',false); END IF;
 IF NOT v.active OR v.emergency_stop OR v.mode<>'live'
 THEN RETURN jsonb_build_object('eligible',false,'code','RUNTIME_DISABLED','dispatchAuthorized',false); END IF;
 IF v.owner<>'new_engine'
 THEN RETURN jsonb_build_object('eligible',false,'code','LEGACY_EXECUTOR_OWNER','dispatchAuthorized',false); END IF;
 IF v.legacy_dispatch_paused_at IS NULL OR v.release_approved_at IS NULL
   OR v.release_id IS NULL
 THEN RETURN jsonb_build_object('eligible',false,'code','CUTOVER_NOT_ATTESTED','dispatchAuthorized',false); END IF;
 -- This is a metadata-only preflight, never a permission to call the provider.
 RETURN jsonb_build_object('eligible',true,'code','OWNER_PREFLIGHT_ONLY',
   'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_channel_cutover_preflight(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_channel_cutover_preflight(uuid,text)
 TO service_role;
COMMIT;
