-- ORYNEO disabled-mode immutable rollback. Disposable QA preview ONLY.
-- Never edits a published snapshot, runs a flow or emits an action.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_rollback_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,
 p_target_version_id uuid,p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE f public.automation_flows%ROWTYPE; v public.automation_flow_versions%ROWTYPE;
 next_revision bigint;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL
 OR p_target_version_id IS NULL OR p_expected_revision IS NULL
 OR p_expected_revision<1
 THEN RAISE EXCEPTION 'ROLLBACK_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_members c
  JOIN public.automation_workspace_members m ON m.user_id=c.user_id
  WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
    AND m.role IN ('admin','publisher'))
 THEN RAISE EXCEPTION 'ROLLBACK_PUBLISHER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings s
  WHERE s.workspace_id=p_workspace_id AND s.mode='disabled'
   AND s.emergency_stop)
 THEN RAISE EXCEPTION 'ROLLBACK_RUNTIME_NOT_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.automation_flows
  WHERE workspace_id=p_workspace_id AND id=p_flow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROLLBACK_FLOW_MISSING' USING ERRCODE='P0002'; END IF;
 IF f.revision<>p_expected_revision THEN
  RAISE EXCEPTION 'ROLLBACK_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO v FROM public.automation_flow_versions
 WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id
   AND id=p_target_version_id AND status='published'
   AND content_sha256 ~ '^[0-9a-f]{64}$';
 IF NOT FOUND THEN RAISE EXCEPTION 'ROLLBACK_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.automation_flows SET
  published_version_id=v.id,enabled=false,
  revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND id=p_flow_id
 RETURNING revision INTO next_revision;
 INSERT INTO public.automation_audit_log
 (workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'flow_rolled_back_disabled','flow',p_flow_id,
  jsonb_build_object('fromVersionId',f.published_version_id,
   'toVersionId',v.id,'sha256',v.content_sha256,'revision',next_revision,
   'runtimeEnabled',false));
 RETURN jsonb_build_object('flowId',p_flow_id,'fromVersionId',f.published_version_id,
   'toVersionId',v.id,'revision',next_revision,'enabled',false,
   'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)
 TO service_role;
COMMIT;
