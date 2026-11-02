-- PostgreSQL 17 disposable QA for atomic planner commit into a durable wait.
\set ON_ERROR_STOP on
BEGIN;
DO $qa$
DECLARE
 w uuid:='22000000-0000-4000-8000-000000000001';
 flow uuid:='22000000-0000-4000-8000-000000000002';
 version uuid:='22000000-0000-4000-8000-000000000003';
 inbox uuid:='22000000-0000-4000-8000-000000000004';
 trigger_node text:='22000000-0000-4000-8000-000000000005';
 wait_node text:='22000000-0000-4000-8000-000000000006';
 end_node text:='22000000-0000-4000-8000-000000000007';
 lease uuid:=gen_random_uuid();activation text;decision jsonb;result jsonb;denied boolean:=false;
BEGIN
 IF has_function_privilege('authenticated','public.automation_live_engine_finish(uuid,uuid,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'LIVE_ENGINE_COMMIT_PUBLIC'; END IF;
 INSERT INTO public.automation_workspaces(id,slug,active) VALUES(w,'stage2-engine-commit',true);
 INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop) VALUES(w,'live',false);
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES(flow,w,'stage2-engine-flow','Stage 2 engine flow','pipeline',false);
 INSERT INTO public.automation_flow_versions(id,workspace_id,flow_id,version,schema_version,
  graph_json,content_sha256,status,published_by,published_at)
 VALUES(version,w,flow,1,'1.0.0',jsonb_build_object(
  'nodes',jsonb_build_array(
   jsonb_build_object('id',trigger_node,'type','trigger','config',jsonb_build_object('event_type','opportunity.created')),
   jsonb_build_object('id',wait_node,'type','wait','config',jsonb_build_object('duration_minutes',5,'cancel_on_reply',false)),
   jsonb_build_object('id',end_node,'type','end','config','{}'::jsonb)),
  'edges',jsonb_build_array(
   jsonb_build_object('source',trigger_node,'source_port','out','target',wait_node),
   jsonb_build_object('source',wait_node,'source_port','timeout','target',end_node))),
  repeat('b',64),'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
 UPDATE public.automation_flows SET enabled=true,published_version_id=version WHERE id=flow;
 INSERT INTO public.automation_event_inbox(id,workspace_id,source,event_id,event_type,schema_version,
  context_refs,state,lease_token,lease_until)
 VALUES(inbox,w,'crm','stage2:engine:1','opportunity.created','1.0.0','{}'::jsonb,
  'pending',lease,clock_timestamp()+interval '2 minutes');
 activation:=encode(sha256(convert_to(array_to_json(ARRAY[w::text,version::text,'crm','stage2:engine:1'])::text,'UTF8')),'hex');
 decision:=jsonb_build_object('dispatchAuthorized',false,'state','waiting','activationKey',activation,
  'trace',jsonb_build_array(
   jsonb_build_object('nodeId',trigger_node,'type','trigger','status','evaluated','nextPort','out'),
   jsonb_build_object('nodeId',wait_node,'type','wait','status','waiting')),
  'plannedActions','[]'::jsonb);
 result:=public.automation_live_engine_finish(w,inbox,lease,
  jsonb_build_array(jsonb_build_object('flowVersionId',version,'decision',decision)));
 IF result->>'ok'<>'true' OR result->>'dispatchAuthorized'<>'false'
  OR (SELECT state FROM public.automation_event_inbox WHERE id=inbox)<>'processed'
  OR NOT EXISTS(SELECT 1 FROM public.automation_executions execution
    JOIN public.automation_live_waits wait ON wait.execution_id=execution.id
    WHERE execution.inbox_id=inbox AND execution.state='waiting'
     AND wait.node_id=wait_node AND wait.state='waiting')
 THEN RAISE EXCEPTION 'LIVE_ENGINE_WAIT_COMMIT_NOT_ATOMIC'; END IF;
 BEGIN
  PERFORM public.automation_live_engine_finish(w,inbox,lease,
   jsonb_build_array(jsonb_build_object('flowVersionId',version,'decision',decision)));
  RAISE EXCEPTION 'LIVE_ENGINE_REPLAY_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'LIVE_ENGINE_REPLAY_NOT_FENCED'; END IF;
END $qa$;
ROLLBACK;
SELECT 'stage2-engine-commit-qa-passed' AS qa;
