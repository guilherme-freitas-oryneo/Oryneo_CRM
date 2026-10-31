-- Macro 6: actual frozen CRM-only graph can be armed with runtime OFF.
\set ON_ERROR_STOP on
\i supabase/automation/live_crm_arm_disabled.preview.sql
DO $acl$
BEGIN
 IF has_function_privilege('anon',
  'public.automation_arm_crm_disabled(uuid,uuid,uuid,bigint,uuid,boolean)','EXECUTE')
 OR has_function_privilege('authenticated',
  'public.automation_arm_crm_disabled(uuid,uuid,uuid,bigint,uuid,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'ARM_RPC_EXPOSED_TO_BROWSER'; END IF;
END $acl$;
BEGIN;
UPDATE public.automation_workspaces SET active=false
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.automation_flows
(id,workspace_id,slug,name,kind,enabled,revision)
VALUES('c7000000-0000-4000-8000-000000000001',
 '11111111-1111-4111-8111-111111111111','qa-macro6-arm',
 'Armar CRM desativado','pipeline',false,1);
INSERT INTO public.automation_flow_versions
(id,workspace_id,flow_id,version,schema_version,graph_json,status,content_sha256,published_by,published_at)
SELECT 'c7000000-0000-4000-8000-000000000002',
 '11111111-1111-4111-8111-111111111111',
 'c7000000-0000-4000-8000-000000000001',1,'1.0.0',g,'published',
 encode(sha256(convert_to(g::text,'UTF8')),'hex'),
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()
 FROM (SELECT '{"id":"c7000000-0000-4000-8000-000000000001",
  "kind":"pipeline","status":"published","nodes":[
  {"id":"c7000000-0000-4000-8000-000000000003","type":"trigger","config":{"event_type":"opportunity.created"}},
  {"id":"c7000000-0000-4000-8000-000000000004","type":"crm_task","config":{"title":"Retomar diagnóstico","due_offset_minutes":15}},
  {"id":"c7000000-0000-4000-8000-000000000005","type":"end","config":{}}],
  "edges":[]}'::jsonb g) x;
UPDATE public.automation_flows
SET published_version_id='c7000000-0000-4000-8000-000000000002'
WHERE id='c7000000-0000-4000-8000-000000000001';
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 flow uuid:='c7000000-0000-4000-8000-000000000001';
 version uuid:='c7000000-0000-4000-8000-000000000002';
 result jsonb;denied boolean:=false;
BEGIN
 result:=public.automation_arm_crm_disabled(w,actor,flow,1,version,true);
 IF result->>'ok'<>'true' OR result->>'dispatchAuthorized'<>'false'
 OR result->>'runtimeDisabled'<>'true' OR result->>'enabled'<>'true'
 THEN RAISE EXCEPTION 'CRM_ARM_FENCE_NOT_ENFORCED: %',result; END IF;
 IF (SELECT mode FROM public.automation_runtime_settings WHERE workspace_id=w)<>'disabled'
 OR EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE
  execution_id IN (SELECT id FROM public.automation_executions
   WHERE flow_version_id=version))
 THEN RAISE EXCEPTION 'ARM_SENT_OR_ENABLED_RUNTIME'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_arm_crm_disabled(w,actor,flow,1,version,false);
 EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'STALE_CAS_ALLOWED'; END IF;
 result:=public.automation_arm_crm_disabled(w,actor,flow,2,version,false);
 IF result->>'enabled'<>'false' THEN RAISE EXCEPTION 'DISARM_FAILED'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false
  WHERE workspace_id=w;
 denied:=false;
 BEGIN
  PERFORM public.automation_arm_crm_disabled(w,actor,flow,3,version,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'LIVE_RUNTIME_ALLOWED_ARM'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'macro6-disabled-crm-arm-cas-role-qa-passed' AS qa_result;
