-- Disposable Postgres only. The runtime is intentionally disabled before AND after.
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $$
DECLARE
  w uuid:='11111111-1111-4111-8111-111111111111';
  actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  f uuid:='44444444-4444-4444-8444-444444444444';
  g jsonb;
  result jsonb;
  validation jsonb:='{"ok":true,"issues":[],"dispatchAuthorized":false}'::jsonb;
  denied boolean:=false;
  stale boolean:=false;
  version_id uuid;
BEGIN
  g:=jsonb_build_object(
    'id',f::text,'name','Teste release desativada','kind','pipeline','status','draft',
    'schema_version','1.0.0','version',1,
    'nodes',jsonb_build_array(
      jsonb_build_object('id','77777777-7777-4777-8777-777777777777',
        'type','trigger','label','Início','position','{"x":0,"y":0}'::jsonb,
        'config','{"event_type":"opportunity.created"}'::jsonb,
        'ports','["out"]'::jsonb),
      jsonb_build_object('id','88888888-8888-4888-8888-888888888888',
        'type','end','label','Fim','position','{"x":200,"y":0}'::jsonb,
        'config','{}'::jsonb,'ports','["in"]'::jsonb)),
    'edges',jsonb_build_array(jsonb_build_object(
      'id','99999999-9999-4999-8999-999999999999',
      'source','77777777-7777-4777-8777-777777777777','source_port','out',
      'target','88888888-8888-4888-8888-888888888888','target_port','in')));
  SELECT public.automation_draft_save(w,actor,f,2,g) INTO result;
  IF result->>'revision'<>'3' THEN RAISE EXCEPTION 'Draft revision mismatch'; END IF;
  BEGIN
    PERFORM public.automation_publish_disabled(w,actor,f,2,g,validation);
  EXCEPTION WHEN serialization_failure THEN stale:=true;
  END;
  IF NOT stale THEN RAISE EXCEPTION 'Stale publication was permitted'; END IF;
  BEGIN
    PERFORM public.automation_publish_disabled(w,actor,f,3,g,'{"ok":false,"dispatchAuthorized":false}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unvalidated publication accepted'; END IF;
  SELECT public.automation_publish_disabled(w,actor,f,3,g,validation) INTO result;
  version_id:=(result->>'versionId')::uuid;
  IF result->>'enabled'<>'false' OR result->>'revision'<>'4'
    OR (SELECT enabled OR published_version_id<>version_id FROM public.automation_flows WHERE id=f)
  THEN RAISE EXCEPTION 'Publication enabled the flow or lost version pointer'; END IF;
  IF (SELECT graph_json->>'status' FROM public.automation_flow_versions WHERE id=version_id)<>'published'
  THEN RAISE EXCEPTION 'Version snapshot not frozen'; END IF;
  IF (SELECT content_sha256 FROM public.automation_flow_versions WHERE id=version_id)
     <>encode(sha256(convert_to((SELECT graph_json::text FROM public.automation_flow_versions WHERE id=version_id),'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Version hash mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.automation_runtime_settings WHERE mode<>'disabled' OR emergency_stop IS NOT TRUE)
    OR EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
  THEN RAISE EXCEPTION 'Publication mutated runtime or emitted action'; END IF;
  -- Save a fresh draft and prove an editor cannot approve its own work.
  SELECT public.automation_draft_save(w,actor,f,4,g) INTO result;
  UPDATE public.automation_workspace_members SET role='editor' WHERE workspace_id=w AND user_id=actor;
  denied:=false;
  BEGIN
    PERFORM public.automation_publish_disabled(w,actor,f,5,g,validation);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Editor was allowed to publish'; END IF;
  UPDATE public.automation_workspace_members SET role='admin' WHERE workspace_id=w AND user_id=actor;
END; $$;
RESET ROLE;
SELECT 'automation-publish-disabled-qa-passed' AS qa_result;
