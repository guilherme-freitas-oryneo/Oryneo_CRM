-- Disabled-only immutable graph pointer rollback QA (PostgreSQL 17 temporary DB).
\set ON_ERROR_STOP on
DO $grants$
BEGIN
 IF has_function_privilege('anon','public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'Rollback exposed to clients'; END IF;
END $grants$;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 f uuid:='44444444-4444-4444-8444-444444444444';
 target uuid; other uuid:=gen_random_uuid(); graph jsonb;
 rev bigint; result jsonb; denied boolean; actions_before bigint;
BEGIN
 SELECT count(*) INTO actions_before FROM public.automation_action_outbox
 WHERE workspace_id=w AND state IN ('queued','leased','sent');
 SELECT published_version_id,revision INTO target,rev
  FROM public.automation_flows WHERE workspace_id=w AND id=f;
 IF target IS NULL THEN RAISE EXCEPTION 'Published fixture is missing'; END IF;
 SELECT graph_json INTO graph FROM public.automation_flow_versions
 WHERE workspace_id=w AND id=target;
 INSERT INTO public.automation_flow_versions
 (id,workspace_id,flow_id,version,schema_version,status,graph_json,
  content_sha256,published_by,published_at)
 VALUES(other,w,f,(SELECT max(version)+1 FROM public.automation_flow_versions WHERE flow_id=f),
  '1.0.0','published',graph,
  encode(sha256(convert_to(graph::text,'UTF8')),'hex'),actor,clock_timestamp());
 UPDATE public.automation_flows SET published_version_id=other,revision=revision+1
 WHERE workspace_id=w AND id=f;
 SELECT revision INTO rev FROM public.automation_flows WHERE id=f;
 denied:=false;
 BEGIN
  PERFORM public.automation_rollback_disabled(w,actor,f,target,rev-1);
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale rollback revision accepted'; END IF;
 result:=public.automation_rollback_disabled(w,actor,f,target,rev);
 IF result->>'enabled'<>'false' OR result->>'dispatchAuthorized'<>'false'
  OR (SELECT published_version_id<>target OR enabled FROM public.automation_flows WHERE id=f)
 THEN RAISE EXCEPTION 'Rollback activated graph or lost pointer'; END IF;
 IF (SELECT count(*) FROM public.automation_flow_versions WHERE flow_id=f AND status='published')<2
 THEN RAISE EXCEPTION 'Immutable historical version was modified'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_audit_log
  WHERE workspace_id=w AND action='flow_rolled_back_disabled'
  AND summary->>'toVersionId'=target::text)
 THEN RAISE EXCEPTION 'Rollback not audited'; END IF;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false
 WHERE workspace_id=w;
 denied:=false;
 BEGIN
  PERFORM public.automation_rollback_disabled(w,actor,f,other,rev+1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Rollback permitted while engine active'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
 WHERE workspace_id=w;
 UPDATE public.automation_workspace_members SET role='editor'
 WHERE workspace_id=w AND user_id=actor;
 denied:=false;
 BEGIN
  PERFORM public.automation_rollback_disabled(w,actor,f,other,rev+1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Editor permitted to roll back'; END IF;
 UPDATE public.automation_workspace_members SET role='admin'
 WHERE workspace_id=w AND user_id=actor;
 IF (SELECT count(*) FROM public.automation_action_outbox
   WHERE workspace_id=w AND state IN ('queued','leased','sent'))<>actions_before
 THEN RAISE EXCEPTION 'Rollback emitted actions'; END IF;
END $qa$;
RESET ROLE;
SELECT 'shadow-rollback-qa-passed' AS qa_result;
