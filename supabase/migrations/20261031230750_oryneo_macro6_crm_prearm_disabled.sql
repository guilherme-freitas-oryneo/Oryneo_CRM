-- Macro 6: controlled CRM-only flow activation primitive, PREVIEW/CI ONLY.
-- A publisher can arm a reviewed immutable CRM graph WHILE RUNTIME OFF.
-- This cannot send, activate the workspace, remove the emergency stop or
-- enable WhatsApp/e-mail. A future cutover must verify channels and providers.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_arm_crm_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,
 p_expected_revision bigint,p_version_id uuid,p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE f public.automation_flows%ROWTYPE;
 v public.automation_flow_versions%ROWTYPE;
 nextrev bigint;node jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL
  OR p_version_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
  OR p_enabled IS NULL
 THEN RAISE EXCEPTION 'CRM_ARM_INVALID_ARGUMENT' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.automation_runtime_settings st
 JOIN public.automation_workspaces w ON w.id=st.workspace_id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members cm ON cm.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND st.mode='disabled' AND st.emergency_stop IS TRUE
 AND m.user_id=p_actor_id AND m.role IN ('admin','publisher')
 FOR SHARE OF w,st,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ARM_RUNTIME_OR_ROLE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.automation_flows
 WHERE id=p_flow_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ARM_FLOW_UNKNOWN' USING ERRCODE='P0002'; END IF;
 IF f.revision<>p_expected_revision OR f.kind<>'pipeline'
 THEN RAISE EXCEPTION 'CRM_ARM_REVISION_OR_KIND_DENIED' USING ERRCODE='40001'; END IF;
 SELECT * INTO v FROM public.automation_flow_versions
 WHERE id=p_version_id AND workspace_id=p_workspace_id
 AND flow_id=f.id AND status='published';
 IF NOT FOUND OR f.published_version_id IS DISTINCT FROM v.id
 OR v.published_by IS NULL OR v.content_sha256 IS NULL
 OR v.content_sha256<>encode(sha256(convert_to(v.graph_json::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'CRM_ARM_PUBLISHED_SNAPSHOT_INVALID' USING ERRCODE='42501'; END IF;
 IF p_enabled THEN
  IF jsonb_typeof(v.graph_json->'nodes')<>'array'
    OR jsonb_array_length(v.graph_json->'nodes') NOT BETWEEN 2 AND 100
  THEN RAISE EXCEPTION 'CRM_ARM_GRAPH_INVALID' USING ERRCODE='42501'; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(v.graph_json->'nodes') LOOP
   IF node->>'type' NOT IN (
    'trigger','condition','crm_task','crm_stage_change','billing_read','end','stop')
   THEN RAISE EXCEPTION 'CRM_ARM_UNSUPPORTED_TRANSPORT_OR_WAIT' USING ERRCODE='42501'; END IF;
  END LOOP;
 END IF;
 UPDATE public.automation_flows SET enabled=p_enabled,
 revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()
 WHERE id=f.id AND workspace_id=p_workspace_id AND revision=p_expected_revision
 RETURNING revision INTO nextrev;
 INSERT INTO public.automation_audit_log
 (workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'crm_flow_armed_disabled','flow',f.id,
  jsonb_build_object('versionId',v.id,'enabled',p_enabled,'revision',nextrev,
    'dispatchAuthorized',false,'runtimeDisabled',true));
 RETURN jsonb_build_object('ok',true,'flowId',f.id,'revision',nextrev,
  'enabled',p_enabled,'dispatchAuthorized',false,'runtimeDisabled',true);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_arm_crm_disabled(uuid,uuid,uuid,bigint,uuid,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_arm_crm_disabled(uuid,uuid,uuid,bigint,uuid,boolean)
 TO service_role;