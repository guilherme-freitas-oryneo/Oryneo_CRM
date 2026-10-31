-- Disposable PostgreSQL 17 QA for shadow wait continuation.
\set ON_ERROR_STOP on
DO $grants$
BEGIN
 IF has_function_privilege('anon','public.automation_wait_shadow_resume(uuid,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_wait_shadow_resume(uuid,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_wait_shadow_resume_fail(uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Shadow resume exposed to untrusted roles'; END IF;
END $grants$;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='af000000-0000-4000-8000-000000000001';
 f uuid:='af000000-0000-4000-8000-000000000002';
 v uuid:='af000000-0000-4000-8000-000000000003';
 timer_node text:='9a000000-0000-4000-8000-000000000005';
 terminal_node text:='9a000000-0000-4000-8000-000000000008';
 trigger_node text:='9a000000-0000-4000-8000-000000000004';
 conv uuid:='af000000-0000-4000-8000-000000000006';
 inbox uuid; claim record; wait_id uuid; graph jsonb; plan jsonb;
 done jsonb; blocked boolean; retry text;
BEGIN
 SELECT graph_json INTO graph FROM public.automation_flow_versions
 WHERE id='9a000000-0000-4000-8000-000000000003';
 IF graph IS NULL THEN RAISE EXCEPTION 'Wait fixture absent'; END IF;
 graph:=jsonb_set(graph,'{id}',to_jsonb(f::text));
 INSERT INTO public.automation_workspaces(id,slug,active)
  VALUES(w,'qa-shadow-resumption',true);
 INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop)
  VALUES(w,'shadow',false);
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
  VALUES(f,w,'qa-resume','QA wait resume','sdr',false);
 INSERT INTO public.automation_flow_versions
  (id,workspace_id,flow_id,version,schema_version,status,content_sha256,
   graph_json,published_at,published_by)
 VALUES(v,w,f,1,'1.0.0','published',repeat('e',64),graph,now(),
   'af000000-0000-4000-8000-000000000099');
 UPDATE public.automation_flows SET published_version_id=v WHERE id=f;
 inbox:=public.automation_shadow_ingest(w,'whatsapp','qa.resume.first',
  'conversation.inbound',jsonb_build_object('conversation_id',conv));
 SELECT * INTO claim FROM public.automation_shadow_claim(w,1);
 IF NOT FOUND OR claim.inbox_id IS DISTINCT FROM inbox THEN
  RAISE EXCEPTION 'Failed to claim first shadow event'; END IF;
 PERFORM public.automation_shadow_finish(w,inbox,claim.lease_token,
  jsonb_build_array(jsonb_build_object('flowVersionId',v,'decision',
  jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
   'state','waiting','activationKey',repeat('a',64),'issues','[]'::jsonb,
   'plannedActions','[]'::jsonb,
   'trace',jsonb_build_array(
    jsonb_build_object('nodeId',trigger_node,'type','trigger','status','evaluated'),
    jsonb_build_object('nodeId',timer_node,'type','wait','status','waiting'))))));
 SELECT id INTO wait_id FROM public.automation_wait_timers
 WHERE workspace_id=w AND node_id=timer_node;
 IF wait_id IS NULL THEN RAISE EXCEPTION 'Atomic wait missing'; END IF;
 UPDATE public.automation_wait_timers SET due_at=now()-interval '1 second' WHERE id=wait_id;
 PERFORM public.automation_wait_shadow_poll(w,10);
 plan:=jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
  'state','completed','trace',
  jsonb_build_array(jsonb_build_object(
   'nodeId',terminal_node,'type','end','status','completed')),
  'plannedActions','[]'::jsonb);
 blocked:=false;
 BEGIN
  PERFORM public.automation_wait_shadow_resume(w,wait_id,
    jsonb_set(plan,'{trace,0,nodeId}',to_jsonb('af000000-0000-4000-8000-0000000000ff'::text)));
 EXCEPTION WHEN invalid_parameter_value THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Forged graph continuation accepted'; END IF;
 done:=public.automation_wait_shadow_resume(w,wait_id,plan);
 IF done->>'resumed'<>'true' OR done->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'Continuation not acknowledged'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
  WHERE id=wait_id AND resumed_at IS NOT NULL AND reason_code='SHADOW_RESUMED')
  OR NOT EXISTS(SELECT 1 FROM public.automation_node_executions
    WHERE node_id=terminal_node
      AND execution_id=(SELECT execution_id FROM public.automation_wait_timers WHERE id=wait_id))
 THEN RAISE EXCEPTION 'Durable resumed trace missing'; END IF;
 done:=public.automation_wait_shadow_resume(w,wait_id,plan);
 IF done->>'alreadyResumed'<>'true' THEN RAISE EXCEPTION 'Duplicate resume not idempotent'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE workspace_id=w
  AND state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Continuation created outbound action'; END IF;
 -- A second due wait exercises non-PII retries and dead letter quarantine.
 inbox:=public.automation_shadow_ingest(w,'whatsapp','qa.resume.second',
  'conversation.inbound',jsonb_build_object('conversation_id',conv));
 SELECT * INTO claim FROM public.automation_shadow_claim(w,1);
 IF NOT FOUND OR claim.inbox_id IS DISTINCT FROM inbox THEN
  RAISE EXCEPTION 'Failed to claim second shadow event'; END IF;
 PERFORM public.automation_shadow_finish(w,inbox,claim.lease_token,
  jsonb_build_array(jsonb_build_object('flowVersionId',v,'decision',
  jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
   'state','waiting','activationKey',repeat('b',64),'issues','[]'::jsonb,
   'plannedActions','[]'::jsonb,
   'trace',jsonb_build_array(
    jsonb_build_object('nodeId',trigger_node,'type','trigger','status','evaluated'),
    jsonb_build_object('nodeId',timer_node,'type','wait','status','waiting'))))));
 SELECT id INTO wait_id FROM public.automation_wait_timers
 WHERE workspace_id=w AND node_id=timer_node AND resumed_at IS NULL;
 IF wait_id IS NULL THEN RAISE EXCEPTION 'Second wait missing'; END IF;
 UPDATE public.automation_wait_timers SET due_at=now()-interval '1 second' WHERE id=wait_id;
 PERFORM public.automation_wait_shadow_poll(w,10);
 retry:=public.automation_wait_shadow_resume_fail(w,wait_id,'SHADOW_RESUME_PLAN');
 IF retry<>'retry_scheduled' OR NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE id=wait_id AND resume_attempts=1 AND resume_next_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Resume backoff not persisted'; END IF;
 UPDATE public.automation_wait_timers SET resume_attempts=4 WHERE id=wait_id;
 retry:=public.automation_wait_shadow_resume_fail(w,wait_id,'SHADOW_RESUME_PLAN');
 IF retry<>'quarantined' OR NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE id=wait_id AND state='cancelled' AND reason_code='SHADOW_CONTINUATION_DEAD_LETTER')
 THEN RAISE EXCEPTION 'Resume dead letter missing'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
END $qa$;
RESET ROLE;
SELECT 'shadow-resume-qa-passed' AS qa_result;
